// O tablet, imitado.
//
//   node testes/achados.mjs
//
// Este teste não depende de nada estar ligado: ele sobe o próprio servidor num
// banco descartável e derruba no fim. Roda em qualquer máquina, inclusive na
// primeira vez que alguém clona o projeto.
//
// O que ele testa é uma coisa só, e é a coisa que dói quando quebra: a
// conversa com o tablet da portaria. Cada verificação aqui repete uma chamada
// que o `SyncRepository.kt` faz de verdade, com os mesmos nomes de campo, os
// mesmos tipos e a mesma ordem. Se o app Android tem um `val ativa: Boolean`,
// aqui tem uma checagem de que veio `true`, e não `1`.
//
// Ao mexer no src/achados.js, rode isto antes de instalar no PC da escola.
// Erro de sincronização não aparece na tela: aparece como item duplicado três
// dias depois, ou como mochila que sumiu da lista.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, crc32 } from "node:zlib";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORTA = Number(process.env.PORTA_TESTE || 8123);
const B = `http://127.0.0.1:${PORTA}`;
const CHAVE = "chave-de-teste-do-tablet-nao-usar-em-producao";
const pastaDados = mkdtempSync(join(tmpdir(), "achados-teste-"));

let falhas = 0;
function ok(nome, cond, extra = "") {
  console.log(`  ${cond ? "ok  " : "FALHA"}  ${nome}${extra ? "  -> " + extra : ""}`);
  if (!cond) falhas++;
}

// Chamada com a chave, do jeito que o OkHttp do tablet faz.
async function tablet(metodo, caminho, corpo) {
  const r = await fetch(B + caminho, {
    method: metodo,
    headers: { "X-Api-Key": CHAVE, ...(corpo !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined
  });
  let dados = null;
  try { dados = await r.json(); } catch { /* 204 não tem corpo, e está certo */ }
  return { status: r.status, dados, bytes: Number(r.headers.get("content-length") || 0) };
}

// Um PNG de verdade, pequeno. Foto falsa em base64 ("AAAA") passaria pelo
// servidor e não provaria nada sobre gravar imagem em disco.
function pngDeMentira(cor = [200, 60, 60]) {
  const bloco = (tipo, dados) => {
    const corpo = Buffer.concat([Buffer.from(tipo), dados]);
    const tam = Buffer.alloc(4); tam.writeUInt32BE(dados.length);
    const soma = Buffer.alloc(4); soma.writeUInt32BE(crc32(corpo) >>> 0);
    return Buffer.concat([tam, corpo, soma]);
  };
  const cabecalho = Buffer.alloc(13);
  cabecalho.writeUInt32BE(2, 0); cabecalho.writeUInt32BE(2, 4);
  cabecalho[8] = 8; cabecalho[9] = 2;
  const linhas = Buffer.concat([
    Buffer.from([0, ...cor, ...cor]),
    Buffer.from([0, ...cor, ...cor])
  ]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco("IHDR", cabecalho),
    bloco("IDAT", deflateSync(linhas)),
    bloco("IEND", Buffer.alloc(0))
  ]);
}

// ============================================================
// sobe o servidor
// ============================================================
const servidor = spawn(process.execPath, [join(raiz, "src", "servidor.js")], {
  env: { ...process.env, DADOS: pastaDados, PORTA: String(PORTA), CHAVE_TABLET: CHAVE },
  stdio: ["ignore", "pipe", "pipe"]
});
let saidaDoServidor = "";
servidor.stdout.on("data", (d) => (saidaDoServidor += d));
servidor.stderr.on("data", (d) => (saidaDoServidor += d));

function encerrar(codigo) {
  servidor.kill();
  try { rmSync(pastaDados, { recursive: true, force: true }); } catch { /* já foi */ }
  process.exit(codigo);
}

async function esperarSubir() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(B + "/", { signal: AbortSignal.timeout(500) });
      if (r.ok) return true;
    } catch { /* ainda subindo */ }
    await new Promise((p) => setTimeout(p, 250));
  }
  return false;
}

console.log("\n  O tablet, imitado\n  ---------------------------------------------");

if (!await esperarSubir()) {
  console.error("\n  O servidor de teste não subiu.\n" + saidaDoServidor + "\n");
  encerrar(1);
}

try {
  // ============================================================
  // quem pode entrar
  // ============================================================
  let r = await fetch(B + "/api/itens");
  ok("sem chave nenhuma o servidor recusa", r.status === 401);

  r = await fetch(B + "/api/itens", { headers: { "X-Api-Key": "chave-errada" } });
  ok("chave errada tambem e recusada", r.status === 401);

  // Uma chave do tamanho certo mas com o conteúdo trocado: pega comparação que
  // só olha o comprimento.
  r = await fetch(B + "/api/itens", { headers: { "X-Api-Key": "X".repeat(CHAVE.length) } });
  ok("chave do tamanho certo e conteudo errado e recusada", r.status === 401);

  r = await fetch(B + "/");
  ok("a tela de entrada continua aberta a quem nao tem chave", r.status === 200);

  // ============================================================
  // GET /api/sync/categorias
  // ============================================================
  r = await tablet("GET", "/api/sync/categorias");
  const cats = r.dados;
  ok("categorias iniciais chegam", r.status === 200 && cats.length === 5, cats?.length + " categorias");

  const casacos = cats.find((c) => c.nome === "Casacos");
  ok("categoria tem os campos que o CategoriaDto.kt espera",
     casacos && typeof casacos.id === "number" && typeof casacos.nome === "string" &&
     "dataCriacao" in casacos, Object.keys(casacos || {}).join(", "));

  // O Gson do tablet desserializa `ativa` num Boolean. Se o servidor mandar 0/1,
  // o parse explode e a sincronizacao inteira para.
  ok("ativa vem como booleano, nao como 0/1", casacos?.ativa === true,
     JSON.stringify(casacos?.ativa));

  // parseDataServidor corta a fracao de segundo e o Z, mas precisa do T.
  ok("dataCriacao tem o T entre a data e a hora",
     /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(casacos?.dataCriacao || ""), casacos?.dataCriacao);

  r = await tablet("GET", "/api/sync/categorias?desde=2030-01-01T00:00:00");
  ok("o filtro desde= corta o que e mais antigo", r.status === 200 && r.dados.length === 0,
     r.dados?.length + " categorias");

  // ============================================================
  // POST /api/categorias — categoria criada no tablet, offline
  // ============================================================
  r = await tablet("POST", "/api/categorias", { nome: "Óculos", idLocalTablet: "uuid-cat-oculos" });
  const oculos = r.dados;
  ok("categoria criada pelo tablet volta com id", r.status === 201 && oculos.id > 5, "id " + oculos?.id);

  // O SyncRepository trata 409 fazendo merge por nome. Se aqui virasse 500 ou
  // um segundo registro, o tablet entraria em laco tentando criar de novo.
  r = await tablet("POST", "/api/categorias", { nome: "óculos", idLocalTablet: "outro-uuid" });
  ok("nome repetido (mesmo com outra caixa) devolve 409", r.status === 409, r.dados?.erro);

  r = await tablet("GET", "/api/categorias");
  ok("GET /api/categorias devolve so as ativas por padrao",
     r.dados.length === 6 && r.dados.every((c) => c.ativa === true), r.dados.length + " ativas");

  // ============================================================
  // POST /api/sync/itens — o lote do tablet offline
  // ============================================================
  const foto = pngDeMentira().toString("base64");
  const lote = [
    {
      descricao: "Casaco azul com capuz", localEncontrado: "Pátio",
      categoriaServidorId: 3, categoriaIdLocalTablet: null, status: 0,
      dataCadastro: "2026-08-01T13:04:00", dataDevolucao: null,
      tabletId: "tablet-01", idLocalTablet: "item-a",
      fotoBase64: foto, nomeArquivoFoto: "foto.png"
    },
    {
      // Categoria que o tablet criou offline: chega sem id do servidor, só com
      // o UUID. É o caso que o ResolverCategoria tem de cobrir.
      descricao: "Óculos de grau", localEncontrado: null,
      categoriaServidorId: null, categoriaIdLocalTablet: "uuid-cat-oculos", status: 0,
      dataCadastro: "2026-08-02T09:00:00", dataDevolucao: null,
      tabletId: "tablet-01", idLocalTablet: "item-b",
      fotoBase64: null, nomeArquivoFoto: null
    },
    {
      descricao: "Item de categoria que nao existe", localEncontrado: null,
      categoriaServidorId: 9999, categoriaIdLocalTablet: "uuid-que-nao-existe", status: 0,
      dataCadastro: "2026-08-03T09:00:00", dataDevolucao: null,
      tabletId: "tablet-01", idLocalTablet: "item-c",
      fotoBase64: null, nomeArquivoFoto: null
    }
  ];

  r = await tablet("POST", "/api/sync/itens", lote);
  ok("o lote responde no formato do SyncResponseDto.kt",
     r.status === 200 && ["recebidos", "criados", "atualizados", "erros"].every((c) => c in r.dados),
     JSON.stringify(r.dados));
  ok("dois itens entram e o terceiro vira erro",
     r.dados.criados === 2 && r.dados.erros.length === 1, JSON.stringify(r.dados));
  ok("o erro comeca pelo idLocalTablet, para achar no log do aparelho",
     String(r.dados.erros[0]).startsWith("item-c:"), r.dados.erros[0]);

  // O caso que mais dói: a Wi-Fi caiu no meio, o tablet reenvia o lote inteiro.
  // Tem de virar atualizacao. Se virar item novo, a portaria acorda com a lista
  // duplicada e ninguem sabe qual mochila e qual.
  r = await tablet("POST", "/api/sync/itens", lote);
  ok("reenviar o mesmo lote nao cria item repetido",
     r.dados.criados === 0 && r.dados.atualizados === 2, JSON.stringify(r.dados));

  r = await tablet("GET", "/api/itens");
  ok("depois de dois envios continuam dois itens", r.dados.length === 2, r.dados.length + " itens");

  // ============================================================
  // GET /api/itens — o que o baixarItens() do tablet lê
  // ============================================================
  const casaco = r.dados.find((i) => i.descricao === "Casaco azul com capuz");
  const campos = ["id", "descricao", "localEncontrado", "categoriaId", "categoriaNome",
                  "status", "dataCadastro", "dataDevolucao", "urlFoto", "tabletId", "idLocalTablet"];
  ok("o item tem todos os campos do ItemDto.kt",
     campos.every((c) => c in casaco), campos.filter((c) => !(c in casaco)).join(", ") || "todos");

  ok("status vem como numero, nao como texto", casaco.status === 0, JSON.stringify(casaco.status));
  ok("categoriaNome vem preenchido", casaco.categoriaNome === "Casacos", casaco.categoriaNome);

  // O tablet passa a urlFoto inteira no @Url do Retrofit, ignorando a baseUrl.
  // Caminho relativo aqui = foto que nunca baixa no aparelho.
  ok("urlFoto e absoluta, com http e endereco",
     /^https?:\/\/[^/]+\/fotos\/[0-9a-f]{32}\.png$/.test(casaco.urlFoto || ""), casaco.urlFoto);

  const imagem = await fetch(casaco.urlFoto);
  const baixada = Buffer.from(await imagem.arrayBuffer());
  ok("a foto baixa e chega byte a byte igual a que subiu",
     imagem.ok && baixada.equals(pngDeMentira()), baixada.length + " bytes");

  r = await tablet("GET", "/api/itens?categoriaId=3");
  ok("o filtro por categoria funciona", r.dados.length === 1, r.dados.length + " itens");
  r = await tablet("GET", "/api/itens?status=1");
  ok("o filtro por status funciona", r.dados.length === 0, r.dados.length + " itens");

  // ============================================================
  // PATCH /api/itens/{id}/status
  // ============================================================
  const id = casaco.id;
  r = await tablet("PATCH", `/api/itens/${id}/status`, { status: 1 });
  // O ApiService.kt declara Response<Unit>: qualquer corpo aqui vira erro de
  // parse no aparelho.
  ok("marcar como devolvido responde 204 sem corpo", r.status === 204 && r.dados === null);

  r = await tablet("GET", `/api/itens/${id}`);
  ok("a data de entrega e carimbada sozinha",
     r.dados.status === 1 && /^\d{4}-\d{2}-\d{2}T/.test(r.dados.dataDevolucao || ""),
     r.dados.dataDevolucao);

  const entregueEm = r.dados.dataDevolucao;
  await tablet("PATCH", `/api/itens/${id}/status`, { status: 0 });
  await tablet("PATCH", `/api/itens/${id}/status`, { status: 1 });
  r = await tablet("GET", `/api/itens/${id}`);
  ok("remarcar como entregue nao reescreve o dia em que saiu",
     r.dados.dataDevolucao === entregueEm, r.dados.dataDevolucao);

  r = await tablet("PATCH", `/api/itens/${id}/status`, { status: 7 });
  ok("situacao que nao existe e recusada", r.status === 400, r.dados?.erro);

  // Sincronizacao atrasada chega depois que a secretaria ja corrigiu o texto
  // pela tela. Ela so pode mexer na situacao.
  await tablet("POST", "/api/sync/itens", [{ ...lote[0], descricao: "TEXTO ANTIGO DO TABLET", status: 2 }]);
  r = await tablet("GET", `/api/itens/${id}`);
  ok("sync atrasada muda a situacao mas nao reescreve a descricao",
     r.dados.descricao === "Casaco azul com capuz" && r.dados.status === 2, r.dados.descricao);

  // ============================================================
  // POST /api/itens em multipart — o caminho de quando o tablet tem Wi-Fi
  // ============================================================
  const forma = new FormData();
  forma.append("Descricao", "Garrafa térmica");
  forma.append("LocalEncontrado", "Quadra");
  forma.append("CategoriaId", "2");
  forma.append("TabletId", "tablet-02");
  forma.append("IdLocalTablet", "item-multipart");
  forma.append("foto", new Blob([pngDeMentira([30, 90, 200])], { type: "image/png" }), "camera.png");

  const rm = await fetch(B + "/api/itens", {
    method: "POST", headers: { "X-Api-Key": CHAVE }, body: forma
  });
  const criado = await rm.json();
  ok("cadastro com foto em multipart responde 201", rm.status === 201, criado?.erro || criado?.descricao);
  ok("o acento sobrevive ao multipart", criado?.descricao === "Garrafa térmica", criado?.descricao);

  const img2 = await fetch(criado.urlFoto);
  const bin2 = Buffer.from(await img2.arrayBuffer());
  ok("a foto do multipart chega inteira, sem byte trocado",
     bin2.equals(pngDeMentira([30, 90, 200])), bin2.length + " bytes");

  // ============================================================
  // DELETE
  // ============================================================
  r = await tablet("DELETE", `/api/itens/${criado.id}`);
  ok("apagar item responde 204", r.status === 204);
  r = await tablet("GET", `/api/itens/${criado.id}`);
  ok("depois de apagar o item some mesmo", r.status === 404);

  // ============================================================
  // o lote grande, que estourava o limite de 1 MB do sistema
  // ============================================================
  // O express.json do sistema aceita 1 MB, que basta para um pagamento e nao
  // basta para cinco fotos em base64. As rotas do tablet tem leitor proprio.
  const fotaza = Buffer.alloc(700 * 1024, 7).toString("base64");
  const loteGordo = [1, 2, 3, 4, 5].map((n) => ({
    descricao: `Item grande ${n}`, localEncontrado: null,
    categoriaServidorId: 1, categoriaIdLocalTablet: null, status: 0,
    dataCadastro: "2026-08-05T10:00:00", dataDevolucao: null,
    tabletId: "tablet-03", idLocalTablet: `gordo-${n}`,
    fotoBase64: fotaza, nomeArquivoFoto: "grande.jpg"
  }));
  r = await tablet("POST", "/api/sync/itens", loteGordo);
  ok("lote de 5 fotos (uns 4,5 MB) passa sem estourar limite",
     r.status === 200 && r.dados.criados === 5, `status ${r.status}, ${JSON.stringify(r.dados).slice(0, 90)}`);

  // ============================================================
  // o resto do sistema continua trancado
  // ============================================================
  // A chave do tablet abre o achados e perdidos e nada mais. Se ela desse
  // acesso a /api/turmas, um aparelho na portaria leria a lista de alunos.
  r = await fetch(B + "/api/turmas", { headers: { "X-Api-Key": CHAVE } });
  ok("a chave do tablet nao abre o resto do sistema", r.status === 401);
  r = await fetch(B + "/api/usuarios", { headers: { "X-Api-Key": CHAVE } });
  ok("a chave do tablet nao le o cadastro de quem usa o sistema", r.status === 401);

} catch (erro) {
  console.error("\n  O teste parou no meio:", erro.message, "\n", erro.stack);
  falhas++;
}

console.log(`\n  ${falhas ? falhas + " falha(s)" : "tudo passou"}\n`);
encerrar(falhas ? 1 : 0);

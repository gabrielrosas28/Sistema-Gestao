// Achados e Perdidos — o que aparece perdido pela escola.
//
// Duas bocas para os mesmos dados:
//   • o tablet da portaria, que cadastra sem internet e sincroniza depois
//   • a tela do site, que a secretaria abre para procurar e dar baixa
//
// O tablet veio de um servidor .NET separado e o app Android continua o mesmo,
// então as rotas daqui imitam as de lá byte a byte: nome de campo em camelCase,
// status como número, urlFoto absoluta, 204 sem corpo no PATCH. Antes de mexer
// em qualquer resposta, leia docs/CONTRATO-TABLET.md — o que parece detalhe
// bobo ali é o que faz a sincronização não duplicar item.

import express from "express";
import { randomUUID, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join, extname } from "node:path";

import { buscar, listar, rodar, anotar, PASTA_DADOS } from "./banco.js";
import { usuarioDaSessao } from "./acesso.js";
import { lerCorpo, separarPartes } from "./multipart.js";

// ============================================================
// onde ficam as fotos
// ============================================================
// Ao lado do banco, dentro de dados/. Assim o Backup.bat, que já leva a pasta
// dados inteira, leva as fotos junto sem ninguém precisar lembrar.
export const PASTA_FOTOS = join(PASTA_DADOS, "fotos");
if (!existsSync(PASTA_FOTOS)) mkdirSync(PASTA_FOTOS, { recursive: true });

// Extensão de imagem e mais nada. A pasta é servida como arquivo estático:
// aceitar .html ou .svg aqui seria deixar qualquer tablet publicar página no
// endereço do sistema da secretaria.
const EXTENSOES = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".gif"]);
const TAMANHO_MAXIMO_FOTO = 20 * 1024 * 1024;   // 20 MB, igual ao servidor antigo
const TAMANHO_MAXIMO_LOTE = 30 * 1024 * 1024;   // lote de 5 fotos em base64 cabe

function salvarFoto(bytes, nomeOriginal) {
  let ext = extname(String(nomeOriginal || "")).toLowerCase();
  if (!EXTENSOES.has(ext)) ext = ".jpg";
  // Nome sorteado, nunca o que veio do cliente: nome de arquivo é a porta de
  // entrada clássica para gravar fora da pasta ("../../algo").
  const nome = randomUUID().replaceAll("-", "") + ext;
  writeFileSync(join(PASTA_FOTOS, nome), bytes);
  return nome;
}

function apagarFoto(nome) {
  if (!nome) return;
  // Recusa qualquer nome que não seja exatamente o que salvamos.
  if (!/^[0-9a-f]{32}\.[a-z]{3,4}$/.test(nome)) return;
  try { unlinkSync(join(PASTA_FOTOS, nome)); } catch { /* já não estava lá */ }
}

// ============================================================
// a chave do tablet
// ============================================================
// O site se identifica por cookie de sessão; o tablet, por uma chave fixa no
// cabeçalho X-Api-Key. No servidor antigo essa chave era digitada à mão no
// appsettings.json e nasceu com o valor "TROCAR-ESTA-CHAVE-EM-PRODUCAO" — que
// é exatamente o tipo de coisa que ninguém troca. Aqui ela é sorteada na
// primeira partida e aparece em Ajustes para a coordenação copiar.
export function chaveDoTablet() {
  if (process.env.CHAVE_TABLET) return process.env.CHAVE_TABLET;
  const guardada = buscar(`SELECT valor FROM sistema WHERE chave = 'chave_tablet'`);
  if (guardada?.valor) return guardada.valor;
  const nova = randomBytes(24).toString("hex");
  rodar(`INSERT INTO sistema (chave, valor) VALUES ('chave_tablet', ?)`, nova);
  return nova;
}

// Comparação que demora igual acertando ou errando, para a chave não poder ser
// descoberta letra por letra medindo o tempo de resposta.
function chaveConfere(enviada, correta) {
  if (typeof enviada !== "string" || enviada.length !== correta.length) return false;
  let diferenca = 0;
  for (let i = 0; i < correta.length; i++) diferenca |= enviada.charCodeAt(i) ^ correta.charCodeAt(i);
  return diferenca === 0;
}

/**
 * Deixa passar quem tem sessão do site OU a chave do tablet.
 * Preenche req.usuario quando for gente logada; fica nulo quando for o tablet.
 */
function deixarEntrar(req, res, prox) {
  req.usuario = usuarioDaSessao(req.cookies?.sessao);
  if (req.usuario) return prox();

  if (chaveConfere(req.get("X-Api-Key"), chaveDoTablet())) {
    req.doTablet = true;
    return prox();
  }
  res.status(401).json({ erro: "Faça login para continuar." });
}

// ============================================================
// formatos que o tablet espera
// ============================================================
const ENCONTRADO = 0, DEVOLVIDO = 1, EXPIRADO = 2;

const agoraUtc = () => new Date().toISOString().slice(0, 19);

// O tablet manda "2026-08-18T13:04:00". Aceita também com fração e com Z, e
// aceita o formato de espaço caso alguma linha antiga tenha entrado assim.
function dataParaGuardar(valor) {
  if (!valor) return null;
  const t = String(valor).trim().replace(" ", "T").split(".")[0].replace(/Z$/, "");
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(t) ? t : null;
}

const dataParaEnviar = (v) => (v ? String(v).replace(" ", "T") : null);

function categoriaParaEnviar(c) {
  return {
    id: c.id,
    nome: c.nome,
    // Booleano de verdade: o Gson do tablet desserializa num Boolean, e 0/1
    // viraria erro de conversão em vez de categoria desativada.
    ativa: !!c.ativa,
    dataCriacao: dataParaEnviar(c.criada_em),
    emoji: c.emoji ?? null
  };
}

// A urlFoto tem de ser absoluta: o tablet joga ela inteira no Retrofit,
// ignorando a URL base. Caminho relativo faz a foto simplesmente não baixar.
function enderecoBase(req) {
  const protocolo = req.get("X-Forwarded-Proto") || req.protocol || "http";
  return `${protocolo}://${req.get("host")}`;
}

function itemParaEnviar(i, req) {
  return {
    id: i.id,
    descricao: i.descricao,
    localEncontrado: i.local_encontrado ?? null,
    categoriaId: i.categoria_id,
    categoriaNome: i.categoria_nome ?? "",
    status: i.status,
    dataCadastro: dataParaEnviar(i.data_cadastro),
    dataDevolucao: dataParaEnviar(i.data_devolucao),
    urlFoto: i.nome_arquivo_foto ? `${enderecoBase(req)}/fotos/${i.nome_arquivo_foto}` : null,
    tabletId: i.tablet_id ?? null,
    idLocalTablet: i.id_local_tablet ?? null
  };
}

const SQL_ITEM = `SELECT i.*, c.nome AS categoria_nome
                    FROM ap_itens i JOIN ap_categorias c ON c.id = i.categoria_id`;

// Procura categoria pelo nome sem diferenciar maiúscula — inclusive com acento.
//
// A comparação acontece aqui, em JavaScript, e não no SQL. O COLLATE NOCASE do
// SQLite só rebaixa as 26 letras do alfabeto inglês: para ele "Óculos" e
// "óculos" são nomes diferentes, e o servidor deixava as duas entrarem. O
// tablet, do outro lado, compara com o lowercase() do Kotlin, que sabe de
// acento — então ele via uma categoria só e ficava tentando criar de novo a que
// já existia, tomando 409 em toda sincronização.
//
// O índice único no banco continua lá como última defesa (pega os casos sem
// acento se dois aparelhos gravarem no mesmo instante), mas quem manda é isto.
const chaveDoNome = (n) => String(n || "").trim().toLowerCase();

function acharCategoriaPorNome(nome, exceto = null) {
  const alvo = chaveDoNome(nome);
  return listar(`SELECT * FROM ap_categorias`)
    .find((c) => chaveDoNome(c.nome) === alvo && c.id !== exceto) ?? null;
}

// ============================================================
// montagem
// ============================================================
export function montarAchados(app) {
  const achados = express.Router();

  // Só estes caminhos são do achados e perdidos. O router é montado na raiz do
  // app, então sem essa lista ele passaria a mão em toda requisição do sistema
  // — inclusive na tela de entrada, que não pode exigir estar logado.
  const MEUS = ["/api/categorias", "/api/itens", "/api/sync", "/api/achados"];

  // Leitor de JSON próprio, com folga. O do sistema é de 1 MB, o que basta para
  // um lançamento de pagamento e é pouco para um lote de 5 fotos em base64
  // (base64 engorda o arquivo em um terço). Este router é montado antes do
  // leitor global justamente para ganhar a vez nas rotas daqui.
  achados.use(MEUS, express.json({ limit: TAMANHO_MAXIMO_LOTE }));
  achados.use(MEUS, deixarEntrar);

  const rota = (fn) => (req, res) =>
    Promise.resolve(fn(req, res)).catch((e) => {
      if (e?.status) return res.status(e.status).json({ erro: e.message });
      console.error("[erro achados]", req.method, req.path, e);
      res.status(500).json({ erro: "Algo deu errado aqui no servidor. Tente de novo." });
    });

  // Ação que muda dados: o tablet pode, a secretaria pode, visitante não.
  const quemFez = (req) => req.usuario?.id ?? null;

  // ----------------------------------------------------------
  // categorias
  // ----------------------------------------------------------
  achados.get("/api/categorias", rota((req, res) => {
    // O padrão é só as ativas — é assim que o tablet chama, sem parâmetro.
    const todas = req.query.somenteAtivas === "false" || req.query.somenteAtivas === "0";
    const lista = listar(
      `SELECT * FROM ap_categorias ${todas ? "" : "WHERE ativa = 1"} ORDER BY nome`);
    res.json(lista.map(categoriaParaEnviar));
  }));

  achados.get("/api/categorias/:id", rota((req, res) => {
    const c = buscar(`SELECT * FROM ap_categorias WHERE id = ?`, req.params.id);
    if (!c) return res.status(404).json({ erro: "Categoria não encontrada." });
    res.json(categoriaParaEnviar(c));
  }));

  achados.post("/api/categorias", rota((req, res) => {
    const nome = String(req.body?.nome || "").trim();
    if (!nome) return res.status(400).json({ erro: "Dê um nome à categoria." });
    if (nome.length > 100) return res.status(400).json({ erro: "Nome longo demais." });

    // Igual ao merge que o tablet faz por nome, acento incluído.
    if (acharCategoriaPorNome(nome))
      return res.status(409).json({ erro: "Já existe uma categoria com este nome." });

    const emoji = String(req.body?.emoji || "").trim() || null;
    const r = rodar(
      `INSERT INTO ap_categorias (nome, emoji, id_local_tablet, criada_em)
       VALUES (?, ?, ?, ?)`,
      nome, emoji, req.body?.idLocalTablet || null, agoraUtc());
    anotar(quemFez(req), "criou categoria de achados", "ap_categoria",
           Number(r.lastInsertRowid), { nome, tablet: !!req.doTablet });
    res.status(201).json(categoriaParaEnviar(
      buscar(`SELECT * FROM ap_categorias WHERE id = ?`, Number(r.lastInsertRowid))));
  }));

  achados.put("/api/categorias/:id", rota((req, res) => {
    const c = buscar(`SELECT * FROM ap_categorias WHERE id = ?`, req.params.id);
    if (!c) return res.status(404).json({ erro: "Categoria não encontrada." });

    const nome = String(req.body?.nome ?? c.nome).trim();
    if (!nome) return res.status(400).json({ erro: "Dê um nome à categoria." });
    if (acharCategoriaPorNome(nome, c.id))
      return res.status(409).json({ erro: "Já existe uma categoria com este nome." });

    const ativa = req.body?.ativa === undefined ? c.ativa : (req.body.ativa ? 1 : 0);
    const emoji = req.body?.emoji === undefined
      ? c.emoji : (String(req.body.emoji || "").trim() || null);

    rodar(`UPDATE ap_categorias SET nome = ?, ativa = ?, emoji = ? WHERE id = ?`,
          nome, ativa, emoji, c.id);
    anotar(quemFez(req), "editou categoria de achados", "ap_categoria", c.id, { nome, ativa });
    res.status(204).end();
  }));

  // Desativar, não apagar: item já cadastrado continua apontando para ela e o
  // histórico da escola não pode ficar sem nome de categoria.
  achados.delete("/api/categorias/:id", rota((req, res) => {
    const c = buscar(`SELECT * FROM ap_categorias WHERE id = ?`, req.params.id);
    if (!c) return res.status(404).json({ erro: "Categoria não encontrada." });
    rodar(`UPDATE ap_categorias SET ativa = 0 WHERE id = ?`, c.id);
    anotar(quemFez(req), "desativou categoria de achados", "ap_categoria", c.id, { nome: c.nome });
    res.status(204).end();
  }));

  // ----------------------------------------------------------
  // itens
  // ----------------------------------------------------------
  achados.get("/api/itens", rota((req, res) => {
    const filtros = [], p = [];
    if (req.query.categoriaId) { filtros.push("i.categoria_id = ?"); p.push(Number(req.query.categoriaId)); }
    if (req.query.status !== undefined && req.query.status !== "") {
      filtros.push("i.status = ?"); p.push(Number(req.query.status));
    }
    const onde = filtros.length ? `WHERE ${filtros.join(" AND ")}` : "";
    const itens = listar(`${SQL_ITEM} ${onde} ORDER BY i.data_cadastro DESC, i.id DESC`, ...p);
    res.json(itens.map((i) => itemParaEnviar(i, req)));
  }));

  achados.get("/api/itens/:id", rota((req, res) => {
    const i = buscar(`${SQL_ITEM} WHERE i.id = ?`, req.params.id);
    if (!i) return res.status(404).json({ erro: "Item não encontrado." });
    res.json(itemParaEnviar(i, req));
  }));

  // Cadastro com foto, em multipart. É por aqui que a secretaria cadastra pela
  // tela do site, e é a rota que o tablet usa quando está online.
  achados.post("/api/itens", rota(async (req, res) => {
    const tipo = req.get("content-type") || "";
    let campos, foto = null;

    if (tipo.startsWith("multipart/form-data")) {
      const corpo = await lerCorpo(req, TAMANHO_MAXIMO_FOTO);
      const partes = separarPartes(corpo, tipo);
      campos = partes.campos;
      foto = partes.arquivos.foto || null;
    } else {
      campos = req.body || {};
    }

    const descricao = String(campos.Descricao ?? campos.descricao ?? "").trim();
    if (!descricao) return res.status(400).json({ erro: "Descreva o que foi encontrado." });

    const categoriaId = Number(campos.CategoriaId ?? campos.categoriaId);
    const categoria = buscar(`SELECT * FROM ap_categorias WHERE id = ?`, categoriaId);
    if (!categoria) return res.status(400).json({ erro: "Categoria inexistente." });

    const local = String(campos.LocalEncontrado ?? campos.localEncontrado ?? "").trim() || null;
    const tabletId = String(campos.TabletId ?? campos.tabletId ?? "").trim() || null;
    const idLocal = String(campos.IdLocalTablet ?? campos.idLocalTablet ?? "").trim() || null;

    let nomeFoto = null;
    if (foto) nomeFoto = salvarFoto(foto.dados, foto.nomeArquivo);
    else if (campos.fotoBase64) nomeFoto = salvarFoto(
      Buffer.from(String(campos.fotoBase64), "base64"), campos.nomeArquivoFoto || "foto.jpg");

    const r = rodar(
      `INSERT INTO ap_itens (descricao, local_encontrado, categoria_id, status,
                             data_cadastro, nome_arquivo_foto, tablet_id, id_local_tablet,
                             criado_por, criado_por_nome)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      descricao, local, categoriaId, ENCONTRADO, agoraUtc(), nomeFoto,
      tabletId, idLocal, quemFez(req), req.usuario?.nome ?? null);

    anotar(quemFez(req), "cadastrou achado", "ap_item", Number(r.lastInsertRowid),
           { descricao, categoria: categoria.nome });
    res.status(201).json(itemParaEnviar(
      buscar(`${SQL_ITEM} WHERE i.id = ?`, Number(r.lastInsertRowid)), req));
  }));

  // 204 sem corpo: o Retrofit do tablet espera Response<Unit> nesta rota.
  achados.patch("/api/itens/:id/status", rota((req, res) => {
    const i = buscar(`SELECT * FROM ap_itens WHERE id = ?`, req.params.id);
    if (!i) return res.status(404).json({ erro: "Item não encontrado." });

    const status = Number(req.body?.status);
    if (![ENCONTRADO, DEVOLVIDO, EXPIRADO].includes(status))
      return res.status(400).json({ erro: "Situação inválida." });

    // A data de entrega é carimbada na primeira vez e não se mexe depois:
    // remarcar como devolvido não pode reescrever o dia em que a mochila saiu.
    const devolucao = status === DEVOLVIDO ? (i.data_devolucao || agoraUtc()) : i.data_devolucao;
    rodar(`UPDATE ap_itens SET status = ?, data_devolucao = ? WHERE id = ?`,
          status, devolucao, i.id);
    anotar(quemFez(req), status === DEVOLVIDO ? "entregou achado" : "mudou situação de achado",
           "ap_item", i.id, { descricao: i.descricao, status });
    res.status(204).end();
  }));

  achados.delete("/api/itens/:id", rota((req, res) => {
    const i = buscar(`SELECT * FROM ap_itens WHERE id = ?`, req.params.id);
    if (!i) return res.status(404).json({ erro: "Item não encontrado." });
    rodar(`DELETE FROM ap_itens WHERE id = ?`, i.id);
    apagarFoto(i.nome_arquivo_foto);
    anotar(quemFez(req), "apagou achado", "ap_item", i.id, { descricao: i.descricao });
    res.status(204).end();
  }));

  // ----------------------------------------------------------
  // sincronização com o tablet
  // ----------------------------------------------------------
  achados.get("/api/sync/categorias", rota((req, res) => {
    const desde = dataParaGuardar(req.query.desde);
    const lista = desde
      ? listar(`SELECT * FROM ap_categorias WHERE criada_em >= ? ORDER BY id`, desde)
      : listar(`SELECT * FROM ap_categorias ORDER BY id`);
    res.json(lista.map(categoriaParaEnviar));
  }));

  // O coração do offline-first. O tablet manda o que cadastrou sem internet, em
  // lotes de 5, e reenvia o lote inteiro quando a Wi-Fi cai no meio — então
  // receber duas vezes o mesmo item é o caso normal, não o caso de erro.
  achados.post("/api/sync/itens", rota((req, res) => {
    const lote = req.body;
    if (!Array.isArray(lote)) return res.status(400).json({ erro: "Esperava uma lista de itens." });

    let criados = 0, atualizados = 0;
    const erros = [];

    for (const dto of lote) {
      try {
        // A identidade é o par tablet + id local. Sem isso, cada reenvio viraria
        // um item novo e a portaria acordaria com a lista triplicada.
        const existente = dto.idLocalTablet
          ? buscar(`SELECT * FROM ap_itens WHERE tablet_id = ? AND id_local_tablet = ?`,
                   dto.tabletId ?? null, dto.idLocalTablet)
          : null;

        if (existente) {
          // Reenvio mexe só na situação. Descrição, local e foto ficam como
          // estão: uma sync atrasada não pode desfazer a correção que a
          // secretaria acabou de fazer pela tela.
          const status = Number(dto.status ?? existente.status);
          const devolucao = dataParaGuardar(dto.dataDevolucao)
            ?? (status === DEVOLVIDO ? (existente.data_devolucao || agoraUtc()) : existente.data_devolucao);
          rodar(`UPDATE ap_itens SET status = ?, data_devolucao = ? WHERE id = ?`,
                status, devolucao, existente.id);
          atualizados++;
          continue;
        }

        const categoriaId = resolverCategoria(dto);
        const descricao = String(dto.descricao || "").trim();
        if (!descricao) throw new Error("Item sem descrição.");

        let nomeFoto = null;
        if (dto.fotoBase64) {
          nomeFoto = salvarFoto(Buffer.from(String(dto.fotoBase64), "base64"),
                                dto.nomeArquivoFoto || "foto.jpg");
        }

        rodar(
          `INSERT INTO ap_itens (descricao, local_encontrado, categoria_id, status,
                                 data_cadastro, data_devolucao, nome_arquivo_foto,
                                 tablet_id, id_local_tablet)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          descricao,
          String(dto.localEncontrado || "").trim() || null,
          categoriaId,
          Number(dto.status ?? ENCONTRADO),
          dataParaGuardar(dto.dataCadastro) || agoraUtc(),
          dataParaGuardar(dto.dataDevolucao),
          nomeFoto,
          dto.tabletId ?? null,
          dto.idLocalTablet ?? null);
        criados++;
      } catch (e) {
        // O tablet lê esta lista e, se ela vier com alguma coisa, deixa o lote
        // inteiro pendente para tentar de novo. O idLocalTablet na frente é o
        // que permite achar o item no log do aparelho.
        erros.push(`${dto?.idLocalTablet ?? "?"}: ${e.message}`);
      }
    }

    res.json({ recebidos: lote.length, criados, atualizados, erros });
  }));

  // ----------------------------------------------------------
  // extras da tela do site (não fazem parte do contrato do tablet)
  // ----------------------------------------------------------
  achados.get("/api/achados/resumo", rota((req, res) => {
    const r = buscar(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(status = 0), 0) AS aguardando,
              COALESCE(SUM(status = 1), 0) AS devolvidos,
              COALESCE(SUM(status = 2), 0) AS expirados,
              COALESCE(SUM(status = 0 AND data_cadastro >= ?), 0) AS na_semana
         FROM ap_itens`,
      new Date(Date.now() - 7 * 86400e3).toISOString().slice(0, 19));
    res.json({
      ...r,
      categorias: buscar(`SELECT COUNT(*) AS n FROM ap_categorias WHERE ativa = 1`).n,
      // Mais antigo ainda esperando dono — é o que vira "hora de encerrar".
      maisAntigo: buscar(
        `SELECT data_cadastro FROM ap_itens WHERE status = 0
          ORDER BY data_cadastro LIMIT 1`)?.data_cadastro ?? null
    });
  }));

  app.use(achados);

  // As fotos são servidas sem exigir chave: a URL já é um nome sorteado de 32
  // letras e o tablet baixa a imagem por ela. Cache longo porque o nome nunca
  // é reaproveitado — foto trocada é foto com outro nome.
  app.use("/fotos", express.static(PASTA_FOTOS, {
    maxAge: "30d",
    setHeaders: (res) => res.setHeader("X-Content-Type-Options", "nosniff")
  }));
}

// Categoria do item que chegou do tablet: primeiro pelo id do servidor, depois
// pelo UUID que o tablet deu quando criou a categoria offline, e por último
// pelo nome. Sem nenhum dos três, o item volta como erro em vez de entrar
// pendurado numa categoria qualquer.
function resolverCategoria(dto) {
  if (dto.categoriaServidorId != null) {
    const c = buscar(`SELECT id FROM ap_categorias WHERE id = ?`, Number(dto.categoriaServidorId));
    if (c) return c.id;
  }
  if (dto.categoriaIdLocalTablet) {
    const c = buscar(`SELECT id FROM ap_categorias WHERE id_local_tablet = ?`,
                     dto.categoriaIdLocalTablet);
    if (c) return c.id;
  }
  if (dto.categoriaNome) {
    const c = acharCategoriaPorNome(dto.categoriaNome);
    if (c) return c.id;
  }
  throw new Error("Categoria não encontrada no servidor.");
}

export { ENCONTRADO, DEVOLVIDO, EXPIRADO };

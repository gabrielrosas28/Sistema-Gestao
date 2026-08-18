// Quem pode o quê, e o que sobra quando alguém sai.
//
//   node testes/permissoes.mjs
//
// Sobe o próprio servidor num banco descartável, como o testes/achados.mjs.
// Aqui o assunto são as três regras que mudaram:
//
//   1. a secretaria cria evento; editar e cancelar continuam da coordenação
//   2. a coordenação fecha o evento inteiro — que arquiva, não apaga
//   3. a coordenação exclui alguém do sistema de vez, e o histórico do
//      dinheiro continua sabendo quem fez cada coisa
//
// A terceira é a que mais merece teste. Excluir uma pessoa mexe em pagamento
// lançado, turma fechada e registro de auditoria ao mesmo tempo. Se um desses
// vínculos ficar solto, o erro não aparece na hora: aparece meses depois, num
// relatório que diz que o dinheiro entrou sem ninguém ter recebido.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORTA = Number(process.env.PORTA_TESTE || 8124);
const B = `http://127.0.0.1:${PORTA}`;
const pastaDados = mkdtempSync(join(tmpdir(), "permissoes-teste-"));
const ANO = new Date().getFullYear();

let falhas = 0;
function ok(nome, cond, extra = "") {
  console.log(`  ${cond ? "ok  " : "FALHA"}  ${nome}${extra ? "  -> " + extra : ""}`);
  if (!cond) falhas++;
}

// Cada pessoa tem o seu cookie: dá para alternar entre secretaria e
// coordenação sem entrar e sair o tempo todo.
const sessoes = { coord: "", secre: "" };
async function como(quem, metodo, caminho, corpo) {
  const r = await fetch(B + caminho, {
    method: metodo,
    headers: { "Content-Type": "application/json", ...(sessoes[quem] ? { Cookie: sessoes[quem] } : {}) },
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined
  });
  const set = r.headers.getSetCookie?.() || [];
  if (set.length) sessoes[quem] = set.map((c) => c.split(";")[0]).join("; ");
  let dados = null;
  try { dados = await r.json(); } catch { /* 204 */ }
  return { status: r.status, dados };
}

// ============================================================
// banco de brincadeira
// ============================================================
// Feito antes de o servidor subir, para ele já achar tudo pronto. As duas
// pessoas entram pelo próprio módulo do sistema, para a senha nascer com o
// mesmo hash que a tela de entrada espera.
process.env.DADOS = pastaDados;
// import() dinâmico pede URL, não caminho: no Windows "C:\..." vira protocolo
// "c:" e o Node recusa. Mesma regra do src/iniciar.js.
const urlBanco = pathToFileURL(join(raiz, "src", "banco.js")).href;
const urlAcesso = pathToFileURL(join(raiz, "src", "acesso.js")).href;
const { rodar, listar } = await import(urlBanco);
const { criarUsuario } = await import(urlAcesso);

criarUsuario({ nome: "Dora Coordenadora", email: "dora@escola.br", senha: "senha12345", papel: "coordenacao" });
criarUsuario({ nome: "Sara Secretária", email: "sara@escola.br", senha: "senha12345", papel: "secretaria" });
const idSara = listar(`SELECT id FROM usuarios WHERE email = 'sara@escola.br'`)[0].id;

const turma = Number(rodar(
  `INSERT INTO turmas (codigo, nome, segmento, professora, ordem, ano_letivo)
   VALUES ('2A', '2º ano A', 'fundamental', 'Tia Márcia', 1, ?)`, ANO).lastInsertRowid);
for (const nome of ["Alice Moura", "Bento Carvalho", "Cecília Duarte"]) {
  rodar(`INSERT INTO alunos (matricula, nome, turma_id) VALUES (?, ?, ?)`,
        nome.slice(0, 3).toUpperCase(), nome, turma);
}

// ============================================================
// sobe o servidor
// ============================================================
const servidor = spawn(process.execPath, [join(raiz, "src", "servidor.js")], {
  env: { ...process.env, DADOS: pastaDados, PORTA: String(PORTA) },
  stdio: ["ignore", "pipe", "pipe"]
});
let saida = "";
servidor.stdout.on("data", (d) => (saida += d));
servidor.stderr.on("data", (d) => (saida += d));

function encerrar(codigo) {
  servidor.kill();
  try { rmSync(pastaDados, { recursive: true, force: true }); } catch { /* já foi */ }
  process.exit(codigo);
}

async function esperarSubir() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(B + "/", { signal: AbortSignal.timeout(500) })).ok) return true; }
    catch { /* ainda subindo */ }
    await new Promise((p) => setTimeout(p, 250));
  }
  return false;
}

console.log("\n  Quem pode o que\n  ---------------------------------------------");
if (!await esperarSubir()) {
  console.error("\n  O servidor de teste não subiu.\n" + saida + "\n");
  encerrar(1);
}

try {
  await como("coord", "POST", "/api/sessao", { email: "dora@escola.br", senha: "senha12345" });
  await como("secre", "POST", "/api/sessao", { email: "sara@escola.br", senha: "senha12345" });

  let r = await como("secre", "GET", "/api/eu");
  ok("a secretaria entra e ja recebe a versao do sistema",
     r.dados?.papel === "secretaria" && !!r.dados?.versao, r.dados?.versao);

  // ============================================================
  // 1. a secretaria cria evento
  // ============================================================
  r = await como("secre", "POST", "/api/eventos", {
    nome: "Festa junina", categoria: "comemoracao", inicio: `${ANO}-06-20`,
    cobra: true, valor: 30, turmas: [turma]
  });
  const evento = r.dados?.id;
  ok("a secretaria cria evento", r.status === 201 && !!evento, r.dados?.erro || "id " + evento);

  r = await como("secre", "PUT", `/api/eventos/${evento}`, {
    nome: "Festa junina 2", categoria: "comemoracao", inicio: `${ANO}-06-20`, valor: 30
  });
  ok("a secretaria nao edita evento", r.status === 403, r.dados?.erro);

  r = await como("secre", "DELETE", `/api/eventos/${evento}`);
  ok("a secretaria nao cancela evento", r.status === 403, r.dados?.erro);

  // ============================================================
  // 2. fechar o evento inteiro
  // ============================================================
  r = await como("secre", "GET", `/api/eventos/${evento}/turmas/${turma}`);
  const alunos = r.dados.alunos;
  ok("a turma abre com os alunos prontos para lancar", alunos.length === 3, alunos.length + " alunos");

  r = await como("secre", "POST", "/api/pagamentos",
                 { participacao_id: alunos[0].participacao_id, valor: 30, meio: "pix" });
  ok("a secretaria lanca pagamento", r.status === 201, r.dados?.erro);

  r = await como("secre", "POST", `/api/eventos/${evento}/fechamento`);
  ok("a secretaria nao fecha evento", r.status === 403, r.dados?.erro);

  r = await como("coord", "POST", `/api/eventos/${evento}/fechamento`);
  ok("a coordenacao fecha o evento", r.status === 201 && !!r.dados?.fechado_em, r.dados?.fechado_em);

  // Fechado é arquivado, não apagado: some da tela de cobrança e continua
  // existindo em todo o resto.
  r = await como("secre", "GET", "/api/eventos?cobra=1");
  ok("evento fechado sai da lista de eventos com cobranca",
     !r.dados.some((e) => e.id === evento), r.dados.length + " eventos na lista");

  r = await como("secre", "GET", "/api/eventos?cobra=1&arquivados=1");
  ok("e aparece na lista de arquivados",
     r.dados.some((e) => e.id === evento), r.dados.length + " arquivados");

  r = await como("secre", "GET", `/api/calendario?mes=${ANO}-06`);
  ok("evento fechado continua no calendario",
     r.dados.eventos.some((e) => e.id === evento), r.dados.eventos.length + " no mes");

  r = await como("secre", "GET", `/api/relatorios/pagamentos?evento=${evento}`);
  ok("o relatorio do evento fechado continua saindo",
     r.status === 200 && r.dados.turmas[0].resumo.pagos === 1, JSON.stringify(r.dados?.turmas?.[0]?.resumo));

  // Travado quer dizer travado: nem lançar, nem estornar, nem mexer na
  // participação de quem quer que seja.
  r = await como("secre", "POST", "/api/pagamentos",
                 { participacao_id: alunos[1].participacao_id, valor: 30, meio: "pix" });
  ok("evento fechado nao aceita pagamento novo", r.status === 423, r.dados?.erro);

  r = await como("secre", "DELETE", `/api/pagamentos/${alunos[0].pagamento_id || 1}`,
                 { motivo: "teste" });
  ok("evento fechado nao aceita estorno", r.status === 423, r.dados?.erro);

  r = await como("secre", "PUT", `/api/participacoes/${alunos[1].participacao_id}`, { participa: false });
  ok("evento fechado nao aceita mexer na participacao", r.status === 423, r.dados?.erro);

  r = await como("coord", "PUT", `/api/eventos/${evento}`, {
    nome: "Outro nome", categoria: "comemoracao", inicio: `${ANO}-06-20`, valor: 30
  });
  ok("nem a coordenacao edita evento fechado sem reabrir", r.status === 423, r.dados?.erro);

  r = await como("secre", "GET", `/api/eventos/${evento}/turmas/${turma}`);
  ok("a turma aparece fechada por causa do evento",
     r.dados.fechada === true && r.dados.eventoFechado === true,
     JSON.stringify({ fechada: r.dados.fechada, evento: r.dados.eventoFechado }));

  r = await como("secre", "DELETE", `/api/eventos/${evento}/fechamento`);
  ok("a secretaria nao reabre evento", r.status === 403, r.dados?.erro);

  r = await como("coord", "DELETE", `/api/eventos/${evento}/fechamento`);
  ok("a coordenacao reabre o evento", r.status === 200 && !r.dados?.fechado_em);

  r = await como("secre", "POST", "/api/pagamentos",
                 { participacao_id: alunos[1].participacao_id, valor: 30, meio: "dinheiro" });
  ok("depois de reabrir volta a lancar pagamento", r.status === 201, r.dados?.erro);

  // ============================================================
  // 2b. a coordenacao mexe nas turmas do evento
  // ============================================================
  const turmaB = Number(rodar(
    `INSERT INTO turmas (codigo, nome, segmento, professora, ordem, ano_letivo)
     VALUES ('3B', '3º ano B', 'fundamental', 'Tia Paula', 2, ?)`, ANO).lastInsertRowid);
  rodar(`INSERT INTO alunos (matricula, nome, turma_id) VALUES ('DAV', 'Davi Nogueira', ?)`, turmaB);

  const eventoBase = {
    nome: "Festa junina", categoria: "comemoracao",
    inicio: `${ANO}-06-20`, fim: null, valor: 30
  };

  r = await como("coord", "PUT", `/api/eventos/${evento}`, { ...eventoBase, turmas: [turma, turmaB] });
  ok("a coordenacao adiciona uma turma ao evento", r.status === 200 && r.dados.entraram === 1,
     JSON.stringify({ entraram: r.dados?.entraram, sairam: r.dados?.sairam }));

  r = await como("secre", "GET", `/api/eventos/${evento}/turmas/${turmaB}`);
  ok("o aluno da turma nova ja entra pronto para pagar",
     r.dados.alunos.length === 1 && r.dados.alunos[0].valor === 30, r.dados.alunos?.length + " aluno");

  r = await como("coord", "PUT", `/api/eventos/${evento}`, { ...eventoBase, turmas: [turma] });
  ok("turma sem pagamento nenhum pode sair", r.status === 200 && r.dados.sairam === 1,
     JSON.stringify({ sairam: r.dados?.sairam }));

  // A turma original tem dois pagamentos lançados. Tirar ela do evento apagaria
  // as participações — e com elas o registro de dinheiro que entrou de verdade.
  r = await como("coord", "PUT", `/api/eventos/${evento}`, { ...eventoBase, turmas: [turmaB] });
  ok("turma com pagamento lancado NAO sai do evento", r.status === 409, r.dados?.erro);

  r = await como("coord", "GET", `/api/eventos/${evento}`);
  ok("e depois da recusa o evento continua exatamente como estava",
     r.dados.turmas.length === 1 && r.dados.turmas[0].id === turma,
     r.dados.turmas.map((t) => t.nome).join(", "));
  ok("a tela recebe quantos pagamentos cada turma tem, para travar o chip",
     r.dados.turmas[0].resumo.pagos === 2, JSON.stringify(r.dados.turmas[0].resumo?.pagos));

  r = await como("secre", "PUT", `/api/eventos/${evento}`, { ...eventoBase, turmas: [turma, turmaB] });
  ok("a secretaria continua sem poder mexer nas turmas", r.status === 403, r.dados?.erro);

  // ============================================================
  // 3. excluir quem usa o sistema
  // ============================================================
  // A Sara criou o evento e lançou dois pagamentos. É de propósito: é
  // exatamente essa pessoa que não pode sumir do histórico do dinheiro.
  r = await como("coord", "POST", "/api/fechamentos", { evento_id: evento, turma_id: turma });
  ok("a coordenacao fecha a turma", r.status === 201, r.dados?.erro);

  r = await como("secre", "DELETE", `/api/usuarios/${idSara}`);
  ok("a secretaria nao exclui ninguem", r.status === 403, r.dados?.erro);

  const idDora = (await como("coord", "GET", "/api/eu")).dados.id;
  r = await como("coord", "DELETE", `/api/usuarios/${idDora}`);
  ok("ninguem exclui a si mesmo", r.status === 409, r.dados?.erro);

  r = await como("coord", "DELETE", `/api/usuarios/${idSara}`);
  ok("a coordenacao exclui a secretaria de vez, com o rastro do que ela fez",
     r.status === 200 && r.dados.pagou === 2 && r.dados.criou === 1, JSON.stringify(r.dados));

  r = await como("coord", "GET", "/api/usuarios");
  ok("a pessoa some do cadastro", !r.dados.some((u) => u.id === idSara), r.dados.length + " pessoas");

  r = await como("secre", "GET", "/api/eu");
  ok("e perde o acesso na hora, mesmo com a sessao aberta", r.status === 401);

  // O ponto todo do exercício: o dinheiro continua tendo dono.
  const bd = new DatabaseSync(join(pastaDados, "gestao.db"), { readOnly: true });
  const pagamentos = bd.prepare(`SELECT * FROM pagamentos`).all();
  ok("os pagamentos continuam la", pagamentos.length === 2, pagamentos.length + " pagamentos");
  ok("e continuam dizendo quem recebeu",
     pagamentos.every((p) => p.lancado_por === null && p.lancado_por_nome === "Sara Secretária"),
     pagamentos.map((p) => p.lancado_por_nome).join(", "));

  // A Dora continua no sistema, então este fechamento mantém o vínculo. O nome
  // ao lado é gravado na hora de fechar, e não só na hora de excluir: é ele que
  // vai segurar a informação no dia em que ela sair.
  const fech = bd.prepare(`SELECT * FROM fechamentos`).all()[0];
  ok("o fechamento de turma ja nasce com o nome de quem fechou",
     fech.fechado_por !== null && fech.fechado_por_nome === "Dora Coordenadora", fech.fechado_por_nome);

  const evLinha = bd.prepare(`SELECT * FROM eventos WHERE id = ?`).get(evento);
  ok("o evento continua sabendo que foi a Sara que criou",
     evLinha.criado_por === null && evLinha.criado_por_nome === "Sara Secretária",
     evLinha.criado_por_nome);

  const daSara = bd.prepare(
    `SELECT * FROM registro WHERE usuario_nome = 'Sara Secretária'`).all();
  ok("o historico dela continua inteiro, com nome",
     daSara.length >= 3 && daSara.every((l) => l.usuario_id === null),
     daSara.length + " linhas no historico");

  const soltos = bd.prepare(`PRAGMA foreign_key_check`).all();
  ok("nenhum vinculo do banco ficou quebrado", soltos.length === 0,
     soltos.length ? JSON.stringify(soltos.slice(0, 2)) : "banco integro");
  bd.close();

  r = await como("coord", "GET", "/api/registro");
  ok("o historico na tela mostra o nome de quem ja saiu",
     r.dados.some((l) => l.usuario === "Sara Secretária"), r.dados.length + " linhas");

  // A última coordenação ativa não pode sair: sem ela ninguém reabre turma
  // nem cadastra gente, e o sistema fica trancado por fora.
  r = await como("coord", "POST", "/api/usuarios", {
    nome: "Novo Secretário", email: "novo@escola.br", senha: "senha12345", papel: "secretaria"
  });
  const idNovo = r.dados?.id;
  r = await como("coord", "DELETE", `/api/usuarios/${idNovo}`);
  ok("quem nunca mexeu em nada sai limpo",
     r.status === 200 && r.dados.pagou === 0, JSON.stringify(r.dados));

  r = await como("coord", "POST", "/api/usuarios", {
    nome: "Outra Coord", email: "outra@escola.br", senha: "senha12345", papel: "coordenacao"
  });
  const idOutra = r.dados?.id;
  r = await como("coord", "PUT", `/api/usuarios/${idOutra}`, { ativo: false });
  ok("desativar outra coordenacao funciona", r.status === 200, r.dados?.erro);

  r = await como("coord", "DELETE", `/api/usuarios/${idOutra}`);
  ok("coordenacao desativada pode ser excluida pela que esta ativa", r.status === 200, r.dados?.erro);

  // Sozinha e sem poder excluir a si mesma, a Dora não consegue deixar o
  // sistema sem coordenação nenhuma — que é o objetivo da trava.
  r = await como("coord", "DELETE", `/api/usuarios/${idDora}`);
  ok("a unica coordenacao que sobrou nao consegue sair", r.status === 409, r.dados?.erro);

  r = await como("coord", "GET", "/api/usuarios");
  ok("no fim resta so a coordenacao ativa",
     r.dados.length === 1 && r.dados[0].papel === "coordenacao",
     r.dados.map((u) => u.nome).join(", "));

} catch (erro) {
  console.error("\n  O teste parou no meio:", erro.message, "\n", erro.stack);
  falhas++;
}

console.log(`\n  ${falhas ? falhas + " falha(s)" : "tudo passou"}\n`);
encerrar(falhas ? 1 : 0);

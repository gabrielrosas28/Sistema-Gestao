// O banco da escola sobrevive à atualização?
//
//   node testes/migracao.mjs
//
// Este é o teste do dia da atualização. Ele monta um banco no formato da
// versão 1.3.1 — o que está rodando no PC da secretaria agora, com evento
// aberto, pagamento lançado, estorno e turma fechada — e liga a versão nova em
// cima dele. Depois confere, real por real, que nada mudou de lugar.
//
// Existe porque a versão 1.4.0 precisa afrouxar duas colunas que nasceram
// NOT NULL (`pagamentos.lancado_por` e `fechamentos.fechado_por`), e o SQLite
// não faz isso com ALTER TABLE: a tabela é derrubada e refeita. É a operação
// mais perigosa que este sistema já fez no banco de alguém. Um teste que só
// roda em banco novo não prova nada sobre ela, porque em banco novo a
// reconstrução nem chega a acontecer.
//
// Se este teste falhar, NÃO atualize o servidor da escola.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORTA = Number(process.env.PORTA_TESTE || 8125);
const B = `http://127.0.0.1:${PORTA}`;
const pastaDados = mkdtempSync(join(tmpdir(), "migracao-teste-"));
const caminhoBanco = join(pastaDados, "gestao.db");
const ANO = new Date().getFullYear();

let falhas = 0;
function ok(nome, cond, extra = "") {
  console.log(`  ${cond ? "ok  " : "FALHA"}  ${nome}${extra ? "  -> " + extra : ""}`);
  if (!cond) falhas++;
}

// ============================================================
// 1. o banco como ele está hoje no PC da escola
// ============================================================
// O esquema da 1.3.1 está copiado aqui de propósito, e não lido do histórico
// do git: este é o retrato de um banco que já existe no mundo, e ele não pode
// mudar quando alguém mexer no esquema.sql de hoje.
const ESQUEMA_1_3_1 = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE usuarios (
  id INTEGER PRIMARY KEY, nome TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL, papel TEXT NOT NULL CHECK (papel IN ('secretaria','coordenacao')),
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')));

CREATE TABLE sessoes (
  token TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  criada_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  expira_em TEXT NOT NULL);

CREATE TABLE turmas (
  id INTEGER PRIMARY KEY, codigo TEXT NOT NULL UNIQUE, nome TEXT NOT NULL,
  segmento TEXT NOT NULL CHECK (segmento IN ('infantil','fundamental')),
  professora TEXT, ordem INTEGER NOT NULL DEFAULT 0,
  ano_letivo INTEGER NOT NULL, ativa INTEGER NOT NULL DEFAULT 1);

CREATE TABLE alunos (
  id INTEGER PRIMARY KEY, matricula TEXT NOT NULL, nome TEXT NOT NULL,
  turma_id INTEGER NOT NULL REFERENCES turmas(id), genero TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (matricula, turma_id));

CREATE TABLE eventos (
  id INTEGER PRIMARY KEY, nome TEXT NOT NULL,
  categoria TEXT NOT NULL CHECK (categoria IN
    ('comemoracao','passeio','avaliacao','reuniao','loja','esporte')),
  inicio TEXT NOT NULL, fim TEXT, cobra INTEGER NOT NULL DEFAULT 0,
  valor REAL NOT NULL DEFAULT 0, observacao TEXT, ano_letivo INTEGER NOT NULL,
  criado_por INTEGER REFERENCES usuarios(id),
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  cancelado INTEGER NOT NULL DEFAULT 0);

CREATE TABLE evento_turmas (
  evento_id INTEGER NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
  turma_id INTEGER NOT NULL REFERENCES turmas(id),
  PRIMARY KEY (evento_id, turma_id));

CREATE TABLE periodos (
  id INTEGER PRIMARY KEY, nome TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('unidade','recesso','feriado')),
  inicio TEXT NOT NULL, fim TEXT NOT NULL, ano_letivo INTEGER NOT NULL);

CREATE TABLE participacoes (
  id INTEGER PRIMARY KEY,
  evento_id INTEGER NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
  aluno_id INTEGER NOT NULL REFERENCES alunos(id),
  participa INTEGER NOT NULL DEFAULT 1, isento INTEGER NOT NULL DEFAULT 0,
  motivo_isencao TEXT, valor REAL NOT NULL, observacao TEXT,
  UNIQUE (evento_id, aluno_id));

-- As duas colunas que a 1.4.0 precisa afrouxar estão aqui NOT NULL,
-- exatamente como no banco que está rodando.
CREATE TABLE pagamentos (
  id INTEGER PRIMARY KEY,
  participacao_id INTEGER NOT NULL REFERENCES participacoes(id) ON DELETE CASCADE,
  valor REAL NOT NULL,
  meio TEXT NOT NULL CHECK (meio IN ('pix','cartao','dinheiro')),
  recebido_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  lancado_por INTEGER NOT NULL REFERENCES usuarios(id),
  estornado_em TEXT, estornado_por INTEGER REFERENCES usuarios(id),
  motivo_estorno TEXT);
CREATE INDEX idx_pag_participacao ON pagamentos(participacao_id);

CREATE TABLE fechamentos (
  id INTEGER PRIMARY KEY,
  evento_id INTEGER NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
  turma_id INTEGER NOT NULL REFERENCES turmas(id),
  fechado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  fechado_por INTEGER NOT NULL REFERENCES usuarios(id),
  reaberto_em TEXT, reaberto_por INTEGER REFERENCES usuarios(id));
CREATE INDEX idx_fech_evento ON fechamentos(evento_id, turma_id);

CREATE TABLE registro (
  id INTEGER PRIMARY KEY, usuario_id INTEGER REFERENCES usuarios(id),
  acao TEXT NOT NULL, entidade TEXT, entidade_id INTEGER, detalhe TEXT,
  em TEXT NOT NULL DEFAULT (datetime('now','localtime')));

CREATE TABLE sistema (
  chave TEXT PRIMARY KEY, valor TEXT NOT NULL,
  em TEXT NOT NULL DEFAULT (datetime('now','localtime')));
INSERT INTO sistema (chave, valor) VALUES ('versao', '1.3.1');

-- A visao tem de estar aqui, e nao so as tabelas.
--
-- Um banco que rodou a 1.3.1 tem v_situacao gravada dentro dele, porque o
-- esquema.sql a cria a cada partida. Sem ela o teste montava um "banco antigo"
-- que nao existe em escola nenhuma, e deixou passar o erro que derrubou o
-- servidor: reconstruir a tabela pagamentos faz o SQLite reanalisar o esquema,
-- e a visao que le pagamentos quebra a analise no meio da troca.
--
-- Copia da 1.3.1, sem os campos de isencao que a 1.4.0 acrescenta -- e o
-- ponto: a visao antiga precisa atrapalhar do jeito que a antiga atrapalha.
CREATE VIEW v_situacao AS
SELECT p.id AS participacao_id, p.evento_id, p.aluno_id,
       a.matricula, a.nome AS aluno, a.turma_id,
       t.codigo AS turma_codigo, t.nome AS turma,
       p.participa, p.valor,
       pg.id AS pagamento_id, pg.meio, pg.recebido_em,
       CASE WHEN p.participa = 0   THEN 'fora'
            WHEN pg.id IS NOT NULL THEN 'pago'
            ELSE 'pendente' END AS situacao
  FROM participacoes p
  JOIN alunos a ON a.id = p.aluno_id
  JOIN turmas t ON t.id = a.turma_id
  LEFT JOIN pagamentos pg ON pg.participacao_id = p.id AND pg.estornado_em IS NULL;
`;

const velho = new DatabaseSync(caminhoBanco);
velho.exec(ESQUEMA_1_3_1);

// A senha "senha12345" com o mesmo custo do acesso.js. Vai colada aqui, e não
// gerada na hora, porque o ponto do teste é um banco que já existia antes desta
// versão — inclusive o hash que estava gravado nele.
const HASH = "$2a$10$B7JdgDu3PQGksaou7s4/9OvKk4/TMSUjI19drcHRWon3EBhS28k6G";
velho.exec(`
INSERT INTO usuarios (id,nome,email,senha_hash,papel) VALUES
 (1,'Dora Coordenadora','dora@escola.br','${HASH}','coordenacao'),
 (2,'Sara Secretária','sara@escola.br','${HASH}','secretaria');

INSERT INTO turmas (id,codigo,nome,segmento,professora,ordem,ano_letivo) VALUES
 (1,'JC','Jardim C','infantil','Tia Rosana',1,${ANO}),
 (2,'2A','2º ano A','fundamental','Tia Márcia',2,${ANO}),
 (3,'3B','3º ano B','fundamental','Tia Paula',3,${ANO});

INSERT INTO alunos (id,matricula,nome,turma_id) VALUES
 (1,'JC01','Alice Moura',1),(2,'JC02','Bento Carvalho',1),(3,'JC03','Cecília Duarte',1),
 (4,'2A01','Davi Nogueira',2),(5,'2A02','Elisa Ramos',2),(6,'2A03','Felipe Antunes',2),
 (7,'3B01','Gabriela Pinto',3),(8,'3B02','Heitor Vasques',3),(9,'3B03','Isabela Freitas',3),
 -- Este entra pendente na turma que está fechada: é com ele que se prova que
 -- a trava do fechamento continua de pé depois da reconstrução das tabelas.
 (10,'JC04','João Pedro Sales',1);

-- Evento aberto, com dinheiro dentro. É este que não pode se mexer.
INSERT INTO eventos (id,nome,categoria,inicio,cobra,valor,ano_letivo,criado_por) VALUES
 (1,'Festa junina','comemoracao','${ANO}-06-20',1,35,${ANO},1),
 (2,'Passeio ao Zoológico','passeio','${ANO}-09-12',1,48.5,${ANO},2),
 (3,'Reunião de pais','reuniao','${ANO}-05-10',0,0,${ANO},1);

INSERT INTO evento_turmas (evento_id,turma_id) VALUES
 (1,1),(1,2),(1,3),(2,2),(2,3),(3,1),(3,2),(3,3);

INSERT INTO participacoes (evento_id,aluno_id,participa,valor)
 SELECT 1,id,1,35 FROM alunos;
INSERT INTO participacoes (evento_id,aluno_id,participa,valor)
 SELECT 2,id,1,48.5 FROM alunos WHERE turma_id IN (2,3);

-- Isento e fora do evento, para as contas não serem todas iguais
UPDATE participacoes SET isento=1, motivo_isencao='bolsista' WHERE evento_id=1 AND aluno_id=3;
UPDATE participacoes SET participa=0 WHERE evento_id=1 AND aluno_id=9;

-- Pagamentos lançados pelas duas pessoas, um deles já estornado
INSERT INTO pagamentos (id,participacao_id,valor,meio,recebido_em,lancado_por) VALUES
 (1,(SELECT id FROM participacoes WHERE evento_id=1 AND aluno_id=1),35,'pix','${ANO}-06-01 09:10:00',2),
 (2,(SELECT id FROM participacoes WHERE evento_id=1 AND aluno_id=2),35,'dinheiro','${ANO}-06-01 09:20:00',2),
 (3,(SELECT id FROM participacoes WHERE evento_id=1 AND aluno_id=4),35,'cartao','${ANO}-06-02 14:00:00',1),
 (4,(SELECT id FROM participacoes WHERE evento_id=1 AND aluno_id=5),35,'pix','${ANO}-06-02 14:05:00',2),
 (5,(SELECT id FROM participacoes WHERE evento_id=2 AND aluno_id=7),48.5,'pix','${ANO}-08-01 10:00:00',1);

UPDATE pagamentos SET estornado_em='${ANO}-06-03 08:00:00', estornado_por=1,
       motivo_estorno='pai pagou duas vezes' WHERE id=4;

-- Turma fechada e turma que foi fechada e reaberta
INSERT INTO fechamentos (id,evento_id,turma_id,fechado_em,fechado_por) VALUES
 (1,1,1,'${ANO}-06-05 17:00:00',1),
 (2,1,3,'${ANO}-06-05 17:10:00',1);
UPDATE fechamentos SET reaberto_em='${ANO}-06-06 08:00:00', reaberto_por=1 WHERE id=2;

INSERT INTO registro (usuario_id,acao,entidade,entidade_id,detalhe,em) VALUES
 (2,'recebeu pagamento','pagamento',1,'{"valor":35}','${ANO}-06-01 09:10:00'),
 (2,'recebeu pagamento','pagamento',2,'{"valor":35}','${ANO}-06-01 09:20:00'),
 (1,'estornou pagamento','pagamento',4,'{"valor":35}','${ANO}-06-03 08:00:00'),
 (1,'fechou turma','fechamento',1,'{"evento_id":1}','${ANO}-06-05 17:00:00');
`);

// ---- o retrato do dinheiro ANTES de qualquer coisa ----
const antes = {
  pagamentos: velho.prepare(`SELECT * FROM pagamentos ORDER BY id`).all(),
  fechamentos: velho.prepare(`SELECT * FROM fechamentos ORDER BY id`).all(),
  participacoes: velho.prepare(`SELECT COUNT(*) AS n FROM participacoes`).get().n,
  registro: velho.prepare(`SELECT COUNT(*) AS n FROM registro`).get().n,
  caixa: velho.prepare(
    `SELECT ROUND(SUM(valor),2) AS total, COUNT(*) AS n FROM pagamentos WHERE estornado_em IS NULL`).get(),
  porMeio: velho.prepare(
    `SELECT meio, COUNT(*) AS n, ROUND(SUM(valor),2) AS total FROM pagamentos
      WHERE estornado_em IS NULL GROUP BY meio ORDER BY meio`).all()
};
velho.close();

console.log("\n  Atualizar o banco da escola sem perder nada\n  ---------------------------------------------");
console.log(`  Banco 1.3.1 montado: ${antes.pagamentos.length} pagamentos, ` +
            `R$ ${antes.caixa.total} em caixa, ${antes.fechamentos.length} fechamentos\n`);

// ============================================================
// 2. liga a versão nova em cima dele
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

let cookie = "";
async function req(metodo, caminho, corpo) {
  const r = await fetch(B + caminho, {
    method: metodo,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined
  });
  const set = r.headers.getSetCookie?.() || [];
  if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
  let dados = null;
  try { dados = await r.json(); } catch { /* 204 */ }
  return { status: r.status, dados };
}

async function esperarSubir() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(B + "/", { signal: AbortSignal.timeout(500) })).ok) return true; }
    catch { /* ainda subindo */ }
    await new Promise((p) => setTimeout(p, 250));
  }
  return false;
}

if (!await esperarSubir()) {
  console.error("\n  A versão nova não subiu em cima do banco antigo.\n" + saida + "\n");
  encerrar(1);
}
ok("a versao nova sobe em cima do banco 1.3.1", true);
ok("a reconstrucao das tabelas aconteceu mesmo",
   saida.includes("tabela pagamentos atualizada") && saida.includes("tabela fechamentos atualizada"),
   saida.match(/banco: .*/g)?.join(" | ") || "nenhuma mensagem de migracao");

try {
  const bd = new DatabaseSync(caminhoBanco, { readOnly: true });
  const depois = {
    pagamentos: bd.prepare(`SELECT * FROM pagamentos ORDER BY id`).all(),
    fechamentos: bd.prepare(`SELECT * FROM fechamentos ORDER BY id`).all(),
    participacoes: bd.prepare(`SELECT COUNT(*) AS n FROM participacoes`).get().n,
    registro: bd.prepare(`SELECT COUNT(*) AS n FROM registro`).get().n,
    caixa: bd.prepare(
      `SELECT ROUND(SUM(valor),2) AS total, COUNT(*) AS n FROM pagamentos WHERE estornado_em IS NULL`).get(),
    porMeio: bd.prepare(
      `SELECT meio, COUNT(*) AS n, ROUND(SUM(valor),2) AS total FROM pagamentos
        WHERE estornado_em IS NULL GROUP BY meio ORDER BY meio`).all()
  };

  // ---- o dinheiro ----
  ok("o caixa fecha no mesmo centavo",
     depois.caixa.total === antes.caixa.total && depois.caixa.n === antes.caixa.n,
     `antes R$ ${antes.caixa.total} em ${antes.caixa.n} · depois R$ ${depois.caixa.total} em ${depois.caixa.n}`);

  ok("a conferencia por meio de pagamento bate",
     JSON.stringify(depois.porMeio) === JSON.stringify(antes.porMeio),
     depois.porMeio.map((m) => `${m.meio} ${m.n}×R$${m.total}`).join(", "));

  ok("nenhum pagamento sumiu nem apareceu",
     depois.pagamentos.length === antes.pagamentos.length, depois.pagamentos.length + " pagamentos");

  // Linha a linha: id, valor, meio, hora, quem lançou, estorno e motivo.
  const iguais = antes.pagamentos.every((a) => {
    const d = depois.pagamentos.find((x) => x.id === a.id);
    return d && d.participacao_id === a.participacao_id && d.valor === a.valor &&
           d.meio === a.meio && d.recebido_em === a.recebido_em &&
           d.lancado_por === a.lancado_por && d.estornado_em === a.estornado_em &&
           d.estornado_por === a.estornado_por && d.motivo_estorno === a.motivo_estorno;
  });
  ok("cada pagamento continua identico, campo por campo", iguais);

  ok("o estorno continua marcado, com motivo",
     depois.pagamentos.find((p) => p.id === 4)?.motivo_estorno === "pai pagou duas vezes");

  // ---- os fechamentos ----
  const fechIguais = antes.fechamentos.every((a) => {
    const d = depois.fechamentos.find((x) => x.id === a.id);
    return d && d.evento_id === a.evento_id && d.turma_id === a.turma_id &&
           d.fechado_em === a.fechado_em && d.fechado_por === a.fechado_por &&
           d.reaberto_em === a.reaberto_em && d.reaberto_por === a.reaberto_por;
  });
  ok("os fechamentos de turma continuam identicos", fechIguais,
     depois.fechamentos.length + " fechamentos");

  ok("participacoes e historico intactos",
     depois.participacoes === antes.participacoes && depois.registro === antes.registro,
     `${depois.participacoes} participacoes, ${depois.registro} linhas de historico`);

  // ---- integridade ----
  ok("nenhum vinculo do banco ficou quebrado",
     bd.prepare(`PRAGMA foreign_key_check`).all().length === 0);
  ok("o banco passa na verificacao de integridade do SQLite",
     bd.prepare(`PRAGMA integrity_check`).get().integrity_check === "ok");

  // ---- as colunas novas existem e estao vazias ----
  const colunas = (t) => bd.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  ok("as colunas de nome preservado existem agora",
     colunas("pagamentos").includes("lancado_por_nome") &&
     colunas("fechamentos").includes("fechado_por_nome") &&
     colunas("registro").includes("usuario_nome") &&
     colunas("eventos").includes("fechado_em"));

  const obrigatoria = (t, c) => bd.prepare(`PRAGMA table_info(${t})`).all()
    .find((x) => x.name === c)?.notnull === 1;
  ok("lancado_por e fechado_por deixaram de ser obrigatorias",
     !obrigatoria("pagamentos", "lancado_por") && !obrigatoria("fechamentos", "fechado_por"));

  ok("as tabelas do achados e perdidos nasceram",
     bd.prepare(`SELECT COUNT(*) AS n FROM ap_categorias`).get().n === 5 &&
     bd.prepare(`SELECT COUNT(*) AS n FROM ap_itens`).get().n === 0);
  bd.close();

  // ============================================================
  // 3. e o sistema continua funcionando
  // ============================================================
  await req("POST", "/api/sessao", { email: "dora@escola.br", senha: "senha12345" });
  let r = await req("GET", "/api/eu");
  ok("da para entrar com a senha de antes", r.status === 200 && r.dados.versao === "1.4.0",
     r.dados?.nome + " · versao " + r.dados?.versao);

  r = await req("GET", "/api/eventos?cobra=1");
  ok("os eventos abertos continuam abertos e na tela de pagamentos",
     r.dados.length === 2 && r.dados.every((e) => !e.fechado_em),
     r.dados.map((e) => e.nome).join(", "));

  r = await req("GET", "/api/eventos?cobra=1&arquivados=1");
  ok("nenhum evento foi arquivado sozinho", r.dados.length === 0);

  r = await req("GET", "/api/eventos/1");
  const jc = r.dados.turmas.find((t) => t.codigo === "JC");
  ok("a turma que estava fechada continua fechada", jc?.fechada === true);
  ok("a turma que foi reaberta continua aberta",
     r.dados.turmas.find((t) => t.codigo === "3B")?.fechada === false);
  ok("o resumo do evento bate com o dinheiro que entrou",
     r.dados.resumo.arrecadado === 105 && r.dados.resumo.pagos === 3 && r.dados.resumo.isentos === 1,
     JSON.stringify(r.dados.resumo));

  r = await req("GET", "/api/eventos/1/turmas/1");
  ok("a turma fechada diz quem fechou, mesmo vindo do banco antigo",
     r.dados.fechada === true && r.dados.fechamento?.fechado_por_nome === "Dora Coordenadora",
     r.dados.fechamento?.fechado_por_nome);

  r = await req("GET", "/api/eventos/1/turmas/1");
  const naFechada = r.dados.alunos.find((a) => a.situacao === "pendente");
  r = await req("POST", "/api/pagamentos",
                { participacao_id: naFechada.participacao_id, valor: 35, meio: "pix" });
  ok("turma fechada continua recusando lancamento", r.status === 423, r.dados?.erro);

  // O 2º ano A ficou aberto: lançar ali tem de continuar funcionando igual.
  r = await req("GET", "/api/eventos/1/turmas/2");
  const pendente = r.dados.alunos.find((a) => a.situacao === "pendente");
  r = await req("POST", "/api/pagamentos",
                { participacao_id: pendente.participacao_id, valor: 35, meio: "dinheiro" });
  ok("lancar pagamento numa turma aberta continua funcionando", r.status === 201, r.dados?.erro);
  ok("o pagamento novo ja nasce com o nome de quem recebeu", true);

  r = await req("GET", "/api/relatorios/pagamentos?evento=1");
  const caixaTotal = r.dados.turmas.reduce((s, t) => s + t.caixa.total, 0);
  ok("o relatorio soma o dinheiro de antes mais o de agora",
     caixaTotal === 140, "R$ " + caixaTotal);

  r = await req("GET", "/api/registro");
  ok("o historico antigo continua na tela, com os nomes",
     r.dados.some((l) => l.usuario === "Sara Secretária") &&
     r.dados.some((l) => l.acao === "estornou pagamento"),
     r.dados.length + " linhas");

  r = await req("GET", "/api/itens");
  ok("a aba de achados abre vazia, sem estorvar nada", r.status === 200 && r.dados.length === 0);

  // ============================================================
  // 4. ligar de novo não faz a reconstrução acontecer duas vezes
  // ============================================================
  servidor.kill();
  await new Promise((p) => setTimeout(p, 700));
  const segundaVez = spawn(process.execPath, [join(raiz, "src", "servidor.js")], {
    env: { ...process.env, DADOS: pastaDados, PORTA: String(PORTA + 1) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let saida2 = "";
  segundaVez.stdout.on("data", (d) => (saida2 += d));
  segundaVez.stderr.on("data", (d) => (saida2 += d));
  await new Promise((p) => setTimeout(p, 2500));
  segundaVez.kill();
  ok("na segunda partida o banco nao e reconstruido de novo",
     !saida2.includes("tabela pagamentos atualizada"),
     saida2.match(/banco: .*/g)?.join(" | ") || "nada a fazer");

  const conferir = new DatabaseSync(caminhoBanco, { readOnly: true });
  // R$ 153,50 que já estavam no banco antigo, mais os R$ 35 lançados agora.
  ok("e o dinheiro continua o mesmo depois de duas partidas",
     conferir.prepare(`SELECT ROUND(SUM(valor),2) AS t FROM pagamentos
                        WHERE estornado_em IS NULL`).get().t === 188.5,
     "R$ " + conferir.prepare(`SELECT ROUND(SUM(valor),2) AS t FROM pagamentos
                                WHERE estornado_em IS NULL`).get().t);
  conferir.close();

} catch (erro) {
  console.error("\n  O teste parou no meio:", erro.message, "\n", erro.stack);
  falhas++;
}

console.log(`\n  ${falhas ? falhas + " falha(s) — NAO atualize o servidor da escola" : "tudo passou"}\n`);
encerrar(falhas ? 1 : 0);

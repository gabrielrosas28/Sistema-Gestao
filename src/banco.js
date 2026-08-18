// Conexão com o banco e criação das tabelas.
//
// Usa o SQLite que já vem dentro do Node — nada para compilar, nada para
// instalar no PC da escola além do próprio Node. Todo acesso a dados passa
// por aqui: é o único arquivo que muda no dia em que o banco virar PostgreSQL.

import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));

// Por padrão o banco fica em dados/gestao.db, ao lado do sistema.
// DADOS=D:\Gestao\dados aponta para outro lugar (outro HD, pasta de rede...).
export const PASTA_DADOS = resolve(process.env.DADOS || join(aqui, "..", "dados"));
if (!existsSync(PASTA_DADOS)) mkdirSync(PASTA_DADOS, { recursive: true });

export const CAMINHO_BANCO = join(PASTA_DADOS, "gestao.db");

export const bd = new DatabaseSync(CAMINHO_BANCO);

// WAL deixa vários PCs lendo enquanto um grava.
bd.exec("PRAGMA journal_mode = WAL");
bd.exec("PRAGMA foreign_keys = ON");
bd.exec("PRAGMA busy_timeout = 5000");

// ============================================================
// atualização automática do banco
// ============================================================
// Quando uma versão nova chega no servidor, o banco antigo se ajusta sozinho
// ao ligar. Ninguém precisa rodar comando de migração nem mexer nos dados.
//
// Como funciona:
//   tabelas  -> CREATE TABLE IF NOT EXISTS, no esquema.sql
//   visões   -> recriadas a cada partida, no esquema.sql
//   colunas  -> garantirColuna() abaixo, que só adiciona o que falta

function garantirColuna(tabela, coluna, definicao) {
  const existe = bd.prepare(`PRAGMA table_info(${tabela})`).all().some((c) => c.name === coluna);
  if (existe) return false;
  bd.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${definicao}`);
  console.log(`  banco: coluna ${tabela}.${coluna} adicionada`);
  return true;
}

const existeTabela = (nome) => !!bd.prepare(
  `SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(nome);

// As colunas precisam existir ANTES da visão que as usa.
if (existeTabela("participacoes")) {
  garantirColuna("participacoes", "isento", "INTEGER NOT NULL DEFAULT 0");
  garantirColuna("participacoes", "motivo_isencao", "TEXT");
}

// Fechar o evento inteiro: trava as turmas todas de uma vez, tira da tela de
// pagamentos e arquiva. Nulo aqui significa evento aberto.
if (existeTabela("eventos")) {
  garantirColuna("eventos", "fechado_em", "TEXT");
  garantirColuna("eventos", "fechado_por", "INTEGER REFERENCES usuarios(id)");
  garantirColuna("eventos", "fechado_por_nome", "TEXT");
  garantirColuna("eventos", "criado_por_nome", "TEXT");
}

// ============================================================
// apagar quem usa o sistema sem apagar o rastro do dinheiro
// ============================================================
// A coordenação pode excluir de vez uma pessoa da secretaria — não só
// desativar. Só que essa pessoa aparece em pagamento lançado, turma fechada e
// no histórico, e um relatório de março não pode virar "recebido por ninguém"
// porque alguém saiu da escola em agosto.
//
// A saída é guardar o nome junto do fato, em texto, e deixar o vínculo com a
// tabela usuarios ficar nulo quando a pessoa sai. Para isso, duas colunas
// precisam parar de ser NOT NULL: pagamentos.lancado_por e
// fechamentos.fechado_por. SQLite não afrouxa NOT NULL com ALTER TABLE, então
// a tabela é reconstruída — uma vez só, e só se ainda estiver apertada.

function colunaEhObrigatoria(tabela, coluna) {
  const c = bd.prepare(`PRAGMA table_info(${tabela})`).all().find((x) => x.name === coluna);
  return !!c && c.notnull === 1;
}

// Reconstrução no formato que a documentação do SQLite recomenda: chaves
// estrangeiras desligadas, tabela nova, cópia, troca de nome, conferência.
// Se a conferência acusar qualquer vínculo quebrado, desfaz tudo e sobe o erro
// — melhor não ligar do que ligar com o banco torto.
function reconstruir(tabela, criar, colunas) {
  bd.exec("PRAGMA foreign_keys = OFF");
  bd.exec("BEGIN");
  try {
    bd.exec(criar.replace(`CREATE TABLE ${tabela}`, `CREATE TABLE _novo_${tabela}`));
    bd.exec(`INSERT INTO _novo_${tabela} (${colunas}) SELECT ${colunas} FROM ${tabela}`);
    bd.exec(`DROP TABLE ${tabela}`);
    bd.exec(`ALTER TABLE _novo_${tabela} RENAME TO ${tabela}`);
    const quebras = bd.prepare(`PRAGMA foreign_key_check`).all();
    if (quebras.length) throw new Error(
      `${tabela}: ${quebras.length} vínculo(s) quebrado(s) na reconstrução`);
    bd.exec("COMMIT");
    console.log(`  banco: tabela ${tabela} atualizada`);
  } catch (e) {
    bd.exec("ROLLBACK");
    throw e;
  } finally {
    bd.exec("PRAGMA foreign_keys = ON");
  }
}

if (existeTabela("pagamentos") && colunaEhObrigatoria("pagamentos", "lancado_por")) {
  reconstruir("pagamentos", `
    CREATE TABLE pagamentos (
      id              INTEGER PRIMARY KEY,
      participacao_id INTEGER NOT NULL REFERENCES participacoes(id) ON DELETE CASCADE,
      valor           REAL    NOT NULL,
      meio            TEXT    NOT NULL CHECK (meio IN ('pix','cartao','dinheiro')),
      recebido_em     TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      lancado_por     INTEGER REFERENCES usuarios(id),
      lancado_por_nome  TEXT,
      estornado_em    TEXT,
      estornado_por   INTEGER REFERENCES usuarios(id),
      estornado_por_nome TEXT,
      motivo_estorno  TEXT
    )`,
    "id, participacao_id, valor, meio, recebido_em, lancado_por, estornado_em, estornado_por, motivo_estorno");
  bd.exec(`CREATE INDEX IF NOT EXISTS idx_pag_participacao ON pagamentos(participacao_id)`);
}

if (existeTabela("fechamentos") && colunaEhObrigatoria("fechamentos", "fechado_por")) {
  reconstruir("fechamentos", `
    CREATE TABLE fechamentos (
      id           INTEGER PRIMARY KEY,
      evento_id    INTEGER NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
      turma_id     INTEGER NOT NULL REFERENCES turmas(id),
      fechado_em   TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      fechado_por  INTEGER REFERENCES usuarios(id),
      fechado_por_nome  TEXT,
      reaberto_em  TEXT,
      reaberto_por INTEGER REFERENCES usuarios(id),
      reaberto_por_nome TEXT
    )`,
    "id, evento_id, turma_id, fechado_em, fechado_por, reaberto_em, reaberto_por");
  bd.exec(`CREATE INDEX IF NOT EXISTS idx_fech_evento ON fechamentos(evento_id, turma_id)`);
}

// Banco criado do zero já nasce com o formato novo; estas linhas cobrem quem
// veio pelo caminho contrário e o registro, que nunca foi NOT NULL.
if (existeTabela("pagamentos")) {
  garantirColuna("pagamentos", "lancado_por_nome", "TEXT");
  garantirColuna("pagamentos", "estornado_por_nome", "TEXT");
}
if (existeTabela("fechamentos")) {
  garantirColuna("fechamentos", "fechado_por_nome", "TEXT");
  garantirColuna("fechamentos", "reaberto_por_nome", "TEXT");
}
if (existeTabela("registro")) {
  garantirColuna("registro", "usuario_nome", "TEXT");
}

// Cria o que ainda não existe e recria as visões. Rodar de novo não quebra nada.
bd.exec(readFileSync(join(aqui, "esquema.sql"), "utf8"));

export const ANO_LETIVO = Number(process.env.ANO_LETIVO || new Date().getFullYear());

// Guarda a versão instalada, para saber o que está rodando em cada servidor.
export const VERSAO = JSON.parse(
  readFileSync(join(aqui, "..", "package.json"), "utf8")).version;
bd.prepare(`INSERT INTO sistema (chave, valor) VALUES ('versao', ?)
            ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor,
                                             em = datetime('now','localtime')`).run(VERSAO);

// ---- atalhos ----
// O SQLite do Node não aceita undefined nem true/false: normaliza antes.
const limpar = (p) => p.map((v) =>
  v === undefined ? null :
  v === true ? 1 :
  v === false ? 0 :
  (typeof v === "number" && !Number.isFinite(v)) ? null : v);

export const buscar = (sql, ...p) => bd.prepare(sql).get(...limpar(p)) ?? null;
export const listar = (sql, ...p) => bd.prepare(sql).all(...limpar(p));
export const rodar  = (sql, ...p) => bd.prepare(sql).run(...limpar(p));

// Registra no histórico quem fez o quê. Chamar em toda ação com dinheiro.
//
// O nome vai junto, em texto, além do vínculo com a tabela usuarios. Parece
// repetição boba e não é: quando a coordenação exclui alguém do sistema o
// vínculo fica nulo, e sem o nome ao lado o histórico inteiro daquela pessoa
// viraria "alguém fez isso".
export function anotar(usuarioId, acao, entidade, entidadeId, detalhe) {
  const nome = usuarioId
    ? buscar(`SELECT nome FROM usuarios WHERE id = ?`, usuarioId)?.nome ?? null
    : null;
  rodar(
    `INSERT INTO registro (usuario_id, usuario_nome, acao, entidade, entidade_id, detalhe)
     VALUES (?, ?, ?, ?, ?, ?)`,
    usuarioId ?? null, nome, acao, entidade ?? null, entidadeId ?? null,
    detalhe ? JSON.stringify(detalhe) : null
  );
}

// Executa várias gravações como uma coisa só: ou tudo entra, ou nada entra.
// Se der erro no meio, o banco volta ao estado anterior.
export function emBloco(fn) {
  return (...args) => {
    bd.exec("BEGIN");
    try {
      const r = fn(...args);
      bd.exec("COMMIT");
      return r;
    } catch (e) {
      bd.exec("ROLLBACK");
      throw e;
    }
  };
}

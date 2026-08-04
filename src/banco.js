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

// As colunas precisam existir ANTES da visão que as usa.
const temParticipacoes = bd.prepare(
  `SELECT 1 FROM sqlite_master WHERE type='table' AND name='participacoes'`).get();
if (temParticipacoes) {
  garantirColuna("participacoes", "isento", "INTEGER NOT NULL DEFAULT 0");
  garantirColuna("participacoes", "motivo_isencao", "TEXT");
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
export function anotar(usuarioId, acao, entidade, entidadeId, detalhe) {
  rodar(
    `INSERT INTO registro (usuario_id, acao, entidade, entidade_id, detalhe)
     VALUES (?, ?, ?, ?, ?)`,
    usuarioId ?? null, acao, entidade ?? null, entidadeId ?? null,
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

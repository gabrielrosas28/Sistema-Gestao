-- ============================================================
-- Banco do sistema Gestão — Colégio Santa Chiara
-- SQLite em modo WAL: vários PCs gravando ao mesmo tempo sem travar.
-- O esquema é ANSI o bastante para migrar para PostgreSQL depois
-- sem reescrever as consultas (ver README, seção "Quando crescer").
-- ============================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------- pessoas que usam o sistema ----------
CREATE TABLE IF NOT EXISTS usuarios (
  id          INTEGER PRIMARY KEY,
  nome        TEXT    NOT NULL,
  email       TEXT    NOT NULL UNIQUE,
  senha_hash  TEXT    NOT NULL,
  papel       TEXT    NOT NULL CHECK (papel IN ('secretaria','coordenacao')),
  ativo       INTEGER NOT NULL DEFAULT 1,
  criado_em   TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sessoes (
  token       TEXT    PRIMARY KEY,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  criada_em   TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  expira_em   TEXT    NOT NULL
);

-- ---------- estrutura da escola ----------
CREATE TABLE IF NOT EXISTS turmas (
  id          INTEGER PRIMARY KEY,
  codigo      TEXT    NOT NULL UNIQUE,          -- 2A, M1B, JC...
  nome        TEXT    NOT NULL,                 -- "2º ano A"
  segmento    TEXT    NOT NULL CHECK (segmento IN ('infantil','fundamental')),
  professora  TEXT,
  ordem       INTEGER NOT NULL DEFAULT 0,       -- ordem de exibição
  ano_letivo  INTEGER NOT NULL,
  ativa       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS alunos (
  id          INTEGER PRIMARY KEY,
  matricula   TEXT    NOT NULL,
  nome        TEXT    NOT NULL,
  turma_id    INTEGER NOT NULL REFERENCES turmas(id),
  genero      TEXT,
  ativo       INTEGER NOT NULL DEFAULT 1,
  criado_em   TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (matricula, turma_id)
);
CREATE INDEX IF NOT EXISTS idx_alunos_turma ON alunos(turma_id);

-- ---------- calendário e eventos ----------
-- Um evento cobre tudo que aparece no calendário: comemoração, passeio,
-- avaliação, reunião, esporte, fardamento. Só cobra quando cobra = 1.
CREATE TABLE IF NOT EXISTS eventos (
  id          INTEGER PRIMARY KEY,
  nome        TEXT    NOT NULL,
  categoria   TEXT    NOT NULL CHECK (categoria IN
                ('comemoracao','passeio','avaliacao','reuniao','loja','esporte')),
  inicio      TEXT    NOT NULL,                 -- AAAA-MM-DD
  fim         TEXT,                             -- nulo = evento de um dia
  cobra       INTEGER NOT NULL DEFAULT 0,
  valor       REAL    NOT NULL DEFAULT 0,       -- valor padrão por aluno
  observacao  TEXT,
  ano_letivo  INTEGER NOT NULL,
  criado_por  INTEGER REFERENCES usuarios(id),
  criado_em   TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  cancelado   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_eventos_data ON eventos(inicio);

CREATE TABLE IF NOT EXISTS evento_turmas (
  evento_id   INTEGER NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
  turma_id    INTEGER NOT NULL REFERENCES turmas(id),
  PRIMARY KEY (evento_id, turma_id)
);

-- ---------- períodos do ano letivo ----------
CREATE TABLE IF NOT EXISTS periodos (
  id          INTEGER PRIMARY KEY,
  nome        TEXT    NOT NULL,                 -- "2ª unidade", "Férias de julho"
  tipo        TEXT    NOT NULL CHECK (tipo IN ('unidade','recesso','feriado')),
  inicio      TEXT    NOT NULL,
  fim         TEXT    NOT NULL,
  ano_letivo  INTEGER NOT NULL
);

-- ---------- dinheiro ----------
-- Participação = "este aluno entra neste evento, por este valor".
-- isento = vai ao evento mas não paga (bolsista, cortesia, irmão, combinado
-- com a direção). Continua contando como participante e some da cobrança.
CREATE TABLE IF NOT EXISTS participacoes (
  id             INTEGER PRIMARY KEY,
  evento_id      INTEGER NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
  aluno_id       INTEGER NOT NULL REFERENCES alunos(id),
  participa      INTEGER NOT NULL DEFAULT 1,
  isento         INTEGER NOT NULL DEFAULT 0,
  motivo_isencao TEXT,
  valor          REAL    NOT NULL,
  observacao     TEXT,
  UNIQUE (evento_id, aluno_id)
);
CREATE INDEX IF NOT EXISTS idx_part_evento ON participacoes(evento_id);

-- Pagamento nunca é apagado: estorno vira uma marca na linha.
-- Assim o relatório de qualquer data passada continua verdadeiro.
CREATE TABLE IF NOT EXISTS pagamentos (
  id              INTEGER PRIMARY KEY,
  participacao_id INTEGER NOT NULL REFERENCES participacoes(id) ON DELETE CASCADE,
  valor           REAL    NOT NULL,
  meio            TEXT    NOT NULL CHECK (meio IN ('pix','cartao','dinheiro')),
  recebido_em     TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  lancado_por     INTEGER NOT NULL REFERENCES usuarios(id),
  estornado_em    TEXT,
  estornado_por   INTEGER REFERENCES usuarios(id),
  motivo_estorno  TEXT
);
CREATE INDEX IF NOT EXISTS idx_pag_participacao ON pagamentos(participacao_id);

-- Fechamento de turma: trava o lançamento até alguém reabrir.
CREATE TABLE IF NOT EXISTS fechamentos (
  id           INTEGER PRIMARY KEY,
  evento_id    INTEGER NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
  turma_id     INTEGER NOT NULL REFERENCES turmas(id),
  fechado_em   TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  fechado_por  INTEGER NOT NULL REFERENCES usuarios(id),
  reaberto_em  TEXT,
  reaberto_por INTEGER REFERENCES usuarios(id)
);
CREATE INDEX IF NOT EXISTS idx_fech_evento ON fechamentos(evento_id, turma_id);

-- ---------- auditoria ----------
-- Toda ação que mexe em dinheiro entra aqui, com nome e hora.
CREATE TABLE IF NOT EXISTS registro (
  id          INTEGER PRIMARY KEY,
  usuario_id  INTEGER REFERENCES usuarios(id),
  acao        TEXT    NOT NULL,
  entidade    TEXT,
  entidade_id INTEGER,
  detalhe     TEXT,
  em          TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_registro_em ON registro(em);

-- ---------- histórico de versões ----------
CREATE TABLE IF NOT EXISTS sistema (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL,
  em    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ---------- visões de apoio ----------
-- Recriada a cada partida, para nunca ficar defasada do código.
DROP VIEW IF EXISTS v_situacao;
CREATE VIEW v_situacao AS
SELECT
  p.id            AS participacao_id,
  p.evento_id,
  p.aluno_id,
  a.matricula,
  a.nome          AS aluno,
  a.turma_id,
  t.codigo        AS turma_codigo,
  t.nome          AS turma,
  p.participa,
  p.isento,
  p.motivo_isencao,
  p.valor,
  -- quanto ainda se espera receber deste aluno
  CASE WHEN p.participa = 1 AND p.isento = 0 THEN p.valor ELSE 0 END AS valor_cobravel,
  pg.id           AS pagamento_id,
  pg.meio,
  pg.recebido_em,
  CASE
    WHEN p.participa = 0     THEN 'fora'
    WHEN pg.id IS NOT NULL   THEN 'pago'
    WHEN p.isento = 1        THEN 'isento'
    ELSE 'pendente'
  END AS situacao
FROM participacoes p
JOIN alunos a ON a.id = p.aluno_id
JOIN turmas t ON t.id = a.turma_id
LEFT JOIN pagamentos pg
  ON pg.participacao_id = p.id AND pg.estornado_em IS NULL;

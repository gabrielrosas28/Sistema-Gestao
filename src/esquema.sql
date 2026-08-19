PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

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

CREATE TABLE IF NOT EXISTS turmas (
  id          INTEGER PRIMARY KEY,
  codigo      TEXT    NOT NULL UNIQUE,
  nome        TEXT    NOT NULL,
  segmento    TEXT    NOT NULL CHECK (segmento IN ('infantil','fundamental')),
  professora  TEXT,
  ordem       INTEGER NOT NULL DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS eventos (
  id          INTEGER PRIMARY KEY,
  nome        TEXT    NOT NULL,
  categoria   TEXT    NOT NULL CHECK (categoria IN
                ('comemoracao','passeio','avaliacao','reuniao','loja','esporte')),
  inicio      TEXT    NOT NULL,
  fim         TEXT,
  cobra       INTEGER NOT NULL DEFAULT 0,
  valor       REAL    NOT NULL DEFAULT 0,
  observacao  TEXT,
  ano_letivo  INTEGER NOT NULL,
  criado_por  INTEGER REFERENCES usuarios(id),
  criado_por_nome TEXT,
  criado_em   TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  cancelado   INTEGER NOT NULL DEFAULT 0,
  fechado_em       TEXT,
  fechado_por      INTEGER REFERENCES usuarios(id),
  fechado_por_nome TEXT
);
CREATE INDEX IF NOT EXISTS idx_eventos_data ON eventos(inicio);

CREATE TABLE IF NOT EXISTS evento_turmas (
  evento_id   INTEGER NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
  turma_id    INTEGER NOT NULL REFERENCES turmas(id),
  PRIMARY KEY (evento_id, turma_id)
);

CREATE TABLE IF NOT EXISTS periodos (
  id          INTEGER PRIMARY KEY,
  nome        TEXT    NOT NULL,
  tipo        TEXT    NOT NULL CHECK (tipo IN ('unidade','recesso','feriado')),
  inicio      TEXT    NOT NULL,
  fim         TEXT    NOT NULL,
  ano_letivo  INTEGER NOT NULL
);

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

CREATE TABLE IF NOT EXISTS pagamentos (
  id              INTEGER PRIMARY KEY,
  participacao_id INTEGER NOT NULL REFERENCES participacoes(id) ON DELETE CASCADE,
  valor           REAL    NOT NULL,
  meio            TEXT    NOT NULL CHECK (meio IN ('pix','cartao','dinheiro')),
  recebido_em     TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  lancado_por        INTEGER REFERENCES usuarios(id),
  lancado_por_nome   TEXT,
  estornado_em       TEXT,
  estornado_por      INTEGER REFERENCES usuarios(id),
  estornado_por_nome TEXT,
  motivo_estorno     TEXT
);
CREATE INDEX IF NOT EXISTS idx_pag_participacao ON pagamentos(participacao_id);

CREATE TABLE IF NOT EXISTS fechamentos (
  id           INTEGER PRIMARY KEY,
  evento_id    INTEGER NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
  turma_id     INTEGER NOT NULL REFERENCES turmas(id),
  fechado_em        TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  fechado_por       INTEGER REFERENCES usuarios(id),
  fechado_por_nome  TEXT,
  reaberto_em       TEXT,
  reaberto_por      INTEGER REFERENCES usuarios(id),
  reaberto_por_nome TEXT
);
CREATE INDEX IF NOT EXISTS idx_fech_evento ON fechamentos(evento_id, turma_id);

CREATE TABLE IF NOT EXISTS registro (
  id          INTEGER PRIMARY KEY,
  usuario_id   INTEGER REFERENCES usuarios(id),
  usuario_nome TEXT,
  acao        TEXT    NOT NULL,
  entidade    TEXT,
  entidade_id INTEGER,
  detalhe     TEXT,
  em          TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_registro_em ON registro(em);

CREATE TABLE IF NOT EXISTS sistema (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL,
  em    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS ap_categorias (
  id              INTEGER PRIMARY KEY,
  nome            TEXT    NOT NULL,
  ativa           INTEGER NOT NULL DEFAULT 1,
  emoji           TEXT,
  id_local_tablet TEXT,
  criada_em       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ap_cat_nome  ON ap_categorias(nome COLLATE NOCASE);
CREATE INDEX        IF NOT EXISTS idx_ap_cat_local ON ap_categorias(id_local_tablet);

CREATE TABLE IF NOT EXISTS ap_itens (
  id                INTEGER PRIMARY KEY,
  descricao         TEXT    NOT NULL,
  local_encontrado  TEXT,
  categoria_id      INTEGER NOT NULL REFERENCES ap_categorias(id),
  status            INTEGER NOT NULL DEFAULT 0,
  data_cadastro     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now')),
  data_devolucao    TEXT,
  nome_arquivo_foto TEXT,
  tablet_id         TEXT,
  id_local_tablet   TEXT,
  criado_por        INTEGER REFERENCES usuarios(id),
  criado_por_nome   TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ap_item_tablet
  ON ap_itens(tablet_id, id_local_tablet) WHERE id_local_tablet IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ap_item_status ON ap_itens(status);
CREATE INDEX IF NOT EXISTS idx_ap_item_data   ON ap_itens(data_cadastro);

INSERT OR IGNORE INTO ap_categorias (id, nome, ativa, emoji, criada_em) VALUES
  (1, 'Material didático',     1, '📘', '2025-01-01T00:00:00'),
  (2, 'Lancheiras e garrafas', 1, '🎒', '2025-01-01T00:00:00'),
  (3, 'Casacos',               1, '🧥', '2025-01-01T00:00:00'),
  (4, 'Brinquedos',            1, '🧸', '2025-01-01T00:00:00'),
  (5, 'Xuxinhas',              1, '🎀', '2025-01-01T00:00:00');

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

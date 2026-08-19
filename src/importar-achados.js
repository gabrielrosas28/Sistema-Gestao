import { DatabaseSync } from "node:sqlite";
import { existsSync, copyFileSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";

import { buscar, rodar } from "./banco.js";
import { PASTA_FOTOS } from "./achados.js";

const argumentos = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const caminhoBanco = argumentos[0];

if (!caminhoBanco) {
  console.error(`
  Diga onde está o banco do servidor antigo:

    npm run importar-achados -- "C:\\AchadosPerdidos\\achadosperdidos.db"

  O arquivo costuma ficar na pasta de instalação do serviço, ao lado do .exe.
`);
  process.exit(1);
}

if (!existsSync(caminhoBanco)) {
  console.error(`\n  Não achei o arquivo:\n  ${caminhoBanco}\n`);
  process.exit(1);
}

const pastaFotosAntiga = argumentos[1] || join(dirname(caminhoBanco), "wwwroot", "fotos");

console.log(`
  Importando o achados e perdidos
  ---------------------------------------------
  De:    ${caminhoBanco}
  Fotos: ${pastaFotosAntiga}${existsSync(pastaFotosAntiga) ? "" : "  (pasta não encontrada — itens entram sem foto)"}
`);

const antigo = new DatabaseSync(caminhoBanco, { readOnly: true });

const temTabela = (nome) => !!antigo.prepare(
  `SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(nome);

if (!temTabela("Categorias") || !temTabela("Itens")) {
  console.error("  Este arquivo não parece ser o banco do Achados e Perdidos.\n" +
                "  Esperava as tabelas Categorias e Itens.\n");
  process.exit(1);
}

const deParaCategoria = new Map();
let catsNovas = 0, catsCasadas = 0;

for (const c of antigo.prepare(`SELECT * FROM Categorias ORDER BY Id`).all()) {
  const nome = String(c.Nome || "").trim();
  if (!nome) continue;

  const jaExiste = buscar(`SELECT id FROM ap_categorias WHERE nome = ? COLLATE NOCASE`, nome);
  if (jaExiste) {
    deParaCategoria.set(c.Id, jaExiste.id);
    catsCasadas++;
    if (c.Emoji) rodar(`UPDATE ap_categorias SET emoji = COALESCE(emoji, ?) WHERE id = ?`,
                       c.Emoji, jaExiste.id);
    continue;
  }

  const r = rodar(
    `INSERT INTO ap_categorias (nome, ativa, emoji, id_local_tablet, criada_em)
     VALUES (?, ?, ?, ?, ?)`,
    nome,
    c.Ativa ? 1 : 0,
    c.Emoji || null,
    c.IdLocalTablet || null,
    normalizarData(c.DataCriacao) || agora());
  deParaCategoria.set(c.Id, Number(r.lastInsertRowid));
  catsNovas++;
}

console.log(`  Categorias: ${catsNovas} novas, ${catsCasadas} que já existiam aqui`);

let novos = 0, repetidos = 0, semCategoria = 0, fotosCopiadas = 0, fotosPerdidas = 0;

const fotosDisponiveis = new Map();
if (existsSync(pastaFotosAntiga)) {
  for (const nome of readdirSync(pastaFotosAntiga)) {
    fotosDisponiveis.set(nome.toLowerCase(), nome);
  }
}

for (const i of antigo.prepare(`SELECT * FROM Itens ORDER BY Id`).all()) {
  const categoriaId = deParaCategoria.get(i.CategoriaId);
  if (!categoriaId) { semCategoria++; continue; }

  if (i.IdLocalTablet) {
    const jaVeio = buscar(
      `SELECT id FROM ap_itens WHERE tablet_id IS ? AND id_local_tablet = ?`,
      i.TabletId || null, i.IdLocalTablet);
    if (jaVeio) { repetidos++; continue; }
  } else {
    const jaVeio = buscar(
      `SELECT id FROM ap_itens WHERE descricao = ? AND data_cadastro = ?`,
      i.Descricao, normalizarData(i.DataCadastro));
    if (jaVeio) { repetidos++; continue; }
  }

  const nomeFoto = copiarFoto(i.NomeArquivoFoto);

  rodar(
    `INSERT INTO ap_itens (descricao, local_encontrado, categoria_id, status,
                           data_cadastro, data_devolucao, nome_arquivo_foto,
                           tablet_id, id_local_tablet)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    String(i.Descricao || "").trim() || "(sem descrição)",
    i.LocalEncontrado || null,
    categoriaId,
    Number(i.Status ?? 0),
    normalizarData(i.DataCadastro) || agora(),
    normalizarData(i.DataDevolucao),
    nomeFoto,
    i.TabletId || null,
    i.IdLocalTablet || null);
  novos++;
}

console.log(`  Itens:      ${novos} novos, ${repetidos} que já estavam aqui`);
if (semCategoria) console.log(`              ${semCategoria} sem categoria conhecida — não entraram`);
console.log(`  Fotos:      ${fotosCopiadas} copiadas${fotosPerdidas ? `, ${fotosPerdidas} não encontradas na pasta` : ""}`);

const total = buscar(`SELECT COUNT(*) AS n FROM ap_itens`).n;
const esperando = buscar(`SELECT COUNT(*) AS n FROM ap_itens WHERE status = 0`).n;
console.log(`
  Pronto. O achados e perdidos agora tem ${total} ${total === 1 ? "item" : "itens"},
  ${esperando} esperando dono. Abra o sistema e veja em Achados.
`);

antigo.close();

function copiarFoto(nomeArquivo) {
  if (!nomeArquivo) return null;
  const limpo = basename(String(nomeArquivo));
  const original = fotosDisponiveis.get(limpo.toLowerCase());
  if (!original) { fotosPerdidas++; return null; }

  const destino = join(PASTA_FOTOS, limpo);
  if (!existsSync(destino)) {
    copyFileSync(join(pastaFotosAntiga, original), destino);
    fotosCopiadas++;
  }
  return limpo;
}

function normalizarData(valor) {
  if (!valor) return null;
  const t = String(valor).trim().replace(" ", "T").split(".")[0].replace(/Z$/, "");
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(t) ? t : null;
}

function agora() {
  return new Date().toISOString().slice(0, 19);
}

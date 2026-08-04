// Importa a estrutura da escola para o banco.
//
//   npm run importar -- "C:\caminho\Exportado.CSV"        (lista do sistema)
//   npm run importar -- "C:\caminho\planilha.xlsx"        (gerador de boletins)
//   npm run importar                                      (procura sozinho)
//
// Opções:
//   --desativar-ausentes   marca como inativo quem está no banco mas não veio
//                          no arquivo. Sem isso, ninguém é desativado.
//
// Roda quantas vezes quiser: atualiza quem já existe, cria quem falta e nunca
// apaga ninguém. Aluno que mudou de turma é movido, levando junto o histórico
// de pagamento — ele fica preso à pessoa, não à turma.

import xlsx from "xlsx";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { listar, buscar, rodar, emBloco, ANO_LETIVO } from "./banco.js";

const aqui = dirname(fileURLToPath(import.meta.url));
const DESATIVAR_AUSENTES = process.argv.includes("--desativar-ausentes");

// ---------- professoras (quadro de 21/01/2026) ----------
// O arquivo de alunos não traz professora. Esta lista preenche o que dá;
// turma que aparecer aqui sem estar na lista fica sem professora, e dá para
// completar depois pelo sistema.
const PROFESSORAS = {
  MZA: "Tia Adriana", MZB: "Tia Fabiana",
  M1A: "Tia Ana Paula", M1B: "Tia Tatiane", M1C: "Tia Ana Paula",
  M2A: "Tia Maíra", M2B: "Tia Jacqueline", M2C: "Tia Liliana", M2D: "Tia Liliana",
  JA: "Tia Rosângela", JB: "Tia Natally", JC: "Tia Mariana", JD: "Tia Natally",
  IA: "Tia Flávia", IB: "Tia Eliana", IC: "Tia Anne", ID: "Tia Eliana",
  "1A": "Tia Gracielle", "1B": "Tia Camila", "1C": "Tia Jeane", "1D": "Tia Gleisi",
  "2A": "Tia Shirley", "2B": "Tia Susy", "2C": "Tia Ingrid", "2D": "Tia Raquel", "2E": "Tia Priscila",
  "3A": "Tia Márcia", "3B": "Tia Jane", "3C": "Tia Claúdia", "3D": "Tia Ivanécia", "3E": "Tia Ana Cleide",
  "4A": "Tia Weslayne", "4B": "Tia Islene", "4C": "Tia Islene",
  "5A": "Tia Flávia", "5B": "Tia Patrícia", "5C": "Tia Emanuella", "5D": "Tia Larissa", "5E": "Tia Patrícia"
};

// ---------- de "CURSO" + "TURMA" para o código do sistema ----------
// O sistema exporta o curso por extenso ("MATERNAL II", "3º ANO / ENSINO
// FUNDAMENTAL") e a turma numa coluna separada ("A"). Aqui vira "M2A" e "3A".
const CURSOS = [
  { teste: /MATERNALZINHO/i,  prefixo: "MZ", nome: "Maternalzinho", segmento: "infantil",    ordem: 0 },
  { teste: /MATERNAL\s*II/i,  prefixo: "M2", nome: "Maternal II",   segmento: "infantil",    ordem: 20 },
  { teste: /MATERNAL\s*I\b/i, prefixo: "M1", nome: "Maternal I",    segmento: "infantil",    ordem: 10 },
  { teste: /JARDIM/i,         prefixo: "J",  nome: "Jardim",        segmento: "infantil",    ordem: 30 },
  { teste: /INFANTIL/i,       prefixo: "I",  nome: "Infantil",      segmento: "infantil",    ordem: 40 }
];

function classificar(curso, turma) {
  const c = String(curso || "").trim();
  const t = String(turma || "").trim().toUpperCase();
  if (!c || !t) return null;

  // "1º ANO / ENSINO FUNDAMENTAL", "5 ANO", "3o ANO"...
  const ano = c.match(/^(\d)\s*[ºo°]?\s*ANO/i);
  if (ano) {
    const n = ano[1];
    return { codigo: n + t, nome: `${n}º ano ${t}`, segmento: "fundamental", ordem: 100 + Number(n) * 10 };
  }
  for (const g of CURSOS) {
    if (g.teste.test(c)) {
      return { codigo: g.prefixo + t, nome: `${g.nome} ${t}`, segmento: g.segmento, ordem: g.ordem };
    }
  }
  return null;   // curso desconhecido: o chamador avisa em vez de sumir com o aluno
}

// ---------- calendário letivo ----------
const PERIODOS = [
  ["1ª unidade", "unidade", "2026-02-02", "2026-04-30"],
  ["2ª unidade", "unidade", "2026-05-04", "2026-08-21"],
  ["3ª unidade", "unidade", "2026-08-24", "2026-12-11"],
  ["Recesso junino", "recesso", "2026-06-22", "2026-06-26"],
  ["Férias de julho", "recesso", "2026-07-06", "2026-07-24"],
  ["Férias de fim de ano", "recesso", "2026-12-14", "2026-12-31"],
  ["Confraternização Universal", "feriado", "2026-01-01", "2026-01-01"],
  ["Carnaval", "feriado", "2026-02-16", "2026-02-17"],
  ["Quarta-feira de Cinzas", "feriado", "2026-02-18", "2026-02-18"],
  ["Sexta-feira Santa", "feriado", "2026-04-03", "2026-04-03"],
  ["Tiradentes", "feriado", "2026-04-21", "2026-04-21"],
  ["Dia do Trabalho", "feriado", "2026-05-01", "2026-05-01"],
  ["Corpus Christi", "feriado", "2026-06-04", "2026-06-04"],
  ["Independência", "feriado", "2026-09-07", "2026-09-07"],
  ["Nossa Senhora Aparecida", "feriado", "2026-10-12", "2026-10-12"],
  ["Finados", "feriado", "2026-11-02", "2026-11-02"],
  ["Proclamação da República", "feriado", "2026-11-15", "2026-11-15"],
  ["Consciência Negra", "feriado", "2026-11-20", "2026-11-20"],
  ["Natal", "feriado", "2026-12-25", "2026-12-25"]
];

// ============================================================
// leitura dos arquivos
// ============================================================

// O sistema da escola exporta em Latin-1, o Excel costuma salvar em UTF-8.
// Ler com a tabela errada troca "MENDONÇA" por "MENDONÃA".
function lerTexto(caminho) {
  const bytes = readFileSync(caminho);
  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF)
    return bytes.subarray(3).toString("utf8");
  const comoUtf8 = bytes.toString("utf8");
  if (!comoUtf8.includes("\uFFFD")) return comoUtf8;      // UTF-8 válido
  return new TextDecoder("latin1").decode(bytes);
}

// CSV com aspas, ponto e vírgula ou vírgula, quebra de linha do Windows.
function lerCSV(texto) {
  const delim = (texto.split("\n")[0].match(/;/g) || []).length >=
                (texto.split("\n")[0].match(/,/g) || []).length ? ";" : ",";
  const linhas = [];
  let campo = "", linha = [], entreAspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreAspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') entreAspas = false;
      else campo += c;
    } else if (c === '"') entreAspas = true;
    else if (c === delim) { linha.push(campo); campo = ""; }
    else if (c === "\n") { linha.push(campo); linhas.push(linha); linha = []; campo = ""; }
    else if (c !== "\r") campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }

  const cabecalho = linhas.shift().map((h) => h.trim().toUpperCase());
  return linhas
    .filter((l) => l.some((v) => v.trim()))
    .map((l) => Object.fromEntries(cabecalho.map((h, i) => [h, (l[i] ?? "").trim()])));
}

// Devolve sempre a mesma forma: { matricula, nome, curso, turma, genero }
function lerArquivo(caminho) {
  if (extname(caminho).toLowerCase() === ".csv") {
    const linhas = lerCSV(lerTexto(caminho));
    const c = Object.keys(linhas[0] || {});
    const pega = (nomes) => nomes.find((n) => c.includes(n));
    const cMat = pega(["MATRICULA", "MATRÍCULA", "CODIGO", "CÓDIGO"]);
    const cNome = pega(["NOME", "ALUNO", "NOME DO ALUNO"]);
    const cCurso = pega(["CURSO", "SERIE", "SÉRIE", "NIVEL", "NÍVEL"]);
    const cTurma = pega(["TURMA", "CLASSE"]);
    if (!cMat || !cNome || !cTurma)
      throw new Error(`O arquivo precisa ter as colunas MATRICULA, NOME, CURSO e TURMA. Achei: ${c.join(", ")}`);
    return linhas.map((l) => ({
      matricula: l[cMat], nome: l[cNome],
      curso: cCurso ? l[cCurso] : "", turma: l[cTurma], genero: null
    }));
  }

  // planilha do gerador de boletins: uma aba por turma, cabeçalho na linha 3
  const wb = xlsx.readFile(caminho);
  const alunos = [];
  for (const aba of wb.SheetNames) {
    if (!/^[1-5][A-E]$/.test(aba)) continue;
    for (const l of xlsx.utils.sheet_to_json(wb.Sheets[aba], { range: 2, defval: "" })) {
      const matricula = String(l["Matrícula"] ?? "").trim();
      const nome = String(l["Nome do Aluno"] ?? "").trim();
      if (!matricula || !nome) continue;
      alunos.push({
        matricula, nome,
        curso: `${aba[0]}º ANO`, turma: aba[1],
        genero: String(l["Gênero"] ?? "").trim() || null
      });
    }
  }
  return alunos;
}

function procurarArquivo() {
  const candidatos = [
    join(aqui, "..", "..", "Exportado.CSV"),
    join(aqui, "..", "Exportado.CSV"),
    join(aqui, "..", "..", "Gerador boletins - 2º ao 5º", "Gerador de boletim - 2026.xlsx")
  ];
  return candidatos.find(existsSync) || null;
}

// ============================================================
// importação
// ============================================================
function importar() {
  const arg = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const caminho = arg ? resolve(arg) : procurarArquivo();

  console.log("\n  Importando a estrutura da escola");
  console.log("  ─────────────────────────────────────────────");

  // ---- calendário ----
  let novosPeriodos = 0;
  for (const [nome, tipo, inicio, fim] of PERIODOS) {
    const existe = buscar(`SELECT id FROM periodos WHERE nome = ? AND ano_letivo = ?`, nome, ANO_LETIVO);
    if (existe) rodar(`UPDATE periodos SET tipo = ?, inicio = ?, fim = ? WHERE id = ?`, tipo, inicio, fim, existe.id);
    else { rodar(`INSERT INTO periodos (nome, tipo, inicio, fim, ano_letivo) VALUES (?, ?, ?, ?, ?)`,
                 nome, tipo, inicio, fim, ANO_LETIVO); novosPeriodos++; }
  }
  console.log(`  Calendário: ${PERIODOS.length} períodos e feriados (${novosPeriodos} criados agora)`);

  if (!caminho || !existsSync(caminho)) {
    console.log(`\n  Não achei o arquivo de alunos.`);
    console.log(`  Passe o caminho:  npm run importar -- "C:\\caminho\\Exportado.CSV"\n`);
    return;
  }
  console.log(`  Arquivo:    ${caminho}`);

  const linhas = lerArquivo(caminho);
  console.log(`  Leu ${linhas.length} linhas`);

  // ---- turmas que aparecem no arquivo ----
  const turmasDoArquivo = new Map();
  const cursosDesconhecidos = new Map();
  const semTurma = [];

  for (const l of linhas) {
    if (!l.matricula || !l.nome) { semTurma.push(l); continue; }
    const t = classificar(l.curso, l.turma);
    if (!t) {
      const chave = `${l.curso} / ${l.turma}`;
      cursosDesconhecidos.set(chave, (cursosDesconhecidos.get(chave) || 0) + 1);
      continue;
    }
    // Todos os alunos da turma precisam apontar para o MESMO objeto: é nele
    // que o id do banco é gravado logo abaixo.
    if (!turmasDoArquivo.has(t.codigo)) turmasDoArquivo.set(t.codigo, t);
    l._turma = turmasDoArquivo.get(t.codigo);
  }

  // ---- grava as turmas ----
  let turmasNovas = [];
  for (const [codigo, t] of [...turmasDoArquivo].sort((a, b) => a[1].ordem - b[1].ordem || a[0].localeCompare(b[0]))) {
    const existe = buscar(`SELECT id, professora FROM turmas WHERE codigo = ? AND ano_letivo = ?`, codigo, ANO_LETIVO);
    const professora = PROFESSORAS[codigo] ?? existe?.professora ?? null;
    if (existe) {
      rodar(`UPDATE turmas SET nome = ?, segmento = ?, professora = ?, ordem = ?, ativa = 1 WHERE id = ?`,
            t.nome, t.segmento, professora, t.ordem, existe.id);
      t.id = existe.id;
    } else {
      const r = rodar(`INSERT INTO turmas (codigo, nome, segmento, professora, ordem, ano_letivo)
                       VALUES (?, ?, ?, ?, ?, ?)`,
                      codigo, t.nome, t.segmento, professora, t.ordem, ANO_LETIVO);
      t.id = Number(r.lastInsertRowid);
      turmasNovas.push(t);
    }
  }

  // ---- alunos ----
  let criados = 0, atualizados = 0, mudaram = [];
  const vistos = new Set();

  for (const l of linhas) {
    if (!l._turma) continue;
    const turmaId = l._turma.id;

    // A matrícula é o número da pessoa, não da turma: procura em toda a escola.
    const existe = buscar(
      `SELECT a.*, t.nome AS turma_nome FROM alunos a JOIN turmas t ON t.id = a.turma_id
        WHERE a.matricula = ? AND t.ano_letivo = ?`, l.matricula, ANO_LETIVO);

    if (existe) {
      if (existe.turma_id !== turmaId) {
        mudaram.push({ nome: l.nome, de: existe.turma_nome, para: l._turma.nome });
      }
      // Gênero só vem da planilha de boletins. Não apaga o que já existe.
      if (l.genero) rodar(`UPDATE alunos SET genero = ? WHERE id = ?`, l.genero, existe.id);
      rodar(`UPDATE alunos SET nome = ?, turma_id = ?, ativo = 1 WHERE id = ?`, l.nome, turmaId, existe.id);
      vistos.add(existe.id);
      atualizados++;
    } else {
      const r = rodar(`INSERT INTO alunos (matricula, nome, turma_id, genero) VALUES (?, ?, ?, ?)`,
                      l.matricula, l.nome, turmaId, l.genero);
      vistos.add(Number(r.lastInsertRowid));
      criados++;
    }
  }

  // ---- quem está no banco e não veio no arquivo ----
  const ausentes = listar(
    `SELECT a.id, a.matricula, a.nome, t.nome AS turma
       FROM alunos a JOIN turmas t ON t.id = a.turma_id
      WHERE a.ativo = 1 AND t.ano_letivo = ?
      ORDER BY t.ordem, a.nome`, ANO_LETIVO).filter((a) => !vistos.has(a.id));

  let desativados = 0;
  if (DESATIVAR_AUSENTES) {
    for (const a of ausentes) { rodar(`UPDATE alunos SET ativo = 0 WHERE id = ?`, a.id); desativados++; }
  }

  // ---- turmas vazias que não vieram no arquivo ----
  const vazias = listar(
    `SELECT t.id, t.codigo, t.nome FROM turmas t
      WHERE t.ativa = 1 AND t.ano_letivo = ?
        AND NOT EXISTS (SELECT 1 FROM alunos a WHERE a.turma_id = t.id AND a.ativo = 1)
      ORDER BY t.ordem`, ANO_LETIVO);
  for (const t of vazias) rodar(`UPDATE turmas SET ativa = 0 WHERE id = ?`, t.id);

  // ============================================================
  // relatório
  // ============================================================
  const total = buscar(`SELECT COUNT(*) AS n FROM alunos WHERE ativo = 1`).n;
  const nTurmas = buscar(`SELECT COUNT(*) AS n FROM turmas WHERE ativa = 1 AND ano_letivo = ?`, ANO_LETIVO).n;

  console.log(`  Turmas:     ${turmasDoArquivo.size} no arquivo`);
  console.log(`  Alunos:     ${criados} cadastrados, ${atualizados} atualizados`);

  if (turmasNovas.length) {
    console.log(`\n  Turmas criadas agora:`);
    for (const t of turmasNovas)
      console.log(`    ${t.codigo.padEnd(5)} ${t.nome}${PROFESSORAS[t.codigo] ? "" : "   (sem professora cadastrada)"}`);
  }

  if (mudaram.length) {
    console.log(`\n  Mudaram de turma (${mudaram.length}):`);
    for (const m of mudaram.slice(0, 15)) console.log(`    ${m.nome}: ${m.de} → ${m.para}`);
    if (mudaram.length > 15) console.log(`    e mais ${mudaram.length - 15}`);
    console.log(`    O histórico de pagamento acompanha o aluno.`);
  }

  if (vazias.length) {
    console.log(`\n  Turmas desativadas por não ter aluno nenhum:`);
    console.log(`    ${vazias.map((t) => t.codigo).join(", ")}`);
    console.log(`    Voltam sozinhas se aparecerem numa importação futura.`);
  }

  if (cursosDesconhecidos.size) {
    console.log(`\n  ATENÇÃO — não reconheci estes cursos, e os alunos ficaram de fora:`);
    for (const [chave, n] of cursosDesconhecidos)
      console.log(`    "${chave}"  →  ${n} ${n === 1 ? "aluno" : "alunos"}`);
    console.log(`    Me avise para eu ensinar o sistema a ler esse nome.`);
  }

  if (semTurma.length)
    console.log(`\n  ${semTurma.length} linhas ignoradas por estar sem matrícula ou sem nome.`);

  if (ausentes.length) {
    console.log(`\n  ${ausentes.length} ${ausentes.length === 1 ? "aluno está" : "alunos estão"} no sistema mas não vieram neste arquivo:`);
    for (const a of ausentes.slice(0, 15)) console.log(`    ${a.matricula}  ${a.nome}  (${a.turma})`);
    if (ausentes.length > 15) console.log(`    e mais ${ausentes.length - 15}`);
    if (desativados) console.log(`\n    ${desativados} desativados, como você pediu com --desativar-ausentes.`);
    else console.log(`\n    Continuam ativos. Para tirar todos de uma vez, rode de novo com --desativar-ausentes.`);
  }

  console.log(`\n  Total no sistema: ${total} alunos ativos em ${nTurmas} turmas\n`);
}

emBloco(importar)();

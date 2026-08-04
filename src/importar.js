// Importa a estrutura da escola para o banco.
//
//   npm run importar
//   npm run importar -- "C:\caminho\Gerador de boletim - 2026.xlsx"
//
// Roda quantas vezes quiser: atualiza quem já existe, cria quem falta
// e não apaga ninguém. Aluno que sumiu da planilha fica marcado como
// inativo, para não perder o histórico de pagamento dele.

import xlsx from "xlsx";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bd, listar, buscar, rodar, emBloco, ANO_LETIVO } from "./banco.js";

const aqui = dirname(fileURLToPath(import.meta.url));

// ---------- turmas da escola (quadro de 21/01/2026) ----------
const TURMAS = [
  // código, nome, segmento, professora, alunos previstos
  ["MZA","Maternalzinho A","infantil","Tia Adriana",3],
  ["MZB","Maternalzinho B","infantil","Tia Fabiana",1],
  ["M1A","Maternal I A","infantil","Tia Ana Paula",12],
  ["M1B","Maternal I B","infantil","Tia Tatiane",11],
  ["M1C","Maternal I C","infantil","Tia Ana Paula",5],
  ["M2A","Maternal II A","infantil","Tia Maíra",14],
  ["M2B","Maternal II B","infantil","Tia Jacqueline",13],
  ["M2C","Maternal II C","infantil","Tia Liliana",14],
  ["M2D","Maternal II D","infantil","Tia Liliana",8],
  ["JA","Jardim A","infantil","Tia Rosângela",13],
  ["JB","Jardim B","infantil","Tia Natally",12],
  ["JC","Jardim C","infantil","Tia Mariana",12],
  ["JD","Jardim D","infantil","Tia Natally",12],
  ["IA","Infantil A","infantil","Tia Flávia",21],
  ["IB","Infantil B","infantil","Tia Eliana",16],
  ["IC","Infantil C","infantil","Tia Anne",19],
  ["ID","Infantil D","infantil","Tia Eliana",16],
  ["1A","1º ano A","fundamental","Tia Gracielle",18],
  ["1B","1º ano B","fundamental","Tia Camila",19],
  ["1C","1º ano C","fundamental","Tia Jeane",14],
  ["1D","1º ano D","fundamental","Tia Gleisi",25],
  ["2A","2º ano A","fundamental","Tia Shirley",25],
  ["2B","2º ano B","fundamental","Tia Susy",19],
  ["2C","2º ano C","fundamental","Tia Ingrid",24],
  ["2D","2º ano D","fundamental","Tia Raquel",20],
  ["2E","2º ano E","fundamental","Tia Priscila",10],
  ["3A","3º ano A","fundamental","Tia Márcia",23],
  ["3B","3º ano B","fundamental","Tia Jane",18],
  ["3C","3º ano C","fundamental","Tia Claúdia",25],
  ["3D","3º ano D","fundamental","Tia Ivanécia",18],
  ["3E","3º ano E","fundamental","Tia Ana Cleide",9],
  ["4A","4º ano A","fundamental","Tia Weslayne",21],
  ["4B","4º ano B","fundamental","Tia Islene",23],
  ["4C","4º ano C","fundamental","Tia Islene",10],
  ["5A","5º ano A","fundamental","Tia Flávia",24],
  ["5B","5º ano B","fundamental","Tia Patrícia",23],
  ["5C","5º ano C","fundamental","Tia Emanuella",18],
  ["5D","5º ano D","fundamental","Tia Larissa",14],
  ["5E","5º ano E","fundamental","Tia Patrícia",12]
];

// ---------- calendário letivo ----------
const PERIODOS = [
  ["1ª unidade","unidade","2026-02-02","2026-04-30"],
  ["2ª unidade","unidade","2026-05-04","2026-08-21"],
  ["3ª unidade","unidade","2026-08-24","2026-12-11"],
  ["Recesso junino","recesso","2026-06-22","2026-06-26"],
  ["Férias de julho","recesso","2026-07-06","2026-07-24"],
  ["Férias de fim de ano","recesso","2026-12-14","2026-12-31"],
  ["Confraternização Universal","feriado","2026-01-01","2026-01-01"],
  ["Carnaval","feriado","2026-02-16","2026-02-17"],
  ["Quarta-feira de Cinzas","feriado","2026-02-18","2026-02-18"],
  ["Sexta-feira Santa","feriado","2026-04-03","2026-04-03"],
  ["Tiradentes","feriado","2026-04-21","2026-04-21"],
  ["Dia do Trabalho","feriado","2026-05-01","2026-05-01"],
  ["Corpus Christi","feriado","2026-06-04","2026-06-04"],
  ["Independência","feriado","2026-09-07","2026-09-07"],
  ["Nossa Senhora Aparecida","feriado","2026-10-12","2026-10-12"],
  ["Finados","feriado","2026-11-02","2026-11-02"],
  ["Proclamação da República","feriado","2026-11-15","2026-11-15"],
  ["Consciência Negra","feriado","2026-11-20","2026-11-20"],
  ["Natal","feriado","2026-12-25","2026-12-25"]
];

const PLANILHA_PADRAO = resolve(join(
  aqui, "..", "..", "Gerador boletins - 2º ao 5º", "Gerador de boletim - 2026.xlsx"));

function importar() {
  const planilha = process.argv[2] ? resolve(process.argv[2]) : PLANILHA_PADRAO;

  console.log("\n  Importando a estrutura da escola");
  console.log("  ─────────────────────────────────────────────");

  // ---- turmas ----
  let novasTurmas = 0;
  TURMAS.forEach(([codigo, nome, segmento, professora], i) => {
    const existe = buscar(`SELECT id FROM turmas WHERE codigo = ? AND ano_letivo = ?`, codigo, ANO_LETIVO);
    if (existe) {
      rodar(`UPDATE turmas SET nome = ?, segmento = ?, professora = ?, ordem = ?, ativa = 1 WHERE id = ?`,
            nome, segmento, professora, i, existe.id);
    } else {
      rodar(`INSERT INTO turmas (codigo, nome, segmento, professora, ordem, ano_letivo)
             VALUES (?, ?, ?, ?, ?, ?)`, codigo, nome, segmento, professora, i, ANO_LETIVO);
      novasTurmas++;
    }
  });
  console.log(`  Turmas:    ${TURMAS.length} no quadro (${novasTurmas} criadas agora)`);

  // ---- períodos ----
  let novosPeriodos = 0;
  for (const [nome, tipo, inicio, fim] of PERIODOS) {
    const existe = buscar(`SELECT id FROM periodos WHERE nome = ? AND ano_letivo = ?`, nome, ANO_LETIVO);
    if (existe) rodar(`UPDATE periodos SET tipo = ?, inicio = ?, fim = ? WHERE id = ?`, tipo, inicio, fim, existe.id);
    else { rodar(`INSERT INTO periodos (nome, tipo, inicio, fim, ano_letivo) VALUES (?, ?, ?, ?, ?)`,
                 nome, tipo, inicio, fim, ANO_LETIVO); novosPeriodos++; }
  }
  console.log(`  Calendário: ${PERIODOS.length} períodos e feriados (${novosPeriodos} criados agora)`);

  // ---- alunos da planilha de boletins ----
  if (!existsSync(planilha)) {
    console.log(`\n  Planilha não encontrada em:\n    ${planilha}`);
    console.log(`  Passe o caminho:  npm run importar -- "C:\\caminho\\planilha.xlsx"\n`);
    return;
  }

  const wb = xlsx.readFile(planilha);
  const codigosNaPlanilha = TURMAS.map(([c]) => c).filter((c) => wb.SheetNames.includes(c));
  let criados = 0, atualizados = 0, vistos = new Set();

  for (const codigo of codigosNaPlanilha) {
    const turma = buscar(`SELECT id FROM turmas WHERE codigo = ? AND ano_letivo = ?`, codigo, ANO_LETIVO);
    // cabeçalho na linha 3: Matrícula | Nome do Aluno | Primeiro Nome | Conceito | Gênero
    const linhas = xlsx.utils.sheet_to_json(wb.Sheets[codigo], { range: 2, defval: "" });

    for (const l of linhas) {
      const matricula = String(l["Matrícula"] ?? "").trim();
      const nome = String(l["Nome do Aluno"] ?? "").trim();
      if (!matricula || !nome) continue;
      const genero = String(l["Gênero"] ?? "").trim() || null;

      const existe = buscar(`SELECT id FROM alunos WHERE matricula = ? AND turma_id = ?`, matricula, turma.id);
      if (existe) {
        rodar(`UPDATE alunos SET nome = ?, genero = ?, ativo = 1 WHERE id = ?`, nome, genero, existe.id);
        vistos.add(existe.id); atualizados++;
      } else {
        const r = rodar(`INSERT INTO alunos (matricula, nome, turma_id, genero) VALUES (?, ?, ?, ?)`,
                        matricula, nome, turma.id, genero);
        vistos.add(Number(r.lastInsertRowid)); criados++;
      }
    }
  }

  // Aluno que saiu da planilha vira inativo — some das listas, mas o
  // histórico de pagamento dele continua no banco.
  const idsTurmas = codigosNaPlanilha
    .map((c) => buscar(`SELECT id FROM turmas WHERE codigo = ? AND ano_letivo = ?`, c, ANO_LETIVO).id);
  let inativados = 0;
  if (idsTurmas.length) {
    const alvo = listar(
      `SELECT id FROM alunos WHERE ativo = 1 AND turma_id IN (${idsTurmas.map(() => "?").join(",")})`,
      ...idsTurmas).filter((a) => !vistos.has(a.id));
    for (const a of alvo) { rodar(`UPDATE alunos SET ativo = 0 WHERE id = ?`, a.id); inativados++; }
  }

  const total = buscar(`SELECT COUNT(*) AS n FROM alunos WHERE ativo = 1`).n;
  console.log(`  Alunos:    ${criados} cadastrados, ${atualizados} atualizados, ${inativados} inativados`);
  console.log(`  Turmas na planilha: ${codigosNaPlanilha.join(", ")}`);

  const semAlunos = listar(
    `SELECT t.codigo FROM turmas t
      WHERE t.ativa = 1 AND t.ano_letivo = ?
        AND NOT EXISTS (SELECT 1 FROM alunos a WHERE a.turma_id = t.id AND a.ativo = 1)
      ORDER BY t.ordem`, ANO_LETIVO).map((t) => t.codigo);

  console.log(`\n  Total no banco: ${total} alunos ativos`);
  if (semAlunos.length) {
    console.log(`\n  Ainda sem alunos: ${semAlunos.join(", ")}`);
    console.log(`  Estas turmas não estão na planilha de boletins do Fundamental.`);
    console.log(`  Dá para importar de outra planilha ou cadastrar pelo sistema.`);
  }
  console.log("");
}

emBloco(importar)();

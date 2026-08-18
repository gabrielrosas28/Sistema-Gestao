// Cópia de segurança do banco e das fotos do achados e perdidos.
//
//   npm run backup
//   npm run backup -- "D:\Backups Gestao"
//
// Usa a cópia oficial do SQLite, então pode rodar com o sistema no ar
// e com gente lançando pagamento — o arquivo sai íntegro.
// Guarda as 30 cópias mais recentes do banco e apaga as antigas.
//
// As fotos ficam de fora do banco, em dados/fotos, e por isso precisam de um
// tratamento próprio: elas são espelhadas numa pasta única no destino, e não
// copiadas dentro de cada cópia. Se cada backup levasse a pasta inteira, trinta
// cópias seriam trinta vezes o mesmo peso em foto — e como o nome do arquivo é
// sorteado e nunca se repete, uma pasta só serve para todas as cópias.
//
// A pasta de fotos nunca é limpa aqui de propósito: um backup de março tem de
// continuar achando a foto de um item que já foi apagado do sistema em agosto.

import { bd, PASTA_DADOS } from "./banco.js";
import { mkdirSync, existsSync, readdirSync, unlinkSync, statSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";

const destino = resolve(process.argv[2] || join(PASTA_DADOS, "backups"));
if (!existsSync(destino)) mkdirSync(destino, { recursive: true });

const agora = new Date();
const carimbo = agora.toISOString().slice(0, 16).replace("T", " ").replace(":", "h");
const arquivo = join(destino, `gestao ${carimbo}.db`);

// VACUUM INTO é a cópia oficial do SQLite: sai compactada e íntegra.
bd.exec(`VACUUM INTO '${arquivo.replace(/'/g, "''")}'`);

const antigos = readdirSync(destino)
  .filter((f) => f.startsWith("gestao ") && f.endsWith(".db"))
  .map((f) => ({ f, t: statSync(join(destino, f)).mtimeMs }))
  .sort((a, b) => b.t - a.t)
  .slice(30);
antigos.forEach(({ f }) => unlinkSync(join(destino, f)));

const mb = (statSync(arquivo).size / 1048576).toFixed(1);
console.log(`\n  Backup salvo: ${arquivo}  (${mb} MB)`);
if (antigos.length) console.log(`  ${antigos.length} cópias antigas removidas.`);

// ---- fotos do achados e perdidos ----
const origemFotos = join(PASTA_DADOS, "fotos");
if (existsSync(origemFotos)) {
  const destinoFotos = join(destino, "fotos");
  if (!existsSync(destinoFotos)) mkdirSync(destinoFotos, { recursive: true });

  let novas = 0, jaEstavam = 0;
  for (const nome of readdirSync(origemFotos)) {
    const de = join(origemFotos, nome);
    const para = join(destinoFotos, nome);
    if (!statSync(de).isFile()) continue;
    // Nome sorteado nunca se repete com conteúdo diferente: se já está lá, é a
    // mesma foto, e copiar de novo só gastaria tempo e disco.
    if (existsSync(para)) { jaEstavam++; continue; }
    copyFileSync(de, para);
    novas++;
  }
  console.log(`  Fotos:        ${destinoFotos}  (${novas} ${novas === 1 ? "nova" : "novas"}, ${jaEstavam} já estavam)`);
}
console.log("");

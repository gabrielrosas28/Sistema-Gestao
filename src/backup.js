import { bd, PASTA_DADOS } from "./banco.js";
import { mkdirSync, existsSync, readdirSync, unlinkSync, statSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";

const destino = resolve(process.argv[2] || join(PASTA_DADOS, "backups"));
if (!existsSync(destino)) mkdirSync(destino, { recursive: true });

const agora = new Date();
const carimbo = agora.toISOString().slice(0, 16).replace("T", " ").replace(":", "h");
const arquivo = join(destino, `gestao ${carimbo}.db`);

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

const origemFotos = join(PASTA_DADOS, "fotos");
if (existsSync(origemFotos)) {
  const destinoFotos = join(destino, "fotos");
  if (!existsSync(destinoFotos)) mkdirSync(destinoFotos, { recursive: true });

  let novas = 0, jaEstavam = 0;
  for (const nome of readdirSync(origemFotos)) {
    const de = join(origemFotos, nome);
    const para = join(destinoFotos, nome);
    if (!statSync(de).isFile()) continue;
    if (existsSync(para)) { jaEstavam++; continue; }
    copyFileSync(de, para);
    novas++;
  }
  console.log(`  Fotos:        ${destinoFotos}  (${novas} ${novas === 1 ? "nova" : "novas"}, ${jaEstavam} já estavam)`);
}
console.log("");

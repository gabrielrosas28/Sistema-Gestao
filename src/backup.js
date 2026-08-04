// Cópia de segurança do banco.
//
//   npm run backup
//   npm run backup -- "D:\Backups Gestao"
//
// Usa a cópia oficial do SQLite, então pode rodar com o sistema no ar
// e com gente lançando pagamento — o arquivo sai íntegro.
// Guarda as 30 cópias mais recentes e apaga as antigas.

import { bd, PASTA_DADOS } from "./banco.js";
import { mkdirSync, existsSync, readdirSync, unlinkSync, statSync } from "node:fs";
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
console.log("");

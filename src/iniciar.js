// Liga o sistema.
//
// O SQLite embutido no Node é liberado direto nas versões novas e pede uma
// permissão extra nas mais antigas. Este arquivo resolve isso sozinho, para
// ninguém precisar decorar parâmetro de linha de comando.

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const servidor = join(aqui, "servidor.js");

const versao = Number(process.versions.node.split(".")[0]);
if (versao < 22) {
  console.log(`
  O sistema precisa do Node.js 22 ou mais novo (este PC tem o ${process.versions.node}).
  Baixe a versão LTS em https://nodejs.org e instale por cima.
`);
  process.exit(1);
}

try {
  await import("node:sqlite");
  await import(servidor);                       // já liberado: sobe direto
} catch {
  // versão que ainda pede a permissão: liga de novo com ela
  spawn(process.execPath, ["--experimental-sqlite", "--no-warnings", servidor],
        { stdio: "inherit" })
    .on("exit", (c) => process.exit(c ?? 0));
}

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const servidor = join(aqui, "servidor.js");

const urlServidor = pathToFileURL(servidor).href;

const versao = Number(process.versions.node.split(".")[0]);
if (versao < 22) {
  console.error(`
  O sistema precisa do Node.js 22 ou mais novo (este PC tem o ${process.versions.node}).
  Baixe a versão LTS em https://nodejs.org e instale por cima.
`);
  process.exit(1);
}

let precisaDaPermissao = false;
try {
  await import("node:sqlite");
} catch {
  precisaDaPermissao = true;
}

if (precisaDaPermissao) {
  spawn(process.execPath, ["--experimental-sqlite", "--no-warnings", servidor], {
    stdio: "inherit",
  }).on("exit", (c) => process.exit(c ?? 0));
} else {
  try {
    await import(urlServidor);
  } catch (erro) {
    console.error("\n  O sistema não conseguiu subir.\n");
    if (erro?.code === "EADDRINUSE") {
      console.error(
        "  A porta já está ocupada. Provavelmente o sistema já está no ar:\n" +
          "  modo sem janela ligado, ou outra janela preta aberta.\n" +
          "  Confira com o Diagnostico.bat antes de ligar de novo.\n"
      );
    } else if (erro?.code === "SQLITE_CANTOPEN" || erro?.code === "ENOENT") {
      console.error(
        "  Não consegui abrir o banco em dados/gestao.db.\n" +
          "  Se a pasta dados sumiu, rode o Instalar.bat.\n"
      );
    }
    console.error(erro?.stack || erro);
    console.error("");
    process.exit(1);
  }
}

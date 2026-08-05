// Liga o sistema.
//
// O SQLite embutido no Node é liberado direto nas versões novas e pede uma
// permissão extra nas mais antigas. Este arquivo resolve isso sozinho, para
// ninguém precisar decorar parâmetro de linha de comando.
//
// Cuidado ao mexer aqui: a versão antiga tinha um catch vazio em volta do
// import do servidor. Qualquer falha — porta ocupada, banco travado, erro de
// digitação no código — era confundida com "falta a permissão do SQLite", e o
// sistema tentava subir de novo do mesmo jeito, falhava de novo e morria em
// silêncio. O erro de verdade nunca chegava na tela. Só caia no plano B
// quando o motivo for mesmo o node:sqlite.

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const servidor = join(aqui, "servidor.js");

// O import() dinâmico pede URL, não caminho. No Linux passa despercebido,
// porque /caminho/assim já é uma URL válida. No Windows não: o C: vira
// "protocolo c:" e o Node recusa com ERR_UNSUPPORTED_ESM_URL_SCHEME.
// Este arquivo só roda no Windows da escola, então era erro em toda partida —
// e o catch vazio da versão antiga transformava isso em tela em branco.
// Nunca passe `servidor` direto para o import(); use `urlServidor`.
const urlServidor = pathToFileURL(servidor).href;

const versao = Number(process.versions.node.split(".")[0]);
if (versao < 22) {
  console.error(`
  O sistema precisa do Node.js 22 ou mais novo (este PC tem o ${process.versions.node}).
  Baixe a versão LTS em https://nodejs.org e instale por cima.
`);
  process.exit(1);
}

// O node:sqlite abre sem a permissão extra?
let precisaDaPermissao = false;
try {
  await import("node:sqlite");
} catch {
  precisaDaPermissao = true;
}

if (precisaDaPermissao) {
  // Versão do Node que ainda exige a permissão: liga de novo com ela.
  spawn(process.execPath, ["--experimental-sqlite", "--no-warnings", servidor], {
    stdio: "inherit",
  }).on("exit", (c) => process.exit(c ?? 0));
} else {
  // Daqui para baixo, erro é erro: aparece inteiro e derruba com código 1.
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

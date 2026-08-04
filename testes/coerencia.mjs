// Confere se a tela e o servidor continuam falando a mesma lingua.
// Roda sem precisar ligar nada:  node testes/coerencia.mjs
//
// Pega o tipo de erro mais chato de achar: alguem renomeia um campo no banco,
// a tela continua pedindo o nome antigo, e so aparece quando a secretaria clica.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const ler = (p) => readFileSync(join(raiz, p), "utf8");

const app = ler("publico/app.js");
const html = ler("publico/index.html");
const css = ler("publico/estilo.css");
const servidor = ler("src/servidor.js");
const esquema = ler("src/esquema.sql");

let falhas = 0;
const ok = (cond, nome, extra = "") => {
  console.log(`  ${cond ? "ok  " : "FALHA"}  ${nome}${extra ? "  -> " + extra : ""}`);
  if (!cond) falhas++;
};

console.log("\n  Coerencia entre tela, servidor e banco\n  ---------------------------------------------");

// ---- elementos ----
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
[...app.matchAll(/id="([A-Za-z]+)"/g)].forEach((m) => ids.add(m[1]));
const buscados = [...new Set([...app.matchAll(/\$\("#([A-Za-z]+)"\)/g)].map((m) => m[1]))];
const semElemento = buscados.filter((i) => !ids.has(i));
ok(!semElemento.length, "todo elemento buscado pela tela existe", semElemento.join(", ") || buscados.length + " elementos");

// ---- rotas ----
const rotas = [...servidor.matchAll(/app\.(get|post|put|delete)\("([^"]+)"/g)]
  .map((m) => ({ metodo: m[1].toUpperCase(), caminho: m[2] }));
const chamadas = [...app.matchAll(/(pegar|enviar|trocar|apagar|api)\(\s*(?:"(GET|POST|PUT|DELETE)",\s*)?[`"]([^`"]+)/g)]
  .map((m) => ({
    metodo: m[2] || { pegar: "GET", enviar: "POST", trocar: "PUT", apagar: "DELETE" }[m[1]],
    caminho: m[3]
  }))
  .filter((c) => c.caminho.startsWith("/api"));
const casa = (c, r) => c.metodo === r.metodo &&
  new RegExp("^" + r.caminho.replace(/:[a-zA-Z]+/g, "[^/]+") + "$")
    .test(c.caminho.split("?")[0].replace(/\$\{[^}]+\}/g, "X"));
const orfas = chamadas.filter((c) => !rotas.some((r) => casa(c, r)));
ok(!orfas.length, "toda chamada da tela tem rota no servidor",
   orfas.map((o) => o.metodo + " " + o.caminho).join(" | ") || chamadas.length + " chamadas");

// ---- campos ----
const visao = esquema.split("CREATE VIEW")[1] || "";
const campos = ["participacao_id", "matricula", "aluno", "turma_id", "participa",
                "valor", "pagamento_id", "meio", "recebido_em", "situacao"];
const semCampo = campos.filter((c) => !visao.includes(c));
ok(!semCampo.length, "campos usados nos cartoes existem no banco", semCampo.join(", "));

// ---- listas fechadas ----
const meios = [...app.matchAll(/const MEIOS = \{([\s\S]*?)\};/g)][0][1].match(/(\w+):/g).map((s) => s.replace(":", ""));
ok(meios.every((m) => esquema.includes(`'${m}'`)), "meios de pagamento aceitos pelo banco", meios.join(", "));

const categorias = [...app.matchAll(/^  (\w+):\s+\{ nome:/gm)].map((m) => m[1]);
ok(categorias.length === 6 && categorias.every((c) => esquema.includes(`'${c}'`)),
   "categorias aceitas pelo banco", categorias.join(", "));

const situacoes = ["pago", "pendente", "isento", "fora"];
ok(situacoes.every((s) => app.includes(`"${s}"`) && esquema.includes(`'${s}'`)),
   "situacoes do cartao batem com o banco", situacoes.join(", "));

ok(app.includes("coordenacao") && esquema.includes("'coordenacao'"), "papeis de acesso batem");

// ---- estilo ----
const classes = [...new Set([...app.matchAll(/class="([^"$]+)"/g)].flatMap((m) => m[1].split(/\s+/)))].filter(Boolean);
const semEstilo = classes.filter((c) => !css.includes("." + c));
ok(!semEstilo.length, "classes usadas na tela existem no estilo", semEstilo.join(", ") || classes.length + " classes");

// ---- higiene ----
const restos = ["ALICE PAES", "Tia Shirley", "const semente", "const AGENDA", "const FERIADOS"]
  .filter((x) => app.includes(x));
ok(!restos.length, "nenhum dado de demonstracao sobrou na tela", restos.join(", "));

ok(app.includes("err.status === 401") && app.includes("err.status === 423"),
   "sessao expirada e turma fechada sao tratadas");

console.log(`\n  ${falhas ? falhas + " falha(s)" : "tudo passou"}\n`);
process.exit(falhas ? 1 : 0);

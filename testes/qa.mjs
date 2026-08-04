// Casos de borda — as situacoes que quebram sistema em producao.
// Rode com o servidor ligado:  node testes/qa.mjs
const B = process.env.ALVO || "http://127.0.0.1:8099";
let cookie = "", falhas = 0;

async function req(metodo, caminho, corpo) {
  const r = await fetch(B + caminho, {
    method: metodo,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined
  });
  const set = r.headers.getSetCookie?.() || [];
  if (set.length) cookie = set.map(c => c.split(";")[0]).join("; ");
  let dados = null; try { dados = await r.json(); } catch {}
  return { status: r.status, dados };
}
function ok(nome, cond, extra = "") {
  console.log(`  ${cond ? "ok  " : "FALHA"}  ${nome}${extra ? "  -> " + extra : ""}`);
  if (!cond) falhas++;
}

console.log("\n  QA - casos de borda\n  ---------------------------------------------");

await req("POST", "/api/sessao", { email: "gabiru10rosas@gmail.com", senha: "senha12345" });
const turmas = (await req("GET", "/api/turmas")).dados;
const t2A = turmas.find(t => t.codigo === "2A");
const vazia = turmas.find(t => t.alunos === 0);          // turma da EI, ainda sem alunos

// ---------- validacao na criacao de evento ----------
let r = await req("POST", "/api/eventos", { nome: "Sem data", categoria: "passeio", inicio: "ontem", turmas: [t2A.id] });
ok("data escrita errado e recusada", r.status === 400, r.dados?.erro);

r = await req("POST", "/api/eventos", { nome: "Invertido", categoria: "passeio", inicio: "2026-09-10", fim: "2026-09-01", turmas: [t2A.id] });
ok("fim antes do inicio e recusado", r.status === 400, r.dados?.erro);

r = await req("POST", "/api/eventos", { nome: "Fantasma", categoria: "passeio", inicio: "2026-09-10", turmas: [99999] });
ok("turma inexistente e recusada", r.status === 400, r.dados?.erro);

r = await req("POST", "/api/eventos", { nome: "Sem turma", categoria: "passeio", inicio: "2026-09-10", turmas: "2A" });
ok("turmas fora de lista e recusado", r.status === 400, r.dados?.erro);

r = await req("POST", "/api/eventos", { nome: "Valor torto", categoria: "loja", inicio: "2026-09-10", cobra: true, valor: "abc", turmas: [t2A.id] });
ok("valor sem numero e recusado", r.status === 400, r.dados?.erro);

// turma repetida na lista nao pode quebrar a chave primaria
r = await req("POST", "/api/eventos", {
  nome: "Repetida", categoria: "esporte", inicio: "2026-09-10",
  cobra: true, valor: 10, turmas: [t2A.id, t2A.id, t2A.id]
});
ok("turma repetida na lista nao quebra", r.status === 201);
const evRep = r.dados.id;
r = await req("GET", `/api/eventos/${evRep}`);
ok("turma repetida entra uma vez so", r.dados.turmas.length === 1, r.dados.turmas.length + " turma");

// ---------- turma sem aluno nenhum ----------
if (vazia) {
  r = await req("POST", "/api/eventos", {
    nome: "Evento na turma vazia", categoria: "comemoracao", inicio: "2026-09-12",
    cobra: true, valor: 20, turmas: [vazia.id]
  });
  const evVazio = r.dados.id;
  r = await req("GET", `/api/eventos/${evVazio}`);
  const rr = r.dados.resumo;
  ok("turma sem aluno devolve numero, nao nulo",
     [rr.alunos, rr.participam, rr.pagos, rr.pendentes, rr.arrecadado, rr.previsto].every(v => typeof v === "number"),
     `participam ${rr.participam}, arrecadado ${rr.arrecadado}`);
  r = await req("GET", `/api/eventos/${evVazio}/turmas/${vazia.id}`);
  ok("turma sem aluno abre sem erro", r.status === 200 && r.dados.alunos.length === 0, vazia.nome);
} else {
  ok("turma sem aluno devolve numero, nao nulo", true, "nenhuma turma vazia no banco");
}

// ---------- aluno que entra depois do evento criado ----------
r = await req("POST", "/api/eventos", {
  nome: "Evento anterior a matricula", categoria: "comemoracao", inicio: "2026-09-20",
  cobra: true, valor: 40, turmas: [t2A.id]
});
const evAntes = r.dados.id;
const antes = (await req("GET", `/api/eventos/${evAntes}/turmas/${t2A.id}`)).dados.alunos.length;

// matricula um aluno novo direto no banco, como faria a importacao da planilha
const brl = (n) => "R$ " + Number(n).toFixed(2);
const { DatabaseSync } = await import("node:sqlite");
const bd = new DatabaseSync(process.env.BANCO || "dados/gestao.db");
bd.prepare(`INSERT INTO alunos (matricula, nome, turma_id) VALUES (?, ?, ?)`)
  .run("20269999", "ZULMIRA ALUNA NOVA", t2A.id);
bd.close();

r = await req("GET", `/api/eventos/${evAntes}/turmas/${t2A.id}`);
const depois = r.dados.alunos;
ok("aluno matriculado depois aparece no evento", depois.length === antes + 1,
   `${antes} -> ${depois.length}`);
ok("aluno novo entra pendente, com o valor do evento",
   depois.find(a => a.matricula === "20269999")?.valor === 40);

// ---------- pagamento com valor invalido ----------
const alvo = depois.find(a => a.matricula === "20269999");
r = await req("POST", "/api/pagamentos", { participacao_id: alvo.participacao_id, valor: "trinta", meio: "pix" });
ok("pagamento com texto no valor e recusado", r.status === 400, r.dados?.erro);
r = await req("POST", "/api/pagamentos", { participacao_id: alvo.participacao_id, valor: 0, meio: "pix" });
ok("pagamento de zero e recusado", r.status === 400, r.dados?.erro);
r = await req("POST", "/api/pagamentos", { participacao_id: alvo.participacao_id, valor: -50, meio: "pix" });
ok("pagamento negativo e recusado", r.status === 400, r.dados?.erro);
r = await req("PUT", `/api/participacoes/${alvo.participacao_id}`, { valor: "muito" });
ok("valor com texto e recusado", r.status === 400, r.dados?.erro);

// sem informar valor, vale o combinado do evento
r = await req("POST", "/api/pagamentos", { participacao_id: alvo.participacao_id, meio: "dinheiro" });
ok("sem valor no pedido usa o valor do evento", r.status === 201 && r.dados.valor === 40, "R$ " + r.dados?.valor);

// ---------- registros que nao existem ----------
r = await req("GET", "/api/eventos/99999");
ok("evento inexistente devolve 404", r.status === 404);
r = await req("PUT", "/api/participacoes/99999", { valor: 10 });
ok("participacao inexistente devolve 404", r.status === 404);
r = await req("DELETE", "/api/pagamentos/99999");
ok("estorno de pagamento inexistente devolve 404", r.status === 404);
r = await req("DELETE", "/api/fechamentos/99999/1");
ok("reabrir turma nao fechada devolve 404", r.status === 404);

// ---------- estorno duas vezes ----------
const pg = (await req("GET", `/api/eventos/${evAntes}/turmas/${t2A.id}`)).dados.alunos
  .find(a => a.matricula === "20269999");
r = await req("DELETE", `/api/pagamentos/${pg.pagamento_id}`, { motivo: "teste" });
ok("primeiro estorno funciona", r.status === 200);
r = await req("DELETE", `/api/pagamentos/${pg.pagamento_id}`, { motivo: "teste" });
ok("nao estorna o mesmo pagamento duas vezes", r.status === 404);

// ---------- historico guarda tudo ----------
r = await req("GET", "/api/registro");
const acoes = r.dados.map(l => l.acao);
ok("historico registra pagamento e estorno",
   acoes.includes("recebeu pagamento") && acoes.includes("estornou pagamento"),
   [...new Set(acoes)].slice(0, 6).join(", "));
ok("historico guarda quem fez", r.dados.every(l => l.usuario || l.acao === "entrou"));

// ---------- calendario em mes vazio ----------
r = await req("GET", "/api/calendario?mes=2026-01");
ok("mes sem evento nao quebra", r.status === 200 && Array.isArray(r.dados.eventos),
   r.dados.eventos.length + " eventos, " + r.dados.periodos.length + " periodos");


// ---------- isencao: participa mas nao paga ----------
console.log("\n  Isencao\n  ---------------------------------------------");
r = await req("POST", "/api/eventos", {
  nome: "Evento com bolsista", categoria: "passeio", inicio: "2026-10-05",
  cobra: true, valor: 50, turmas: [t2A.id]
});
const evIs = r.dados.id;
let lista = (await req("GET", `/api/eventos/${evIs}/turmas/${t2A.id}`)).dados.alunos;
const [i1, i2, i3] = lista;

r = await req("PUT", `/api/participacoes/${i1.participacao_id}`, { isento: true });
ok("isencao sem motivo e recusada", r.status === 400, r.dados?.erro);

r = await req("PUT", `/api/participacoes/${i1.participacao_id}`, { isento: true, motivo_isencao: "ok" });
ok("motivo curto demais e recusado", r.status === 400);

r = await req("PUT", `/api/participacoes/${i1.participacao_id}`, { isento: true, motivo_isencao: "Bolsista integral" });
ok("aluno isentado com motivo", r.status === 200 && r.dados.situacao === "isento", r.dados?.aluno);
ok("motivo fica guardado", r.dados.motivo_isencao === "Bolsista integral");
ok("isento continua participando do evento", r.dados.participa === 1);

r = await req("POST", "/api/pagamentos", { participacao_id: i1.participacao_id, valor: 50, meio: "pix" });
ok("nao recebe dinheiro de quem esta isento", r.status === 409, r.dados?.erro);

// isento nao entra na conta do que falta receber
let ev = (await req("GET", `/api/eventos/${evIs}`)).dados;
const semIsento = (lista.length - 1) * 50;
ok("isento sai do previsto", ev.resumo.previsto === semIsento, `previsto ${ev.resumo.previsto} de ${lista.length * 50}`);
ok("isento nao conta como pendente", ev.resumo.pendentes === lista.length - 1, `${ev.resumo.pendentes} pendentes`);
ok("resumo conta os isentos", ev.resumo.isentos === 1);
ok("resumo mostra quanto foi isentado", ev.resumo.isentado === 50, brl(ev.resumo.isentado));

// voltar a cobrar
r = await req("PUT", `/api/participacoes/${i1.participacao_id}`, { isento: false });
ok("voltar a cobrar devolve para pendente", r.dados.situacao === "pendente");
ok("motivo e limpo ao voltar a cobrar", !r.dados.motivo_isencao);
ev = (await req("GET", `/api/eventos/${evIs}`)).dados;
ok("previsto volta ao valor cheio", ev.resumo.previsto === lista.length * 50);

// quem ja pagou nao pode ser isentado sem estorno
await req("POST", "/api/pagamentos", { participacao_id: i2.participacao_id, valor: 50, meio: "cartao" });
r = await req("PUT", `/api/participacoes/${i2.participacao_id}`, { isento: true, motivo_isencao: "Bolsista integral" });
ok("nao isenta quem ja pagou", r.status === 409, r.dados?.erro);

// turma so com pagos e isentos fica completa
const todos = (await req("GET", `/api/eventos/${evIs}/turmas/${t2A.id}`)).dados.alunos;
for (const a of todos.filter(x => x.situacao === "pendente"))
  await req("PUT", `/api/participacoes/${a.participacao_id}`, { isento: true, motivo_isencao: "Cortesia da direcao" });
ev = (await req("GET", `/api/eventos/${evIs}`)).dados;
ok("turma so com pagos e isentos nao tem pendencia", ev.resumo.pendentes === 0,
   `${ev.resumo.pagos} pagos, ${ev.resumo.isentos} isentos`);
ok("previsto vira so o que ja entrou", ev.resumo.previsto === ev.resumo.arrecadado,
   `previsto ${ev.resumo.previsto}, arrecadado ${ev.resumo.arrecadado}`);

// relatorio traz a isencao
r = await req("GET", `/api/relatorios/pagamentos?evento=${evIs}&turma=${t2A.id}`);
const rel = r.dados.turmas[0];
ok("relatorio traz o motivo da isencao",
   rel.alunos.some(a => a.situacao === "isento" && a.motivo_isencao));
ok("caixa nao conta isento como dinheiro", rel.caixa.total === rel.resumo.arrecadado,
   `caixa ${rel.caixa.total}, arrecadado ${rel.resumo.arrecadado}`);

// lista de cobranca ignora isentos
r = await req("GET", `/api/relatorios/pagamentos?evento=${evIs}&somentePendentes=1`);
ok("lista de cobranca nao chama isento",
   r.dados.turmas.every(t => t.alunos.every(a => a.situacao === "pendente")));

// historico guarda a isencao com motivo
r = await req("GET", "/api/registro");
const isencao = r.dados.find(l => l.acao === "isentou do pagamento");
ok("historico registra a isencao", !!isencao, isencao?.usuario);
ok("historico guarda o motivo", (isencao?.detalhe || "").includes("Bolsista") || (isencao?.detalhe || "").includes("Cortesia"));

const brl2 = (n) => "R$ " + Number(n).toFixed(2);

console.log(`\n  ${falhas ? falhas + " falha(s)" : "tudo passou"}\n`);
process.exit(falhas ? 1 : 0);

// Edicao de evento, calendario letivo e cadastro de pessoas.
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
const ok = (nome, cond, extra = "") => {
  console.log(`  ${cond ? "ok  " : "FALHA"}  ${nome}${extra ? "  -> " + extra : ""}`);
  if (!cond) falhas++;
};

console.log("\n  Ajustes: evento, calendario e pessoas\n  ---------------------------------------------");
await req("POST", "/api/sessao", { email: "gabiru10rosas@gmail.com", senha: "senha12345" });
const turmas = (await req("GET", "/api/turmas")).dados;
const t2A = turmas.find(t => t.codigo === "2A");
const t2B = turmas.find(t => t.codigo === "2B");
const t2C = turmas.find(t => t.codigo === "2C");

// ---------- editar evento ----------
let r = await req("POST", "/api/eventos", {
  nome: "Passeio ao museu", categoria: "passeio", inicio: "2026-11-10",
  cobra: true, valor: 60, turmas: [t2A.id, t2B.id]
});
const ev = r.dados.id;

r = await req("PUT", `/api/eventos/${ev}`, {
  nome: "Passeio ao museu de arte", categoria: "passeio",
  inicio: "2026-11-17", fim: "2026-11-17", valor: 60, turmas: [t2A.id, t2B.id]
});
ok("nome e data do evento sao editados", r.status === 200 && r.dados.nome === "Passeio ao museu de arte", r.dados?.inicio);

r = await req("PUT", `/api/eventos/${ev}`, {
  nome: "Passeio ao museu de arte", inicio: "2026-11-17", fim: "2026-11-10", valor: 60
});
ok("fim antes do inicio e recusado na edicao", r.status === 400, r.dados?.erro);

// turma nova entra com os alunos ja prontos
r = await req("PUT", `/api/eventos/${ev}`, {
  nome: "Passeio ao museu de arte", inicio: "2026-11-17", valor: 60,
  turmas: [t2A.id, t2B.id, t2C.id]
});
ok("turma nova entra no evento", r.dados.entraram === 1);
r = await req("GET", `/api/eventos/${ev}/turmas/${t2C.id}`);
ok("turma nova ja vem com os alunos", r.dados.alunos.length === t2C.alunos, r.dados.alunos.length + " alunos");

// tirar turma sem pagamento pode
r = await req("PUT", `/api/eventos/${ev}`, {
  nome: "Passeio ao museu de arte", inicio: "2026-11-17", valor: 60, turmas: [t2A.id, t2B.id]
});
ok("turma sem pagamento pode sair", r.dados.sairam === 1);

// trocar o valor so mexe em quem nao pagou
const alunos2A = (await req("GET", `/api/eventos/${ev}/turmas/${t2A.id}`)).dados.alunos;
await req("POST", "/api/pagamentos", { participacao_id: alunos2A[0].participacao_id, valor: 60, meio: "pix" });
r = await req("PUT", `/api/eventos/${ev}`, {
  nome: "Passeio ao museu de arte", inicio: "2026-11-17", valor: 75,
  aplicarValor: true, turmas: [t2A.id, t2B.id]
});
ok("valor novo aplicado a quem falta pagar", r.dados.valoresTrocados > 0, r.dados.valoresTrocados + " alunos");
const depois = (await req("GET", `/api/eventos/${ev}/turmas/${t2A.id}`)).dados.alunos;
ok("quem ja pagou mantem o valor antigo",
   depois.find(a => a.participacao_id === alunos2A[0].participacao_id).valor === 60, "R$ 60");
ok("quem nao pagou ficou com o valor novo",
   depois.filter(a => a.situacao === "pendente").every(a => a.valor === 75), "R$ 75");

// turma com pagamento nao pode sair
r = await req("PUT", `/api/eventos/${ev}`, {
  nome: "Passeio ao museu de arte", inicio: "2026-11-17", valor: 75, turmas: [t2B.id]
});
ok("turma com pagamento nao pode sair do evento", r.status === 409, r.dados?.erro?.slice(0, 60));

// cancelar evento
r = await req("DELETE", `/api/eventos/${ev}`);
ok("nao cancela evento com pagamento lancado", r.status === 409, r.dados?.erro?.slice(0, 50));

r = await req("POST", "/api/eventos", { nome: "Evento a cancelar", categoria: "reuniao",
  inicio: "2026-11-25", cobra: false, turmas: [t2A.id] });
const evCancel = r.dados.id;
r = await req("DELETE", `/api/eventos/${evCancel}`);
ok("evento sem pagamento pode ser cancelado", r.status === 200);
r = await req("GET", "/api/calendario?mes=2026-11");
ok("cancelado some do calendario", !r.dados.eventos.some(e => e.id === evCancel));

// ---------- calendario letivo ----------
console.log("\n  Calendario letivo\n  ---------------------------------------------");
r = await req("POST", "/api/periodos", { nome: "Semana de provas", tipo: "unidade",
  inicio: "2026-11-23", fim: "2026-11-27" });
ok("periodo criado", r.status === 201);
const per = r.dados.id;

r = await req("POST", "/api/periodos", { nome: "X", tipo: "carnaval", inicio: "2026-11-23" });
ok("tipo invalido e recusado", r.status === 400, r.dados?.erro);
r = await req("POST", "/api/periodos", { nome: "", tipo: "feriado", inicio: "2026-11-23" });
ok("periodo sem nome e recusado", r.status === 400);
r = await req("POST", "/api/periodos", { nome: "Invertido", tipo: "recesso", inicio: "2026-11-23", fim: "2026-11-01" });
ok("fim antes do inicio e recusado", r.status === 400, r.dados?.erro);

r = await req("POST", "/api/periodos", { nome: "Dia da escola", tipo: "feriado", inicio: "2026-11-05" });
ok("feriado de um dia so usa a mesma data no fim", r.status === 201);
r = await req("GET", "/api/calendario?mes=2026-11");
const f = r.dados.periodos.find(p => p.nome === "Dia da escola");
ok("feriado novo aparece no calendario", f?.inicio === f?.fim && f?.inicio === "2026-11-05");

r = await req("PUT", `/api/periodos/${per}`, { nome: "Semana de provas da 3a unidade",
  tipo: "unidade", inicio: "2026-11-23", fim: "2026-11-27" });
ok("periodo editado", r.status === 200);
r = await req("DELETE", `/api/periodos/${per}`);
ok("periodo apagado", r.status === 200);
r = await req("DELETE", `/api/periodos/${per}`);
ok("apagar duas vezes devolve 404", r.status === 404);

// ---------- pessoas ----------
console.log("\n  Cadastro de pessoas\n  ---------------------------------------------");
r = await req("POST", "/api/usuarios", { nome: "Ana Secretaria", email: "ana@santachiara.com.br",
  senha: "senhaforte1", papel: "secretaria" });
ok("pessoa cadastrada", r.status === 201);
const ana = r.dados.id;

r = await req("POST", "/api/usuarios", { nome: "Bia", email: "nao-e-email", senha: "senhaforte1" });
ok("e-mail torto e recusado", r.status === 400, r.dados?.erro);
r = await req("POST", "/api/usuarios", { nome: "Bia", email: "bia@x.com", senha: "curta" });
ok("senha curta e recusada", r.status === 400, r.dados?.erro);
r = await req("POST", "/api/usuarios", { nome: "Ana de novo", email: "ana@santachiara.com.br", senha: "senhaforte1" });
ok("e-mail repetido e recusado", r.status === 409, r.dados?.erro);

r = await req("PUT", `/api/usuarios/${ana}`, { papel: "coordenacao" });
ok("secretaria promovida a coordenacao", r.status === 200 && r.dados.papel === "coordenacao");

r = await req("PUT", `/api/usuarios/${ana}`, { ativo: false });
ok("acesso pode ser tirado", r.status === 200 && r.dados.ativo === 0);

// a ultima coordenacao ativa nao pode se trancar do lado de fora
const eu = (await req("GET", "/api/eu")).dados;
r = await req("PUT", `/api/usuarios/${eu.id}`, { papel: "secretaria" });
ok("ultima coordenacao nao pode se rebaixar", r.status === 409, r.dados?.erro);
r = await req("PUT", `/api/usuarios/${eu.id}`, { ativo: false });
ok("ultima coordenacao nao pode tirar o proprio acesso", r.status === 409);

// senha nova derruba a sessao antiga e passa a valer
r = await req("PUT", `/api/usuarios/${ana}`, { ativo: true, senha: "outrasenha9" });
ok("senha trocada pela coordenacao", r.status === 200);
const guardado = cookie;
cookie = "";
r = await req("POST", "/api/sessao", { email: "ana@santachiara.com.br", senha: "senhaforte1" });
ok("senha antiga para de funcionar", r.status === 401);
r = await req("POST", "/api/sessao", { email: "ana@santachiara.com.br", senha: "outrasenha9" });
ok("senha nova funciona", r.status === 200);

// secretaria nao mexe em ajustes
r = await req("POST", "/api/usuarios", { nome: "C", email: "c@x.com", senha: "senhaforte1" });
ok("coordenacao promovida consegue cadastrar", r.status === 201);
cookie = guardado;
r = await req("PUT", `/api/usuarios/${ana}`, { papel: "secretaria" });
await req("POST", "/api/sessao", { email: "ana@santachiara.com.br", senha: "outrasenha9" });
r = await req("POST", "/api/periodos", { nome: "Teste", tipo: "feriado", inicio: "2026-12-01" });
ok("secretaria nao edita o calendario letivo", r.status === 403, r.dados?.erro);
r = await req("PUT", `/api/eventos/${ev}`, { nome: "X", inicio: "2026-11-17", valor: 75 });
ok("secretaria nao edita evento", r.status === 403);
r = await req("POST", "/api/usuarios", { nome: "D", email: "d@x.com", senha: "senhaforte1" });
ok("secretaria nao cadastra pessoa", r.status === 403);

console.log(`\n  ${falhas ? falhas + " falha(s)" : "tudo passou"}\n`);
process.exit(falhas ? 1 : 0);

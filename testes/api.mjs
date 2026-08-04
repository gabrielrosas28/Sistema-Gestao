// Teste de ponta a ponta da API
const B = "http://127.0.0.1:8099";
let cookie = "";
let falhas = 0;

async function req(metodo, caminho, corpo) {
  const r = await fetch(B + caminho, {
    method: metodo,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  const set = r.headers.getSetCookie?.() || [];
  if (set.length) cookie = set.map(c => c.split(";")[0]).join("; ");
  let dados = null;
  try { dados = await r.json(); } catch {}
  return { status: r.status, dados };
}

function ok(nome, cond, extra = "") {
  console.log(`  ${cond ? "ok  " : "FALHA"}  ${nome}${extra ? "  -> " + extra : ""}`);
  if (!cond) falhas++;
}

console.log("\n  Teste da API\n  ---------------------------------------------");

let r = await req("POST", "/api/sessao", { email: "gabiru10rosas@gmail.com", senha: "errada" });
ok("senha errada e recusada", r.status === 401, r.dados?.erro);

r = await req("GET", "/api/turmas");
ok("sem login nao le turmas", r.status === 401);

r = await req("POST", "/api/sessao", { email: "gabiru10rosas@gmail.com", senha: "senha12345" });
ok("login funciona", r.status === 200 && r.dados.papel === "coordenacao", r.dados?.nome);

r = await req("GET", "/api/turmas");
const turmas = r.dados;
const t2A = turmas.find(t => t.codigo === "2A");
ok("39 turmas cadastradas", turmas.length === 39, turmas.length + " turmas");
ok("2 ano A tem alunos", t2A.alunos > 20, `${t2A.alunos} alunos, ${t2A.professora}`);

const turmasFund = turmas.filter(t => t.segmento === "fundamental" && t.alunos > 0).map(t => t.id);
r = await req("POST", "/api/eventos", {
  nome: "Dia dos Pais", categoria: "comemoracao", inicio: "2026-08-09",
  cobra: true, valor: 30, turmas: turmasFund
});
ok("evento criado", r.status === 201, "id " + r.dados?.id);
const eventoId = r.dados.id;

r = await req("POST", "/api/eventos", { nome: "", categoria: "passeio", inicio: "2026-08-14", turmas: [1] });
ok("evento sem nome e recusado", r.status === 400, r.dados?.erro);

r = await req("POST", "/api/eventos", {
  nome: "Passeio ao parque", categoria: "passeio", inicio: "2026-08-14",
  cobra: false, turmas: turmasFund.slice(0, 3)
});
ok("evento sem cobranca criado", r.status === 201);

r = await req("GET", `/api/eventos/${eventoId}/turmas/${t2A.id}`);
const turma = r.dados;
ok("participacoes criadas junto com o evento", turma.alunos.length === t2A.alunos,
   turma.alunos.length + " alunos");
ok("todos comecam pendentes", turma.alunos.every(a => a.situacao === "pendente"));
ok("valor do evento aplicado", turma.alunos[0].valor === 30);

const [a1, a2, a3, a4] = turma.alunos;
r = await req("POST", "/api/pagamentos", { participacao_id: a1.participacao_id, valor: 30, meio: "pix" });
ok("pagamento em pix", r.status === 201 && r.dados.situacao === "pago", r.dados?.aluno);

r = await req("POST", "/api/pagamentos", { participacao_id: a1.participacao_id, valor: 30, meio: "pix" });
ok("nao deixa pagar duas vezes", r.status === 409, r.dados?.erro);

r = await req("POST", "/api/pagamentos", { participacao_id: a2.participacao_id, valor: 30, meio: "cartao" });
ok("pagamento em cartao", r.status === 201);
const pagA3 = await req("POST", "/api/pagamentos", { participacao_id: a3.participacao_id, valor: 30, meio: "dinheiro" });
ok("pagamento em dinheiro", pagA3.status === 201);

r = await req("POST", "/api/pagamentos", { participacao_id: a4.participacao_id, valor: 30, meio: "boleto" });
ok("meio invalido e recusado", r.status === 400, r.dados?.erro);

r = await req("PUT", `/api/participacoes/${a4.participacao_id}`, { participa: false });
ok("marcar que nao participa", r.status === 200 && r.dados.situacao === "fora");

r = await req("POST", "/api/pagamentos", { participacao_id: a4.participacao_id, valor: 30, meio: "pix" });
ok("nao recebe de quem nao participa", r.status === 409, r.dados?.erro);

r = await req("PUT", `/api/participacoes/${a1.participacao_id}`, { participa: false });
ok("nao tira do evento quem ja pagou", r.status === 409, r.dados?.erro);

r = await req("PUT", `/api/participacoes/${a2.participacao_id}`, { valor: 15 });
ok("valor individual ajustado", r.status === 200 && r.dados.valor === 15);

r = await req("DELETE", `/api/pagamentos/${pagA3.dados.pagamento_id}`, { motivo: "lancado na turma errada" });
ok("estorno volta para pendente", r.status === 200 && r.dados.situacao === "pendente", r.dados?.aluno);

r = await req("GET", `/api/relatorios/pagamentos?evento=${eventoId}&turma=${t2A.id}`);
const rel = r.dados.turmas[0];
ok("relatorio traz a turma", rel.turma.codigo === "2A");
ok("caixa separa por meio",
   rel.caixa.pix.total === 30 && rel.caixa.cartao.total === 15 && rel.caixa.dinheiro.total === 0,
   `pix ${rel.caixa.pix.total} | cartao ${rel.caixa.cartao.total} | dinheiro ${rel.caixa.dinheiro.total}`);
ok("total do caixa bate com a soma", rel.caixa.total === 45, "total " + rel.caixa.total);
ok("resumo conta os pendentes", rel.resumo.pendentes === rel.resumo.participam - rel.resumo.pagos,
   `${rel.resumo.pagos} pagos, ${rel.resumo.pendentes} pendentes, ${rel.resumo.participam} participam`);

r = await req("GET", `/api/relatorios/pagamentos?evento=${eventoId}&turma=${t2A.id}&somentePendentes=1`);
ok("relatorio de cobranca so traz pendentes",
   r.dados.turmas[0].alunos.every(a => a.situacao === "pendente"),
   r.dados.turmas[0].alunos.length + " a cobrar");

r = await req("POST", "/api/fechamentos", { evento_id: eventoId, turma_id: t2A.id });
ok("turma fechada", r.status === 201);

r = await req("POST", "/api/pagamentos", { participacao_id: a3.participacao_id, valor: 30, meio: "pix" });
ok("turma fechada trava o lancamento", r.status === 423, r.dados?.erro?.slice(0, 70));

r = await req("POST", "/api/fechamentos", { evento_id: eventoId, turma_id: t2A.id });
ok("nao fecha duas vezes", r.status === 409);

r = await req("DELETE", `/api/fechamentos/${eventoId}/${t2A.id}`);
ok("turma reaberta", r.status === 200);

r = await req("POST", "/api/pagamentos", { participacao_id: a3.participacao_id, valor: 30, meio: "pix" });
ok("depois de reabrir volta a lancar", r.status === 201);

r = await req("GET", "/api/calendario?mes=2026-08");
ok("calendario traz os eventos de agosto", r.dados.eventos.length >= 2,
   r.dados.eventos.map(e => e.nome).join(", "));
ok("calendario traz unidade e feriados", r.dados.periodos.length >= 1,
   r.dados.periodos.map(p => p.nome).join(", "));

await req("POST", "/api/usuarios", { nome: "Secretaria Teste", email: "sec@teste.com", senha: "senha12345", papel: "secretaria" });
cookie = "";
r = await req("POST", "/api/sessao", { email: "sec@teste.com", senha: "senha12345" });
ok("secretaria entra", r.status === 200);
r = await req("POST", "/api/eventos", { nome: "X", categoria: "passeio", inicio: "2026-09-01", turmas: [t2A.id] });
ok("secretaria nao cria evento", r.status === 403, r.dados?.erro);
r = await req("POST", "/api/fechamentos", { evento_id: eventoId, turma_id: t2A.id });
ok("secretaria nao fecha turma", r.status === 403);
r = await req("POST", "/api/pagamentos", { participacao_id: turma.alunos[5].participacao_id, valor: 30, meio: "pix" });
ok("secretaria lanca pagamento", r.status === 201);
r = await req("GET", "/api/registro");
ok("secretaria nao ve o historico", r.status === 403);

console.log(`\n  ${falhas ? falhas + " falha(s)" : "tudo passou"}\n`);
process.exit(falhas ? 1 : 0);

/* ============================================================
   Gestão — Colégio Santa Chiara
   Tudo que aparece na tela vem do servidor da escola.
   ============================================================ */

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const brl = (n) => "R$ " + Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const primeiro = (n) => String(n || "").split(" ")[0];
const resto = (n) => String(n || "").split(" ").slice(1).join(" ");
const diaMes = (s) => (s ? s.slice(8, 10) + "/" + s.slice(5, 7) : "");
const hojeIso = () => new Date().toLocaleDateString("sv-SE");   // AAAA-MM-DD local

const CATEGORIAS = {
  comemoracao: { nome: "Comemoração", cor: "#FDB92E" },
  passeio:     { nome: "Passeio",     cor: "#2E9BD1" },
  avaliacao:   { nome: "Avaliações",  cor: "#3E4095" },
  reuniao:     { nome: "Reunião",     cor: "#6C7291" },
  loja:        { nome: "Fardamento e material", cor: "#8E5AB8" },
  esporte:     { nome: "Esportes",    cor: "#12857A" }
};
const MEIOS = { pix: "Pix", cartao: "Cartão", dinheiro: "Dinheiro" };
const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

/* ---------- estado ---------- */
let eu = null, turmas = [], eventos = [];
let eventoAtual = null, turmaAtual = null, dadosTurma = null;
let filtro = "todos", busca = "";
let mesAtual = new Date();
let turmasNovoEvento = new Set(), catNovoEvento = "comemoracao";
let escopoRel = "turma", formatoRel = "pdf";

/* ============================================================
   conversa com o servidor
   ============================================================ */
class ErroDoServidor extends Error {
  constructor(mensagem, status) { super(mensagem); this.status = status; }
}

async function api(metodo, caminho, corpo) {
  let r;
  try {
    r = await fetch(caminho, {
      method: metodo,
      headers: corpo ? { "Content-Type": "application/json" } : {},
      body: corpo ? JSON.stringify(corpo) : undefined
    });
  } catch {
    throw new ErroDoServidor("Sem conexão com o servidor da escola. Confira se ele está ligado.", 0);
  }
  let dados = null;
  try { dados = await r.json(); } catch {}
  // O 401 da própria tela de entrada é senha errada, não sessão vencida.
  // Tratar os dois igual mandava quem errou a senha para "sessão expirou",
  // que não diz nada sobre o que a pessoa precisa fazer.
  const ehLogin = caminho === "/api/sessao" && metodo === "POST";
  if (r.status === 401 && !ehLogin) {
    mostrarEntrada("Sua sessão expirou. Entre de novo.");
    throw new ErroDoServidor("sessão expirada", 401);
  }
  if (!r.ok) throw new ErroDoServidor(dados?.erro || "Não consegui completar essa ação.", r.status);
  return dados;
}

const pegar  = (c) => api("GET", c);
const enviar = (c, corpo) => api("POST", c, corpo);
const trocar = (c, corpo) => api("PUT", c, corpo);
const apagar = (c, corpo) => api("DELETE", c, corpo);

/* ============================================================
   entrada
   ============================================================ */
function mostrarEntrada(recado) {
  eu = null;
  $("#telaApp").hidden = true;
  $("#telaEntrada").hidden = false;
  $("#totais").hidden = true;
  const r = $("#recadoEntrada");
  r.hidden = !recado; r.textContent = recado || "";
}

$("#formEntrada").addEventListener("submit", async (e) => {
  e.preventDefault();
  const botao = $("#btnEntrar");
  botao.disabled = true; botao.textContent = "Entrando...";
  try {
    eu = await api("POST", "/api/sessao", { email: $("#email").value, senha: $("#senha").value });
    $("#senha").value = "";
    await abrirSistema();
  } catch (err) {
    const r = $("#recadoEntrada");
    r.hidden = false; r.textContent = err.message;
  } finally {
    botao.disabled = false; botao.textContent = "Entrar";
  }
});

$("#btnSair").onclick = async () => {
  try { await apagar("/api/sessao"); } catch {}
  mostrarEntrada();
};

async function abrirSistema() {
  $("#telaEntrada").hidden = true;
  $("#telaApp").hidden = false;
  $("#navNome").textContent = eu.nome;
  $("#navPapel").textContent = `${eu.papel === "coordenacao" ? "Coordenação" : "Secretaria"} · versão ${eu.versao}`;
  document.body.dataset.papel = eu.papel;
  turmas = await pegar("/api/turmas");
  irPara("inicio");
}

/* ============================================================
   navegação
   ============================================================ */
const conteudo = $("#conteudo"), titulo = $("#titulo"), trilha = $("#trilha");
const acoesTopo = $("#acoesTopo"), barraTotais = $("#totais");

const TELAS = {};

async function irPara(tela) {
  document.querySelectorAll(".nav__item").forEach((b) => b.removeAttribute("aria-current"));
  const raiz = { inicio: "inicio", calendario: "calendario", eventos: "eventos",
                 evento: "eventos", pagamentos: "eventos", turmas: "turmas", ajustes: "ajustes" }[tela];
  document.querySelector(`.nav__item[data-ir="${raiz}"]`)?.setAttribute("aria-current", "page");
  barraTotais.hidden = true; trilha.hidden = true; trilha.innerHTML = ""; acoesTopo.innerHTML = "";
  window.scrollTo(0, 0);
  conteudo.innerHTML = `<div class="carregando"><span class="girando"></span> Buscando no servidor...</div>`;
  try {
    await TELAS[tela]();
  } catch (err) {
    if (err.status === 401) return;
    conteudo.innerHTML = `<div class="vazio"><h3>Não deu para carregar</h3><p>${esc(err.message)}</p>
      <button class="btn btn--primario" onclick="location.reload()">Tentar de novo</button></div>`;
  }
}

document.querySelectorAll(".nav__item").forEach((b) => b.onclick = () => irPara(b.dataset.ir));

/* ---------- avisos ---------- */
let avisoTimer;
function avisar(texto, erro) {
  const el = $("#aviso");
  el.textContent = texto;
  el.classList.toggle("aviso--erro", !!erro);
  el.hidden = false;
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => (el.hidden = true), erro ? 5200 : 3200);
}

/* ============================================================
   início
   ============================================================ */
TELAS.inicio = async () => {
  titulo.textContent = saudacao();
  acoesTopo.innerHTML = botaoNovoEvento();
  eventos = await pegar("/api/eventos?cobra=1");

  const arrecadado = eventos.reduce((s, e) => s + (e.resumo?.arrecadado || 0), 0);
  const previsto   = eventos.reduce((s, e) => s + (e.resumo?.previsto || 0), 0);
  const pendentes  = eventos.reduce((s, e) => s + (e.resumo?.pendentes || 0), 0);
  const totalAlunos = turmas.reduce((s, t) => s + t.alunos, 0);
  const proximo = eventos.filter((e) => e.inicio >= hojeIso()).sort((a, b) => a.inicio.localeCompare(b.inicio))[0];

  conteudo.innerHTML = `
    <div class="fichas">
      <div class="ficha ficha--ok"><div class="ficha__rotulo">Recebido</div>
        <div class="ficha__valor">${brl(arrecadado)}</div>
        <div class="ficha__nota">${eventos.length} ${eventos.length === 1 ? "evento aberto" : "eventos abertos"}</div></div>
      <div class="ficha ficha--destaque"><div class="ficha__rotulo">A receber</div>
        <div class="ficha__valor">${brl(previsto - arrecadado)}</div>
        <div class="ficha__nota">${pendentes} ${pendentes === 1 ? "pagamento pendente" : "pagamentos pendentes"}</div></div>
      <div class="ficha"><div class="ficha__rotulo">Alunos matriculados</div>
        <div class="ficha__valor">${totalAlunos} <small>em ${turmas.length} turmas</small></div>
        <div class="ficha__nota">Maternalzinho ao 5º ano</div></div>
      <div class="ficha"><div class="ficha__rotulo">Próximo evento</div>
        ${proximo
          ? `<div class="ficha__valor" style="font-size:20px">${esc(proximo.nome)}</div>
             <div class="ficha__nota">${diaMes(proximo.inicio)} · ${faltam(proximo.inicio)}</div>`
          : `<div class="ficha__valor" style="font-size:20px">—</div>
             <div class="ficha__nota">Nenhum evento marcado</div>`}</div>
    </div>
    <div class="secao"><h2>Eventos com cobrança</h2><span class="secao__nota">Clique para ver as turmas</span></div>
    <div class="eventos">${eventos.length ? eventos.map(linhaEvento).join("") : semEventos()}</div>`;
  ligar();
};

const saudacao = () => {
  const h = new Date().getHours();
  return `${h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite"}, ${primeiro(eu.nome)}`;
};

function faltam(data) {
  const dias = Math.round((new Date(data + "T12:00") - new Date(hojeIso() + "T12:00")) / 86400e3);
  if (dias === 0) return "é hoje";
  if (dias === 1) return "é amanhã";
  return `faltam ${dias} dias`;
}

const semEventos = () => `<div class="vazio"><h3>Nenhum evento com cobrança</h3>
  <p>Crie um evento para começar a lançar os pagamentos.</p>
  ${eu.papel === "coordenacao" ? `<button class="btn btn--primario" data-novo>Criar evento</button>` : ""}</div>`;

const botaoNovoEvento = () => eu.papel === "coordenacao"
  ? `<button class="btn btn--primario" data-novo><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 5v14M5 12h14"/></svg>Criar evento</button>`
  : "";

function linhaEvento(e) {
  const r = e.resumo || { pagos: 0, participam: 0, arrecadado: 0, previsto: 0 };
  const pct = r.participam ? Math.round(r.pagos / r.participam * 100) : 0;
  return `<button class="evento" data-evento="${e.id}">
    <div>
      <div class="evento__nome">${esc(e.nome)}</div>
      <div class="evento__meta">${diaMes(e.inicio)} · ${e.qtd_turmas} ${e.qtd_turmas === 1 ? "turma" : "turmas"} · <b>${brl(e.valor)}</b> por aluno</div>
    </div>
    <div>
      <div class="fita"><div class="fita__pago" style="width:${pct}%"></div></div>
      <div class="fita__rotulo"><span><b>${r.pagos}</b> de ${r.participam} pagos</span><span>${pct}%</span></div>
    </div>
    <div class="dinheiro">${brl(r.arrecadado)}<small>de ${brl(r.previsto)}</small></div>
    <svg class="evento__seta" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="m9 6 6 6-6 6"/></svg>
  </button>`;
}

/* ============================================================
   lista de eventos
   ============================================================ */
TELAS.eventos = async () => {
  titulo.textContent = "Pagamentos";
  acoesTopo.innerHTML = botaoNovoEvento();
  eventos = await pegar("/api/eventos?cobra=1");
  conteudo.innerHTML = `
    <div class="secao"><h2>Eventos com cobrança</h2><span class="secao__nota">Clique para ver as turmas</span></div>
    <div class="eventos">${eventos.length ? eventos.map(linhaEvento).join("") : semEventos()}</div>`;
  ligar();
};

/* ============================================================
   evento: turmas
   ============================================================ */
TELAS.evento = async () => {
  eventoAtual = await pegar(`/api/eventos/${eventoAtual.id}`);
  titulo.textContent = eventoAtual.nome;
  trilha.hidden = false;
  trilha.innerHTML = `<button data-voltar="eventos">Pagamentos</button> <span>›</span> <span>${esc(eventoAtual.nome)}</span>`;
  acoesTopo.innerHTML = eventoAtual.cobra ? botaoRelatorio() : "";

  const r = eventoAtual.resumo || {};
  const porSegmento = [
    { nome: "Educação Infantil", turmas: eventoAtual.turmas.filter((t) => t.segmento === "infantil") },
    { nome: "Ensino Fundamental I", turmas: eventoAtual.turmas.filter((t) => t.segmento === "fundamental") }
  ].filter((s) => s.turmas.length);

  conteudo.innerHTML = `
    ${eventoAtual.cobra ? `<div class="fichas" style="grid-template-columns:repeat(3,1fr)">
      <div class="ficha"><div class="ficha__rotulo">Valor por aluno</div><div class="ficha__valor">${brl(eventoAtual.valor)}</div>
        <div class="ficha__nota">${diaMes(eventoAtual.inicio)}${eventoAtual.fim ? " a " + diaMes(eventoAtual.fim) : ""}</div></div>
      <div class="ficha ficha--ok"><div class="ficha__rotulo">Recebido</div><div class="ficha__valor">${brl(r.arrecadado)}</div>
        <div class="ficha__nota">${r.pagos} de ${r.participam} alunos</div></div>
      <div class="ficha ficha--destaque"><div class="ficha__rotulo">A receber</div><div class="ficha__valor">${brl(r.previsto - r.arrecadado)}</div>
        <div class="ficha__nota">${r.pendentes} pendentes</div></div>
    </div>` : `<div class="faixa-unidade"><b>Evento sem cobrança</b><span>${CATEGORIAS[eventoAtual.categoria]?.nome || ""}</span></div>`}
    ${porSegmento.map((s) => `
      <div class="grupo-titulo">${s.nome}</div>
      <div class="turmas">${s.turmas.map((t) => {
        const rt = t.resumo || {};
        const pct = rt.participam ? Math.round(rt.pagos / rt.participam * 100) : 0;
        const completa = rt.participam > 0 && rt.pendentes === 0;
        // Evento sem cobrança não tem o que lançar: o cartão não é clicável.
        const abre = eventoAtual.cobra;
        return `<${abre ? "button" : "div"} class="turma" ${abre ? `data-turma="${t.id}"` : ""}>
          <div class="turma__nome">${esc(t.nome)}</div>
          <div class="turma__prof">${esc(t.professora || "")} · ${t.alunos} ${t.alunos === 1 ? "aluno" : "alunos"}</div>
          ${abre ? `<div class="fita"><div class="fita__pago" style="width:${pct}%"></div></div>
          <div class="turma__estado ${t.fechada || completa ? "turma__estado--ok" : "turma__estado--pend"}">
            ${t.fechada ? "Turma fechada" : completa ? "Turma completa" : rt.pendentes + " pendentes"}</div>` : ""}
        </${abre ? "button" : "div"}>`;
      }).join("")}</div>`).join("")}`;
  ligar();
};

const botaoRelatorio = () =>
  `<button class="btn btn--fantasma" data-relatorio><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 3v12M8 11l4 4 4-4"/><path d="M4 17v3h16v-3"/></svg>Exportar relatório</button>`;

/* ============================================================
   pagamentos da turma
   ============================================================ */
TELAS.pagamentos = async () => {
  dadosTurma = await pegar(`/api/eventos/${eventoAtual.id}/turmas/${turmaAtual.id}`);
  titulo.textContent = turmaAtual.nome;
  trilha.hidden = false;
  trilha.innerHTML = `<button data-voltar="eventos">Pagamentos</button> <span>›</span>
    <button data-voltar="evento">${esc(eventoAtual.nome)}</button> <span>›</span> <span>${esc(turmaAtual.nome)}</span>`;
  acoesTopo.innerHTML = botaoRelatorio();

  const f = dadosTurma.fechamento;
  conteudo.innerHTML = `
    ${dadosTurma.fechada ? `<div class="fechado">
      <div class="fechado__texto"><b>Turma fechada</b>Encerrada em ${dataHora(f?.fechado_em)} por ${esc(f?.fechado_por_nome || "—")} · os lançamentos estão travados.</div>
      ${eu.papel === "coordenacao" ? `<button class="btn btn--amarelo" data-reabrir>Reabrir turma</button>` : ""}
    </div>` : ""}
    <div class="filtros">
      <div class="busca">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input id="buscaAluno" placeholder="Buscar aluno ou matrícula" value="${esc(busca)}">
      </div>
      <button class="chip" data-filtro="todos">Todos <span></span></button>
      <button class="chip" data-filtro="pendentes">Pendentes <span></span></button>
      <button class="chip" data-filtro="pagos">Pagos <span></span></button>
      <button class="chip" data-filtro="isentos">Isentos <span></span></button>
      <button class="chip" data-filtro="fora">Não participam <span></span></button>
    </div>
    <div class="canhotos" id="canhotos"></div>`;

  $("#buscaAluno").oninput = (e) => { busca = e.target.value; desenharCanhotos(); };
  document.querySelectorAll("[data-filtro]").forEach((b) => b.onclick = () => { filtro = b.dataset.filtro; desenharCanhotos(); });
  ligar();
  desenharCanhotos();
};

const dataHora = (s) => (s ? s.slice(8, 10) + "/" + s.slice(5, 7) + " às " + s.slice(11, 16) : "");

function desenharCanhotos() {
  const lista = dadosTurma.alunos;
  const contagem = {
    todos: lista.length,
    pendentes: lista.filter((a) => a.situacao === "pendente").length,
    pagos: lista.filter((a) => a.situacao === "pago").length,
    isentos: lista.filter((a) => a.situacao === "isento").length,
    fora: lista.filter((a) => a.situacao === "fora").length
  };
  document.querySelectorAll("[data-filtro]").forEach((b) => {
    b.setAttribute("aria-pressed", b.dataset.filtro === filtro);
    b.querySelector("span").textContent = contagem[b.dataset.filtro];
  });

  const termo = busca.trim().toLowerCase();
  const visiveis = lista.filter((a) => {
    if (["pendentes", "pagos", "isentos", "fora"].includes(filtro)) {
      const alvo = { pendentes: "pendente", pagos: "pago", isentos: "isento", fora: "fora" }[filtro];
      if (a.situacao !== alvo) return false;
    }
    if (termo && !(a.aluno.toLowerCase().includes(termo) || a.matricula.includes(termo))) return false;
    return true;
  });

  const alvo = $("#canhotos");
  alvo.innerHTML = visiveis.length
    ? visiveis.map((a) => canhoto(a, dadosTurma.fechada)).join("")
    : `<div class="vazio" style="grid-column:1/-1"><h3>Nenhum aluno neste filtro</h3><p>Ajuste a busca ou escolha outro filtro.</p></div>`;

  if (!dadosTurma.fechada) visiveis.forEach((a) => ligarCanhoto(a, alvo));
  atualizarTotais();
}

function canhoto(a, travada) {
  const estilo = { pago: "canhoto--pago", isento: "canhoto--isento",
                   pendente: "canhoto--pendente", fora: "canhoto--fora" }[a.situacao];
  const classe = estilo + (travada ? " canhoto--travado" : "");
  const selo = { pago: `<span class="selo selo--pago">Pago</span>`,
                 isento: `<span class="selo selo--isento">Isento</span>`,
                 pendente: `<span class="selo selo--participa">A receber</span>`,
                 fora: `<span class="selo selo--fora">Não vai</span>` }[a.situacao];

  const controles = !a.participa
    ? `<div class="acoes"><button class="btn btn--fantasma" data-participa>Marcar participação</button></div>`
    : a.situacao === "isento"
    ? `<div class="motivo"><span class="motivo__rotulo">Vai ao evento sem pagar</span>${esc(a.motivo_isencao || "")}</div>
       <div class="acoes"><button class="btn btn--fantasma" data-cobrar>Voltar a cobrar</button></div>`
    : `<div class="campo">
         <span class="campo__rotulo">Valor</span>
         <input class="valor-entrada" data-valor value="${Number(a.valor).toFixed(2).replace(".", ",")}"
                inputmode="decimal" aria-label="Valor de ${esc(primeiro(a.aluno))}" ${a.situacao === "pago" ? "disabled" : ""}>
       </div>
       <div class="campo">
         <span class="campo__rotulo">Meio</span>
         <div class="meios">${Object.entries(MEIOS).map(([k, nome]) =>
           `<button class="meio" data-meio="${k}" aria-pressed="${a.meio === k}" ${a.situacao === "pago" ? "disabled" : ""}>${nome}</button>`).join("")}</div>
       </div>
       <div class="acoes">
         ${a.situacao === "pago"
           ? `<button class="btn btn--fantasma" data-estornar>Desfazer pagamento</button>`
           : `<button class="btn btn--primario" data-pagar>Confirmar pagamento</button>
              <button class="btn btn--fantasma" data-isentar title="Vai ao evento, mas não paga">Não paga</button>
              <button class="btn btn--fantasma" data-participa title="Não vai ao evento">Não vai</button>`}
       </div>`;

  return `<article class="canhoto ${classe}" data-part="${a.participacao_id}">
    <div class="canhoto__talao"><span class="canhoto__matricula">${esc(a.matricula)}</span></div>
    <div class="canhoto__corpo">
      <div class="canhoto__topo">
        <div style="min-width:0">
          <div class="canhoto__nome">${esc(primeiro(a.aluno))}</div>
          <div class="canhoto__sobrenome">${esc(resto(a.aluno))}</div>
        </div>${selo}
      </div>
      <div class="canhoto__linha"></div>
      ${controles}
      ${a.situacao === "pago"
        ? `<div class="carimbo ${a.recemPago ? "carimbo--novo" : ""}">PAGO<small>${MEIOS[a.meio] || ""} · ${diaMes(a.recebido_em)}</small></div>`
        : a.situacao === "isento"
        ? `<div class="carimbo carimbo--isento ${a.recemPago ? "carimbo--novo" : ""}">ISENTO</div>`
        : ""}
    </div>
  </article>`;
}

/* Guarda o meio escolhido antes de confirmar (ainda não foi ao servidor). */
const meioEscolhido = new Map();

function ligarCanhoto(a, alvo) {
  const el = alvo.querySelector(`[data-part="${a.participacao_id}"]`);
  if (!el) return;

  const comSalvamento = async (fn) => {
    el.classList.add("canhoto--salvando");
    try {
      const atualizado = await fn();
      trocarAluno(atualizado);
      desenharCanhotos();
    } catch (err) {
      if (err.status !== 401) avisar(err.message, true);
      el.classList.remove("canhoto--salvando");
      if (err.status === 423) irPara("pagamentos");   // alguém fechou a turma agora
    }
  };

  el.querySelectorAll("[data-participa]").forEach((b) => b.onclick = () =>
    comSalvamento(() => trocar(`/api/participacoes/${a.participacao_id}`, { participa: !a.participa })));

  el.querySelectorAll("[data-meio]").forEach((b) => b.onclick = () => {
    meioEscolhido.set(a.participacao_id, b.dataset.meio);
    a.meio = b.dataset.meio;
    desenharCanhotos();
  });

  el.querySelector("[data-pagar]")?.addEventListener("mousedown", (ev) => ev.preventDefault());
  el.querySelector("[data-pagar]")?.addEventListener("click", () => {
    const meio = meioEscolhido.get(a.participacao_id) || a.meio;
    if (!meio) return avisar("Escolha se entrou por Pix, cartão ou dinheiro.", true);
    const valor = lerValor(el);
    if (valor === null) return avisar("Confira o valor: use só números.", true);
    if (valor === 0) return avisar("O valor recebido não pode ser zero.", true);
    comSalvamento(async () => {
      const r = await enviar("/api/pagamentos", { participacao_id: a.participacao_id, valor, meio });
      r.recemPago = true;
      meioEscolhido.delete(a.participacao_id);
      setTimeout(() => { const x = dadosTurma.alunos.find((y) => y.participacao_id === r.participacao_id); if (x) x.recemPago = false; }, 600);
      return r;
    });
  });

  el.querySelector("[data-isentar]")?.addEventListener("click", () => {
    const motivo = prompt(
      `${a.aluno} vai ao evento sem pagar.\n\nPor quê? (bolsista, cortesia, combinado com a direção...)\n` +
      `Fica registrado com o seu nome.`, "");
    if (motivo === null) return;
    if (motivo.trim().length < 3) return avisar("Escreva o motivo da isenção.", true);
    comSalvamento(async () => {
      const r = await trocar(`/api/participacoes/${a.participacao_id}`,
                             { isento: true, motivo_isencao: motivo.trim() });
      r.recemPago = true;
      setTimeout(() => { const x = dadosTurma.alunos.find((y) => y.participacao_id === r.participacao_id); if (x) x.recemPago = false; }, 600);
      return r;
    });
  });

  el.querySelector("[data-cobrar]")?.addEventListener("click", () =>
    comSalvamento(() => trocar(`/api/participacoes/${a.participacao_id}`, { isento: false })));

  el.querySelector("[data-estornar]")?.addEventListener("click", () => {
    if (!confirm(`Desfazer o pagamento de ${a.aluno}?\n\nO lançamento não é apagado: fica registrado como estornado, com seu nome.`)) return;
    comSalvamento(() => apagar(`/api/pagamentos/${a.pagamento_id}`, { motivo: "estornado pela tela" }));
  });

  // Salva o valor sem redesenhar a tela. Redesenhar aqui derrubaria o clique
  // de quem digita o valor e vai direto para "Confirmar pagamento".
  el.querySelector("[data-valor]")?.addEventListener("change", async () => {
    const valor = lerValor(el);
    if (valor === null) { avisar("Confira o valor: use só números.", true); desenharCanhotos(); return; }
    if (valor === a.valor) return;
    try {
      trocarAluno(await trocar(`/api/participacoes/${a.participacao_id}`, { valor }));
      atualizarTotais();
    } catch (err) {
      if (err.status !== 401) avisar(err.message, true);
      desenharCanhotos();
    }
  });
}

function lerValor(el) {
  const bruto = el.querySelector("[data-valor]")?.value ?? "";
  const n = Number(String(bruto).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function trocarAluno(novo) {
  const i = dadosTurma.alunos.findIndex((a) => a.participacao_id === novo.participacao_id);
  if (i >= 0) dadosTurma.alunos[i] = { ...dadosTurma.alunos[i], ...novo };
}

function atualizarTotais() {
  const lista = dadosTurma.alunos;
  const cobraveis = lista.filter((a) => a.participa && !a.isento);
  const isentos = lista.filter((a) => a.situacao === "isento");
  const pagos = lista.filter((a) => a.situacao === "pago");
  const arrecadado = pagos.reduce((s, a) => s + a.valor, 0);
  const previsto = cobraveis.reduce((s, a) => s + a.valor, 0);

  barraTotais.hidden = false;
  barraTotais.innerHTML = `
    <div class="totais__item">Confirmados<b>${pagos.length} / ${cobraveis.length}</b></div>
    <div class="totais__item">Arrecadado<b>${brl(arrecadado)}</b></div>
    <div class="totais__item">Falta receber<b>${brl(previsto - arrecadado)}</b></div>
    ${isentos.length ? `<div class="totais__item">Isentos<b>${isentos.length}</b></div>` : ""}
    <div class="totais__acao">
      <button class="btn btn--fantasma" data-relatorio>Exportar relatório</button>
      ${eu.papel === "coordenacao"
        ? (dadosTurma.fechada
            ? `<button class="btn btn--amarelo" data-reabrir>Reabrir turma</button>`
            : `<button class="btn btn--amarelo" data-fecharturma>Fechar turma</button>`)
        : ""}
    </div>`;
  ligar();
}

/* ============================================================
   turmas
   ============================================================ */
TELAS.turmas = async () => {
  titulo.textContent = "Turmas";
  turmas = await pegar("/api/turmas");
  const grupos = [
    { nome: "Educação Infantil", lista: turmas.filter((t) => t.segmento === "infantil") },
    { nome: "Ensino Fundamental I", lista: turmas.filter((t) => t.segmento === "fundamental") }
  ].filter((g) => g.lista.length);

  conteudo.innerHTML = grupos.map((g) => `
    <div class="grupo-titulo">${g.nome} · ${g.lista.reduce((a, t) => a + t.alunos, 0)} alunos</div>
    <div class="turmas">${g.lista.map((t) => `
      <div class="turma">
        <div class="turma__nome">${esc(t.nome)}</div>
        <div class="turma__prof">${esc(t.professora || "")}</div>
        <div class="turma__estado ${t.alunos ? "turma__estado--ok" : "turma__estado--pend"}">
          ${t.alunos ? t.alunos + (t.alunos === 1 ? " aluno" : " alunos") : "sem alunos cadastrados"}</div>
      </div>`).join("")}</div>`).join("");
};

/* ============================================================
   ajustes — só a coordenação enxerga
   ============================================================ */
const TIPOS = { unidade: "Unidade letiva", recesso: "Recesso ou férias", feriado: "Feriado" };
let abaAjustes = "pessoas";

TELAS.ajustes = async () => {
  titulo.textContent = "Ajustes";
  const [pessoas, periodos] = await Promise.all([pegar("/api/usuarios"), pegar("/api/periodos")]);

  acoesTopo.innerHTML = abaAjustes === "pessoas"
    ? `<button class="btn btn--primario" data-nova-pessoa><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 5v14M5 12h14"/></svg>Cadastrar pessoa</button>`
    : `<button class="btn btn--primario" data-novo-periodo><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 5v14M5 12h14"/></svg>Adicionar período</button>`;

  conteudo.innerHTML = `
    <div class="filtros">
      <button class="chip" data-aba="pessoas" aria-pressed="${abaAjustes === "pessoas"}">Quem usa o sistema <span>${pessoas.filter((p) => p.ativo).length}</span></button>
      <button class="chip" data-aba="calendario" aria-pressed="${abaAjustes === "calendario"}">Calendário letivo <span>${periodos.length}</span></button>
    </div>
    ${abaAjustes === "pessoas" ? listaPessoas(pessoas) : listaPeriodos(periodos)}`;

  document.querySelectorAll("[data-aba]").forEach((b) => b.onclick = () => { abaAjustes = b.dataset.aba; irPara("ajustes"); });
  document.querySelectorAll("[data-nova-pessoa]").forEach((b) => b.onclick = () => abrirUsuario());
  document.querySelectorAll("[data-novo-periodo]").forEach((b) => b.onclick = () => abrirPeriodo());
  document.querySelectorAll("[data-pessoa]").forEach((b) => b.onclick = () =>
    abrirUsuario(pessoas.find((p) => p.id === Number(b.dataset.pessoa))));
  document.querySelectorAll("[data-periodo]").forEach((b) => b.onclick = () =>
    abrirPeriodo(periodos.find((p) => p.id === Number(b.dataset.periodo))));
};

function listaPessoas(pessoas) {
  return `<div class="secao"><h2>Quem usa o sistema</h2>
      <span class="secao__nota">Clique para editar ou trocar a senha</span></div>
    <div class="eventos">${pessoas.map((p) => `
      <button class="evento evento--pessoa ${p.ativo ? "" : "evento--inativo"}" data-pessoa="${p.id}">
        <div>
          <div class="evento__nome">${esc(p.nome)}${p.id === eu.id ? " <span class='etiqueta' style='background:var(--azul-claro);color:var(--azul)'>você</span>" : ""}</div>
          <div class="evento__meta">${esc(p.email)}</div>
        </div>
        <span class="etiqueta" style="${p.papel === "coordenacao"
          ? "background:var(--azul-claro);color:var(--azul)" : "background:var(--papel);color:var(--cinza)"}">
          ${p.papel === "coordenacao" ? "Coordenação" : "Secretaria"}</span>
        <span class="evento__meta">${p.ativo ? "" : "sem acesso"}</span>
        <svg class="evento__seta" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="m9 6 6 6-6 6"/></svg>
      </button>`).join("")}</div>
    <p class="ajuda" style="margin-top:14px">A coordenação faz tudo que a secretaria faz, e ainda cria eventos,
    fecha e reabre turma, edita o calendário e cadastra quem usa o sistema.</p>`;
}

function listaPeriodos(periodos) {
  const grupos = Object.entries(TIPOS).map(([tipo, nome]) => ({
    tipo, nome, lista: periodos.filter((p) => p.tipo === tipo)
  })).filter((g) => g.lista.length);
  if (!grupos.length) return `<div class="vazio"><h3>Calendário letivo vazio</h3>
    <p>Adicione as unidades, os recessos e os feriados do ano.</p></div>`;
  return grupos.map((g) => `
    <div class="grupo-titulo">${g.nome}</div>
    <div class="eventos">${g.lista.map((p) => `
      <button class="evento evento--periodo" data-periodo="${p.id}">
        <div>
          <div class="evento__nome">${esc(p.nome)}</div>
          <div class="evento__meta">${p.inicio === p.fim ? diaMes(p.inicio) : `${diaMes(p.inicio)} a ${diaMes(p.fim)}`}
            ${p.inicio !== p.fim ? `· ${Math.round((new Date(p.fim) - new Date(p.inicio)) / 86400e3) + 1} dias` : ""}</div>
        </div>
        <svg class="evento__seta" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="m9 6 6 6-6 6"/></svg>
      </button>`).join("")}</div>`).join("");
}

/* ---------- modal: pessoa ---------- */
let pessoaEditando = null;

function abrirUsuario(pessoa) {
  pessoaEditando = pessoa || null;
  $("#recadoUsuario").hidden = true;
  $("#tituloUsuario").textContent = pessoa ? "Editar pessoa" : "Cadastrar pessoa";
  $("#salvarUsuario").textContent = pessoa ? "Salvar" : "Cadastrar";
  $("#usNome").value = pessoa?.nome || "";
  $("#usEmail").value = pessoa?.email || "";
  $("#usEmail").disabled = !!pessoa;
  $("#usSenha").value = "";
  $("#usSenha").placeholder = pessoa ? "deixe em branco para manter a atual" : "mínimo 8 letras";
  $("#ajudaSenha").textContent = pessoa
    ? "Trocar a senha desconecta essa pessoa de todos os PCs."
    : "Passe a senha para a pessoa. Ela pode ser trocada depois.";

  let papel = pessoa?.papel || "secretaria";
  let ativo = pessoa ? !!pessoa.ativo : true;
  const desenhar = () => {
    $("#papelEscolha").innerHTML = `
      ${[["secretaria", "Secretaria", "Lança e estorna pagamentos, marca participação e isenção, exporta relatórios."],
         ["coordenacao", "Coordenação", "Tudo da secretaria, mais criar eventos, fechar e reabrir turma, editar o calendário e cadastrar pessoas."]]
        .map(([id, nome, nota]) => `
        <button class="escolha" data-papel="${id}" aria-pressed="${papel === id}">
          <span class="escolha__marca"></span>
          <span><span class="escolha__titulo">${nome}</span><br><span class="escolha__nota">${nota}</span></span>
        </button>`).join("")}
      ${pessoa ? `<label class="opcao" style="margin-top:6px"><input type="checkbox" id="usAtivo" ${ativo ? "checked" : ""}>
        Pode entrar no sistema</label>` : ""}`;
    $("#papelEscolha").querySelectorAll("[data-papel]").forEach((b) => b.onclick = () => { papel = b.dataset.papel; desenhar(); });
    if (pessoa) $("#usAtivo").onchange = (e) => (ativo = e.target.checked);
  };
  desenhar();

  $("#salvarUsuario").onclick = async () => {
    const recado = $("#recadoUsuario");
    const botao = $("#salvarUsuario");
    botao.disabled = true;
    try {
      if (pessoa) {
        const corpo = { nome: $("#usNome").value, papel, ativo };
        if ($("#usSenha").value) corpo.senha = $("#usSenha").value;
        await trocar(`/api/usuarios/${pessoa.id}`, corpo);
        avisar(`${$("#usNome").value} atualizado`);
      } else {
        await enviar("/api/usuarios", {
          nome: $("#usNome").value, email: $("#usEmail").value,
          senha: $("#usSenha").value, papel
        });
        avisar(`${$("#usNome").value} cadastrado`);
      }
      $("#cortinaUsuario").hidden = true;
      irPara("ajustes");
    } catch (err) {
      recado.hidden = false; recado.textContent = err.message;
    } finally {
      botao.disabled = false;
    }
  };

  $("#cortinaUsuario").hidden = false;
  $(pessoa ? "#usNome" : "#usNome").focus();
}

/* ---------- modal: período do calendário ---------- */
let periodoEditando = null;

function abrirPeriodo(periodo) {
  periodoEditando = periodo || null;
  $("#recadoPeriodo").hidden = true;
  $("#tituloPeriodo").textContent = periodo ? "Editar período" : "Adicionar período";
  $("#apagarPeriodo").hidden = !periodo;
  $("#peNome").value = periodo?.nome || "";
  $("#peInicio").value = periodo?.inicio || hojeIso();
  $("#peFim").value = periodo && periodo.fim !== periodo.inicio ? periodo.fim : "";

  let tipo = periodo?.tipo || "unidade";
  const CORES = { unidade: "var(--azul)", recesso: "var(--amarelo)", feriado: "var(--vermelho)" };
  const desenhar = () => {
    $("#tipoEscolha").innerHTML = Object.entries(TIPOS).map(([id, nome]) =>
      `<button class="turma-chip" data-tipo="${id}" aria-pressed="${tipo === id}"
         style="${tipo === id ? `background:${CORES[id]};color:#fff` : ""}">${nome}</button>`).join("");
    $("#tipoEscolha").querySelectorAll("[data-tipo]").forEach((b) => b.onclick = () => { tipo = b.dataset.tipo; desenhar(); });
  };
  desenhar();

  $("#salvarPeriodo").onclick = async () => {
    const recado = $("#recadoPeriodo");
    const corpo = { nome: $("#peNome").value, tipo, inicio: $("#peInicio").value, fim: $("#peFim").value || null };
    const botao = $("#salvarPeriodo");
    botao.disabled = true;
    try {
      if (periodo) await trocar(`/api/periodos/${periodo.id}`, corpo);
      else await enviar("/api/periodos", corpo);
      $("#cortinaPeriodo").hidden = true;
      avisar(`${corpo.nome} salvo no calendário`);
      irPara("ajustes");
    } catch (err) {
      recado.hidden = false; recado.textContent = err.message;
    } finally { botao.disabled = false; }
  };

  $("#apagarPeriodo").onclick = async () => {
    if (!confirm(`Apagar "${periodo.nome}" do calendário?`)) return;
    try {
      await apagar(`/api/periodos/${periodo.id}`);
      $("#cortinaPeriodo").hidden = true;
      avisar(`${periodo.nome} apagado`);
      irPara("ajustes");
    } catch (err) { avisar(err.message, true); }
  };

  $("#cortinaPeriodo").hidden = false;
  $("#peNome").focus();
}

/* ============================================================
   calendário
   ============================================================ */
TELAS.calendario = async () => {
  titulo.textContent = "Calendário escolar";
  acoesTopo.innerHTML = botaoNovoEvento();

  const ano = mesAtual.getFullYear(), mes = mesAtual.getMonth();
  const chaveMes = `${ano}-${String(mes + 1).padStart(2, "0")}`;
  const { eventos: itens, periodos } = await pegar(`/api/calendario?mes=${chaveMes}`);

  const feriados = {};
  periodos.filter((p) => p.tipo === "feriado").forEach((p) => {
    for (let d = p.inicio; d <= p.fim; d = somarDia(d)) feriados[d] = p.nome;
  });
  const recessos = periodos.filter((p) => p.tipo === "recesso");
  const unidade = periodos.find((p) => p.tipo === "unidade");
  const recessoMes = recessos.find((r) => r.inicio.slice(0, 7) === chaveMes || r.fim.slice(0, 7) === chaveMes);

  const primeiroDia = new Date(ano, mes, 1);
  const inicioGrade = new Date(ano, mes, 1 - primeiroDia.getDay());
  const celulas = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(inicioGrade); d.setDate(inicioGrade.getDate() + i);
    const k = d.toLocaleDateString("sv-SE");
    const foraDoMes = d.getMonth() !== mes, fds = d.getDay() === 0 || d.getDay() === 6;
    const feriado = feriados[k];
    const recesso = recessos.find((r) => k >= r.inicio && k <= r.fim);
    const doDia = itens.filter((e) => k >= e.inicio && k <= (e.fim || e.inicio));
    celulas.push(`<div class="cal__dia ${foraDoMes ? "cal__dia--fora" : ""} ${fds && !foraDoMes ? "cal__dia--fimsemana" : ""}
        ${feriado ? "cal__dia--feriado" : ""} ${recesso && !feriado ? "cal__dia--recesso" : ""} ${k === hojeIso() ? "cal__dia--hoje" : ""}">
      <span class="cal__num">${d.getDate()}</span>
      ${feriado ? `<span class="cal__feriado">${esc(feriado)}</span>` : ""}
      ${doDia.slice(0, 3).map((e) => `<button class="cal__ev" data-evento="${e.id}" title="${esc(e.nome)}">
        <i class="cal__marca" style="background:${CATEGORIAS[e.categoria]?.cor || "#999"}"></i><span>${esc(e.nome)}</span></button>`).join("")}
      ${doDia.length > 3 ? `<span class="cal__mais">+${doDia.length - 3} eventos</span>` : ""}
    </div>`);
  }

  const doMes = itens.filter((e) => e.inicio.slice(0, 7) === chaveMes).sort((a, b) => a.inicio.localeCompare(b.inicio));

  conteudo.innerHTML = `
    <div class="cal__barra">
      <div class="cal__nav">
        <button data-mes="-1" aria-label="Mês anterior"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m15 6-6 6 6 6"/></svg></button>
        <button data-mes="1" aria-label="Próximo mês"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m9 6 6 6-6 6"/></svg></button>
      </div>
      <div class="cal__mes">${MESES[mes]} ${ano}</div>
      <button class="btn btn--fantasma" data-mes="hoje">Hoje</button>
    </div>
    ${unidade ? `<div class="faixa-unidade"><b>${esc(unidade.nome)}</b><span>${diaMes(unidade.inicio)} a ${diaMes(unidade.fim)}</span></div>` : ""}
    ${recessoMes ? `<div class="faixa-unidade faixa-unidade--recesso"><b>${esc(recessoMes.nome)}</b><span>${diaMes(recessoMes.inicio)} a ${diaMes(recessoMes.fim)}</span></div>` : ""}
    <div class="cal__grade">
      ${["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"].map((d) => `<div class="cal__cabeca">${d}</div>`).join("")}
      ${celulas.join("")}
    </div>
    <div class="legenda">${Object.values(CATEGORIAS).map((c) => `<span><i style="background:${c.cor}"></i>${c.nome}</span>`).join("")}
      <span><i style="background:var(--vermelho)"></i>Feriado</span><span><i style="background:var(--amarelo)"></i>Recesso</span></div>

    <div class="secao" style="margin-top:32px"><h2>Agenda de ${MESES[mes].toLowerCase()}</h2>
      <span class="secao__nota">${doMes.length} ${doMes.length === 1 ? "evento" : "eventos"}</span></div>
    <div class="agenda">${doMes.length ? doMes.map((e) => {
      const c = CATEGORIAS[e.categoria] || { nome: "Evento", cor: "#999" };
      const dia = new Date(e.inicio + "T12:00");
      return `<div class="agenda__item" style="border-left-color:${c.cor}">
        <button class="agenda__abrir" data-evento="${e.id}">
          <div class="agenda__data"><b>${dia.getDate()}</b>${["dom","seg","ter","qua","qui","sex","sáb"][dia.getDay()]}</div>
          <div>
            <div class="agenda__nome">${esc(e.nome)}</div>
            <div class="agenda__meta">${e.qtd_turmas} ${e.qtd_turmas === 1 ? "turma" : "turmas"}${e.fim ? " · até " + diaMes(e.fim) : ""}${e.cobra ? " · " + brl(e.valor) + " por aluno" : " · sem cobrança"}</div>
          </div>
        </button>
        <span class="etiqueta" style="background:${c.cor}22;color:${c.cor}">${c.nome}</span>
        <button class="agenda__editar somente-coord" data-editar="${e.id}" title="Editar evento" aria-label="Editar ${esc(e.nome)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M4 20h4L20 8l-4-4L4 16z"/></svg>
        </button>
      </div>`;
    }).join("") : `<div class="vazio"><h3>Nenhum evento em ${MESES[mes].toLowerCase()}</h3><p>Crie um evento para aparecer aqui.</p></div>`}</div>`;

  document.querySelectorAll("[data-mes]").forEach((b) => b.onclick = () => {
    mesAtual = b.dataset.mes === "hoje" ? new Date() : new Date(ano, mes + Number(b.dataset.mes), 1);
    irPara("calendario");
  });
  ligar();
};

const somarDia = (iso) => {
  const d = new Date(iso + "T12:00"); d.setDate(d.getDate() + 1);
  return d.toLocaleDateString("sv-SE");
};

/* ============================================================
   cliques comuns
   ============================================================ */
function ligar() {
  document.querySelectorAll("[data-evento]").forEach((b) => b.onclick = () => {
    eventoAtual = { id: Number(b.dataset.evento) };
    irPara("evento");
  });
  document.querySelectorAll("[data-turma]").forEach((b) => b.onclick = () => {
    turmaAtual = eventoAtual.turmas.find((t) => t.id === Number(b.dataset.turma));
    busca = ""; filtro = "todos";      // turma nova começa com a lista limpa
    irPara("pagamentos");
  });
  document.querySelectorAll("[data-voltar]").forEach((b) => b.onclick = () => irPara(b.dataset.voltar));
  document.querySelectorAll("[data-novo]").forEach((b) => b.onclick = () => { abrirEvento.preenchido = false; abrirEvento(); });
  document.querySelectorAll("[data-editar]").forEach((b) => b.onclick = async () => {
    try {
      const e = await pegar(`/api/eventos/${b.dataset.editar}`);
      abrirEvento.preenchido = false;
      abrirEvento(e);
    } catch (err) { avisar(err.message, true); }
  });
  document.querySelectorAll("[data-relatorio]").forEach((b) => b.onclick = abrirRelatorio);

  document.querySelectorAll("[data-fecharturma]").forEach((b) => b.onclick = async () => {
    const pend = dadosTurma.alunos.filter((a) => a.situacao === "pendente").length;
    if (pend && !confirm(`Ainda faltam ${pend} pagamentos nesta turma.\n\nFechar assim mesmo? A coordenação pode reabrir depois.`)) return;
    try {
      await enviar("/api/fechamentos", { evento_id: eventoAtual.id, turma_id: turmaAtual.id });
      avisar(`${turmaAtual.nome} fechada`);
      irPara("pagamentos");
    } catch (err) { avisar(err.message, true); }
  });

  document.querySelectorAll("[data-reabrir]").forEach((b) => b.onclick = async () => {
    try {
      await apagar(`/api/fechamentos/${eventoAtual.id}/${turmaAtual.id}`);
      avisar(`${turmaAtual.nome} reaberta para lançamentos`);
      irPara("pagamentos");
    } catch (err) { avisar(err.message, true); }
  });
}

/* ============================================================
   modal: criar e editar evento
   ============================================================ */
let eventoEditando = null;

function abrirEvento(evento) {
  eventoEditando = evento || null;
  $("#recadoEvento").hidden = true;
  $("#tituloEvento").textContent = evento ? "Editar evento" : "Criar evento";
  $("#salvarEvento").textContent = evento ? "Salvar alterações" : "Criar evento";
  $("#cancelarEvento").hidden = !evento;
  $("#campoAplicar").hidden = !evento;
  $("#evCobra").disabled = !!evento;   // virar cobrado depois mexeria em todo mundo

  if (evento && !abrirEvento.preenchido) {
    $("#evNome").value = evento.nome;
    $("#evData").value = evento.inicio;
    $("#evFim").value = evento.fim || "";
    $("#evValor").value = evento.cobra ? Number(evento.valor).toFixed(2).replace(".", ",") : "";
    $("#evCobra").checked = !!evento.cobra;
    catNovoEvento = evento.categoria;
    turmasNovoEvento = new Set((evento.turmas || []).map((t) => t.id));
    abrirEvento.preenchido = true;
  }
  if (!evento) $("#evData").value = $("#evData").value || hojeIso();

  $("#catEscolha").innerHTML = Object.entries(CATEGORIAS).map(([k, c]) =>
    `<button class="turma-chip" data-cat="${k}" aria-pressed="${catNovoEvento === k}"
       style="${catNovoEvento === k ? `background:${c.cor};color:#fff` : ""}">${c.nome}</button>`).join("");
  $("#catEscolha").querySelectorAll("[data-cat]").forEach((b) => b.onclick = () => { catNovoEvento = b.dataset.cat; abrirEvento(eventoEditando); });

  $("#evCobra").onchange = (e) => ($("#campoValor").hidden = !e.target.checked);
  $("#campoValor").hidden = !$("#evCobra").checked;

  const grupos = [
    { id: "infantil", nome: "Educação Infantil" },
    { id: "fundamental", nome: "Ensino Fundamental I" }
  ];
  $("#turmasEscolha").innerHTML = grupos.map((g) => {
    const lista = turmas.filter((t) => t.segmento === g.id);
    if (!lista.length) return "";
    return `<div style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-size:12.5px;font-weight:700;color:var(--cinza)">${g.nome}</span>
        <button class="btn btn--fantasma" style="padding:3px 9px;font-size:12px" data-seg="${g.id}">Selecionar todas</button>
      </div>
      <div class="turmas-escolha">${lista.map((t) =>
        `<button class="turma-chip" data-t="${t.id}" aria-pressed="${turmasNovoEvento.has(t.id)}">${esc(t.nome)}</button>`).join("")}</div>
    </div>`;
  }).join("");

  const caixa = $("#turmasEscolha");
  caixa.querySelectorAll("[data-t]").forEach((b) => b.onclick = () => {
    const id = Number(b.dataset.t);
    turmasNovoEvento.has(id) ? turmasNovoEvento.delete(id) : turmasNovoEvento.add(id);
    b.setAttribute("aria-pressed", turmasNovoEvento.has(id));
  });
  caixa.querySelectorAll("[data-seg]").forEach((b) => b.onclick = () => {
    const lista = turmas.filter((t) => t.segmento === b.dataset.seg);
    const todas = lista.every((t) => turmasNovoEvento.has(t.id));
    lista.forEach((t) => todas ? turmasNovoEvento.delete(t.id) : turmasNovoEvento.add(t.id));
    abrirEvento(eventoEditando);
  });

  $("#cortinaEvento").hidden = false;
  $("#evNome").focus();
}

$("#salvarEvento").onclick = async () => {
  const recado = $("#recadoEvento");
  const cobra = $("#evCobra").checked;
  const corpo = {
    nome: $("#evNome").value.trim(),
    categoria: catNovoEvento,
    inicio: $("#evData").value,
    fim: $("#evFim").value || null,
    cobra,
    valor: cobra ? Number(($("#evValor").value || "0").replace(/\./g, "").replace(",", ".")) : 0,
    turmas: [...turmasNovoEvento]
  };
  const editando = eventoEditando;
  const botao = $("#salvarEvento");
  const rotulo = botao.textContent;
  botao.disabled = true; botao.textContent = editando ? "Salvando..." : "Criando...";
  try {
    if (editando) {
      corpo.aplicarValor = $("#evAplicar").checked;
      const r = await trocar(`/api/eventos/${editando.id}`, corpo);
      const partes = [];
      if (r.entraram) partes.push(`${r.entraram} ${r.entraram === 1 ? "turma entrou" : "turmas entraram"}`);
      if (r.sairam) partes.push(`${r.sairam} ${r.sairam === 1 ? "turma saiu" : "turmas saíram"}`);
      if (r.valoresTrocados) partes.push(`${r.valoresTrocados} ${r.valoresTrocados === 1 ? "valor atualizado" : "valores atualizados"}`);
      avisar(`"${corpo.nome}" salvo${partes.length ? " · " + partes.join(", ") : ""}`);
    } else {
      await enviar("/api/eventos", corpo);
      avisar(`"${corpo.nome}" criado`);
    }
    fecharEvento();
    mesAtual = new Date(corpo.inicio + "T12:00");
    irPara("calendario");
  } catch (err) {
    recado.hidden = false; recado.textContent = err.message;
  } finally {
    botao.disabled = false; botao.textContent = rotulo;
  }
};

$("#cancelarEvento").onclick = async () => {
  if (!eventoEditando) return;
  if (!confirm(`Cancelar o evento "${eventoEditando.nome}"?\n\n` +
               `Ele sai do calendário e das listas de pagamento. O histórico continua guardado.`)) return;
  try {
    await apagar(`/api/eventos/${eventoEditando.id}`);
    avisar(`"${eventoEditando.nome}" cancelado`);
    fecharEvento();
    irPara("calendario");
  } catch (err) {
    const recado = $("#recadoEvento");
    recado.hidden = false; recado.textContent = err.message;
  }
};

function fecharEvento() {
  $("#cortinaEvento").hidden = true;
  $("#evNome").value = ""; $("#evValor").value = ""; $("#evFim").value = "";
  $("#evCobra").checked = true; $("#evCobra").disabled = false;
  turmasNovoEvento.clear();
  eventoEditando = null;
  abrirEvento.preenchido = false;
}

/* ============================================================
   relatórios
   ============================================================ */
function abrirRelatorio() {
  const naTurma = !!dadosTurma && !barraTotais.hidden;
  escopoRel = naTurma ? "turma" : "evento";
  const opcoes = [
    naTurma && { id: "turma", titulo: `Só ${turmaAtual.nome}`,
                 nota: `${dadosTurma.alunos.length} alunos · evento ${eventoAtual.nome}` },
    { id: "evento", titulo: `Todas as turmas de ${eventoAtual.nome}`,
      nota: `${eventoAtual.turmas?.length || eventoAtual.qtd_turmas} turmas, uma página por turma` },
    { id: "pendentes", titulo: "Só quem ainda não pagou",
      nota: "Lista de cobrança do evento inteiro, agrupada por turma" }
  ].filter(Boolean);

  $("#escopoRel").innerHTML = opcoes.map((o) => `
    <button class="escolha" data-escopo="${o.id}" aria-pressed="${escopoRel === o.id}">
      <span class="escolha__marca"></span>
      <span><span class="escolha__titulo">${esc(o.titulo)}</span><br><span class="escolha__nota">${esc(o.nota)}</span></span>
    </button>`).join("");
  $("#escopoRel").querySelectorAll("[data-escopo]").forEach((b) => b.onclick = () => {
    escopoRel = b.dataset.escopo;
    $("#escopoRel").querySelectorAll("[data-escopo]").forEach((x) => x.setAttribute("aria-pressed", x.dataset.escopo === escopoRel));
  });
  document.querySelectorAll("[data-formato]").forEach((b) => b.onclick = () => {
    formatoRel = b.dataset.formato;
    document.querySelectorAll("[data-formato]").forEach((x) => x.setAttribute("aria-pressed", x.dataset.formato === formatoRel));
  });
  $("#cortinaRelatorio").hidden = false;
}

$("#gerarRelatorio").onclick = async () => {
  const botao = $("#gerarRelatorio");
  botao.disabled = true; botao.textContent = "Gerando...";
  try {
    const params = new URLSearchParams({ evento: eventoAtual.id });
    if (escopoRel === "turma") params.set("turma", turmaAtual.id);
    if (escopoRel === "pendentes") params.set("somentePendentes", "1");
    const dados = await pegar(`/api/relatorios/pagamentos?${params}`);
    $("#cortinaRelatorio").hidden = true;

    const incFora = $("#incFora").checked;
    if (formatoRel === "csv") gerarCSV(dados, incFora);
    else gerarImpressao(dados, incFora, $("#incResumo").checked, $("#incAssina").checked, escopoRel === "pendentes");
  } catch (err) {
    avisar(err.message, true);
  } finally {
    botao.disabled = false; botao.textContent = "Gerar relatório";
  }
};

const filtrarAlunos = (alunos, incFora) => incFora ? alunos : alunos.filter((a) => a.participa);

function gerarCSV(dados, incFora) {
  const linhas = [["Evento", "Turma", "Professora", "Matrícula", "Aluno", "Participa", "Situação",
                   "Valor", "Meio", "Recebido em", "Motivo da isenção"]];
  const rotulo = { pago: "Pago", pendente: "Pendente", isento: "Isento", fora: "Não participa" };
  dados.turmas.forEach(({ turma, alunos }) => filtrarAlunos(alunos, incFora).forEach((a) => {
    linhas.push([dados.evento.nome, turma.nome, turma.professora || "", a.matricula, a.aluno,
      a.participa ? "Sim" : "Não",
      rotulo[a.situacao],
      a.participa && !a.isento ? Number(a.valor).toFixed(2).replace(".", ",") : "",
      MEIOS[a.meio] || "", a.recebido_em || "", a.motivo_isencao || ""]);
  }));
  const csv = "﻿" + linhas.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `Pagamentos ${dados.evento.nome}${dados.turmas.length === 1 ? " - " + dados.turmas[0].turma.nome : ""}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  avisar(`Planilha baixada · ${linhas.length - 1} linhas`);
}

function gerarImpressao(dados, incFora, incResumo, incAssina, soPendentes) {
  // Numa lista de cobrança, turma que já pagou tudo não vira página em branco.
  const paginas = dados.turmas
    .map((t) => ({ ...t, lista: filtrarAlunos(t.alunos, incFora) }))
    .filter((t) => t.lista.length || !soPendentes)
    .map(({ turma, lista, resumo, caixa }, i) => {
    return `<section class="${i ? "quebra" : ""}">
      <div class="rel__topo">
        <img class="rel__logo" src="assets/logo-santa-chiara.png" alt="">
        <div>
          <div class="rel__escola">Colégio Santa Chiara</div>
          <div class="rel__lema">Educação para um novo mundo.</div>
        </div>
      </div>
      <div class="rel__titulo">${soPendentes ? "Pagamentos pendentes" : "Relatório de pagamentos"} — ${esc(turma.nome)}</div>
      <div class="rel__sub">${esc(dados.evento.nome)} · ${diaMes(dados.evento.inicio)} · ${esc(turma.professora || "")} · valor ${brl(dados.evento.valor)} por aluno</div>
      ${incResumo ? `<div class="rel__resumo">
        <div>Participam<b>${resumo.participam}</b></div>
        <div>Pagos<b>${resumo.pagos}</b></div>
        <div>Pendentes<b>${resumo.pendentes}</b></div>
        ${resumo.isentos ? `<div>Isentos<b>${resumo.isentos}</b></div>` : ""}
        <div>Arrecadado<b>${brl(resumo.arrecadado)}</b></div>
        <div>A receber<b>${brl(resumo.previsto - resumo.arrecadado)}</b></div>
      </div>` : ""}
      <table class="rel">
        <thead><tr><th style="width:78px">Matrícula</th><th>Aluno</th><th style="width:78px">Situação</th>
          <th style="width:62px" class="dir">Valor</th><th style="width:66px">Meio</th></tr></thead>
        <tbody>${lista.map((a) => {
          const cor = { pago: "rel__pago", pendente: "rel__pend", isento: "rel__isento", fora: "rel__fora" }[a.situacao];
          const texto = { pago: "Pago", pendente: "Pendente", isento: "Isento", fora: "Não vai" }[a.situacao];
          return `<tr>
          <td class="num">${esc(a.matricula)}</td>
          <td>${esc(a.aluno)}${a.situacao === "isento" && a.motivo_isencao ? ` <span class="rel__nota">(${esc(a.motivo_isencao)})</span>` : ""}</td>
          <td class="${cor}">${texto}</td>
          <td class="num dir">${a.situacao === "isento" ? "—" : a.participa ? brl(a.valor).replace("R$ ", "") : "—"}</td>
          <td>${MEIOS[a.meio] || "—"}</td></tr>`;
        }).join("")}</tbody>
      </table>
      <div class="rel__meios">
        <span class="rot">Conferência<br>de caixa</span>
        ${Object.entries(MEIOS).map(([k, nome]) => `<span class="cel">${nome}<b>${brl(caixa[k].total)}</b>
          <small>${caixa[k].qtd} ${caixa[k].qtd === 1 ? "aluno" : "alunos"}</small></span>`).join("")}
        <span class="cel cel--total">Total recebido<b>${brl(caixa.total)}</b>
          <small>${caixa.qtd} ${caixa.qtd === 1 ? "pagamento" : "pagamentos"}</small></span>
      </div>
      ${incAssina ? `<div class="rel__assina"><div>Secretaria</div><div>Coordenação</div></div>` : ""}
      <div class="rel__rodape"><span>Emitido em ${dados.emitido_em} por ${esc(dados.emitido_por)}</span>
        <span>${esc(turma.nome)} · ${lista.length} ${lista.length === 1 ? "registro" : "registros"}</span></div>
    </section>`;
  }).join("");

  if (!paginas) return avisar("Nenhum aluno para este relatório.", true);
  $("#relatorio").innerHTML = paginas;
  window.print();
}

/* ============================================================
   geral
   ============================================================ */
// Fechar qualquer modal limpa o rascunho, para o próximo abrir em branco.
function fecharTudo() {
  document.querySelectorAll(".cortina").forEach((c) => (c.hidden = true));
  eventoEditando = null; pessoaEditando = null; periodoEditando = null;
  abrirEvento.preenchido = false;
}
document.querySelectorAll("[data-fechar]").forEach((b) => b.onclick = fecharTudo);
document.querySelectorAll(".cortina").forEach((c) => c.onclick = (e) => { if (e.target === c) fecharTudo(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") fecharTudo(); });

/* ---------- começa aqui ---------- */
(async () => {
  try {
    eu = await pegar("/api/eu");
    await abrirSistema();
  } catch {
    mostrarEntrada();
  }
})();

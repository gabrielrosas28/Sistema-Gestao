import express from "express";
import cookieParser from "cookie-parser";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";

import { bd, listar, buscar, rodar, anotar, emBloco, ANO_LETIVO, CAMINHO_BANCO, VERSAO } from "./banco.js";
import { entrar, sair, exigirLogin, exigirCoordenacao, criarUsuario, trocarSenha } from "./acesso.js";
import { montarAchados, chaveDoTablet } from "./achados.js";

const aqui = dirname(fileURLToPath(import.meta.url));
const PORTA = Number(process.env.PORTA || 8080);

const app = express();
app.use(cookieParser());

montarAchados(app);

app.use(express.json({ limit: "1mb" }));
app.use(express.static(join(aqui, "..", "publico")));

const rota = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    if (e?.status) return res.status(e.status).json({ erro: e.message });
    console.error("[erro]", req.method, req.path, e);
    res.status(500).json({ erro: "Algo deu errado aqui no servidor. Tente de novo." });
  });

app.post("/api/sessao", rota((req, res) => {
  const r = entrar(req.body.email, req.body.senha);
  if (!r) return res.status(401).json({ erro: "E-mail ou senha não conferem." });
  res.cookie("sessao", r.token, {
    httpOnly: true, sameSite: "lax", maxAge: 30 * 86400e3
  });
  res.json({ ...r.usuario, versao: VERSAO, ano_letivo: ANO_LETIVO });
}));

app.delete("/api/sessao", rota((req, res) => {
  sair(req.cookies?.sessao);
  res.clearCookie("sessao");
  res.json({ ok: true });
}));

app.get("/api/eu", exigirLogin, (req, res) =>
  res.json({ ...req.usuario, versao: VERSAO, ano_letivo: ANO_LETIVO }));

app.get("/api/chave-tablet", exigirLogin, exigirCoordenacao, (req, res) =>
  res.json({ chave: chaveDoTablet() }));

app.use("/api", exigirLogin);

app.get("/api/turmas", rota((req, res) => {
  res.json(listar(
    `SELECT t.*, (SELECT COUNT(*) FROM alunos a WHERE a.turma_id = t.id AND a.ativo = 1) AS alunos
       FROM turmas t WHERE t.ativa = 1 AND t.ano_letivo = ?
      ORDER BY t.ordem, t.codigo`, ANO_LETIVO));
}));

app.get("/api/turmas/:id/alunos", rota((req, res) => {
  res.json(listar(
    `SELECT id, matricula, nome, genero FROM alunos
      WHERE turma_id = ? AND ativo = 1 ORDER BY nome`, req.params.id));
}));

app.get("/api/eventos", rota((req, res) => {
  const arquivados = req.query.arquivados === "1";
  const eventos = listar(
    `SELECT e.*,
            (SELECT COUNT(*) FROM evento_turmas et WHERE et.evento_id = e.id) AS qtd_turmas
       FROM eventos e
      WHERE e.cancelado = 0 AND e.ano_letivo = ?
        AND e.fechado_em IS ${arquivados ? "NOT NULL" : "NULL"}
        ${req.query.cobra === "1" ? "AND e.cobra = 1" : ""}
      ORDER BY e.inicio ${arquivados ? "DESC" : ""}`, ANO_LETIVO);
  res.json(eventos.map((e) => ({ ...e, resumo: e.cobra ? resumoDoEvento(e.id) : null })));
}));

app.get("/api/eventos/:id", rota((req, res) => {
  const e = buscar(`SELECT * FROM eventos WHERE id = ?`, req.params.id);
  if (!e) return res.status(404).json({ erro: "Evento não encontrado." });
  const turmas = listar(
    `SELECT t.*,
            (SELECT COUNT(*) FROM alunos a WHERE a.turma_id = t.id AND a.ativo = 1) AS alunos
       FROM evento_turmas et JOIN turmas t ON t.id = et.turma_id
      WHERE et.evento_id = ? ORDER BY t.ordem, t.codigo`, e.id);
  res.json({
    ...e,
    resumo: e.cobra ? resumoDoEvento(e.id) : null,
    turmas: turmas.map((t) => ({
      ...t,
      fechada: !!turmaFechada(e.id, t.id),
      resumo: e.cobra ? resumoDoEvento(e.id, t.id) : null
    }))
  });
}));

app.post("/api/eventos", rota((req, res) => {
  const { nome, categoria, inicio, fim, cobra, valor, turmas, observacao } = req.body;
  if (!nome?.trim()) return res.status(400).json({ erro: "Dê um nome ao evento." });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio || ""))
    return res.status(400).json({ erro: "Escolha a data de início." });
  if (fim && fim < inicio)
    return res.status(400).json({ erro: "A data de término é anterior à de início." });
  if (!Array.isArray(turmas) || !turmas.length)
    return res.status(400).json({ erro: "Escolha ao menos uma turma." });

  const valorNum = valorValido(valor) ?? 0;
  if (cobra && !(valorNum > 0)) return res.status(400).json({ erro: "Informe o valor por aluno." });

  const existentes = new Set(listar(
    `SELECT id FROM turmas WHERE ativa = 1 AND ano_letivo = ?`, ANO_LETIVO).map((t) => t.id));
  const invalidas = turmas.filter((id) => !existentes.has(Number(id)));
  if (invalidas.length)
    return res.status(400).json({ erro: "Uma das turmas escolhidas não existe mais." });

  const id = emBloco(() => {
    const r = rodar(
      `INSERT INTO eventos (nome, categoria, inicio, fim, cobra, valor, observacao,
                            ano_letivo, criado_por, criado_por_nome)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      nome.trim(), categoria, inicio, fim || null, cobra ? 1 : 0,
      valorNum, observacao || null, ANO_LETIVO, req.usuario.id, req.usuario.nome
    );
    const eventoId = Number(r.lastInsertRowid);

    const ligaTurma = bd.prepare(`INSERT INTO evento_turmas (evento_id, turma_id) VALUES (?, ?)`);
    const criaParticipacao = bd.prepare(
      `INSERT INTO participacoes (evento_id, aluno_id, participa, valor)
       SELECT ?, id, 1, ? FROM alunos WHERE turma_id = ? AND ativo = 1`);

    for (const turmaId of new Set(turmas.map(Number))) {
      ligaTurma.run(eventoId, turmaId);
      if (cobra) criaParticipacao.run(eventoId, valorNum, turmaId);
    }
    anotar(req.usuario.id, "criou evento", "evento", eventoId,
           { nome, valor: valorNum, turmas: turmas.length });
    return eventoId;
  })();

  res.status(201).json({ id });
}));

app.put("/api/eventos/:id", exigirCoordenacao, rota((req, res) => {
  const e = buscar(`SELECT * FROM eventos WHERE id = ?`, req.params.id);
  if (!e) return res.status(404).json({ erro: "Evento não encontrado." });
  if (e.fechado_em) return res.status(423).json({
    erro: `Evento fechado em ${e.fechado_em} por ${e.fechado_por_nome || "alguém"}. Reabra antes de editar.` });

  const { nome, categoria, inicio, fim, valor, aplicarValor, turmas, observacao } = req.body;
  if (!nome?.trim()) return res.status(400).json({ erro: "Dê um nome ao evento." });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio || ""))
    return res.status(400).json({ erro: "Escolha a data de início." });
  if (fim && fim < inicio)
    return res.status(400).json({ erro: "A data de término é anterior à de início." });
  const valorNum = valorValido(valor) ?? e.valor;
  if (e.cobra && !(valorNum > 0)) return res.status(400).json({ erro: "Informe o valor por aluno." });

  const resultado = emBloco(() => {
    rodar(`UPDATE eventos SET nome = ?, categoria = ?, inicio = ?, fim = ?, valor = ?, observacao = ?
            WHERE id = ?`,
          nome.trim(), categoria || e.categoria, inicio, fim || null, valorNum,
          observacao ?? e.observacao, e.id);

    let entraram = 0, sairam = 0, valoresTrocados = 0;

    if (Array.isArray(turmas) && turmas.length) {
      const atuais = new Set(listar(
        `SELECT turma_id FROM evento_turmas WHERE evento_id = ?`, e.id).map((t) => t.turma_id));
      const novas = new Set(turmas.map(Number));

      for (const id of novas) if (!atuais.has(id)) {
        rodar(`INSERT INTO evento_turmas (evento_id, turma_id) VALUES (?, ?)`, e.id, id);
        if (e.cobra) completarParticipacoes(e.id, id);
        entraram++;
      }
      for (const id of atuais) if (!novas.has(id)) {
        const pago = buscar(
          `SELECT COUNT(*) AS n FROM v_situacao WHERE evento_id = ? AND turma_id = ? AND situacao = 'pago'`,
          e.id, id).n;
        if (pago) {
          const t = buscar(`SELECT nome FROM turmas WHERE id = ?`, id);
          throw Object.assign(new Error(
            `${t.nome} já tem ${pago} ${pago === 1 ? "pagamento lançado" : "pagamentos lançados"}. ` +
            `Estorne antes de tirar a turma do evento.`), { status: 409 });
        }
        rodar(`DELETE FROM participacoes WHERE evento_id = ? AND aluno_id IN
                 (SELECT id FROM alunos WHERE turma_id = ?)`, e.id, id);
        rodar(`DELETE FROM evento_turmas WHERE evento_id = ? AND turma_id = ?`, e.id, id);
        sairam++;
      }
    }

    if (aplicarValor && e.cobra) {
      valoresTrocados = rodar(
        `UPDATE participacoes SET valor = ?
          WHERE evento_id = ? AND isento = 0
            AND id NOT IN (SELECT participacao_id FROM pagamentos WHERE estornado_em IS NULL)`,
        valorNum, e.id).changes;
    }

    anotar(req.usuario.id, "editou evento", "evento", e.id,
           { nome, valor: valorNum, entraram, sairam, valoresTrocados });
    return { entraram, sairam, valoresTrocados };
  })();

  res.json({ ...buscar(`SELECT * FROM eventos WHERE id = ?`, e.id), ...resultado });
}));

app.delete("/api/eventos/:id", exigirCoordenacao, rota((req, res) => {
  const e = buscar(`SELECT * FROM eventos WHERE id = ?`, req.params.id);
  if (!e) return res.status(404).json({ erro: "Evento não encontrado." });
  if (e.fechado_em) return res.status(423).json({
    erro: "Este evento está fechado. Reabra antes de cancelar." });
  const pagos = buscar(
    `SELECT COUNT(*) AS n FROM v_situacao WHERE evento_id = ? AND situacao = 'pago'`, e.id).n;
  if (pagos) return res.status(409).json({
    erro: `Este evento já tem ${pagos} ${pagos === 1 ? "pagamento lançado" : "pagamentos lançados"}. ` +
          `Estorne os pagamentos antes de cancelar, para as famílias não ficarem sem o registro.` });
  rodar(`UPDATE eventos SET cancelado = 1 WHERE id = ?`, e.id);
  anotar(req.usuario.id, "cancelou evento", "evento", e.id, { nome: e.nome });
  res.json({ ok: true });
}));

app.get("/api/periodos", rota((req, res) => {
  res.json(listar(`SELECT * FROM periodos WHERE ano_letivo = ? ORDER BY inicio, nome`, ANO_LETIVO));
}));

function validarPeriodo(b) {
  if (!b.nome?.trim()) return "Dê um nome ao período.";
  if (!["unidade", "recesso", "feriado"].includes(b.tipo)) return "Escolha o tipo do período.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.inicio || "")) return "Escolha a data de início.";
  const fim = b.fim || b.inicio;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fim)) return "Data de término inválida.";
  if (fim < b.inicio) return "A data de término é anterior à de início.";
  return null;
}

app.post("/api/periodos", exigirCoordenacao, rota((req, res) => {
  const erro = validarPeriodo(req.body);
  if (erro) return res.status(400).json({ erro });
  const r = rodar(`INSERT INTO periodos (nome, tipo, inicio, fim, ano_letivo) VALUES (?, ?, ?, ?, ?)`,
                  req.body.nome.trim(), req.body.tipo, req.body.inicio,
                  req.body.fim || req.body.inicio, ANO_LETIVO);
  anotar(req.usuario.id, "criou período", "periodo", Number(r.lastInsertRowid), req.body);
  res.status(201).json({ id: Number(r.lastInsertRowid) });
}));

app.put("/api/periodos/:id", exigirCoordenacao, rota((req, res) => {
  const p = buscar(`SELECT * FROM periodos WHERE id = ?`, req.params.id);
  if (!p) return res.status(404).json({ erro: "Período não encontrado." });
  const erro = validarPeriodo(req.body);
  if (erro) return res.status(400).json({ erro });
  rodar(`UPDATE periodos SET nome = ?, tipo = ?, inicio = ?, fim = ? WHERE id = ?`,
        req.body.nome.trim(), req.body.tipo, req.body.inicio, req.body.fim || req.body.inicio, p.id);
  anotar(req.usuario.id, "editou período", "periodo", p.id, req.body);
  res.json({ ok: true });
}));

app.delete("/api/periodos/:id", exigirCoordenacao, rota((req, res) => {
  const p = buscar(`SELECT * FROM periodos WHERE id = ?`, req.params.id);
  if (!p) return res.status(404).json({ erro: "Período não encontrado." });
  rodar(`DELETE FROM periodos WHERE id = ?`, p.id);
  anotar(req.usuario.id, "apagou período", "periodo", p.id, { nome: p.nome });
  res.json({ ok: true });
}));

app.get("/api/calendario", rota((req, res) => {
  const mes = req.query.mes || new Date().toISOString().slice(0, 7);
  const [ano, m] = mes.split("-").map(Number);
  const primeiro = `${mes}-01`;
  const ultimo = `${mes}-${String(new Date(ano, m, 0).getDate()).padStart(2, "0")}`;

  res.json({
    mes,
    eventos: listar(
      `SELECT e.*, (SELECT COUNT(*) FROM evento_turmas et WHERE et.evento_id = e.id) AS qtd_turmas
         FROM eventos e
        WHERE e.cancelado = 0
          AND e.inicio <= ? AND COALESCE(e.fim, e.inicio) >= ?
        ORDER BY e.inicio`, ultimo, primeiro),
    periodos: listar(
      `SELECT * FROM periodos
        WHERE inicio <= ? AND fim >= ? ORDER BY inicio`, ultimo, primeiro)
  });
}));

app.get("/api/eventos/:id/turmas/:turmaId", rota((req, res) => {
  const { id, turmaId } = req.params;
  const evento = buscar(`SELECT fechado_em, fechado_por_nome FROM eventos WHERE id = ?`, id);
  const eventoFechado = !!evento?.fechado_em;

  if (!eventoFechado && !turmaFechada(id, turmaId)) completarParticipacoes(id, turmaId);
  const fech = turmaFechada(id, turmaId);
  res.json({
    fechada: eventoFechado || !!fech,
    eventoFechado,
    fechamento: fech
      ? { ...fech, fechado_por_nome: fech.quem_fechou }
      : (eventoFechado
          ? { fechado_em: evento.fechado_em, fechado_por_nome: evento.fechado_por_nome || "alguém",
              pelo_evento: true }
          : null),
    resumo: resumoDoEvento(id, turmaId),
    alunos: listar(
      `SELECT * FROM v_situacao WHERE evento_id = ? AND turma_id = ? ORDER BY aluno`,
      id, turmaId)
  });
}));

app.put("/api/participacoes/:id", rota((req, res) => {
  const p = buscar(`SELECT * FROM participacoes WHERE id = ?`, req.params.id);
  if (!p) return res.status(404).json({ erro: "Participação não encontrada." });
  if (travada(res, p.evento_id, p.aluno_id)) return;

  const participa = req.body.participa === undefined ? p.participa : (req.body.participa ? 1 : 0);
  const isento = req.body.isento === undefined ? p.isento : (req.body.isento ? 1 : 0);
  let valor = p.valor;
  if (req.body.valor !== undefined) {
    valor = valorValido(req.body.valor);
    if (valor === null) return res.status(400).json({ erro: "Valor inválido." });
  }

  const pago = buscar(
    `SELECT id FROM pagamentos WHERE participacao_id = ? AND estornado_em IS NULL`, p.id);

  if (!participa && pago) return res.status(409).json({
    erro: "Este aluno já pagou. Estorne o pagamento antes de tirar do evento." });

  if (isento && !p.isento && pago) return res.status(409).json({
    erro: "Este aluno já pagou. Estorne o pagamento antes de isentar." });

  let motivo = p.motivo_isencao;
  if (isento && !p.isento) {
    motivo = String(req.body.motivo_isencao || "").trim();
    if (motivo.length < 3) return res.status(400).json({
      erro: "Escreva o motivo da isenção (bolsista, cortesia, combinado com a direção...)." });
  }
  if (!isento) motivo = null;

  rodar(`UPDATE participacoes SET participa = ?, isento = ?, motivo_isencao = ?, valor = ?
          WHERE id = ?`, participa, isento, motivo, valor, p.id);

  const acao = !participa ? "tirou do evento"
             : isento && !p.isento ? "isentou do pagamento"
             : !isento && p.isento ? "voltou a cobrar"
             : p.participa !== participa ? "marcou participação"
             : "ajustou o valor";
  anotar(req.usuario.id, acao, "participacao", p.id,
         { aluno_id: p.aluno_id, valor, motivo: motivo || undefined });
  res.json(buscar(`SELECT * FROM v_situacao WHERE participacao_id = ?`, p.id));
}));

app.post("/api/pagamentos", rota((req, res) => {
  const { participacao_id, valor, meio } = req.body;
  const p = buscar(`SELECT * FROM participacoes WHERE id = ?`, participacao_id);
  if (!p) return res.status(404).json({ erro: "Participação não encontrada." });
  if (travada(res, p.evento_id, p.aluno_id)) return;
  if (!p.participa) return res.status(409).json({ erro: "Marque a participação antes de receber." });
  if (p.isento) return res.status(409).json({
    erro: "Este aluno está isento. Volte a cobrar dele antes de lançar o pagamento." });
  if (!["pix", "cartao", "dinheiro"].includes(meio))
    return res.status(400).json({ erro: "Escolha como o pagamento entrou." });

  const jaPago = buscar(
    `SELECT id FROM pagamentos WHERE participacao_id = ? AND estornado_em IS NULL`, p.id);
  if (jaPago) return res.status(409).json({ erro: "Este aluno já consta como pago." });

  const valorPago = valor === undefined ? p.valor : valorValido(valor);
  if (valorPago === null) return res.status(400).json({ erro: "Valor inválido." });
  if (valorPago === 0) return res.status(400).json({ erro: "O valor recebido não pode ser zero." });

  const r = rodar(
    `INSERT INTO pagamentos (participacao_id, valor, meio, lancado_por, lancado_por_nome)
     VALUES (?, ?, ?, ?, ?)`,
    p.id, valorPago, meio, req.usuario.id, req.usuario.nome);
  anotar(req.usuario.id, "recebeu pagamento", "pagamento", Number(r.lastInsertRowid),
         { aluno_id: p.aluno_id, valor: valorPago, meio });
  res.status(201).json(buscar(`SELECT * FROM v_situacao WHERE participacao_id = ?`, p.id));
}));

app.delete("/api/pagamentos/:id", rota((req, res) => {
  const pg = buscar(`SELECT * FROM pagamentos WHERE id = ? AND estornado_em IS NULL`, req.params.id);
  if (!pg) return res.status(404).json({ erro: "Pagamento não encontrado." });
  const p = buscar(`SELECT * FROM participacoes WHERE id = ?`, pg.participacao_id);
  if (travada(res, p.evento_id, p.aluno_id)) return;

  rodar(`UPDATE pagamentos
            SET estornado_em = datetime('now','localtime'), estornado_por = ?,
                estornado_por_nome = ?, motivo_estorno = ?
          WHERE id = ?`, req.usuario.id, req.usuario.nome, req.body?.motivo || null, pg.id);
  anotar(req.usuario.id, "estornou pagamento", "pagamento", pg.id,
         { valor: pg.valor, motivo: req.body?.motivo });
  res.json(buscar(`SELECT * FROM v_situacao WHERE participacao_id = ?`, p.id));
}));

app.post("/api/eventos/:id/fechamento", exigirCoordenacao, rota((req, res) => {
  const e = buscar(`SELECT * FROM eventos WHERE id = ?`, req.params.id);
  if (!e) return res.status(404).json({ erro: "Evento não encontrado." });
  if (e.cancelado) return res.status(409).json({ erro: "Este evento foi cancelado." });
  if (e.fechado_em) return res.status(409).json({ erro: "Este evento já está fechado." });

  const resumo = e.cobra ? resumoDoEvento(e.id) : null;
  rodar(`UPDATE eventos
            SET fechado_em = datetime('now','localtime'), fechado_por = ?, fechado_por_nome = ?
          WHERE id = ?`, req.usuario.id, req.usuario.nome, e.id);
  anotar(req.usuario.id, "fechou evento", "evento", e.id, { nome: e.nome, ...resumo });
  res.status(201).json(buscar(`SELECT * FROM eventos WHERE id = ?`, e.id));
}));

app.delete("/api/eventos/:id/fechamento", exigirCoordenacao, rota((req, res) => {
  const e = buscar(`SELECT * FROM eventos WHERE id = ?`, req.params.id);
  if (!e) return res.status(404).json({ erro: "Evento não encontrado." });
  if (!e.fechado_em) return res.status(409).json({ erro: "Este evento não está fechado." });

  rodar(`UPDATE eventos SET fechado_em = NULL, fechado_por = NULL, fechado_por_nome = NULL
          WHERE id = ?`, e.id);
  anotar(req.usuario.id, "reabriu evento", "evento", e.id, { nome: e.nome });
  res.json(buscar(`SELECT * FROM eventos WHERE id = ?`, e.id));
}));

app.post("/api/fechamentos", exigirCoordenacao, rota((req, res) => {
  const { evento_id, turma_id } = req.body;
  const ev = buscar(`SELECT fechado_em FROM eventos WHERE id = ?`, evento_id);
  if (ev?.fechado_em)
    return res.status(409).json({ erro: "O evento inteiro já está fechado." });
  if (turmaFechada(evento_id, turma_id))
    return res.status(409).json({ erro: "Esta turma já está fechada." });
  const r = rodar(
    `INSERT INTO fechamentos (evento_id, turma_id, fechado_por, fechado_por_nome)
     VALUES (?, ?, ?, ?)`,
    evento_id, turma_id, req.usuario.id, req.usuario.nome);
  anotar(req.usuario.id, "fechou turma", "fechamento", Number(r.lastInsertRowid),
         { evento_id, turma_id, ...resumoDoEvento(evento_id, turma_id) });
  res.status(201).json({ ok: true });
}));

app.delete("/api/fechamentos/:eventoId/:turmaId", exigirCoordenacao, rota((req, res) => {
  const f = turmaFechada(req.params.eventoId, req.params.turmaId);
  if (!f) return res.status(404).json({ erro: "Esta turma não está fechada." });
  const ev = buscar(`SELECT fechado_em, fechado_por_nome FROM eventos WHERE id = ?`, f.evento_id);
  if (ev?.fechado_em) return res.status(423).json({
    erro: `O evento inteiro está fechado desde ${ev.fechado_em}. Reabra o evento primeiro.` });
  rodar(`UPDATE fechamentos
            SET reaberto_em = datetime('now','localtime'), reaberto_por = ?, reaberto_por_nome = ?
          WHERE id = ?`, req.usuario.id, req.usuario.nome, f.id);
  anotar(req.usuario.id, "reabriu turma", "fechamento", f.id,
         { evento_id: f.evento_id, turma_id: f.turma_id });
  res.json({ ok: true });
}));

app.get("/api/relatorios/pagamentos", rota((req, res) => {
  const { evento, turma, somentePendentes } = req.query;
  const e = buscar(`SELECT * FROM eventos WHERE id = ?`, evento);
  if (!e) return res.status(404).json({ erro: "Evento não encontrado." });

  const turmas = turma
    ? [buscar(`SELECT * FROM turmas WHERE id = ?`, turma)]
    : listar(`SELECT t.* FROM evento_turmas et JOIN turmas t ON t.id = et.turma_id
               WHERE et.evento_id = ? ORDER BY t.ordem, t.codigo`, e.id);

  res.json({
    evento: e,
    emitido_em: new Date().toLocaleString("pt-BR"),
    emitido_por: req.usuario.nome,
    turmas: turmas.map((t) => {
      let alunos = listar(
        `SELECT * FROM v_situacao WHERE evento_id = ? AND turma_id = ? ORDER BY aluno`, e.id, t.id);
      if (somentePendentes === "1") alunos = alunos.filter((a) => a.situacao === "pendente");
      return { turma: t, alunos, resumo: resumoDoEvento(e.id, t.id), caixa: caixaDaTurma(e.id, t.id) };
    })
  });
}));

app.get("/api/registro", exigirCoordenacao, rota((req, res) => {
  res.json(listar(
    `SELECT r.*, COALESCE(u.nome, r.usuario_nome) AS usuario FROM registro r
       LEFT JOIN usuarios u ON u.id = r.usuario_id
      ORDER BY r.id DESC LIMIT 300`));
}));

app.get("/api/usuarios", exigirCoordenacao, rota((req, res) => {
  res.json(listar(`SELECT id, nome, email, papel, ativo FROM usuarios ORDER BY nome`));
}));

app.post("/api/usuarios", exigirCoordenacao, rota((req, res) => {
  const { nome, email, senha, papel } = req.body;
  if (!nome?.trim() || !email?.trim() || !senha)
    return res.status(400).json({ erro: "Preencha nome, e-mail e senha." });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()))
    return res.status(400).json({ erro: "Confira o e-mail." });
  if (senha.length < 8) return res.status(400).json({ erro: "A senha precisa de pelo menos 8 letras." });
  if (buscar(`SELECT id FROM usuarios WHERE email = ?`, email.trim().toLowerCase()))
    return res.status(409).json({ erro: "Já existe alguém com este e-mail." });
  const id = criarUsuario({ nome: nome.trim(), email, senha,
                            papel: papel === "coordenacao" ? "coordenacao" : "secretaria" });
  anotar(req.usuario.id, "cadastrou usuário", "usuario", Number(id), { nome, papel });
  res.status(201).json({ id });
}));

app.put("/api/usuarios/:id", exigirCoordenacao, rota((req, res) => {
  const u = buscar(`SELECT * FROM usuarios WHERE id = ?`, req.params.id);
  if (!u) return res.status(404).json({ erro: "Usuário não encontrado." });

  const nome = (req.body.nome ?? u.nome).trim();
  const papel = req.body.papel === undefined ? u.papel
              : (req.body.papel === "coordenacao" ? "coordenacao" : "secretaria");
  const ativo = req.body.ativo === undefined ? u.ativo : (req.body.ativo ? 1 : 0);

  if (u.papel === "coordenacao" && (papel !== "coordenacao" || !ativo)) {
    const outras = buscar(
      `SELECT COUNT(*) AS n FROM usuarios
        WHERE papel = 'coordenacao' AND ativo = 1 AND id <> ?`, u.id).n;
    if (!outras) return res.status(409).json({
      erro: "Esta é a única coordenação ativa. Cadastre ou promova outra pessoa antes." });
  }

  if (req.body.senha !== undefined) {
    if (String(req.body.senha).length < 8)
      return res.status(400).json({ erro: "A senha precisa de pelo menos 8 letras." });
    trocarSenha(u.id, req.body.senha);
    rodar(`DELETE FROM sessoes WHERE usuario_id = ?`, u.id);
  }

  rodar(`UPDATE usuarios SET nome = ?, papel = ?, ativo = ? WHERE id = ?`, nome, papel, ativo, u.id);
  if (!ativo) rodar(`DELETE FROM sessoes WHERE usuario_id = ?`, u.id);

  anotar(req.usuario.id, "editou usuário", "usuario", u.id,
         { nome, papel, ativo, senhaTrocada: req.body.senha !== undefined });
  res.json(buscar(`SELECT id, nome, email, papel, ativo FROM usuarios WHERE id = ?`, u.id));
}));

app.delete("/api/usuarios/:id", exigirCoordenacao, rota((req, res) => {
  const u = buscar(`SELECT * FROM usuarios WHERE id = ?`, req.params.id);
  if (!u) return res.status(404).json({ erro: "Usuário não encontrado." });

  if (u.id === req.usuario.id) return res.status(409).json({
    erro: "Você não pode excluir a sua própria conta. Peça a outra pessoa da coordenação." });

  if (u.papel === "coordenacao") {
    const outras = buscar(
      `SELECT COUNT(*) AS n FROM usuarios
        WHERE papel = 'coordenacao' AND ativo = 1 AND id <> ?`, u.id).n;
    if (!outras) return res.status(409).json({
      erro: "Esta é a única coordenação ativa. Cadastre ou promova outra pessoa antes." });
  }

  const rastro = emBloco(() => {
    const pagou = rodar(
      `UPDATE pagamentos SET lancado_por_nome = COALESCE(lancado_por_nome, ?), lancado_por = NULL
        WHERE lancado_por = ?`, u.nome, u.id).changes;
    const estornou = rodar(
      `UPDATE pagamentos SET estornado_por_nome = COALESCE(estornado_por_nome, ?), estornado_por = NULL
        WHERE estornado_por = ?`, u.nome, u.id).changes;
    const fechou = rodar(
      `UPDATE fechamentos SET fechado_por_nome = COALESCE(fechado_por_nome, ?), fechado_por = NULL
        WHERE fechado_por = ?`, u.nome, u.id).changes;
    rodar(
      `UPDATE fechamentos SET reaberto_por_nome = COALESCE(reaberto_por_nome, ?), reaberto_por = NULL
        WHERE reaberto_por = ?`, u.nome, u.id);
    const criou = rodar(
      `UPDATE eventos SET criado_por_nome = COALESCE(criado_por_nome, ?), criado_por = NULL
        WHERE criado_por = ?`, u.nome, u.id).changes;
    rodar(
      `UPDATE ap_itens SET criado_por_nome = COALESCE(criado_por_nome, ?), criado_por = NULL
        WHERE criado_por = ?`, u.nome, u.id);
    rodar(
      `UPDATE registro SET usuario_nome = COALESCE(usuario_nome, ?), usuario_id = NULL
        WHERE usuario_id = ?`, u.nome, u.id);

    rodar(`DELETE FROM sessoes WHERE usuario_id = ?`, u.id);
    rodar(`DELETE FROM usuarios WHERE id = ?`, u.id);
    return { pagou, estornou, fechou, criou };
  })();

  anotar(req.usuario.id, "excluiu usuário", "usuario", null,
         { nome: u.nome, email: u.email, papel: u.papel, ...rastro });

  res.json({ ok: true, ...rastro });
}));

function turmaFechada(eventoId, turmaId) {
  return buscar(
    `SELECT f.*, COALESCE(u.nome, f.fechado_por_nome, 'alguém') AS quem_fechou
       FROM fechamentos f
       LEFT JOIN usuarios u ON u.id = f.fechado_por
      WHERE f.evento_id = ? AND f.turma_id = ? AND f.reaberto_em IS NULL`,
    eventoId, turmaId);
}

function travada(res, eventoId, alunoId) {
  const a = buscar(`SELECT turma_id FROM alunos WHERE id = ?`, alunoId);
  if (!a) { res.status(404).json({ erro: "Aluno não encontrado." }); return true; }

  const e = buscar(`SELECT fechado_em, fechado_por_nome FROM eventos WHERE id = ?`, eventoId);
  if (e?.fechado_em) {
    res.status(423).json({
      erro: `Evento fechado em ${e.fechado_em} por ${e.fechado_por_nome || "alguém"}. ` +
            `A coordenação precisa reabrir o evento para alterar.`
    });
    return true;
  }

  const f = turmaFechada(eventoId, a.turma_id);
  if (!f) return false;
  res.status(423).json({
    erro: `Turma fechada em ${f.fechado_em} por ${f.quem_fechou}. A coordenação precisa reabrir para alterar.`
  });
  return true;
}

function resumoDoEvento(eventoId, turmaId) {
  const filtro = turmaId ? `AND turma_id = ?` : ``;
  const p = turmaId ? [eventoId, turmaId] : [eventoId];
  return buscar(
    `SELECT
       COUNT(*)                                                      AS alunos,
       COALESCE(SUM(participa), 0)                                   AS participam,
       COALESCE(SUM(situacao = 'pago'), 0)                           AS pagos,
       COALESCE(SUM(situacao = 'pendente'), 0)                       AS pendentes,
       COALESCE(SUM(situacao = 'isento'), 0)                         AS isentos,
       COALESCE(SUM(CASE WHEN situacao = 'pago' THEN valor END), 0)  AS arrecadado,
       -- previsto ignora quem é isento: esse dinheiro não vai entrar mesmo
       COALESCE(SUM(valor_cobravel), 0)                              AS previsto,
       COALESCE(SUM(CASE WHEN situacao = 'isento' THEN valor END), 0) AS isentado
     FROM v_situacao WHERE evento_id = ? ${filtro}`, ...p);
}

function completarParticipacoes(eventoId, turmaId) {
  const e = buscar(`SELECT cobra, valor FROM eventos WHERE id = ?`, eventoId);
  if (!e?.cobra) return 0;
  const r = rodar(
    `INSERT INTO participacoes (evento_id, aluno_id, participa, valor)
     SELECT ?, a.id, 1, ?
       FROM alunos a
      WHERE a.turma_id = ? AND a.ativo = 1
        AND NOT EXISTS (SELECT 1 FROM participacoes p
                         WHERE p.evento_id = ? AND p.aluno_id = a.id)`,
    eventoId, e.valor, turmaId, eventoId);
  return r.changes;
}

function valorValido(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n < 1e7 ? n : null;
}

function caixaDaTurma(eventoId, turmaId) {
  const linhas = listar(
    `SELECT meio, COUNT(*) AS qtd, SUM(valor) AS total
       FROM v_situacao
      WHERE evento_id = ? AND turma_id = ? AND situacao = 'pago'
      GROUP BY meio`, eventoId, turmaId);
  const caixa = { pix: { qtd: 0, total: 0 }, cartao: { qtd: 0, total: 0 }, dinheiro: { qtd: 0, total: 0 } };
  let total = 0, qtd = 0;
  for (const l of linhas) {
    if (caixa[l.meio]) caixa[l.meio] = { qtd: l.qtd, total: l.total };
    total += l.total; qtd += l.qtd;
  }
  return { ...caixa, total, qtd };
}

rodar(`DELETE FROM sessoes WHERE expira_em < datetime('now','localtime')`);

app.listen(PORTA, "0.0.0.0", () => {
  const ips = Object.values(networkInterfaces()).flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address);
  const total = buscar(`SELECT COUNT(*) AS n FROM alunos WHERE ativo = 1`)?.n ?? 0;
  console.log("");
  console.log(`  Gestão — Colégio Santa Chiara   versão ${VERSAO}`);
  console.log("  ─────────────────────────────────────────────");
  console.log(`  Banco:  ${CAMINHO_BANCO}`);
  console.log(`  Alunos: ${total}`);
  console.log(`  Neste PC:      http://localhost:${PORTA}`);
  ips.forEach((ip) => console.log(`  Nos outros PCs: http://${ip}:${PORTA}`));
  console.log("");
  console.log("  Deixe esta janela aberta. Fechar aqui derruba o sistema.");
  console.log("");
});

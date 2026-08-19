import express from "express";
import { randomUUID, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join, extname } from "node:path";

import { buscar, listar, rodar, anotar, PASTA_DADOS } from "./banco.js";
import { usuarioDaSessao } from "./acesso.js";
import { lerCorpo, separarPartes } from "./multipart.js";

export const PASTA_FOTOS = join(PASTA_DADOS, "fotos");
if (!existsSync(PASTA_FOTOS)) mkdirSync(PASTA_FOTOS, { recursive: true });

const EXTENSOES = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".gif"]);
const TAMANHO_MAXIMO_FOTO = 20 * 1024 * 1024;
const TAMANHO_MAXIMO_LOTE = 30 * 1024 * 1024;

function salvarFoto(bytes, nomeOriginal) {
  let ext = extname(String(nomeOriginal || "")).toLowerCase();
  if (!EXTENSOES.has(ext)) ext = ".jpg";
  const nome = randomUUID().replaceAll("-", "") + ext;
  writeFileSync(join(PASTA_FOTOS, nome), bytes);
  return nome;
}

function apagarFoto(nome) {
  if (!nome) return;
  if (!/^[0-9a-f]{32}\.[a-z]{3,4}$/.test(nome)) return;
  try { unlinkSync(join(PASTA_FOTOS, nome)); } catch { }
}

export function chaveDoTablet() {
  if (process.env.CHAVE_TABLET) return process.env.CHAVE_TABLET;
  const guardada = buscar(`SELECT valor FROM sistema WHERE chave = 'chave_tablet'`);
  if (guardada?.valor) return guardada.valor;
  const nova = randomBytes(24).toString("hex");
  rodar(`INSERT INTO sistema (chave, valor) VALUES ('chave_tablet', ?)`, nova);
  return nova;
}

function chaveConfere(enviada, correta) {
  if (typeof enviada !== "string" || enviada.length !== correta.length) return false;
  let diferenca = 0;
  for (let i = 0; i < correta.length; i++) diferenca |= enviada.charCodeAt(i) ^ correta.charCodeAt(i);
  return diferenca === 0;
}

function deixarEntrar(req, res, prox) {
  req.usuario = usuarioDaSessao(req.cookies?.sessao);
  if (req.usuario) return prox();

  if (chaveConfere(req.get("X-Api-Key"), chaveDoTablet())) {
    req.doTablet = true;
    return prox();
  }
  res.status(401).json({ erro: "Faça login para continuar." });
}

const ENCONTRADO = 0, DEVOLVIDO = 1, EXPIRADO = 2;

const agoraUtc = () => new Date().toISOString().slice(0, 19);

function dataParaGuardar(valor) {
  if (!valor) return null;
  const t = String(valor).trim().replace(" ", "T").split(".")[0].replace(/Z$/, "");
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(t) ? t : null;
}

const dataParaEnviar = (v) => (v ? String(v).replace(" ", "T") : null);

function categoriaParaEnviar(c) {
  return {
    id: c.id,
    nome: c.nome,
    ativa: !!c.ativa,
    dataCriacao: dataParaEnviar(c.criada_em),
    emoji: c.emoji ?? null
  };
}

function enderecoBase(req) {
  const protocolo = req.get("X-Forwarded-Proto") || req.protocol || "http";
  return `${protocolo}://${req.get("host")}`;
}

function itemParaEnviar(i, req) {
  return {
    id: i.id,
    descricao: i.descricao,
    localEncontrado: i.local_encontrado ?? null,
    categoriaId: i.categoria_id,
    categoriaNome: i.categoria_nome ?? "",
    status: i.status,
    dataCadastro: dataParaEnviar(i.data_cadastro),
    dataDevolucao: dataParaEnviar(i.data_devolucao),
    urlFoto: i.nome_arquivo_foto ? `${enderecoBase(req)}/fotos/${i.nome_arquivo_foto}` : null,
    tabletId: i.tablet_id ?? null,
    idLocalTablet: i.id_local_tablet ?? null
  };
}

const SQL_ITEM = `SELECT i.*, c.nome AS categoria_nome
                    FROM ap_itens i JOIN ap_categorias c ON c.id = i.categoria_id`;

const chaveDoNome = (n) => String(n || "").trim().toLowerCase();

function acharCategoriaPorNome(nome, exceto = null) {
  const alvo = chaveDoNome(nome);
  return listar(`SELECT * FROM ap_categorias`)
    .find((c) => chaveDoNome(c.nome) === alvo && c.id !== exceto) ?? null;
}

export function montarAchados(app) {
  const achados = express.Router();

  const MEUS = ["/api/categorias", "/api/itens", "/api/sync", "/api/achados"];

  achados.use(MEUS, express.json({ limit: TAMANHO_MAXIMO_LOTE }));
  achados.use(MEUS, deixarEntrar);

  const rota = (fn) => (req, res) =>
    Promise.resolve(fn(req, res)).catch((e) => {
      if (e?.status) return res.status(e.status).json({ erro: e.message });
      console.error("[erro achados]", req.method, req.path, e);
      res.status(500).json({ erro: "Algo deu errado aqui no servidor. Tente de novo." });
    });

  const quemFez = (req) => req.usuario?.id ?? null;

  achados.get("/api/categorias", rota((req, res) => {
    const todas = req.query.somenteAtivas === "false" || req.query.somenteAtivas === "0";
    const lista = listar(
      `SELECT * FROM ap_categorias ${todas ? "" : "WHERE ativa = 1"} ORDER BY nome`);
    res.json(lista.map(categoriaParaEnviar));
  }));

  achados.get("/api/categorias/:id", rota((req, res) => {
    const c = buscar(`SELECT * FROM ap_categorias WHERE id = ?`, req.params.id);
    if (!c) return res.status(404).json({ erro: "Categoria não encontrada." });
    res.json(categoriaParaEnviar(c));
  }));

  achados.post("/api/categorias", rota((req, res) => {
    const nome = String(req.body?.nome || "").trim();
    if (!nome) return res.status(400).json({ erro: "Dê um nome à categoria." });
    if (nome.length > 100) return res.status(400).json({ erro: "Nome longo demais." });

    if (acharCategoriaPorNome(nome))
      return res.status(409).json({ erro: "Já existe uma categoria com este nome." });

    const emoji = String(req.body?.emoji || "").trim() || null;
    const r = rodar(
      `INSERT INTO ap_categorias (nome, emoji, id_local_tablet, criada_em)
       VALUES (?, ?, ?, ?)`,
      nome, emoji, req.body?.idLocalTablet || null, agoraUtc());
    anotar(quemFez(req), "criou categoria de achados", "ap_categoria",
           Number(r.lastInsertRowid), { nome, tablet: !!req.doTablet });
    res.status(201).json(categoriaParaEnviar(
      buscar(`SELECT * FROM ap_categorias WHERE id = ?`, Number(r.lastInsertRowid))));
  }));

  achados.put("/api/categorias/:id", rota((req, res) => {
    const c = buscar(`SELECT * FROM ap_categorias WHERE id = ?`, req.params.id);
    if (!c) return res.status(404).json({ erro: "Categoria não encontrada." });

    const nome = String(req.body?.nome ?? c.nome).trim();
    if (!nome) return res.status(400).json({ erro: "Dê um nome à categoria." });
    if (acharCategoriaPorNome(nome, c.id))
      return res.status(409).json({ erro: "Já existe uma categoria com este nome." });

    const ativa = req.body?.ativa === undefined ? c.ativa : (req.body.ativa ? 1 : 0);
    const emoji = req.body?.emoji === undefined
      ? c.emoji : (String(req.body.emoji || "").trim() || null);

    rodar(`UPDATE ap_categorias SET nome = ?, ativa = ?, emoji = ? WHERE id = ?`,
          nome, ativa, emoji, c.id);
    anotar(quemFez(req), "editou categoria de achados", "ap_categoria", c.id, { nome, ativa });
    res.status(204).end();
  }));

  achados.delete("/api/categorias/:id", rota((req, res) => {
    const c = buscar(`SELECT * FROM ap_categorias WHERE id = ?`, req.params.id);
    if (!c) return res.status(404).json({ erro: "Categoria não encontrada." });
    rodar(`UPDATE ap_categorias SET ativa = 0 WHERE id = ?`, c.id);
    anotar(quemFez(req), "desativou categoria de achados", "ap_categoria", c.id, { nome: c.nome });
    res.status(204).end();
  }));

  achados.get("/api/itens", rota((req, res) => {
    const filtros = [], p = [];
    if (req.query.categoriaId) { filtros.push("i.categoria_id = ?"); p.push(Number(req.query.categoriaId)); }
    if (req.query.status !== undefined && req.query.status !== "") {
      filtros.push("i.status = ?"); p.push(Number(req.query.status));
    }
    const onde = filtros.length ? `WHERE ${filtros.join(" AND ")}` : "";
    const itens = listar(`${SQL_ITEM} ${onde} ORDER BY i.data_cadastro DESC, i.id DESC`, ...p);
    res.json(itens.map((i) => itemParaEnviar(i, req)));
  }));

  achados.get("/api/itens/:id", rota((req, res) => {
    const i = buscar(`${SQL_ITEM} WHERE i.id = ?`, req.params.id);
    if (!i) return res.status(404).json({ erro: "Item não encontrado." });
    res.json(itemParaEnviar(i, req));
  }));

  achados.post("/api/itens", rota(async (req, res) => {
    const tipo = req.get("content-type") || "";
    let campos, foto = null;

    if (tipo.startsWith("multipart/form-data")) {
      const corpo = await lerCorpo(req, TAMANHO_MAXIMO_FOTO);
      const partes = separarPartes(corpo, tipo);
      campos = partes.campos;
      foto = partes.arquivos.foto || null;
    } else {
      campos = req.body || {};
    }

    const descricao = String(campos.Descricao ?? campos.descricao ?? "").trim();
    if (!descricao) return res.status(400).json({ erro: "Descreva o que foi encontrado." });

    const categoriaId = Number(campos.CategoriaId ?? campos.categoriaId);
    const categoria = buscar(`SELECT * FROM ap_categorias WHERE id = ?`, categoriaId);
    if (!categoria) return res.status(400).json({ erro: "Categoria inexistente." });

    const local = String(campos.LocalEncontrado ?? campos.localEncontrado ?? "").trim() || null;
    const tabletId = String(campos.TabletId ?? campos.tabletId ?? "").trim() || null;
    const idLocal = String(campos.IdLocalTablet ?? campos.idLocalTablet ?? "").trim() || null;

    let nomeFoto = null;
    if (foto) nomeFoto = salvarFoto(foto.dados, foto.nomeArquivo);
    else if (campos.fotoBase64) nomeFoto = salvarFoto(
      Buffer.from(String(campos.fotoBase64), "base64"), campos.nomeArquivoFoto || "foto.jpg");

    const r = rodar(
      `INSERT INTO ap_itens (descricao, local_encontrado, categoria_id, status,
                             data_cadastro, nome_arquivo_foto, tablet_id, id_local_tablet,
                             criado_por, criado_por_nome)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      descricao, local, categoriaId, ENCONTRADO, agoraUtc(), nomeFoto,
      tabletId, idLocal, quemFez(req), req.usuario?.nome ?? null);

    anotar(quemFez(req), "cadastrou achado", "ap_item", Number(r.lastInsertRowid),
           { descricao, categoria: categoria.nome });
    res.status(201).json(itemParaEnviar(
      buscar(`${SQL_ITEM} WHERE i.id = ?`, Number(r.lastInsertRowid)), req));
  }));

  achados.patch("/api/itens/:id/status", rota((req, res) => {
    const i = buscar(`SELECT * FROM ap_itens WHERE id = ?`, req.params.id);
    if (!i) return res.status(404).json({ erro: "Item não encontrado." });

    const status = Number(req.body?.status);
    if (![ENCONTRADO, DEVOLVIDO, EXPIRADO].includes(status))
      return res.status(400).json({ erro: "Situação inválida." });

    const devolucao = status === DEVOLVIDO ? (i.data_devolucao || agoraUtc()) : i.data_devolucao;
    rodar(`UPDATE ap_itens SET status = ?, data_devolucao = ? WHERE id = ?`,
          status, devolucao, i.id);
    anotar(quemFez(req), status === DEVOLVIDO ? "entregou achado" : "mudou situação de achado",
           "ap_item", i.id, { descricao: i.descricao, status });
    res.status(204).end();
  }));

  achados.delete("/api/itens/:id", rota((req, res) => {
    const i = buscar(`SELECT * FROM ap_itens WHERE id = ?`, req.params.id);
    if (!i) return res.status(404).json({ erro: "Item não encontrado." });
    rodar(`DELETE FROM ap_itens WHERE id = ?`, i.id);
    apagarFoto(i.nome_arquivo_foto);
    anotar(quemFez(req), "apagou achado", "ap_item", i.id, { descricao: i.descricao });
    res.status(204).end();
  }));

  achados.get("/api/sync/categorias", rota((req, res) => {
    const desde = dataParaGuardar(req.query.desde);
    const lista = desde
      ? listar(`SELECT * FROM ap_categorias WHERE criada_em >= ? ORDER BY id`, desde)
      : listar(`SELECT * FROM ap_categorias ORDER BY id`);
    res.json(lista.map(categoriaParaEnviar));
  }));

  achados.post("/api/sync/itens", rota((req, res) => {
    const lote = req.body;
    if (!Array.isArray(lote)) return res.status(400).json({ erro: "Esperava uma lista de itens." });

    let criados = 0, atualizados = 0;
    const erros = [];

    for (const dto of lote) {
      try {
        const existente = dto.idLocalTablet
          ? buscar(`SELECT * FROM ap_itens WHERE tablet_id = ? AND id_local_tablet = ?`,
                   dto.tabletId ?? null, dto.idLocalTablet)
          : null;

        if (existente) {
          const status = Number(dto.status ?? existente.status);
          const devolucao = dataParaGuardar(dto.dataDevolucao)
            ?? (status === DEVOLVIDO ? (existente.data_devolucao || agoraUtc()) : existente.data_devolucao);
          rodar(`UPDATE ap_itens SET status = ?, data_devolucao = ? WHERE id = ?`,
                status, devolucao, existente.id);
          atualizados++;
          continue;
        }

        const categoriaId = resolverCategoria(dto);
        const descricao = String(dto.descricao || "").trim();
        if (!descricao) throw new Error("Item sem descrição.");

        let nomeFoto = null;
        if (dto.fotoBase64) {
          nomeFoto = salvarFoto(Buffer.from(String(dto.fotoBase64), "base64"),
                                dto.nomeArquivoFoto || "foto.jpg");
        }

        rodar(
          `INSERT INTO ap_itens (descricao, local_encontrado, categoria_id, status,
                                 data_cadastro, data_devolucao, nome_arquivo_foto,
                                 tablet_id, id_local_tablet)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          descricao,
          String(dto.localEncontrado || "").trim() || null,
          categoriaId,
          Number(dto.status ?? ENCONTRADO),
          dataParaGuardar(dto.dataCadastro) || agoraUtc(),
          dataParaGuardar(dto.dataDevolucao),
          nomeFoto,
          dto.tabletId ?? null,
          dto.idLocalTablet ?? null);
        criados++;
      } catch (e) {
        erros.push(`${dto?.idLocalTablet ?? "?"}: ${e.message}`);
      }
    }

    res.json({ recebidos: lote.length, criados, atualizados, erros });
  }));

  achados.get("/api/achados/resumo", rota((req, res) => {
    const r = buscar(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(status = 0), 0) AS aguardando,
              COALESCE(SUM(status = 1), 0) AS devolvidos,
              COALESCE(SUM(status = 2), 0) AS expirados,
              COALESCE(SUM(status = 0 AND data_cadastro >= ?), 0) AS na_semana
         FROM ap_itens`,
      new Date(Date.now() - 7 * 86400e3).toISOString().slice(0, 19));
    res.json({
      ...r,
      categorias: buscar(`SELECT COUNT(*) AS n FROM ap_categorias WHERE ativa = 1`).n,
      maisAntigo: buscar(
        `SELECT data_cadastro FROM ap_itens WHERE status = 0
          ORDER BY data_cadastro LIMIT 1`)?.data_cadastro ?? null
    });
  }));

  app.use(achados);

  app.use("/fotos", express.static(PASTA_FOTOS, {
    maxAge: "30d",
    setHeaders: (res) => res.setHeader("X-Content-Type-Options", "nosniff")
  }));
}

function resolverCategoria(dto) {
  if (dto.categoriaServidorId != null) {
    const c = buscar(`SELECT id FROM ap_categorias WHERE id = ?`, Number(dto.categoriaServidorId));
    if (c) return c.id;
  }
  if (dto.categoriaIdLocalTablet) {
    const c = buscar(`SELECT id FROM ap_categorias WHERE id_local_tablet = ?`,
                     dto.categoriaIdLocalTablet);
    if (c) return c.id;
  }
  if (dto.categoriaNome) {
    const c = acharCategoriaPorNome(dto.categoriaNome);
    if (c) return c.id;
  }
  throw new Error("Categoria não encontrada no servidor.");
}

export { ENCONTRADO, DEVOLVIDO, EXPIRADO };

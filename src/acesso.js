// Login, sessão e níveis de acesso.
//
// Dois papéis:
//   secretaria  — lança e estorna pagamentos, marca participação
//   coordenacao — tudo isso, mais criar eventos, fechar e reabrir turma,
//                 cadastrar usuários e ver o histórico

import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { buscar, rodar, anotar } from "./banco.js";

const DIAS_DE_SESSAO = 30;

export function criarUsuario({ nome, email, senha, papel }) {
  const hash = bcrypt.hashSync(senha, 10);
  const r = rodar(
    `INSERT INTO usuarios (nome, email, senha_hash, papel) VALUES (?, ?, ?, ?)`,
    nome, email.trim().toLowerCase(), hash, papel
  );
  return r.lastInsertRowid;
}

export function trocarSenha(usuarioId, senha) {
  rodar(`UPDATE usuarios SET senha_hash = ? WHERE id = ?`, bcrypt.hashSync(senha, 10), usuarioId);
}

export function entrar(email, senha) {
  const u = buscar(
    `SELECT * FROM usuarios WHERE email = ? AND ativo = 1`,
    String(email || "").trim().toLowerCase()
  );
  // Compara mesmo sem usuário, para não entregar quais e-mails existem.
  const confere = bcrypt.compareSync(senha || "", u?.senha_hash || "$2a$10$invalido");
  if (!u || !confere) return null;

  const token = randomBytes(32).toString("hex");
  const expira = new Date(Date.now() + DIAS_DE_SESSAO * 86400e3).toISOString();
  rodar(`INSERT INTO sessoes (token, usuario_id, expira_em) VALUES (?, ?, ?)`,
        token, u.id, expira);
  anotar(u.id, "entrou", "usuario", u.id);
  return { token, usuario: { id: u.id, nome: u.nome, email: u.email, papel: u.papel } };
}

export function sair(token) {
  const s = buscar(`SELECT usuario_id FROM sessoes WHERE token = ?`, token);
  if (s) anotar(s.usuario_id, "saiu", "usuario", s.usuario_id);
  rodar(`DELETE FROM sessoes WHERE token = ?`, token);
}

export function usuarioDaSessao(token) {
  if (!token) return null;
  const linha = buscar(
    `SELECT u.id, u.nome, u.email, u.papel, s.expira_em
       FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token = ? AND u.ativo = 1`, token
  );
  if (!linha) return null;
  if (new Date(linha.expira_em) < new Date()) {
    rodar(`DELETE FROM sessoes WHERE token = ?`, token);
    return null;
  }
  return { id: linha.id, nome: linha.nome, email: linha.email, papel: linha.papel };
}

// --- porteiros das rotas ---
export function exigirLogin(req, res, prox) {
  req.usuario = usuarioDaSessao(req.cookies?.sessao);
  if (!req.usuario) return res.status(401).json({ erro: "Faça login para continuar." });
  prox();
}

export function exigirCoordenacao(req, res, prox) {
  if (req.usuario?.papel !== "coordenacao")
    return res.status(403).json({ erro: "Esta ação é da coordenação." });
  prox();
}

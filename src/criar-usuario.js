// Cadastra quem vai usar o sistema.
//
//   npm run criar-usuario -- "Maria Silva" maria@santachiara.com.br senhaSegura coordenacao
//
// Papéis:
//   secretaria  — lança e estorna pagamentos
//   coordenacao — tudo isso, mais criar eventos, fechar/reabrir turma,
//                 cadastrar gente e ver o histórico
//
// O primeiro usuário precisa ser da coordenação. Os próximos podem ser
// cadastrados pela tela de usuários, sem mexer em linha de comando.

import { buscar } from "./banco.js";
import { criarUsuario } from "./acesso.js";

const [nome, email, senha, papel = "secretaria"] = process.argv.slice(2);

if (!nome || !email || !senha) {
  console.log(`
  Uso:
    npm run criar-usuario -- "Nome Completo" email@escola.com senha papel

  Exemplo:
    npm run criar-usuario -- "Maria Silva" maria@santachiara.com.br 12345678 coordenacao
`);
  process.exit(1);
}

if (senha.length < 8) {
  console.log("\n  A senha precisa de pelo menos 8 letras.\n");
  process.exit(1);
}
if (!["secretaria", "coordenacao"].includes(papel)) {
  console.log("\n  O papel tem que ser secretaria ou coordenacao.\n");
  process.exit(1);
}
if (buscar(`SELECT id FROM usuarios WHERE email = ?`, email.trim().toLowerCase())) {
  console.log(`\n  Já existe alguém cadastrado com ${email}.\n`);
  process.exit(1);
}

criarUsuario({ nome, email, senha, papel });
console.log(`\n  ${nome} cadastrado como ${papel}.`);
console.log(`  Entra no sistema com ${email.trim().toLowerCase()}\n`);

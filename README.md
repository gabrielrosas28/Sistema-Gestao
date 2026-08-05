# Gestão — Colégio Santa Chiara

Sistema da secretaria: calendário escolar, eventos, pagamentos por turma e
relatórios. Roda num PC da escola e é aberto pelo navegador dos outros PCs.

**Versão 1.3.0** · 637 alunos · 39 turmas, do Maternalzinho ao 5º ano

---

## Como funciona

Um PC guarda tudo (o **servidor**). Os outros só abrem o navegador e digitam
o endereço. Nenhum dado fica nas máquinas, então **não há o que sincronizar**
e ninguém trabalha com versão desatualizada: todo mundo olha o mesmo banco,
ao vivo.

```
   PC da secretaria  ┐
   PC da coordenação ├──  rede da escola  ──▶  PC servidor  ──▶  gestao.db
   PC da direção     │                          (Node.js)
   Celular no Wi-Fi  ┘
```

Se um PC desligar, nada se perde. Se o servidor desligar, o sistema volta ao
ligar de novo — os dados continuam no arquivo.

---

## O que dá para fazer

**Calendário escolar** — mês a mês, com unidades letivas, recessos e feriados.
Eventos por categoria: comemoração, passeio, avaliações, reunião, fardamento
e material, esportes.

**Pagamentos** — um cartão por aluno, com valor, meio (Pix, cartão, dinheiro)
e confirmação. Filtros por pendente, pago, isento e não participa.

**Aluno isento** — participa da atividade sem pagar (bolsista, cortesia,
combinado com a direção). Sai da conta do "falta receber" e não vira pendente
eterno. O motivo fica registrado.

**Fechar turma** — trava o lançamento quando a turma está conferida. A
coordenação reabre quando precisa corrigir.

**Relatórios** — documento para imprimir em papel timbrado, com conferência de
caixa por meio de pagamento, ou planilha `.csv` para o Excel. Escopo: uma
turma, o evento inteiro (uma página por turma) ou só quem falta pagar.

**Ajustes** (só coordenação) — cadastro de quem usa o sistema e edição do
calendário letivo.

---

## Instalar

O passo a passo completo está em [INSTALAR-NO-SERVIDOR.md](INSTALAR-NO-SERVIDOR.md).
Resumo:

```
git clone https://github.com/gabrielrosas28/Sistema-Gestao.git Gestao
```

Depois, dentro da pasta, dois cliques em:

| Arquivo | O que faz |
|---|---|
| `Instalar.bat` | Instala, importa turmas e alunos, cria o primeiro acesso |
| `Gestao.bat` | Liga o sistema |
| `Liberar na rede.bat` | Abre a porta no firewall (como administrador) |
| `Rodar sem janela.bat` | Faz subir sozinho com o Windows (como administrador) |
| `Atualizar.bat` | Backup, baixa a versão nova e confere |
| `Backup.bat` | Cópia do banco |
| `Diagnostico.bat` | Descobre por que o sistema não está abrindo |
| `Desinstalar.bat` | Tira tudo do servidor, banco e backups junto — sem volta |

**Requisitos:** Node.js 22 ou mais novo, e Git no servidor.

> A pasta precisa ficar **fora do OneDrive**. O sincronizador copia o arquivo
> do banco enquanto o sistema grava nele, e isso corrompe lançamento de
> pagamento. Use `C:\Gestao`.

---

## Estrutura

```
src/
  servidor.js      API e regras de negócio
  banco.js         conexão, atualização automática do esquema
  esquema.sql      tabelas e a visão v_situacao
  acesso.js        login, sessão, papéis
  importar.js      lê Exportado.CSV ou a planilha de boletins
  criar-usuario.js primeiro acesso pela linha de comando
  backup.js        cópia do banco com VACUUM INTO
  iniciar.js       liga o servidor na versão certa do Node
publico/
  index.html       uma página só
  app.js           telas, chamadas à API, relatórios
  estilo.css       identidade visual do colégio
testes/
  coerencia.mjs    confere tela × servidor × banco (roda sem ligar nada)
  api.mjs          fluxo principal de ponta a ponta
  qa.mjs           casos de borda
  ajustes.mjs      edição de evento, calendário e pessoas
```

**Sem framework de front-end e sem build.** A página é servida como está.
Trocar um arquivo em `publico/` e recarregar o navegador basta.

---

## Comandos

| Comando | O que faz |
|---|---|
| `npm start` | Liga o sistema |
| `npm run importar -- "caminho\Exportado.CSV"` | Atualiza turmas e alunos |
| `npm run criar-usuario` | Cadastra alguém pela linha de comando |
| `npm run backup` | Cópia do banco |
| `npm run testar` | Roda os quatro conjuntos de teste |

`npm run testar` precisa do sistema ligado na porta 8099:

```
set PORTA=8099 && npm start
```

---

## Quem pode o quê

| Ação | Secretaria | Coordenação |
|---|---|---|
| Lançar e estornar pagamento | sim | sim |
| Marcar participação e isenção | sim | sim |
| Ver e exportar relatórios | sim | sim |
| Criar, editar e cancelar evento | não | sim |
| Fechar e reabrir turma | não | sim |
| Editar o calendário letivo | não | sim |
| Cadastrar quem usa o sistema | não | sim |
| Ver o histórico de alterações | não | sim |

---

## Decisões que sustentam o resto

**Pagamento nunca é apagado.** Estorno marca a linha com autor e motivo. Um
relatório emitido mês passado continua batendo com o banco hoje.

**Pagamento pertence ao aluno, não à turma.** Aluno que muda de turma leva o
histórico junto.

**O banco se atualiza sozinho.** Coluna nova entra ao ligar, sem comando
manual e sem tocar em lançamento antigo. Ver `garantirColuna` em `banco.js`.

**A última coordenação ativa não consegue se rebaixar nem tirar o próprio
acesso.** Sem isso dava para trancar todo mundo do lado de fora.

**Nada de dinheiro sem rastro.** Isentar, estornar, fechar turma e editar
evento entram na tabela `registro` com nome, hora e detalhe.

---

## Quando crescer

Hoje o banco é um arquivo SQLite, que aguenta com folga 637 alunos e as
máquinas da administração lançando ao mesmo tempo. Se um dia houver muito mais
gente gravando simultaneamente, o caminho é PostgreSQL: as consultas são
padrão e só `src/banco.js` precisa mudar. Os PCs continuam abrindo o mesmo
endereço.

---

## Histórico

O que mudou em cada versão está em [HISTORICO.md](HISTORICO.md).

# Gestão — Colégio Santa Chiara

Sistema da secretaria: calendário escolar, eventos, pagamentos por turma e
relatórios. Roda num PC da escola e é aberto pelo navegador dos outros PCs.

---

## Como funciona

Um PC guarda tudo (o **servidor**). Os outros só abrem o navegador e digitam
o endereço. Não existe cópia de dados em máquina nenhuma, então **não há o que
sincronizar** e ninguém fica com versão desatualizada: todo mundo está olhando
o mesmo banco, ao vivo.

```
   PC da secretaria  ┐
   PC da coordenação ├──  rede da escola  ──▶  PC servidor  ──▶  gestao.db
   PC da direção     │                          (Node.js)
   Celular no Wi-Fi  ┘
```

Se um PC desligar, nada se perde. Se o servidor desligar, o sistema volta ao
ligar de novo — os dados continuam no arquivo.

---

## Não rode de dentro do OneDrive

O sistema precisa morar numa pasta **fora** de qualquer pasta sincronizada
(OneDrive, Google Drive, Dropbox). O sincronizador copia o arquivo do banco
enquanto o sistema está gravando nele, e isso corrompe lançamento de pagamento.

Use `C:\Gestao` no PC servidor. O OneDrive continua ótimo para guardar os
**backups** — só não para rodar o sistema.

---

## Instalação no PC servidor

Escolha um PC que fique ligado no horário de funcionamento. Não precisa ser
potente: um computador comum de secretaria dá conta com folga.

**1. Instale o Node.js**
Baixe a versão **LTS** em <https://nodejs.org> e instale clicando em avançar.
É a única coisa que precisa ser instalada.

**2. Copie a pasta `Sistema Gestao`** para `C:\Gestao` no PC servidor.
Fora do OneDrive, como explicado acima.

**3. Dê dois cliques em `Instalar.bat`**

Ele confere o Node, instala os componentes, importa turmas, calendário e alunos,
e pergunta o nome, e-mail e senha do primeiro acesso (o da coordenação).

**4. Dê dois cliques em `Gestao.bat`** para ligar.

A janela mostra os endereços. Deixe-a aberta — fechar derruba o sistema.

<details>
<summary>Fazer os mesmos passos pelo Prompt de Comando</summary>

```
cd C:\Gestao
npm install
npm run importar
npm run criar-usuario -- "Seu Nome" seu@email.com suasenha coordenacao
npm start
```

Se a planilha do gerador de boletins estiver em outro lugar:

```
npm run importar -- "C:\caminho\Gerador de boletim - 2026.xlsx"
```
</details>

---

## Nos outros PCs

Abra o navegador e digite o endereço que apareceu na janela do servidor, algo
como `http://192.168.0.10:8080`. Salve nos favoritos.

Para não depender do número, peça a quem cuida da rede para **fixar o IP** do
PC servidor. Sem isso, o endereço pode mudar quando o PC reiniciar.

---

## Deixar ligando junto com o Windows

1. Aperte `Windows + R`, digite `shell:startup` e dê Enter.
2. Arraste o `Gestao.bat` para essa pasta (segurando `Alt` para criar um atalho).

Da próxima vez que o PC ligar, o sistema sobe sozinho.

---

## Backup

Dois cliques em `Backup.bat`. Ele salva em
`OneDrive\Backups Gestao` — assim existe cópia fora do prédio.

Pelo Prompt de Comando:

```
npm run backup
npm run backup -- "D:\Backups Gestao"
```

Pode rodar com o sistema no ar e com gente lançando pagamento — a cópia sai
íntegra. Guarda as 30 mais recentes.

Para rodar sozinho todo dia: abra o **Agendador de Tarefas** do Windows, crie
uma tarefa diária às 19h apontando para `C:\Gestao\Backup.bat` com o argumento
`/auto` (assim ele não fica esperando alguém apertar uma tecla).

Para restaurar: pare o sistema, troque `dados\gestao.db` pela cópia, ligue de novo.

---

## Atualizar para uma versão nova

O servidor é uma cópia do repositório no GitHub. Atualizar é **dois cliques em
`Atualizar.bat`** — ele faz backup, baixa a versão nova, confere se está
coerente e avisa. Depois é só abrir o `Gestao.bat`.

O banco **se ajusta sozinho** ao ligar. Coluna nova entra sem apagar nada, e
nenhum lançamento antigo é tocado. Não existe comando de migração para rodar
à mão.

Para o `Atualizar.bat` funcionar, o servidor precisa ter o Git instalado
(<https://git-scm.com>) e a pasta precisa ter vindo de um `git clone`, e não
de um arquivo copiado:

```
cd C:\
git clone https://github.com/SEU-USUARIO/gestao-santa-chiara.git Gestao
```

O número da versão aparece na janela do servidor e no canto da tela, embaixo
do seu nome — dá para conferir de qualquer PC se o servidor já atualizou.
O que mudou em cada versão está em `HISTORICO.md`.

---

## Aluno que participa mas não paga

Bolsista, cortesia, combinado com a direção. No cartão do aluno, **Não paga**
pede o motivo e marca como **isento**.

O isento continua contando como participante do evento, some da conta do
"falta receber" e não aparece na lista de cobrança — a turma fecha completa
sem ninguém ficar pendente para sempre. O motivo e o nome de quem isentou
ficam no histórico e saem no relatório.

Quem já pagou não pode ser isentado direto: primeiro estorna o pagamento.
Isso evita esconder dinheiro que entrou de verdade.

---

## Quem pode o quê

| Ação | Secretaria | Coordenação |
|---|---|---|
| Lançar e estornar pagamento | sim | sim |
| Marcar quem participa | sim | sim |
| Isentar aluno do pagamento | sim | sim |
| Ver e exportar relatórios | sim | sim |
| Criar evento e definir valor | não | sim |
| Fechar e reabrir turma | não | sim |
| Cadastrar quem usa o sistema | não | sim |
| Ver o histórico de alterações | não | sim |

Toda ação que mexe em dinheiro fica registrada com nome, data e hora. Pagamento
estornado **não é apagado**: fica marcado como estornado, com o motivo. Por isso
um relatório emitido mês passado continua batendo com o que foi impresso na época.

---

## Comandos

| Comando | O que faz |
|---|---|
| `npm start` | Liga o sistema |
| `npm run importar` | Atualiza turmas e alunos a partir da planilha |
| `npm run criar-usuario` | Cadastra alguém pela linha de comando |
| `npm run backup` | Faz uma cópia do banco |
| `npm run testar` | Confere se as regras de pagamento estão de pé (com o sistema ligado) |

---

## Ajustes

Variáveis opcionais, se precisar:

| Variável | Para quê | Padrão |
|---|---|---|
| `PORTA` | Porta do site | `8080` |
| `DADOS` | Onde fica o banco | `dados` dentro da pasta |
| `ANO_LETIVO` | Ano das turmas e eventos | ano atual |

Exemplo: `set PORTA=80 && npm start` deixa o endereço sem o `:8080`.

---

## Quando crescer

Hoje o banco é um arquivo SQLite, que aguenta com folga os 616 alunos e as
máquinas da administração lançando ao mesmo tempo. Se um dia a escola passar a
ter muito mais gente gravando simultaneamente, o caminho é trocar para
PostgreSQL: as consultas são padrão e só o arquivo `src/banco.js` precisa mudar.
Os PCs continuam abrindo o mesmo endereço, sem reinstalar nada.

---

## O que ainda falta

- Ligar a interface (o protótipo `Gestao - prototipo UI.html`) a este servidor
- Cadastro dos alunos da Educação Infantil e do 1º ano, que não estão na
  planilha de boletins do Fundamental
- Trazer o gerador de boletins para dentro do sistema

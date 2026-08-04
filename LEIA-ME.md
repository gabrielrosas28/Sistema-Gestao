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

## Tirar a janela preta do caminho

Enquanto o sistema roda pelo `Gestao.bat`, ele só fica no ar com aquela janela
aberta. Qualquer pessoa que a feche sem querer derruba o sistema para a escola
inteira.

Clique com o botão direito em **`Rodar sem janela.bat`** e escolha
**Executar como administrador**. Ele registra o sistema no Windows para:

- subir sozinho quando o PC liga, antes de alguém fazer login
- rodar escondido, sem janela para fechar por engano
- voltar sozinho se travar

O que apareceria na janela passa a ser gravado em `dados\servidor.log`.

O mesmo arquivo desliga esse modo (opção 2), o que você precisa fazer antes de
rodar o `Atualizar.bat` — e religar depois.

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

## Atualizar a lista de alunos

Sempre que a secretaria exportar uma lista nova do sistema da escola:

```
npm run importar -- "C:\caminho\Exportado.CSV"
```

Pode rodar quantas vezes quiser. Ele cria quem chegou, atualiza quem já existe
e **move quem trocou de turma** — o pagamento acompanha o aluno, porque está
preso à pessoa e não à turma.

**Ninguém é apagado nem desativado.** Quem está no sistema e não veio no
arquivo aparece listado no final para você conferir. Se tiver certeza de que
o arquivo é a escola inteira e quer tirar todos de uma vez:

```
npm run importar -- "C:\caminho\Exportado.CSV" --desativar-ausentes
```

Aluno desativado some das listas, mas o histórico de pagamento dele fica
guardado.

O arquivo precisa ter as colunas **MATRICULA, NOME, CURSO e TURMA**. A planilha
`.xlsx` do gerador de boletins também continua funcionando, só que ela cobre
apenas do 2º ao 5º ano.

---

## Quem pode o quê

| Ação | Secretaria | Coordenação |
|---|---|---|
| Lançar e estornar pagamento | sim | sim |
| Marcar quem participa | sim | sim |
| Isentar aluno do pagamento | sim | sim |
| Ver e exportar relatórios | sim | sim |
| Criar, editar e cancelar evento | não | sim |
| Fechar e reabrir turma | não | sim |
| Editar o calendário letivo | não | sim |
| Cadastrar quem usa o sistema | não | sim |
| Ver o histórico de alterações | não | sim |

Quem é da coordenação tem a aba **Ajustes** no menu, com o cadastro de pessoas
e o calendário letivo. A secretaria não enxerga essa aba.

Toda ação que mexe em dinheiro fica registrada com nome, data e hora. Pagamento
estornado **não é apagado**: fica marcado como estornado, com o motivo. Por isso
um relatório emitido mês passado continua batendo com o que foi impresso na época.

---

## Comandos

| Comando | O que faz |
|---|---|
| `npm start` | Liga o sistema |
| `npm run importar -- "caminho\Exportado.CSV"` | Atualiza turmas e alunos |
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

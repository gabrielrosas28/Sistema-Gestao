# Histórico de versões

O número da versão aparece na janela do servidor e no canto da tela, embaixo
do seu nome. Serve para saber se o servidor já está com a última versão.

Formato `maior.menor.correção`:

- **correção** (1.1.**1**) — conserto de erro, nada muda no uso
- **menor** (1.**2**.0) — recurso novo, o que já existia continua igual
- **maior** (**2**.0.0) — mudança grande, que pede aviso antes

---

## 1.3.1 — 4 de agosto de 2026

**O modo sem janela nunca funcionou, e o sistema escondia o motivo**

Quatro erros empilhados. Um impedia o modo sem janela de existir, outro
quebrava a partida em toda máquina Windows, e os outros dois faziam o sistema
morrer calado, sem dizer o que havia dado errado.

- **O `iniciar.js` nunca subiu pelo caminho principal no Windows.** O
  `import()` dinâmico exige URL, não caminho. No Linux `/caminho/x.js` já é
  URL válida e o erro não aparece; no Windows o `C:` vira "protocolo c:" e o
  Node recusa com `ERR_UNSUPPORTED_ESM_URL_SCHEME`. Ou seja: desde sempre,
  toda partida no servidor falhava e caía no plano B — o processo filho com
  `--experimental-sqlite`. Funcionava por acidente. Agora passa
  `pathToFileURL(...)`, e o `coerencia.mjs` reprova quem voltar a passar
  caminho para o `import()`.

- **A tarefa do Windows nascia truncada.** O comando inteiro ia dentro do
  `/tr` do `schtasks`, com `\"` no meio. O `schtasks` lê os argumentos pela
  regra do C, onde a barra invertida escapa a aspa seguinte — e o caminho da
  pasta já termina em barra. O `\"` do fim virava barra literal mais fim de
  aspas, e o `schtasks` recebia só `cmd /c cd /d "C:\Gestao\`, jogando fora o
  node, o `servidor.js` e o log. Agora o comando mora num `_servico.cmd`
  gerado ao lado do sistema, e o `/tr` é só um caminho.
- **O `Gestao.bat` abria e fechava sem mostrar nada.** Faltava o `call` antes
  do `npm`. Sem ele o `npm.cmd` toma o controle e a janela morre junto,
  sem passar pelo `pause` — o erro aparecia e sumia no mesmo instante.
- **O `iniciar.js` engolia qualquer erro.** O `catch` vazio tratava toda falha
  como "falta a permissão do SQLite", tentava de novo do mesmo jeito e
  desistia em silêncio. Porta ocupada, banco travado, erro de digitação: tudo
  virava a mesma tela em branco. Agora só cai no plano B quando o motivo é
  mesmo o `node:sqlite`; o resto aparece inteiro.

Junto disso:

- O `Rodar sem janela.bat` confere se o sistema **realmente** subiu na porta
  8080 antes de dizer que deu certo, e mostra o fim do log quando não subiu
- Some o limite de 72 horas do Agendador, que derrubaria o servidor sozinho
  no meio da semana; e a tarefa passa a tentar voltar 3 vezes se travar
- O `Diagnostico.bat` confere as quatro dependências uma a uma, não só o
  `express`. Uma `node_modules` copiada de outro PC ou tirada de um `.zip`
  vem pela metade, e antes isso passava como "componentes instalados"
- A opção [3] mostra estado da tarefa, último código de saída e fim do log
- A opção [2] apaga também o `_servico.cmd`
- Novo `Desinstalar.bat`: tira tudo do servidor — tarefa, firewall, banco,
  backups e a própria pasta

## 1.3.0 — 4 de agosto de 2026

**Importar a escola inteira**

O `Exportado.CSV` do sistema da escola agora entra direto, com as 39 turmas
e os 637 alunos do Maternalzinho ao 5º ano.

- Lê o arquivo em Latin-1, que é como o sistema exporta, sem estragar acento
- Monta o código da turma juntando as colunas CURSO e TURMA
  (`MATERNAL II` + `C` vira `M2C`; `3º ANO / ENSINO FUNDAMENTAL` + `A` vira `3A`)
- Turma que ainda não existia é criada, em vez de o aluno sumir
- Aluno que mudou de turma é movido, levando o histórico de pagamento junto
- Gênero vindo da planilha de boletins é preservado, não apagado
- Quem está no sistema e não veio no arquivo continua ativo e é listado no
  fim; para desativar todos de uma vez, use `--desativar-ausentes`
- Turma que ficou sem nenhum aluno é desativada e volta sozinha depois
- A planilha `.xlsx` do gerador de boletins continua funcionando igual

---

## 1.2.0 — 4 de agosto de 2026

**Ajustes, para a coordenação**

Aba nova no menu, que só a coordenação enxerga.

- **Quem usa o sistema**: cadastrar pessoas, trocar o papel, trocar a senha e
  tirar o acesso de quem saiu da escola
- **Calendário letivo**: criar, editar e apagar unidades, recessos e feriados
- A última coordenação ativa não consegue se rebaixar nem tirar o próprio
  acesso — evita trancar todo mundo do lado de fora
- Trocar a senha de alguém desconecta essa pessoa de todos os PCs

**Editar evento**

Lápis ao lado de cada evento na agenda do mês.

- Muda nome, categoria, datas e valor
- Turma nova entra já com todos os alunos prontos para lançar
- Turma que já tem pagamento não sai do evento sem estorno antes
- Trocar o valor só mexe em quem ainda não pagou, e você escolhe se aplica
- Cancelar evento, desde que não tenha pagamento lançado

**Rodar sem janela aberta**

`Rodar sem janela.bat` (como administrador) registra o sistema no Windows: ele
sobe sozinho quando o PC liga, antes de alguém fazer login, e não fica uma
janela preta que qualquer pessoa possa fechar por engano.

---

## 1.1.0 — 4 de agosto de 2026

**Aluno isento**

Aluno que participa da atividade mas não paga (bolsista, cortesia, combinado
com a direção) agora tem situação própria, em vez de virar pendente eterno.

- Botão **Não paga** no cartão do aluno, com motivo obrigatório
- Filtro **Isentos** na lista da turma
- Isento sai da conta do "falta receber" e não conta como pendente
- Turma fica completa mesmo com isentos, sem cobrança fantasma
- Relatório e planilha mostram a situação e o motivo
- Quem já pagou não pode ser isentado sem estornar antes
- Toda isenção fica no histórico, com nome de quem fez e o motivo

**Atualização sem dor de cabeça**

- O banco se ajusta sozinho ao ligar: colunas novas entram sem apagar nada
- `Atualizar.bat` faz backup, baixa a versão nova e confere antes de liberar
- A versão instalada aparece na janela do servidor e na tela

---

## 1.0.0 — 4 de agosto de 2026

Primeira versão.

- Calendário escolar mês a mês, com unidades, recessos e feriados
- Eventos por categoria, com turmas participantes e valor por aluno
- Lançamento de pagamento por aluno, em Pix, cartão ou dinheiro
- Fechamento de turma, com reabertura pela coordenação
- Relatório para impressão e planilha, com conferência de caixa por meio
- Login por pessoa, com secretaria e coordenação
- Pagamento estornado fica registrado, nunca é apagado
- Importação de turmas, calendário e alunos da planilha de boletins

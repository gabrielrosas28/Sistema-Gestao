# Histórico de versões

O número da versão aparece na janela do servidor e no canto da tela, embaixo
do seu nome. Serve para saber se o servidor já está com a última versão.

Formato `maior.menor.correção`:

- **correção** (1.1.**1**) — conserto de erro, nada muda no uso
- **menor** (1.**2**.0) — recurso novo, o que já existia continua igual
- **maior** (**2**.0.0) — mudança grande, que pede aviso antes

---

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

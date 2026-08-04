# Histórico de versões

O número da versão aparece na janela do servidor e no canto da tela, embaixo
do seu nome. Serve para saber se o servidor já está com a última versão.

Formato `maior.menor.correção`:

- **correção** (1.1.**1**) — conserto de erro, nada muda no uso
- **menor** (1.**2**.0) — recurso novo, o que já existia continua igual
- **maior** (**2**.0.0) — mudança grande, que pede aviso antes

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

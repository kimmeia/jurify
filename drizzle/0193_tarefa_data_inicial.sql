-- Prazo tem duas datas, e só uma estava no banco.
--
-- No escritório, prazo se trabalha com um par: a data em que se começa (ou em
-- que a contagem se inicia) e a data FATAL, que é o limite legal e não se
-- move. `tarefas` só tinha `dataVencimento`, então quem criava tarefa a
-- partir de uma movimentação tinha que escolher qual das duas gravar — e
-- perdia a outra.
--
-- `agendamentos` (onde mora o prazo processual) já tem dataInicio e dataFim,
-- então essa metade não precisa de migration.
--
-- Non-destrutivo: coluna nova com DEFAULT NULL. Tarefa antiga fica sem data
-- inicial e continua se comportando como hoje — `dataVencimento` segue sendo
-- a data fatal.

ALTER TABLE tarefas
  ADD COLUMN dataInicial TIMESTAMP NULL DEFAULT NULL;

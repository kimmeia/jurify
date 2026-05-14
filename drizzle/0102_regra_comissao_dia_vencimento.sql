-- Configura o dia de vencimento da despesa automática gerada após
-- fechar comissão. Antes era hardcoded "dia 5 do mês seguinte" em
-- `calcularVencimentoComissao` (db-comissoes.ts). Escritórios que
-- pagam comissão em outros dias (10, 15, 25) não tinham opção e
-- precisavam editar manualmente cada despesa criada.
--
-- Default 5 preserva comportamento atual — após a migration, todos
-- os escritórios continuam com vencimento dia 5 até alterarem.
-- Clamp pra último dia do mês fica no app (ex: dia 31 em fevereiro
-- vira 28/29).
--
-- Idempotente: ADD COLUMN com IF NOT EXISTS é absorvido pelo
-- auto-migrate como "duplicate column" (erro inofensivo).

ALTER TABLE regra_comissao
  ADD COLUMN diaVencimentoDespesaRegraCom INT NOT NULL DEFAULT 5;

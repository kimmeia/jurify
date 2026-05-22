-- Reconciliação mensal de cobranças "fantasmas" — locais com status
-- PENDING/OVERDUE que foram apagadas no Asaas e o webhook PAYMENT_DELETED
-- não chegou (downtime, perda de evento, conta sem webhook configurado).
-- Cron mensal compara IDs locais contra um sweep do Asaas e remove os
-- que sumiram. Esta coluna registra quando rodou pra evitar rerun antes
-- de 30 dias.

ALTER TABLE asaas_config
  ADD COLUMN ultimaReconciliacaoFantasmasEm DATETIME NULL DEFAULT NULL
  AFTER historicoSyncErroMensagem;

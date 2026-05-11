-- Migration 0092: marca de cortesia em subscriptions (clientes piloto, isenções
-- manuais concedidas pelo admin do Jurify).
--
-- Sem cortesia, dar acesso grátis a um piloto exige criar um row "fake" no
-- Asaas, mexer no status pra ficar 'active', e o painel fica com a info
-- inconsistente (parece pago mas é grátis). Pior: se o cron de status sync
-- rodar, pode reverter.
--
-- Cortesia é uma flag declarativa que TODA checagem de acesso lê ANTES de
-- olhar o status do Asaas:
--   if (sub.cortesia && cortesiaAindaValida(sub)) → liberar acesso
--
-- Campos:
--  - cortesia: flag liga/desliga
--  - cortesiaMotivo: por quê? (auditável, exibido na UI)
--  - cortesiaExpiraEm: NULL = não expira, ou epoch ms pra cortesia temporária
--
-- Concessão/remoção registradas em auditoria_acoes via registrarAuditoria
-- — quem fez, quando, motivo.

ALTER TABLE subscriptions
  ADD COLUMN cortesia BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN cortesiaMotivo VARCHAR(500) NULL DEFAULT NULL,
  ADD COLUMN cortesiaExpiraEm BIGINT NULL DEFAULT NULL;

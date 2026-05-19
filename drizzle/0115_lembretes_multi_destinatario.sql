-- 0115_lembretes_multi_destinatario.sql
-- Lembretes pré-evento com múltiplos destinatários e canais.
-- Schema antigo `agendamento_lembretes` tinha 1 destinatário implícito (o
-- responsável do agendamento) e 1 canal. Agora cada lembrete pode disparar
-- pra N colaboradores em N canais distintos.
--
-- Decisões:
-- - `destinatarioIds` JSON array — mais simples que tabela N:N pra um caso
--   onde a cardinalidade típica é 1-3 destinatários por lembrete
-- - `canais` JSON array — combinação livre de [notificacao_app, email, whatsapp]
-- - `dispararEm` TIMESTAMP — calculado uma vez na criação (dataInicio do agendamento
--   menos `minutosAntes`). Cron usa esse campo indexado pra varrer pendentes
--   sem JOIN. Se o agendamento mudar de data, o app recalcula e atualiza.
-- - Mantém colunas antigas (tipo, minutosAntes, enviado, enviadoAt) pra retrocompat
--
-- Migration non-destrutiva: ADD COLUMN com defaults seguros.

ALTER TABLE `agendamento_lembretes`
  ADD COLUMN `destinatarioIds` JSON DEFAULT NULL COMMENT 'Array de colaborador.id que recebem o lembrete (null = só responsável do agendamento, legado)',
  ADD COLUMN `canais` JSON DEFAULT NULL COMMENT 'Array de canais [notificacao_app, email, whatsapp]. Null cai no tipo legado',
  ADD COLUMN `dispararEm` TIMESTAMP NULL DEFAULT NULL COMMENT 'Momento exato em que o cron deve disparar (dataInicio - minutosAntes). Calculado na criação.';

-- Index pra cron varrer rapidamente os pendentes
CREATE INDEX `idx_lembretes_disparo`
  ON `agendamento_lembretes`(`dispararEm`, `enviado`);

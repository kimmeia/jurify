-- Marco de leitura da conversa pelo atendente. Alimenta o contador
-- `naoLidas` da lista do Atendimento (badge, negrito e fundo destacado)
-- — o campo sempre existiu no contrato ConversaInfo mas nunca era
-- calculado no servidor. NULL = atendente nunca abriu a conversa
-- (todas as mensagens de entrada contam como não lidas).

ALTER TABLE `conversas`
  ADD COLUMN `lidaPeloAtendenteEm` TIMESTAMP NULL DEFAULT NULL;

-- Backfill: conversas existentes começam como "lidas agora". Sem isso,
-- o primeiro deploy acorda com TODA a lista destacada (histórico inteiro
-- de entradas contando como não lido). Só mensagens novas destacam.
UPDATE `conversas` SET `lidaPeloAtendenteEm` = NOW() WHERE `lidaPeloAtendenteEm` IS NULL;

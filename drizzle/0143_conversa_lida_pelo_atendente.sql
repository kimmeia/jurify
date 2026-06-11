-- Marco de leitura da conversa pelo atendente. Alimenta o contador
-- `naoLidas` da lista do Atendimento (badge, negrito e fundo destacado)
-- — o campo sempre existiu no contrato ConversaInfo mas nunca era
-- calculado no servidor. NULL = atendente nunca abriu a conversa
-- (todas as mensagens de entrada contam como não lidas).

ALTER TABLE `conversas`
  ADD COLUMN `lidaPeloAtendenteEm` TIMESTAMP NULL DEFAULT NULL;

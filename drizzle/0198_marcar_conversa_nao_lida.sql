-- "Marcar como não lida" do Atendimento: marcação manual que devolve a
-- conversa pro radar do inbox sem depender de mensagem nova. Na lista ela
-- ganha o destaque de não lida com bolinha sem número — o contador numérico
-- continua vindo de lidaPeloAtendenteEm × mensagens de entrada. Abrir a
-- conversa limpa a marcação (junto com o carimbo de leitura).
--
-- Non-destrutivo: coluna nova com DEFAULT NULL — conversa antiga fica sem
-- marcação e nada muda pra ela.

ALTER TABLE conversas
  ADD COLUMN marcadaNaoLidaEmConv TIMESTAMP NULL DEFAULT NULL;

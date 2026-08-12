-- A conversa do JurisIA passa a lembrar o caso que estava aberto.
--
-- Antes o caso vivia só no estado da tela do redator: reabrir a conversa no dia
-- seguinte trazia o texto e perdia o processo, e a próxima pergunta era
-- respondida sem os autos. Duas colunas anuláveis — conversa de pesquisa livre
-- continua com NULL nas duas, que é o que toda linha antiga já é.

ALTER TABLE jurisia_conversas
  ADD COLUMN contatoIdJurisConv INT NULL DEFAULT NULL,
  ADD COLUMN processoIdJurisConv INT NULL DEFAULT NULL;

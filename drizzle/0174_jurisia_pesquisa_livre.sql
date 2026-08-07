-- Conversa do JurisIA deixa de exigir processo.
--
-- Pesquisa jurisprudencial nasce sem processo nenhum: o advogado pergunta
-- "como o TJCE vem decidindo revisional bancária" sem ter caso aberto. O
-- índice único (escritorioId, monitoramentoId) continua valendo — MySQL trata
-- NULL como distinto no UNIQUE, então várias pesquisas livres convivem com a
-- conversa única de cada processo.
ALTER TABLE jurisia_conversas MODIFY COLUMN monitoramentoIdJurisConv INT NULL;

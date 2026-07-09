-- Cache do nome do pagador (customer Asaas) direto na cobrança.
--
-- A tela "Revisar cobranças sem cliente" buscava o nome no Asaas a cada
-- abertura, EM PARALELO, o que estourava o rate limit e deixava quase tudo como
-- "(pagador desconhecido)". Com esta coluna o nome é buscado 1x (sequencial,
-- rate-safe) e GUARDADO — as próximas aberturas leem do banco, instantâneo, e
-- não gastam cota. Non-destrutivo: default NULL (cobranças antigas preenchem
-- sob demanda quando a revisão abre).
ALTER TABLE asaas_cobrancas ADD COLUMN nomePagadorAsaasCob VARCHAR(255) DEFAULT NULL;

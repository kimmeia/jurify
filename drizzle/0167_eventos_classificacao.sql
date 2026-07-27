-- Classificação IA das movimentações (feed de Processos).
--
-- Além do resumo em 1 frase, a IA passa a classificar cada movimentação em
-- duas dimensões — pra o advogado priorizar de relance:
--   desfecho    = favoravel|desfavoravel|parcial|neutro (só em DECISÕES; NULL
--                 quando não é decisão de mérito). Avaliado do ponto de vista
--                 do NOSSO cliente.
--   relevancia  = relevante|rotina (rotina = mero expediente: conclusos,
--                 juntada, distribuído...). NULL = ainda não classificado.
-- A 3ª dimensão ("requer prazo") não vira coluna aqui — já vem de
-- prazos_sugeridos (ligado por evento_id). Non-destrutivo: NULL cobre as
-- movimentações antigas (ficam sem selo até serem reclassificadas).
ALTER TABLE eventos_processo ADD COLUMN desfechoEvento ENUM('favoravel','desfavoravel','parcial','neutro') DEFAULT NULL;
ALTER TABLE eventos_processo ADD COLUMN relevanciaEvento ENUM('relevante','rotina') DEFAULT NULL;

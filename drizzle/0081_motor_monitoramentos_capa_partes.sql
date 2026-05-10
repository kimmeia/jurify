-- Migration 0081: persiste capa e partes do processo no monitoramento
--
-- Por que existe: o scraper TJCE retorna capa (classe, vara, juiz,
-- valor da causa, distribuição) e partes (autor/réu/advogados) em todo
-- consultarTjce, mas hoje esses dados são jogados fora — só os 4
-- campos resumidos (ultimaMovimentacaoEm/Texto, hashUltimasMovs) são
-- persistidos. Resultado: ao clicar "Histórico" em /processos, o user
-- paga 1 crédito pra ver dados que somem ao refresh (state in-memory).
--
-- Fix: 2 colunas TEXT pra capturar o JSON inteiro da capa/partes.
-- Cron passa a salvar a cada tick (de graça — a consulta já está
-- sendo feita), e buscarProcessoCompleto sob demanda também salva.
-- Frontend lê do DB ao abrir card; refresh preserva.
--
-- Non-destrutivo: ALTER TABLE ADD COLUMN com default NULL. Linhas
-- antigas continuam válidas (frontend cai no fallback histórico).

ALTER TABLE motor_monitoramentos
  ADD COLUMN capa_json TEXT DEFAULT NULL,
  ADD COLUMN partes_json TEXT DEFAULT NULL;

-- Migration 0107: índices em tabelas hot que estavam sem cobertura
--
-- `eventos_processo` e `motor_monitoramentos` crescem ~linearmente com a
-- atividade dos escritórios. Sem índices, as queries de listagem em
-- /processos passam a fazer full table scan conforme volume sobe.
--
-- Queries cobertas:
--
-- 1. eventos_processo: listar eventos de um CNJ específico ordenados por
--    data (Processos.tsx → consultar histórico do processo)
--      SELECT ... WHERE escritorioId=? AND cnjAfetado=? ORDER BY dataEvento DESC
--    → composite (escritorioId, cnjAfetado, dataEvento DESC)
--
-- 2. motor_monitoramentos: listar monitoramentos do escritório (UI inicial
--    da página /processos, ordenado por createdAt DESC)
--      SELECT ... WHERE escritorioId=? ORDER BY createdAt DESC
--    → composite (escritorioId, createdAt DESC)
--
-- 3. motor_monitoramentos: cron busca os "ativos com poll vencido"
--      SELECT ... WHERE tipoMonitoramento=? AND status='ativo'
--                AND (ultimaConsultaEm IS NULL OR ultimaConsultaEm < ?)
--    → composite (status, ultimaConsultaEm) — Postgres faria
--      partial-index, MySQL não suporta, então índice cobre os 2 estados
--      mas o seletivo é "ativo"
--
-- Tabelas continuam aceitando writes — CREATE INDEX no MySQL é online
-- (algoritmo INPLACE) pra tabelas InnoDB. Sem downtime esperado.

CREATE INDEX idx_eventos_proc_escr_cnj_data
  ON eventos_processo (escritorioId, cnjAfetado, dataEvento);

CREATE INDEX idx_motor_mon_escr_created
  ON motor_monitoramentos (escritorio_id, created_at);

CREATE INDEX idx_motor_mon_status_consulta
  ON motor_monitoramentos (status, ultima_consulta_em);

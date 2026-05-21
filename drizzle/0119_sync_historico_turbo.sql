-- Sync histórico do Asaas pra cobranças: opções de aceleração.
--
-- Default antigo de 60min entre janelas + 1 dia/tick = 3 anos demora 45
-- dias de calendário. Cliente piloto com 3 anos de histórico não termina.
-- Default novo: 10min entre janelas + 1 dia/tick = ~7,5 dias. Operador
-- pode subir dias/tick (até 7) e descer intervalo (até 5min) via UI
-- pra acelerar — desde que o rate guard local não estoure.

ALTER TABLE asaas_config
  MODIFY COLUMN historicoSyncIntervaloMinutos INT NOT NULL DEFAULT 10;

ALTER TABLE asaas_config
  ADD COLUMN historicoSyncDiasPorTick INT NOT NULL DEFAULT 1
  AFTER historicoSyncIntervaloMinutos;

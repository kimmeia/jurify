-- Importação de extrato Asaas em segundo plano (espelho do historicoSync
-- de cobranças): cursor andando do dia mais recente pro mais antigo em
-- janelas de N dias por tick, respeitando a cota de 25k/12h do Asaas.
-- `extratoSyncProximaTentativaEm` implementa o backoff automático quando
-- a cota corta a janela no meio (resultado parcial): o cron pula o
-- escritório até esse horário e retoma sozinho.

ALTER TABLE `asaas_config`
  ADD COLUMN `extratoSyncStatus` ENUM('inativo','agendado','executando','pausado','concluido','erro') NOT NULL DEFAULT 'inativo',
  ADD COLUMN `extratoSyncDe` VARCHAR(10) DEFAULT NULL,
  ADD COLUMN `extratoSyncAte` VARCHAR(10) DEFAULT NULL,
  ADD COLUMN `extratoSyncCursor` VARCHAR(10) DEFAULT NULL,
  ADD COLUMN `extratoSyncTotalDias` INT DEFAULT NULL,
  ADD COLUMN `extratoSyncDiasFeitos` INT NOT NULL DEFAULT 0,
  ADD COLUMN `extratoSyncDespesasImportadas` INT NOT NULL DEFAULT 0,
  ADD COLUMN `extratoSyncDuplicadas` INT NOT NULL DEFAULT 0,
  ADD COLUMN `extratoSyncErros` INT NOT NULL DEFAULT 0,
  ADD COLUMN `extratoSyncIntervaloMinutos` INT NOT NULL DEFAULT 10,
  ADD COLUMN `extratoSyncDiasPorTick` INT NOT NULL DEFAULT 7,
  ADD COLUMN `extratoSyncProximaTentativaEm` TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN `extratoSyncIniciadoEm` TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN `extratoSyncUltimaJanelaEm` TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN `extratoSyncConcluidoEm` TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN `extratoSyncErroMensagem` VARCHAR(512) DEFAULT NULL;

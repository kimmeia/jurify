-- Fase 2: Integrações — Canais e Auditoria
-- Migration: 0013_fase2_canais.sql

CREATE TABLE IF NOT EXISTS `canais_integrados` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `escritorioId` INT NOT NULL,
  `tipoCanal` ENUM('whatsapp_qr','whatsapp_api','instagram','facebook','telefone_voip') NOT NULL,
  `nomeCanal` VARCHAR(128),
  `statusCanal` ENUM('conectado','desconectado','pendente','erro','banido') NOT NULL DEFAULT 'pendente',
  `configEncrypted` TEXT,
  `configIv` VARCHAR(64),
  `configTag` VARCHAR(64),
  `webhookSecret` VARCHAR(128),
  `telefoneCanal` VARCHAR(20),
  `ultimaSyncCanal` TIMESTAMP NULL,
  `mensagemErro` VARCHAR(512),
  `createdAtCanal` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAtCanal` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_canais_escritorio` (`escritorioId`),
  INDEX `idx_canais_tipo` (`tipoCanal`)
);

CREATE TABLE IF NOT EXISTS `integracao_audit_log` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `escritorioIdAudit` INT NOT NULL,
  `colaboradorIdAudit` INT NOT NULL,
  `canalIdAudit` INT,
  `acaoAudit` ENUM('conectou','desconectou','editou_config','testou','erro') NOT NULL,
  `detalhesAudit` TEXT,
  `ipAudit` VARCHAR(45),
  `createdAtAudit` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_audit_escritorio` (`escritorioIdAudit`),
  INDEX `idx_audit_canal` (`canalIdAudit`)
);

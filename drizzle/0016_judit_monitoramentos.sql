-- Monitoramentos criados via Judit.IO pelo admin
-- Cada registro corresponde a um tracking_id ativo na Judit

CREATE TABLE IF NOT EXISTS `judit_monitoramentos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `trackingId` varchar(128) NOT NULL,
  `searchType` varchar(32) NOT NULL,
  `searchKey` varchar(128) NOT NULL,
  `recurrence` int NOT NULL DEFAULT 1,
  `statusJudit` enum('created','updating','updated','paused','deleted') NOT NULL DEFAULT 'created',
  `apelidoJudit` varchar(255),
  `clienteUserId` int,
  `tribunalJudit` varchar(16),
  `nomePartes` varchar(512),
  `ultimaMovJudit` text,
  `ultimaMovDataJudit` varchar(32),
  `totalAtualizacoes` int NOT NULL DEFAULT 0,
  `withAttachments` boolean NOT NULL DEFAULT false,
  `createdAtJuditMon` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAtJuditMon` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `judit_mon_tracking_unique` (`trackingId`),
  KEY `judit_mon_search_key` (`searchKey`),
  KEY `judit_mon_status` (`statusJudit`),
  KEY `judit_mon_cliente` (`clienteUserId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Respostas/atualizações recebidas da Judit (webhook ou polling)
-- Cada registro é um snapshot completo do processo

CREATE TABLE IF NOT EXISTS `judit_respostas` (
  `id` int NOT NULL AUTO_INCREMENT,
  `monitoramentoId` int NOT NULL,
  `responseId` varchar(128),
  `requestIdJudit` varchar(128),
  `responseType` varchar(64) NOT NULL,
  `responseDataJudit` text,
  `cachedResponse` boolean DEFAULT false,
  `stepsCountJudit` int DEFAULT 0,
  `createdAtJuditResp` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `judit_resp_mon` (`monitoramentoId`),
  KEY `judit_resp_created` (`createdAtJuditResp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

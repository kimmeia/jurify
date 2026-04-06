-- Tabela de integrações externas gerenciadas pelo admin
-- Cada provedor tem no máximo 1 registro (UNIQUE em provedor)
-- API key criptografada com AES-256-GCM
-- Status persiste entre sessões — só muda com ação manual do admin

CREATE TABLE IF NOT EXISTS `admin_integracoes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `provedor` varchar(64) NOT NULL,
  `nomeExibicao` varchar(128) NOT NULL,
  `apiKeyEncrypted` text,
  `apiKeyIv` varchar(64),
  `apiKeyTag` varchar(64),
  `statusIntegracao` enum('conectado','desconectado','erro') NOT NULL DEFAULT 'desconectado',
  `ultimoTeste` timestamp NULL,
  `mensagemErro` varchar(512),
  `configJson` text,
  `webhookUrl` varchar(512),
  `webhookSecret` varchar(128),
  `createdAtInteg` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAtInteg` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `admin_integracoes_provedor_unique` (`provedor`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- PWA — Web Push (notificação de nova mensagem/movimentação com o app fechado).
--
-- push_subscriptions: 1 linha por dispositivo/navegador inscrito de um user.
--   endpoint é único (o browser reusa o mesmo por device) → UPSERT por endpoint.
-- web_push_keys: par de chaves VAPID do servidor (gerado 1x se não vier por
--   env). Linha única.

CREATE TABLE IF NOT EXISTS `push_subscriptions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `userId` INT NOT NULL,
  `endpoint` VARCHAR(512) NOT NULL,
  `p256dh` VARCHAR(255) NOT NULL,
  `auth` VARCHAR(255) NOT NULL,
  `userAgent` VARCHAR(255) NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_push_endpoint` (`endpoint`),
  KEY `idx_push_user` (`userId`)
);

CREATE TABLE IF NOT EXISTS `web_push_keys` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `publicKey` TEXT NOT NULL,
  `privateKey` TEXT NOT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- SmartFlow — modelos da plataforma (admin cria → clientes clonam).
--
-- Um modelo é um blueprint (TemplateSmartflow serializado) que o admin
-- publica; aparece na galeria do SmartFlow de cada escritório pra ser
-- clonado (reusa o pipeline criarDeTemplate + wizard já existentes).
-- Modelos NÃO disparam sozinhos — só viram cenário do cliente ao clonar.
CREATE TABLE IF NOT EXISTS `smartflow_templates` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `nomeTpl` VARCHAR(128) NOT NULL,
  `descricaoTpl` VARCHAR(512) NOT NULL DEFAULT '',
  `iconeTpl` VARCHAR(48) NOT NULL DEFAULT 'sparkles',
  `gradienteTpl` VARCHAR(64) NOT NULL DEFAULT 'from-violet-500 to-indigo-500',
  `gatilhoTpl` VARCHAR(48) NOT NULL,
  `configGatilhoTpl` TEXT NULL,
  `passosTpl` TEXT NOT NULL,
  `categoriaTpl` VARCHAR(48) NULL,
  `badgeTpl` VARCHAR(16) NULL,
  `dicaTpl` VARCHAR(512) NULL,
  `disponivelParaClientesTpl` BOOLEAN NOT NULL DEFAULT FALSE,
  `criadoPorTpl` INT NULL,
  `createdAtTpl` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAtTpl` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Rastreabilidade do clone: cenário criado a partir de um modelo aponta
-- pra origem (contagem de clones no admin + futura "atualização do modelo").
ALTER TABLE `smartflow_cenarios`
  ADD COLUMN `origemTemplateIdSF` INT NULL;

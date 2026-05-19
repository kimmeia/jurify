-- 0116_agendamento_contato_anexos.sql
-- Adições à agenda:
--   1. Campo `telefoneContato` no agendamento (string livre — pode ser número,
--      WhatsApp, IM, etc). Útil pra contato direto da reunião sem precisar
--      vincular um contato formal do CRM.
--   2. Tabela `agendamento_anexos` pra anexar PDFs, imagens, docs à reunião —
--      útil pra "preparar antes" e ter à mão no momento. Reusa o upload-route
--      existente (storage em disco /uploads/escritorio_XX) — guarda só metadata
--      (url, nome, mime, tamanho).
--
-- Migration non-destrutiva: ADD COLUMN com default NULL + CREATE TABLE.

ALTER TABLE `agendamentos`
  ADD COLUMN `contatoTelefone` VARCHAR(64) DEFAULT NULL COMMENT 'Telefone/WhatsApp/IM livre pro contato da reunião — não vinculado a contato CRM';

CREATE TABLE IF NOT EXISTS `agendamento_anexos` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `agendamentoId` INT NOT NULL,
  `escritorioId` INT NOT NULL,
  `url` VARCHAR(512) NOT NULL COMMENT 'Path local /uploads/escritorio_X/arquivo — devolvido pelo uploadRouter.enviar',
  `nome` VARCHAR(255) NOT NULL,
  `mimeType` VARCHAR(128) NOT NULL,
  `tamanho` INT NOT NULL DEFAULT 0,
  `uploadedById` INT DEFAULT NULL COMMENT 'colaborador.id que fez o upload',
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_agendamento_anexos_ag` (`agendamentoId`),
  INDEX `idx_agendamento_anexos_esc` (`escritorioId`)
);

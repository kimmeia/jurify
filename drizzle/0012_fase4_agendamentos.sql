-- Fase 4: Agendamento — Compromissos e Lembretes
-- Migration: 0012_fase4_agendamentos.sql

CREATE TABLE IF NOT EXISTS `agendamentos` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `escritorioId` INT NOT NULL,
  `criadoPorId` INT NOT NULL,
  `responsavelId` INT NOT NULL,
  `tipoAgendamento` ENUM('prazo_processual','audiencia','reuniao_comercial','tarefa','follow_up','outro') NOT NULL,
  `titulo` VARCHAR(255) NOT NULL,
  `descricao` TEXT,
  `dataInicio` TIMESTAMP NOT NULL,
  `dataFim` TIMESTAMP NULL,
  `diaInteiro` BOOLEAN NOT NULL DEFAULT FALSE,
  `local` VARCHAR(512),
  `prioridade` ENUM('baixa','normal','alta','critica') NOT NULL DEFAULT 'normal',
  `statusAgendamento` ENUM('pendente','em_andamento','concluido','cancelado','atrasado') NOT NULL DEFAULT 'pendente',
  `processoIdAgend` INT,
  `corHex` VARCHAR(7) NOT NULL DEFAULT '#3b82f6',
  `createdAtAgend` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAtAgend` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_agend_escritorio` (`escritorioId`),
  INDEX `idx_agend_responsavel` (`responsavelId`),
  INDEX `idx_agend_data` (`dataInicio`),
  INDEX `idx_agend_status` (`statusAgendamento`)
);

CREATE TABLE IF NOT EXISTS `agendamento_lembretes` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `agendamentoId` INT NOT NULL,
  `tipoLembrete` ENUM('notificacao_app','email','whatsapp') NOT NULL,
  `minutosAntes` INT NOT NULL,
  `enviado` BOOLEAN NOT NULL DEFAULT FALSE,
  `enviadoAt` TIMESTAMP NULL,
  INDEX `idx_lembretes_agend` (`agendamentoId`)
);

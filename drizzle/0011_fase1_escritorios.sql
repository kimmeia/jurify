-- Fase 1: Fundação — Escritórios, Colaboradores, Convites
-- Migration: 0011_fase1_escritorios.sql

CREATE TABLE IF NOT EXISTS `escritorios` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `nome` VARCHAR(255) NOT NULL,
  `cnpj` VARCHAR(18),
  `telefone` VARCHAR(20),
  `email` VARCHAR(320),
  `endereco` TEXT,
  `logoUrl` VARCHAR(512),
  `fusoHorario` VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo',
  `horarioAbertura` VARCHAR(5) NOT NULL DEFAULT '08:00',
  `horarioFechamento` VARCHAR(5) NOT NULL DEFAULT '18:00',
  `diasFuncionamento` TEXT,
  `mensagemAusencia` TEXT,
  `mensagemBoasVindas` TEXT,
  `ownerId` INT NOT NULL,
  `planoAtendimento` ENUM('basico','intermediario','completo') NOT NULL DEFAULT 'basico',
  `maxColaboradores` INT NOT NULL DEFAULT 1,
  `maxConexoesWhatsapp` INT NOT NULL DEFAULT 0,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_escritorios_owner` (`ownerId`)
);

CREATE TABLE IF NOT EXISTS `colaboradores` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `escritorioId` INT NOT NULL,
  `userId` INT NOT NULL,
  `cargo` ENUM('dono','gestor','atendente','estagiario') NOT NULL,
  `departamento` VARCHAR(64),
  `ativo` BOOLEAN NOT NULL DEFAULT TRUE,
  `maxAtendimentosSimultaneos` INT NOT NULL DEFAULT 5,
  `recebeLeadsAutomaticos` BOOLEAN NOT NULL DEFAULT TRUE,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_colaborador_escritorio_user` (`escritorioId`, `userId`),
  INDEX `idx_colaboradores_user` (`userId`),
  INDEX `idx_colaboradores_escritorio` (`escritorioId`)
);

CREATE TABLE IF NOT EXISTS `convites_colaborador` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `escritorioId` INT NOT NULL,
  `email` VARCHAR(320) NOT NULL,
  `cargoConvite` ENUM('gestor','atendente','estagiario') NOT NULL,
  `departamentoConvite` VARCHAR(64),
  `token` VARCHAR(128) NOT NULL UNIQUE,
  `statusConvite` ENUM('pendente','aceito','expirado','cancelado') NOT NULL DEFAULT 'pendente',
  `convidadoPorId` INT NOT NULL,
  `aceitoPorUserId` INT,
  `expiresAt` TIMESTAMP NOT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_convites_escritorio` (`escritorioId`),
  INDEX `idx_convites_token` (`token`),
  INDEX `idx_convites_email` (`email`)
);

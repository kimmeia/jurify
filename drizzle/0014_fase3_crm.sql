-- Fase 3: CRM — Contatos, Conversas, Mensagens, Leads, Métricas
-- Migration: 0014_fase3_crm.sql

CREATE TABLE IF NOT EXISTS `contatos` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `escritorioIdContato` INT NOT NULL,
  `nomeContato` VARCHAR(255) NOT NULL,
  `telefoneContato` VARCHAR(20),
  `emailContato` VARCHAR(320),
  `cpfCnpj` VARCHAR(18),
  `origemContato` ENUM('whatsapp','instagram','facebook','telefone','manual','site') NOT NULL DEFAULT 'manual',
  `tagsContato` TEXT,
  `observacoesContato` TEXT,
  `responsavelIdContato` INT,
  `createdAtContato` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAtContato` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_contatos_escritorio` (`escritorioIdContato`),
  INDEX `idx_contatos_telefone` (`telefoneContato`),
  INDEX `idx_contatos_responsavel` (`responsavelIdContato`)
);

CREATE TABLE IF NOT EXISTS `conversas` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `escritorioIdConv` INT NOT NULL,
  `contatoIdConv` INT NOT NULL,
  `canalIdConv` INT NOT NULL,
  `atendenteIdConv` INT,
  `statusConv` ENUM('aguardando','em_atendimento','resolvido','fechado') NOT NULL DEFAULT 'aguardando',
  `prioridadeConv` ENUM('baixa','normal','alta','urgente') NOT NULL DEFAULT 'normal',
  `assuntoConv` VARCHAR(255),
  `departamentoConv` VARCHAR(64),
  `chatIdExterno` VARCHAR(128),
  `ultimaMensagemAt` TIMESTAMP NULL,
  `ultimaMensagemPreview` VARCHAR(255),
  `tempoEspera` INT,
  `tempoConclusao` INT,
  `avaliacaoCliente` INT,
  `createdAtConv` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAtConv` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_conversas_escritorio` (`escritorioIdConv`),
  INDEX `idx_conversas_contato` (`contatoIdConv`),
  INDEX `idx_conversas_atendente` (`atendenteIdConv`),
  INDEX `idx_conversas_status` (`statusConv`)
);

CREATE TABLE IF NOT EXISTS `mensagens` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `conversaIdMsg` INT NOT NULL,
  `remetenteIdMsg` INT,
  `direcaoMsg` ENUM('entrada','saida') NOT NULL,
  `tipoMsg` ENUM('texto','imagem','audio','video','documento','localizacao','contato','sticker','sistema') NOT NULL,
  `conteudoMsg` TEXT,
  `mediaUrl` VARCHAR(512),
  `mediaType` VARCHAR(64),
  `statusMsg` ENUM('pendente','enviada','entregue','lida','falha') NOT NULL DEFAULT 'pendente',
  `idExterno` VARCHAR(128),
  `replyToId` INT,
  `createdAtMsg` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_mensagens_conversa` (`conversaIdMsg`),
  INDEX `idx_mensagens_data` (`createdAtMsg`)
);

CREATE TABLE IF NOT EXISTS `leads` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `escritorioIdLead` INT NOT NULL,
  `contatoIdLead` INT NOT NULL,
  `conversaIdLead` INT,
  `responsavelIdLead` INT,
  `etapaFunil` ENUM('novo','qualificado','proposta','negociacao','fechado_ganho','fechado_perdido') NOT NULL DEFAULT 'novo',
  `valorEstimado` VARCHAR(20),
  `origemLead` VARCHAR(128),
  `motivoPerda` VARCHAR(255),
  `probabilidade` INT NOT NULL DEFAULT 50,
  `dataFechPrevisto` VARCHAR(10),
  `observacoesLead` TEXT,
  `createdAtLead` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAtLead` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_leads_escritorio` (`escritorioIdLead`),
  INDEX `idx_leads_responsavel` (`responsavelIdLead`),
  INDEX `idx_leads_etapa` (`etapaFunil`)
);

CREATE TABLE IF NOT EXISTS `atendimento_metricas_diarias` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `escritorioIdMetrica` INT NOT NULL,
  `colaboradorIdMetrica` INT NOT NULL,
  `dataMetrica` VARCHAR(10) NOT NULL,
  `totalAtendimentos` INT NOT NULL DEFAULT 0,
  `tempoMedioResposta` INT NOT NULL DEFAULT 0,
  `tempoMedioConclusao` INT NOT NULL DEFAULT 0,
  `avaliacaoMedia` VARCHAR(10),
  `leadsRecebidos` INT NOT NULL DEFAULT 0,
  `leadsConvertidos` INT NOT NULL DEFAULT 0,
  `mensagensEnviadas` INT NOT NULL DEFAULT 0,
  `mensagensRecebidas` INT NOT NULL DEFAULT 0,
  `createdAtMetrica` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_metrica_dia` (`escritorioIdMetrica`, `colaboradorIdMetrica`, `dataMetrica`),
  INDEX `idx_metricas_escritorio` (`escritorioIdMetrica`)
);

CREATE TABLE `admin_integracoes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`provedor` varchar(64) NOT NULL,
	`nomeExibicao` varchar(128) NOT NULL,
	`apiKeyEncrypted` text,
	`apiKeyIv` varchar(64),
	`apiKeyTag` varchar(64),
	`statusIntegracao` enum('conectado','desconectado','erro') NOT NULL DEFAULT 'desconectado',
	`ultimoTeste` timestamp,
	`mensagemErro` varchar(512),
	`configJson` text,
	`webhookUrl` varchar(512),
	`webhookSecret` varchar(128),
	`createdAtInteg` timestamp NOT NULL DEFAULT (now()),
	`updatedAtInteg` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `admin_integracoes_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_integracoes_provedor_unique` UNIQUE(`provedor`)
);
--> statement-breakpoint
CREATE TABLE `judit_monitoramentos` (
	`id` int AUTO_INCREMENT NOT NULL,
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
	`createdAtJuditMon` timestamp NOT NULL DEFAULT (now()),
	`updatedAtJuditMon` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `judit_monitoramentos_id` PRIMARY KEY(`id`),
	CONSTRAINT `judit_monitoramentos_trackingId_unique` UNIQUE(`trackingId`)
);
--> statement-breakpoint
CREATE TABLE `judit_respostas` (
	`id` int AUTO_INCREMENT NOT NULL,
	`monitoramentoId` int NOT NULL,
	`responseId` varchar(128),
	`requestIdJudit` varchar(128),
	`responseType` varchar(64) NOT NULL,
	`responseDataJudit` text,
	`cachedResponse` boolean DEFAULT false,
	`stepsCountJudit` int DEFAULT 0,
	`createdAtJuditResp` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `judit_respostas_id` PRIMARY KEY(`id`)
);

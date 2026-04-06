CREATE TABLE `movimentacoes_processo` (
	`id` int AUTO_INCREMENT NOT NULL,
	`processoId` int NOT NULL,
	`codigo` int NOT NULL,
	`nome` varchar(512) NOT NULL,
	`dataHora` varchar(32) NOT NULL,
	`complementos` text,
	`lida` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `movimentacoes_processo_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `processos_monitorados` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`numeroCnj` varchar(25) NOT NULL,
	`numeroCnjLimpo` varchar(20) NOT NULL,
	`tribunal` varchar(16) NOT NULL,
	`aliasApi` varchar(64) NOT NULL,
	`classe` varchar(255),
	`assuntos` text,
	`orgaoJulgador` varchar(255),
	`dataAjuizamento` varchar(32),
	`grau` varchar(8),
	`ultimaAtualizacao` varchar(32),
	`totalMovimentacoes` int NOT NULL DEFAULT 0,
	`ultimaMovimentacao` varchar(512),
	`ultimaMovimentacaoData` varchar(32),
	`status` enum('ativo','pausado','arquivado') NOT NULL DEFAULT 'ativo',
	`apelido` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `processos_monitorados_id` PRIMARY KEY(`id`)
);

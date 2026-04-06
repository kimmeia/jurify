CREATE TABLE `notificacoes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`titulo` varchar(255) NOT NULL,
	`mensagem` text NOT NULL,
	`tipoNotif` enum('movimentacao','sistema','plano') NOT NULL DEFAULT 'sistema',
	`processoId` int,
	`lida` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notificacoes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `oabs_advogado` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`numero` varchar(20) NOT NULL,
	`uf` varchar(2) NOT NULL,
	`tipo` enum('principal','suplementar') NOT NULL DEFAULT 'principal',
	`nomeTitular` varchar(255) NOT NULL,
	`cadastradaPorAdmin` boolean NOT NULL DEFAULT false,
	`statusOab` enum('ativa','suspensa','cancelada') NOT NULL DEFAULT 'ativa',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `oabs_advogado_id` PRIMARY KEY(`id`)
);

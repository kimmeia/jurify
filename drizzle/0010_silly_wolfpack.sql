CREATE TABLE `colaboradores` (
	`id` int AUTO_INCREMENT NOT NULL,
	`escritorioId` int NOT NULL,
	`userId` int NOT NULL,
	`cargo` enum('dono','gestor','atendente','estagiario') NOT NULL,
	`departamento` varchar(64),
	`ativo` boolean NOT NULL DEFAULT true,
	`maxAtendimentosSimultaneos` int NOT NULL DEFAULT 5,
	`recebeLeadsAutomaticos` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `colaboradores_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `convites_colaborador` (
	`id` int AUTO_INCREMENT NOT NULL,
	`escritorioId` int NOT NULL,
	`email` varchar(320) NOT NULL,
	`cargoConvite` enum('gestor','atendente','estagiario') NOT NULL,
	`departamentoConvite` varchar(64),
	`token` varchar(128) NOT NULL,
	`statusConvite` enum('pendente','aceito','expirado','cancelado') NOT NULL DEFAULT 'pendente',
	`convidadoPorId` int NOT NULL,
	`aceitoPorUserId` int,
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `convites_colaborador_id` PRIMARY KEY(`id`),
	CONSTRAINT `convites_colaborador_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `escritorios` (
	`id` int AUTO_INCREMENT NOT NULL,
	`nome` varchar(255) NOT NULL,
	`cnpj` varchar(18),
	`telefone` varchar(20),
	`email` varchar(320),
	`endereco` text,
	`logoUrl` varchar(512),
	`fusoHorario` varchar(64) NOT NULL DEFAULT 'America/Sao_Paulo',
	`horarioAbertura` varchar(5) NOT NULL DEFAULT '08:00',
	`horarioFechamento` varchar(5) NOT NULL DEFAULT '18:00',
	`diasFuncionamento` text,
	`mensagemAusencia` text,
	`mensagemBoasVindas` text,
	`ownerId` int NOT NULL,
	`planoAtendimento` enum('basico','intermediario','completo') NOT NULL DEFAULT 'basico',
	`maxColaboradores` int NOT NULL DEFAULT 1,
	`maxConexoesWhatsapp` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `escritorios_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `processos_monitorados` ADD `fonte` enum('DATAJUD','TRIBUNAL_DIRETO') DEFAULT 'DATAJUD' NOT NULL;
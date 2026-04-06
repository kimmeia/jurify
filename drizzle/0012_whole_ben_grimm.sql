CREATE TABLE `agentes_ia` (
	`id` int AUTO_INCREMENT NOT NULL,
	`escritorioId` int NOT NULL,
	`nome` varchar(128) NOT NULL,
	`descricao` varchar(512),
	`modelo` varchar(64) NOT NULL DEFAULT 'gpt-4o-mini',
	`prompt` text NOT NULL,
	`ativo` boolean NOT NULL DEFAULT false,
	`canalId` int,
	`openaiApiKey` text,
	`apiKeyIv` varchar(64),
	`apiKeyTag` varchar(64),
	`maxTokens` int NOT NULL DEFAULT 500,
	`temperatura` varchar(10) NOT NULL DEFAULT '0.70',
	`createdAtAgente` timestamp NOT NULL DEFAULT (now()),
	`updatedAtAgente` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `agentes_ia_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `assinaturas_digitais` (
	`id` int AUTO_INCREMENT NOT NULL,
	`escritorioId` int NOT NULL,
	`contatoId` int NOT NULL,
	`titulo` varchar(255) NOT NULL,
	`descricao` varchar(512),
	`statusAssinatura` enum('pendente','enviado','visualizado','assinado','recusado','expirado') NOT NULL DEFAULT 'pendente',
	`documentoUrl` text,
	`documentoAssinadoUrl` text,
	`assinantNome` varchar(255),
	`assinantEmail` varchar(320),
	`assinantTelefone` varchar(20),
	`tokenAssinatura` varchar(128),
	`enviadoPor` int,
	`enviadoAt` timestamp,
	`visualizadoAt` timestamp,
	`assinadoAt` timestamp,
	`ipAssinatura` varchar(45),
	`expiracaoAt` timestamp,
	`createdAtAssinatura` timestamp NOT NULL DEFAULT (now()),
	`updatedAtAssinatura` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `assinaturas_digitais_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `cargos_personalizados` (
	`id` int AUTO_INCREMENT NOT NULL,
	`escritorioId` int NOT NULL,
	`nome` varchar(64) NOT NULL,
	`descricao` varchar(255),
	`cor` varchar(20) DEFAULT '#6366f1',
	`isDefault` boolean NOT NULL DEFAULT false,
	`createdAtCargo` timestamp NOT NULL DEFAULT (now()),
	`updatedAtCargo` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `cargos_personalizados_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `cliente_anotacoes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`escritorioId` int NOT NULL,
	`contatoId` int NOT NULL,
	`titulo` varchar(255),
	`conteudo` text NOT NULL,
	`criadoPor` int,
	`createdAtAnotacao` timestamp NOT NULL DEFAULT (now()),
	`updatedAtAnotacao` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `cliente_anotacoes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `cliente_arquivos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`escritorioId` int NOT NULL,
	`contatoId` int NOT NULL,
	`nome` varchar(255) NOT NULL,
	`tipo` varchar(64),
	`tamanho` int,
	`url` text NOT NULL,
	`uploadPor` int,
	`createdAtArquivo` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cliente_arquivos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `permissoes_cargo` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cargoId` int NOT NULL,
	`modulo` varchar(32) NOT NULL,
	`ver_todos` boolean NOT NULL DEFAULT false,
	`ver_proprios` boolean NOT NULL DEFAULT false,
	`criar` boolean NOT NULL DEFAULT false,
	`editar` boolean NOT NULL DEFAULT false,
	`excluir` boolean NOT NULL DEFAULT false,
	CONSTRAINT `permissoes_cargo_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tarefas` (
	`id` int AUTO_INCREMENT NOT NULL,
	`escritorioIdTarefa` int NOT NULL,
	`contatoIdTarefa` int,
	`processoIdTarefa` int,
	`responsavelIdTarefa` int,
	`criadoPorTarefa` int NOT NULL,
	`tituloTarefa` varchar(255) NOT NULL,
	`descricaoTarefa` text,
	`statusTarefa` enum('pendente','em_andamento','concluida','cancelada') NOT NULL DEFAULT 'pendente',
	`prioridadeTarefa` enum('baixa','normal','alta','urgente') NOT NULL DEFAULT 'normal',
	`dataVencimento` timestamp,
	`concluidaAt` timestamp,
	`createdAtTarefa` timestamp NOT NULL DEFAULT (now()),
	`updatedAtTarefa` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tarefas_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `colaboradores` ADD `ultimaAtividade` timestamp;--> statement-breakpoint
ALTER TABLE `colaboradores` ADD `ultimaDistribuicao` timestamp;--> statement-breakpoint
ALTER TABLE `colaboradores` ADD `cargoPersonalizadoId` int;
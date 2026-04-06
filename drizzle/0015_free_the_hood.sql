CREATE TABLE `mensagem_templates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`escritorioIdTpl` int NOT NULL,
	`tituloTpl` varchar(100) NOT NULL,
	`conteudoTpl` text NOT NULL,
	`categoriaTpl` enum('saudacao','cobranca','agendamento','juridico','encerramento','outro') NOT NULL DEFAULT 'outro',
	`atalhoTpl` varchar(20),
	`criadoPorTpl` int NOT NULL,
	`createdAtTpl` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `mensagem_templates_id` PRIMARY KEY(`id`)
);

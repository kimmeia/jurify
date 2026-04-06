CREATE TABLE `agendamento_lembretes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`agendamentoId` int NOT NULL,
	`tipoLembrete` enum('notificacao_app','email','whatsapp') NOT NULL,
	`minutosAntes` int NOT NULL,
	`enviado` boolean NOT NULL DEFAULT false,
	`enviadoAt` timestamp,
	CONSTRAINT `agendamento_lembretes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `agendamentos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`escritorioId` int NOT NULL,
	`criadoPorId` int NOT NULL,
	`responsavelId` int NOT NULL,
	`tipoAgendamento` enum('prazo_processual','audiencia','reuniao_comercial','tarefa','follow_up','outro') NOT NULL,
	`titulo` varchar(255) NOT NULL,
	`descricao` text,
	`dataInicio` timestamp NOT NULL,
	`dataFim` timestamp,
	`diaInteiro` boolean NOT NULL DEFAULT false,
	`local` varchar(512),
	`prioridade` enum('baixa','normal','alta','critica') NOT NULL DEFAULT 'normal',
	`statusAgendamento` enum('pendente','em_andamento','concluido','cancelado','atrasado') NOT NULL DEFAULT 'pendente',
	`processoIdAgend` int,
	`corHex` varchar(7) NOT NULL DEFAULT '#3b82f6',
	`createdAtAgend` timestamp NOT NULL DEFAULT (now()),
	`updatedAtAgend` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `agendamentos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `atendimento_metricas_diarias` (
	`id` int AUTO_INCREMENT NOT NULL,
	`escritorioIdMetrica` int NOT NULL,
	`colaboradorIdMetrica` int NOT NULL,
	`dataMetrica` varchar(10) NOT NULL,
	`totalAtendimentos` int NOT NULL DEFAULT 0,
	`tempoMedioResposta` int NOT NULL DEFAULT 0,
	`tempoMedioConclusao` int NOT NULL DEFAULT 0,
	`avaliacaoMedia` varchar(10),
	`leadsRecebidos` int NOT NULL DEFAULT 0,
	`leadsConvertidos` int NOT NULL DEFAULT 0,
	`mensagensEnviadas` int NOT NULL DEFAULT 0,
	`mensagensRecebidas` int NOT NULL DEFAULT 0,
	`createdAtMetrica` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `atendimento_metricas_diarias_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `canais_integrados` (
	`id` int AUTO_INCREMENT NOT NULL,
	`escritorioId` int NOT NULL,
	`tipoCanal` enum('whatsapp_qr','whatsapp_api','instagram','facebook','telefone_voip') NOT NULL,
	`nomeCanal` varchar(128),
	`statusCanal` enum('conectado','desconectado','pendente','erro','banido') NOT NULL DEFAULT 'pendente',
	`configEncrypted` text,
	`configIv` varchar(64),
	`configTag` varchar(64),
	`webhookSecret` varchar(128),
	`telefoneCanal` varchar(20),
	`ultimaSyncCanal` timestamp,
	`mensagemErro` varchar(512),
	`createdAtCanal` timestamp NOT NULL DEFAULT (now()),
	`updatedAtCanal` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `canais_integrados_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `contatos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`escritorioIdContato` int NOT NULL,
	`nomeContato` varchar(255) NOT NULL,
	`telefoneContato` varchar(20),
	`emailContato` varchar(320),
	`cpfCnpj` varchar(18),
	`origemContato` enum('whatsapp','instagram','facebook','telefone','manual','site') NOT NULL DEFAULT 'manual',
	`tagsContato` text,
	`observacoesContato` text,
	`responsavelIdContato` int,
	`createdAtContato` timestamp NOT NULL DEFAULT (now()),
	`updatedAtContato` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `contatos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `conversas` (
	`id` int AUTO_INCREMENT NOT NULL,
	`escritorioIdConv` int NOT NULL,
	`contatoIdConv` int NOT NULL,
	`canalIdConv` int NOT NULL,
	`atendenteIdConv` int,
	`statusConv` enum('aguardando','em_atendimento','resolvido','fechado') NOT NULL DEFAULT 'aguardando',
	`prioridadeConv` enum('baixa','normal','alta','urgente') NOT NULL DEFAULT 'normal',
	`assuntoConv` varchar(255),
	`departamentoConv` varchar(64),
	`chatIdExterno` varchar(128),
	`ultimaMensagemAt` timestamp,
	`ultimaMensagemPreview` varchar(255),
	`tempoEspera` int,
	`tempoConclusao` int,
	`avaliacaoCliente` int,
	`createdAtConv` timestamp NOT NULL DEFAULT (now()),
	`updatedAtConv` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `conversas_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `integracao_audit_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`escritorioIdAudit` int NOT NULL,
	`colaboradorIdAudit` int NOT NULL,
	`canalIdAudit` int,
	`acaoAudit` enum('conectou','desconectou','editou_config','testou','erro') NOT NULL,
	`detalhesAudit` text,
	`ipAudit` varchar(45),
	`createdAtAudit` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `integracao_audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `leads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`escritorioIdLead` int NOT NULL,
	`contatoIdLead` int NOT NULL,
	`conversaIdLead` int,
	`responsavelIdLead` int,
	`etapaFunil` enum('novo','qualificado','proposta','negociacao','fechado_ganho','fechado_perdido') NOT NULL DEFAULT 'novo',
	`valorEstimado` varchar(20),
	`origemLead` varchar(128),
	`motivoPerda` varchar(255),
	`probabilidade` int NOT NULL DEFAULT 50,
	`dataFechPrevisto` varchar(10),
	`observacoesLead` text,
	`createdAtLead` timestamp NOT NULL DEFAULT (now()),
	`updatedAtLead` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `leads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `mensagens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`conversaIdMsg` int NOT NULL,
	`remetenteIdMsg` int,
	`direcaoMsg` enum('entrada','saida') NOT NULL,
	`tipoMsg` enum('texto','imagem','audio','video','documento','localizacao','contato','sticker','sistema') NOT NULL,
	`conteudoMsg` text,
	`mediaUrl` varchar(512),
	`mediaType` varchar(64),
	`statusMsg` enum('pendente','enviada','entregue','lida','falha') NOT NULL DEFAULT 'pendente',
	`idExterno` varchar(128),
	`replyToId` int,
	`createdAtMsg` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `mensagens_id` PRIMARY KEY(`id`)
);

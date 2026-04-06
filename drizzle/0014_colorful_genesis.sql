CREATE TABLE `asaas_clientes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`escritorioIdAsaasCli` int NOT NULL,
	`contatoIdAsaas` int NOT NULL,
	`asaasCustomerId` varchar(64) NOT NULL,
	`cpfCnpjAsaas` varchar(18) NOT NULL,
	`nomeAsaasCli` varchar(255),
	`sincronizadoEmAsaas` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `asaas_clientes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `asaas_cobrancas` (
	`id` int AUTO_INCREMENT NOT NULL,
	`escritorioIdAsaasCob` int NOT NULL,
	`contatoIdAsaasCob` int,
	`asaasPaymentId` varchar(64) NOT NULL,
	`asaasCustomerIdCob` varchar(64) NOT NULL,
	`valorAsaas` varchar(20) NOT NULL,
	`valorLiquidoAsaas` varchar(20),
	`vencimentoAsaas` varchar(10) NOT NULL,
	`formaPagAsaas` enum('BOLETO','CREDIT_CARD','PIX','UNDEFINED') NOT NULL,
	`statusAsaasCob` varchar(64) NOT NULL,
	`descricaoAsaas` varchar(512),
	`invoiceUrlAsaas` text,
	`bankSlipUrlAsaas` text,
	`pixQrCodePayload` text,
	`dataPagamentoAsaas` varchar(10),
	`externalRefAsaas` varchar(255),
	`createdAtAsaasCob` timestamp NOT NULL DEFAULT (now()),
	`updatedAtAsaasCob` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `asaas_cobrancas_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `asaas_config` (
	`id` int AUTO_INCREMENT NOT NULL,
	`escritorioIdAsaas` int NOT NULL,
	`apiKeyEncryptedAsaas` text,
	`apiKeyIvAsaas` varchar(64),
	`apiKeyTagAsaas` varchar(64),
	`modoAsaas` enum('sandbox','producao') NOT NULL DEFAULT 'producao',
	`statusAsaas` enum('conectado','desconectado','erro') NOT NULL DEFAULT 'desconectado',
	`webhookTokenAsaas` varchar(128),
	`ultimoTesteAsaas` timestamp,
	`mensagemErroAsaas` varchar(512),
	`saldoAsaas` varchar(32),
	`createdAtAsaasConfig` timestamp NOT NULL DEFAULT (now()),
	`updatedAtAsaasConfig` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `asaas_config_id` PRIMARY KEY(`id`),
	CONSTRAINT `asaas_config_escritorioIdAsaas_unique` UNIQUE(`escritorioIdAsaas`)
);

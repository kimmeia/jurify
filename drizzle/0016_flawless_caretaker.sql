CREATE TABLE `judit_creditos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`escritorioIdJCred` int NOT NULL,
	`saldoJCred` int NOT NULL DEFAULT 0,
	`totalCompradoJCred` int NOT NULL DEFAULT 0,
	`totalConsumidoJCred` int NOT NULL DEFAULT 0,
	`updatedAtJCred` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `judit_creditos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `judit_transacoes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`escritorioIdJTx` int NOT NULL,
	`tipoJTx` enum('compra','consumo','bonus','estorno') NOT NULL,
	`quantidadeJTx` int NOT NULL,
	`saldoAnteriorJTx` int NOT NULL,
	`saldoDepoisJTx` int NOT NULL,
	`operacaoJTx` varchar(64) NOT NULL,
	`detalhesJTx` varchar(512),
	`userIdJTx` int NOT NULL,
	`createdAtJTx` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `judit_transacoes_id` PRIMARY KEY(`id`)
);

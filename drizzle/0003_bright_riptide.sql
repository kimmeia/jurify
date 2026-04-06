CREATE TABLE `taxas_medias_bacen` (
	`id` int AUTO_INCREMENT NOT NULL,
	`modalidade` varchar(64) NOT NULL,
	`codigoSgs` int NOT NULL,
	`data` varchar(10) NOT NULL,
	`taxaMensal` varchar(20) NOT NULL,
	`taxaAnual` varchar(20),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `taxas_medias_bacen_id` PRIMARY KEY(`id`)
);

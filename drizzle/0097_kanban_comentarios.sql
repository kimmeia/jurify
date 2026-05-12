CREATE TABLE `kanban_comentarios` (
  `id` int AUTO_INCREMENT NOT NULL,
  `cardIdKCom` int NOT NULL,
  `autorIdKCom` int NOT NULL,
  `textoKCom` text NOT NULL,
  `createdAtKCom` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `kanban_comentarios_id` PRIMARY KEY(`id`)
);

CREATE INDEX `kc_card_idx` ON `kanban_comentarios` (`cardIdKCom`);

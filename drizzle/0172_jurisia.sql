-- Módulo JurisIA (beta) — memória por caso e controle de uso.
--
-- `jurisia_conversas` é o "caso com memória": uma linha por processo por
-- escritório, criada na primeira pergunta. Nada de o advogado precisar criar
-- caso e subir documento — o processo já está no banco.
--
-- Todas as tabelas carregam escritorioId porque o JurisIA nasce multi-tenant:
-- retrofitar isolamento depois é como vazamento de acervo entre escritórios
-- costuma acontecer.

CREATE TABLE IF NOT EXISTS `jurisia_conversas` (
  `id` int AUTO_INCREMENT NOT NULL,
  `escritorioIdJurisConv` int NOT NULL,
  `monitoramentoIdJurisConv` int NOT NULL,
  `tituloJurisConv` varchar(200) DEFAULT NULL,
  `criadoPorJurisConv` int DEFAULT NULL,
  `ultimaMensagemAtJurisConv` timestamp NULL DEFAULT NULL,
  `createdAtJurisConv` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `jurisia_conversas_id` PRIMARY KEY(`id`),
  CONSTRAINT `jurisia_conv_unica` UNIQUE(`escritorioIdJurisConv`,`monitoramentoIdJurisConv`)
);

CREATE INDEX `idx_juris_conv_esc` ON `jurisia_conversas` (`escritorioIdJurisConv`,`ultimaMensagemAtJurisConv`);

CREATE TABLE IF NOT EXISTS `jurisia_mensagens` (
  `id` int AUTO_INCREMENT NOT NULL,
  `conversaIdJurisMsg` int NOT NULL,
  `escritorioIdJurisMsg` int NOT NULL,
  `papelJurisMsg` enum('usuario','assistente') NOT NULL,
  `conteudoJurisMsg` text NOT NULL,
  -- Resposta validada (afirmações + fontes). NULL nas mensagens do usuário.
  `respostaJsonJurisMsg` text DEFAULT NULL,
  -- Motivo da recusa quando a trava barrou a resposta do modelo. Fica gravado
  -- de propósito: recusa que some é recusa que ninguém audita.
  `recusaJurisMsg` varchar(255) DEFAULT NULL,
  `autorIdJurisMsg` int DEFAULT NULL,
  `createdAtJurisMsg` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `jurisia_mensagens_id` PRIMARY KEY(`id`)
);

CREATE INDEX `idx_juris_msg_conversa` ON `jurisia_mensagens` (`conversaIdJurisMsg`,`id`);

-- Uso mensal por escritório — é o que o limite do plano consulta.
CREATE TABLE IF NOT EXISTS `jurisia_uso` (
  `id` int AUTO_INCREMENT NOT NULL,
  `escritorioIdJurisUso` int NOT NULL,
  -- 'YYYY-MM' no fuso do escritório.
  `competenciaJurisUso` varchar(7) NOT NULL,
  `mensagensJurisUso` int NOT NULL DEFAULT 0,
  `atualizadoEmJurisUso` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `jurisia_uso_id` PRIMARY KEY(`id`),
  CONSTRAINT `jurisia_uso_unico` UNIQUE(`escritorioIdJurisUso`,`competenciaJurisUso`)
);

-- Limite do plano. Default 0 = módulo desligado, que é o certo pra quem não
-- contratou; os planos que vendem JurisIA recebem o valor no seed.
ALTER TABLE `planos` ADD COLUMN `jurisia_mensagens_mes` int NOT NULL DEFAULT 0;

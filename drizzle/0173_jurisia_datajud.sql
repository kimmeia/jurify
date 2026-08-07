-- Acervo público do DataJud (API Pública do CNJ).
--
-- Diferente das tabelas de conversa, estas NÃO têm escritorioId: são dados
-- públicos do CNJ, iguais para todos os escritórios. Misturar os dois mundos
-- é o erro que faria acervo de um escritório vazar como se fosse estatística
-- nacional.

CREATE TABLE IF NOT EXISTS `jurisia_processos` (
  `id` int AUTO_INCREMENT NOT NULL,
  `cnjJurisProc` varchar(20) NOT NULL,
  `tribunalJurisProc` varchar(16) NOT NULL,
  `grauJurisProc` varchar(8) DEFAULT NULL,
  `classeCodigoJurisProc` int DEFAULT NULL,
  `classeNomeJurisProc` varchar(255) DEFAULT NULL,
  `assuntoCodigoJurisProc` int DEFAULT NULL,
  `assuntoNomeJurisProc` varchar(255) DEFAULT NULL,
  `orgaoCodigoJurisProc` int DEFAULT NULL,
  `orgaoNomeJurisProc` varchar(255) DEFAULT NULL,
  `ajuizamentoEmJurisProc` timestamp NULL DEFAULT NULL,
  `atualizadoEmJurisProc` timestamp NULL DEFAULT NULL,
  -- Deduzido dos movimentos. NULL = ainda não terminou (ou não deu pra dizer).
  `resultadoJurisProc` enum('procedente','parcial','improcedente','acordo','extinto_sem_merito') DEFAULT NULL,
  `resultadoEmJurisProc` timestamp NULL DEFAULT NULL,
  -- O nome do movimento que gerou a classificação — é o que se confere
  -- quando a estatística sai estranha.
  `resultadoMovimentoJurisProc` varchar(255) DEFAULT NULL,
  `sincronizadoEmJurisProc` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `jurisia_processos_id` PRIMARY KEY(`id`),
  CONSTRAINT `jurisia_proc_cnj` UNIQUE(`cnjJurisProc`)
);

-- Índice do jeito que a pergunta é feita: "revisional (classe+assunto) nessa
-- vara costuma dar quanto".
CREATE INDEX `idx_juris_proc_recorte` ON `jurisia_processos`
  (`tribunalJurisProc`,`classeCodigoJurisProc`,`assuntoCodigoJurisProc`,`resultadoJurisProc`);

CREATE TABLE IF NOT EXISTS `jurisia_movimentos` (
  `id` int AUTO_INCREMENT NOT NULL,
  `processoIdJurisMov` int NOT NULL,
  `codigoJurisMov` int DEFAULT NULL,
  `nomeJurisMov` varchar(255) NOT NULL,
  `dataHoraJurisMov` timestamp NOT NULL,
  CONSTRAINT `jurisia_movimentos_id` PRIMARY KEY(`id`)
);

CREATE INDEX `idx_juris_mov_proc` ON `jurisia_movimentos` (`processoIdJurisMov`,`dataHoraJurisMov`);

-- Estado da varredura por tribunal. O cursor é o `search_after` do
-- Elasticsearch: paginar o índice é ordens de magnitude mais barato do que
-- adivinhar número CNJ e testar se existe.
CREATE TABLE IF NOT EXISTS `jurisia_varredura` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tribunalJurisVarr` varchar(16) NOT NULL,
  `cursorJurisVarr` text DEFAULT NULL,
  `statusJurisVarr` enum('fila','rodando','completo','erro') NOT NULL DEFAULT 'fila',
  `processosJurisVarr` int NOT NULL DEFAULT 0,
  `sigilososJurisVarr` int NOT NULL DEFAULT 0,
  `ultimoErroJurisVarr` varchar(500) DEFAULT NULL,
  `ultimaExecucaoJurisVarr` timestamp NULL DEFAULT NULL,
  CONSTRAINT `jurisia_varredura_id` PRIMARY KEY(`id`),
  CONSTRAINT `jurisia_varr_tribunal` UNIQUE(`tribunalJurisVarr`)
);

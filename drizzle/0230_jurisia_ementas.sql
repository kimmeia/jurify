-- Jurisprudência de verdade: a ementa, e o estado de cada fonte oficial.
--
-- O acervo que existia (jurisia_processos, do DataJud) traz classe, vara e
-- movimento — e NENHUMA linha de texto de decisão. Por isso a JurisIA sabia
-- dizer como os processos terminam e não sabia citar precedente: faltava a
-- matéria-prima, não o ajuste. Ementa é acórdão publicado, é pública por
-- desenho e mora nos portais de jurisprudência dos próprios tribunais.
--
-- Duas tabelas, com papéis separados de propósito:
--   `jurisia_ementas`       — o material citável, com o endereço oficial.
--   `jurisia_fontes_coleta` — o estado do robô em cada fonte.
--
-- Sem `escritorioId` nas duas: é dado público, igual para todos os
-- escritórios, como já acontece no acervo do DataJud. Misturar com tabela de
-- escritório é o erro que faria material de um vazar como jurisprudência
-- nacional.
--
-- Sem COLLATE explícito, de propósito: as tabelas vizinhas herdaram o padrão
-- do banco (general_ci) e fixar unicode_ci aqui faz o MySQL recusar comparar a
-- sigla do tribunal com a do acervo — "Illegal mix of collations". É o mesmo
-- tropeço que a migration 0196 já pagou.

CREATE TABLE IF NOT EXISTS `jurisia_ementas` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,

  -- Qual fonte trouxe (`shared/fontes-oficiais.ts`). Guardar a origem é o que
  -- permite apagar e recoletar UMA fonte quando o parser dela mudar, sem
  -- derrubar o acervo inteiro.
  `fonteIdJurisEm` VARCHAR(40) NOT NULL,
  `tribunalJurisEm` VARCHAR(16) NOT NULL,

  -- Como o tribunal chama o julgado ("Apelação Cível 0123456-78.2025.8.06.0001").
  -- É o texto que o advogado copia pra peça, então entra como veio.
  `identificadorJurisEm` VARCHAR(255) NOT NULL,
  `orgaoJurisEm` VARCHAR(180),
  `relatorJurisEm` VARCHAR(180),
  `julgadoEmJurisEm` DATE,

  -- O texto da ementa. FULLTEXT porque busca por SEMELHANÇA sozinha erra o
  -- termo exato ("capitalização" tem que achar capitalização), e busca por
  -- texto sozinha erra o sinônimo. As duas juntas é o que dá precisão.
  `ementaJurisEm` TEXT NOT NULL,

  -- O endereço oficial. Sem ele a citação não se confere, e citação que não
  -- se confere não entra em petição.
  `urlJurisEm` VARCHAR(500) NOT NULL,
  `assuntosJurisEm` VARCHAR(500),

  `coletadoEmJurisEm` TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,

  -- Mesmo acórdão recoletado amanhã não duplica. A chave é fonte+identificador
  -- porque o mesmo processo pode aparecer no portal do TJ e no do STJ, e são
  -- dois julgados diferentes.
  UNIQUE KEY `uq_juris_ementa` (`fonteIdJurisEm`, `identificadorJurisEm`),
  INDEX `idx_juris_ementa_trib` (`tribunalJurisEm`),
  INDEX `idx_juris_ementa_data` (`julgadoEmJurisEm`),
  FULLTEXT INDEX `ft_juris_ementa` (`ementaJurisEm`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `jurisia_fontes_coleta` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `fonteIdJurisFonte` VARCHAR(40) NOT NULL,

  -- Nasce DESLIGADA, e isso é decisão de desenho: ninguém liga um robô contra
  -- o site de um tribunal sem antes sondar se ele responde do nosso servidor.
  -- O cron só coleta o que estiver ligado à mão no painel.
  `ligadaJurisFonte` BOOLEAN NOT NULL DEFAULT FALSE,

  `statusJurisFonte` ENUM('nunca','ok','coletando','erro','bloqueada') NOT NULL DEFAULT 'nunca',
  `ultimaColetaEmJurisFonte` TIMESTAMP NULL,
  `proximaEmJurisFonte` TIMESTAMP NULL,
  `itensJurisFonte` INT NOT NULL DEFAULT 0,
  `ultimoErroJurisFonte` VARCHAR(500),
  `atualizadoEmJurisFonte` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,

  UNIQUE KEY `uq_juris_fonte` (`fonteIdJurisFonte`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

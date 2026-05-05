-- 0046_cobranca_acoes: vínculo N:M entre cobranças e ações (cliente_processos).
--
-- Permite "1 cobrança ativa N ações" (pacote: cobro R$ 3000 que fecha 3
-- ações distintas) e "N cobranças por ação" (parcelamento). Anteriormente
-- o sistema só vinculava cobrança ao cliente; quando o cliente tinha
-- múltiplas ações simultâneas o SmartFlow não conseguia diferenciar
-- qual ação ativava o card no Kanban.
--
-- Idempotente: usa IF NOT EXISTS pra não falhar se a tabela já foi
-- criada por algum push prévio do drizzle-kit.

CREATE TABLE IF NOT EXISTS `cobranca_acoes` (
  `cobrancaIdAc` INT NOT NULL,
  `processoIdAc` INT NOT NULL,
  `createdAtCobAc` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`cobrancaIdAc`, `processoIdAc`),
  INDEX `cob_acoes_cob_idx` (`cobrancaIdAc`),
  INDEX `cob_acoes_proc_idx` (`processoIdAc`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

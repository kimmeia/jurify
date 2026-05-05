-- 0049_hotfix_kanban_processo: corrige migrations 0047 e 0048 que usaram
-- sintaxes não suportadas em MySQL clássico (`ADD COLUMN IF NOT EXISTS`,
-- `CREATE INDEX IF NOT EXISTS`, `DROP INDEX IF EXISTS`).
--
-- Sintomas em produção:
--  • Kanban fica "Carregando..." infinito (Drizzle SELECT inclui
--    processoIdKCard, coluna não existe → query crasha).
--  • SmartFlow falha no passo kanban_criar_card com
--    "Failed query: select id from kanban_cards where ... processoIdKCard".
--  • Idempotência do webhook Asaas perde precisão (acaoIdWhEv não existe,
--    INSERT no asaas_webhook_eventos cai no try/catch genérico).
--
-- Esta migration usa sintaxe clássica MySQL (sem IF NOT EXISTS). O
-- auto-migrate trata "Duplicate column name", "Duplicate key name" e
-- "Can't drop" como `isHarmlessError`, então é seguro rodar em ambientes
-- onde alguma das migrations 0047/0048 chegou a executar parcialmente
-- (ex: MySQL 8.0.29+). Statements duplicados são ignorados.

-- ─── Fix 0047: asaas_webhook_eventos ─────────────────────────────────
ALTER TABLE `asaas_webhook_eventos`
  ADD COLUMN `acaoIdWhEv` INT NOT NULL DEFAULT 0;

-- Drop do índice antigo (sem acaoId). Se não existir, harmless.
ALTER TABLE `asaas_webhook_eventos` DROP INDEX `asaas_wh_ev_uq`;

CREATE UNIQUE INDEX `asaas_wh_ev_uq`
  ON `asaas_webhook_eventos`
  (`escritorioIdWhEv`, `asaasPaymentIdWhEv`, `eventTypeWhEv`, `acaoIdWhEv`);

-- ─── Fix 0048: kanban_cards ──────────────────────────────────────────
ALTER TABLE `kanban_cards` ADD COLUMN `processoIdKCard` INT NULL;

CREATE INDEX `kanban_cards_proc_cli_idx`
  ON `kanban_cards` (`escritorioIdKCard`, `processoIdKCard`, `clienteIdKCard`);

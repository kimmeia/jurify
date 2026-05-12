-- Adiciona valor estimado ao card pra integração Kanban↔Cobrança.
-- Quando o card é movido pra coluna "Ganho/Concluído", o frontend abre modal
-- pré-preenchido com este valor. Sincroniza com cobrança Asaas/manual gerada.
-- NULL = card ainda não tem valor (ok, modal abre com campo vazio).

ALTER TABLE kanban_cards ADD COLUMN valorEstimadoKCard DECIMAL(14,2) NULL;

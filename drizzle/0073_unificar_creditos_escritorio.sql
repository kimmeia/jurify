-- Migration 0073: Unifica créditos do plano + motor próprio em UM saldo
--
-- Antes (legado pós-Sprint-2):
--   - user_credits (por user): cobrava cálculos. creditsTotal/Used.
--   - motor_creditos (por escritório): cobrava processos/monitoramentos.
--
-- Problema: user assina plano profissional (500 cred/mês pra cálculos)
-- mas motor_creditos.saldo = 0 → não consegue consultar processo nem
-- monitorar. Reportado pelo user em 08/05/2026 (Boyadjian).
--
-- Agora (saldo único por escritório):
--   - escritorio_creditos: ÚNICA fonte de cred do escritório
--   - cota_mensal: vem do plano (100/500/∞) e renova mensalmente
--   - saldo: cota_mensal + pacotes pré-pagos comprados - consumido
--   - Cron resetCotaMensalEscritorios libera cota nova a cada 30 dias
--
-- user_credits fica DEPRECATED mas não dropa (preserva histórico).

RENAME TABLE motor_creditos TO escritorio_creditos;
RENAME TABLE motor_transacoes TO escritorio_transacoes;

ALTER TABLE escritorio_creditos
  ADD COLUMN cotaMensal INT NOT NULL DEFAULT 0
    COMMENT 'Créditos do plano que renovam mensalmente (100/500/999999)',
  ADD COLUMN ultimoReset DATETIME NULL
    COMMENT 'Quando rolou o último reset mensal da cota';

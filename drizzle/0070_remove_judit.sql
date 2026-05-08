-- Migration 0070: Remove Judit (08/05/2026)
--
-- Decisão: substituir Judit completamente pelo motor próprio.
-- Sem clientes em produção = momento ideal pra limpar antes do go-live.
--
-- Dropa tabelas Judit-específicas (sem dados úteis ainda) e renomeia
-- judit_creditos/judit_transacoes pra motor_creditos/motor_transacoes
-- (sistema de créditos vai ser reusado pra cobrar consultas via motor).

-- 1. Drop tabelas que não vão ser reaproveitadas
DROP TABLE IF EXISTS judit_respostas;
DROP TABLE IF EXISTS judit_novas_acoes;
DROP TABLE IF EXISTS judit_monitoramentos;
DROP TABLE IF EXISTS judit_credenciais;

-- 2. Renomeia tabelas que mantemos (esquema preservado)
RENAME TABLE judit_creditos TO motor_creditos;
RENAME TABLE judit_transacoes TO motor_transacoes;

-- 3. Limpa coluna em cliente_processos que apontava pra judit_monitoramentos
-- (FK já foi removida implicitamente pelo DROP TABLE acima — MySQL não
-- mantém constraint após drop do alvo, mas tem campo monitoramentoId
-- que vira lixo)
ALTER TABLE cliente_processos
  DROP COLUMN IF EXISTS monitoramentoId;

-- Migration 0072: Asaas — status "aguardando_validacao"
--
-- Sprint pós-Sprint-2 (08/05/2026): user reportou erro HTTP 429
-- (rate limit 12h excedida) ao tentar conectar Asaas em produção.
-- Cada click "Conectar" chamava testarConexao → 1 request à API.
-- Várias tentativas estouraram a cota.
--
-- Solução: tolerar 429. Salvar a key criptografada com status novo
-- "aguardando_validacao" e cron valida em background quando rate
-- limit liberar.
--
-- Uso:
--   - status="aguardando_validacao" + mensagemErro: motivo (ex: "rate_limit_429")
--   - Cron `validarConexoesAsaasPendentes` cada 30min retenta
--   - Quando teste passar: status vira "conectado"

ALTER TABLE asaas_config
  MODIFY COLUMN statusAsaas
    ENUM('conectado', 'desconectado', 'erro', 'aguardando_validacao')
    NOT NULL
    DEFAULT 'desconectado';

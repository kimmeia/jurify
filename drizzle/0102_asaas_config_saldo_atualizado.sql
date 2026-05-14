-- Cache de saldo Asaas no DB para reduzir polling direto à API.
--
-- Contexto: `obterSaldo` (router-asaas.ts:3387) era chamado pelo frontend
-- a cada 5 minutos por cada usuário com a aba Financeiro aberta. 10 users
-- do mesmo escritório = 10 requests/5min direto ao Asaas, todos retornando
-- o mesmo número. Saldo muda raramente (só quando uma cobrança é paga),
-- então cachear é seguro.
--
-- Nova coluna `saldoAtualizadoEmAsaas` registra quando o saldo foi
-- buscado pela última vez. `obterSaldo` lê do cache se < 10min de idade,
-- senão consulta Asaas. Webhook PAYMENT_RECEIVED/CONFIRMED zera o
-- timestamp pra forçar refresh na próxima leitura (saldo cresceu).
--
-- Default NULL pra rows existentes — primeira chamada após o deploy
-- vai considerar cache miss e fazer 1 request fresh ao Asaas (normal).
--
-- Idempotente: ADD COLUMN absorvido pelo auto-migrate como
-- "duplicate column" quando rerun.

ALTER TABLE asaas_config
  ADD COLUMN saldoAtualizadoEmAsaas TIMESTAMP NULL DEFAULT NULL;

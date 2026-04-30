-- 0043_cobranca_manual: permite cobrança lançada manualmente (sem
-- passar pela API Asaas — cliente paga em dinheiro/cartão presencial).
-- Mesma tabela `asaas_cobrancas` mas com `origem='manual'`,
-- `asaasPaymentId=NULL` e formas de pagamento adicionais (DINHEIRO,
-- TRANSFERENCIA, OUTRO).
--
-- Despite the table name "asaas_cobrancas", optei por reusar essa
-- tabela ao invés de criar uma paralela: as listagens, KPIs, cron de
-- comissão e exclusão já filtram por escritorio_id e funcionam de
-- graça pra ambas origens. Tabela paralela exigiria UNION em vários
-- lugares, mais erros de drift.

-- 1) Torna asaasPaymentId NULLABLE (cobrança manual não tem ID Asaas).
--    O índice UNIQUE (escritorioId, asaasPaymentId) continua válido
--    porque MySQL trata NULL como distinto, então N cobranças manuais
--    coexistem com NULL.
ALTER TABLE asaas_cobrancas
  MODIFY COLUMN asaasPaymentId VARCHAR(64) NULL;

-- 2) Torna asaasCustomerId NULLABLE (contato pode não ter vínculo Asaas).
ALTER TABLE asaas_cobrancas
  MODIFY COLUMN asaasCustomerIdCob VARCHAR(64) NULL;

-- 3) Coluna origem (asaas | manual).
ALTER TABLE asaas_cobrancas
  ADD COLUMN origemAsaasCob ENUM('asaas','manual') NOT NULL DEFAULT 'asaas';

-- 4) Expande enum formaPagamento com DINHEIRO/TRANSFERENCIA/OUTRO.
ALTER TABLE asaas_cobrancas
  MODIFY COLUMN formaPagAsaas
    ENUM('BOLETO','CREDIT_CARD','PIX','UNDEFINED','DINHEIRO','TRANSFERENCIA','OUTRO')
    NOT NULL;

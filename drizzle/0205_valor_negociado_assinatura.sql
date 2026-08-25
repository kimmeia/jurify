-- Valor fechado na conversa pra plano sob consulta. Fica na ASSINATURA
-- (não no plano, que é preço de tabela; não no escritório, que só tem
-- desconto). A fatura composta usa este valor como preço do pacote quando
-- presente — sem ele, aplicarValorAssinatura "corrigiria" a assinatura
-- negociada de volta pra R$ 0.
ALTER TABLE subscriptions ADD COLUMN valor_negociado_centavos INT DEFAULT NULL;

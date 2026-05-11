-- Migration 0093: importar extrato financeiro do Asaas como despesas.
--
-- Hoje só temos despesas geradas via webhook PAYMENT_RECEIVED (taxa por
-- cobrança recebida, com `origem='taxa_asaas'`). PIX de saída,
-- notificações (SMS/WhatsApp/email/voz), mensalidade Asaas, antecipações
-- etc. nunca viraram despesa local — o usuário precisa olhar o extrato
-- direto no painel Asaas, fora do nosso Financeiro.
--
-- Solução: importar GET /v3/financialTransactions (o extrato completo
-- da conta Asaas) e gerar uma despesa por movimentação de débito. O
-- campo `type` de cada movimentação vira a categoria (Notificações,
-- Transferências, Mensalidade, Antecipações, etc).
--
-- Idempotência: cada movimentação no Asaas tem ID único. UNIQUE
-- (escritorioIdDesp, asaasFinTransIdDesp) impede duplicata em retries
-- ou re-execuções manuais do sync. MySQL trata múltiplos NULL como
-- distintos, então despesas manuais/legacy (sem asaasFinTransId) não
-- conflitam.

ALTER TABLE despesas
  ADD COLUMN asaasFinTransIdDesp VARCHAR(64) NULL DEFAULT NULL,
  ADD COLUMN asaasFinTransTypeDesp VARCHAR(64) NULL DEFAULT NULL,
  MODIFY COLUMN origemDesp ENUM('manual', 'taxa_asaas', 'recorrencia', 'extrato_asaas')
    NOT NULL DEFAULT 'manual';

CREATE UNIQUE INDEX desp_asaas_fintrans_uq
  ON despesas (escritorioIdDesp, asaasFinTransIdDesp);

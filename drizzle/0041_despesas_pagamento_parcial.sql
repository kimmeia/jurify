-- 0041_despesas_pagamento_parcial: pagamento parcial de despesas.
-- Adiciona coluna `valorPagoDesp` (acumulador) e expande enum de
-- status com 'parcial'. UI agora oferece "Registrar pagamento" no
-- lugar de "Marcar paga", aceitando valores menores que o total.

-- 1) Acumulador de pagamentos. Default 0 mantém retrocompatibilidade
--    com despesas pré-migração (status=pendente → valorPago=0;
--    status=pago já existia → será corrigido pelo backfill abaixo).
ALTER TABLE despesas
  ADD COLUMN valorPagoDesp DECIMAL(12,2) NOT NULL DEFAULT 0.00;

-- 2) Backfill: despesas que já estavam quitadas ganham valorPago = valor
--    (inflar o acumulador pra refletir histórico).
UPDATE despesas
SET valorPagoDesp = valorDesp
WHERE statusDesp = 'pago';

-- 3) Adiciona 'parcial' ao enum (MySQL 5.7+ suporta MODIFY pra estender).
ALTER TABLE despesas
  MODIFY COLUMN statusDesp
    ENUM('pendente','parcial','pago','vencido')
    NOT NULL DEFAULT 'pendente';

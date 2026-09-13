-- Cancelar a assinatura honrando a cláusula 5 dos Termos: "ao cancelar, o
-- acesso permanece até o fim do período já pago".
--
-- Até aqui `subscriptions` não sabia nem o ciclo (mensal/anual) nem quando
-- caiu o último pagamento — `currentPeriodEnd` era "vencimento + 30 dias"
-- em qualquer ciclo, e cancelar virava `canceled` na hora, sem carência.
--
-- `fim_periodo_pago_em` é o instante (epoch ms, como as outras datas da
-- tabela) em que termina o período que o cliente pagou: é ele que libera o
-- acesso de uma assinatura cancelada. `aviso_fim_acesso_enviado_em` é a
-- trava do e-mail "seu acesso termina em 3 dias" (um só por assinatura).
ALTER TABLE subscriptions
  ADD COLUMN ultimo_pagamento_em BIGINT DEFAULT NULL,
  ADD COLUMN ciclo ENUM('monthly','yearly') DEFAULT NULL,
  ADD COLUMN fim_periodo_pago_em BIGINT DEFAULT NULL,
  ADD COLUMN aviso_fim_acesso_enviado_em BIGINT DEFAULT NULL;

-- Melhor esforço para quem já está ativo: o único registro do período pago
-- que existia era `currentPeriodEnd`. Quando ele ainda está no futuro, é a
-- melhor estimativa de até quando o cliente pagou — sem isso, quem cancelar
-- antes do próximo pagamento perderia a carência que os Termos prometem.
-- Passado ou nulo fica NULL: o próximo webhook de pagamento preenche.
UPDATE subscriptions
   SET fim_periodo_pago_em = currentPeriodEnd
 WHERE status = 'active'
   AND fim_periodo_pago_em IS NULL
   AND currentPeriodEnd IS NOT NULL
   AND currentPeriodEnd > UNIX_TIMESTAMP() * 1000;

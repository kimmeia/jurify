-- 0117_pagador_beneficiario.sql
-- Caso resolvido: "Carlos fechou ação de R$ 15k. R$ 10k pagou no nome da esposa
-- mas é o cliente". Hoje o operador era forçado a lançar manual no Carlos pra
-- ver o pagamento no cliente → duplicava o caixa (2 linhas com mesmo valor).
--
-- Solução: a cobrança Asaas continua no CPF de quem pagou (esposa, auditoria
-- correta), mas ganha um vínculo lógico opcional `contatoBeneficiarioId`
-- apontando pro contato CRM dono da cobrança. KPI / resumo do cliente /
-- comissão passam a usar `COALESCE(contatoBeneficiarioId, contatoId)` —
-- a cobrança conta UMA vez, no contato certo.
--
-- Migration non-destrutiva: ADD COLUMN com default NULL + INDEX.
-- Cobranças existentes mantêm comportamento atual (contatoBeneficiarioId=NULL).

ALTER TABLE `asaas_cobrancas`
  ADD COLUMN `contatoBeneficiarioIdAsaasCob` INT DEFAULT NULL
  COMMENT 'Quando preenchido, esta cobrança conta como pagamento deste contato CRM (não do contatoId pagador). Resolve o caso "pagou no CPF da esposa mas é dívida do cliente".';

-- Índice pra KPI / resumo do cliente fazerem WHERE eficiente nas duas pontas.
CREATE INDEX `asaas_cob_beneficiario_idx`
  ON `asaas_cobrancas` (`escritorioIdAsaasCob`, `contatoBeneficiarioIdAsaasCob`);

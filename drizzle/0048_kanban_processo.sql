-- 0048_kanban_processo: vínculo de cards Kanban a ações.
--
-- Permite que o SmartFlow crie 1 card POR (cliente, ação) em vez de
-- 1 card POR cobrança. Cobre o cenário do "pacote": cliente paga 1
-- cobrança que ativa 3 ações → SmartFlow dispara 3× → cria 3 cards
-- distintos (não duplica). Próximas parcelas pagas: idempotência
-- detecta os cards existentes e não cria mais.
--
-- NULL é aceitável: cards legados (criados por SmartFlow antigo ou
-- direto pela UI do Kanban) não têm `processoId`. A idempotência cai
-- pra `asaasPaymentId` nesse caso (comportamento preservado).
--
-- Idempotente: usa IF NOT EXISTS pra coluna e index.

ALTER TABLE `kanban_cards`
  ADD COLUMN IF NOT EXISTS `processoIdKCard` INT NULL;

-- Index composto pra acelerar o lookup do passo `kanban_criar_card`
-- (idempotência por escritorioId + processoId + clienteId).
CREATE INDEX IF NOT EXISTS `kanban_cards_proc_cli_idx`
  ON `kanban_cards` (`escritorioIdKCard`, `processoIdKCard`, `clienteIdKCard`);

-- 0047_webhook_eventos_acao: estende a tabela de idempotência do webhook
-- Asaas pra incluir `acaoId` na chave única.
--
-- Motivação: quando uma cobrança está vinculada a N ações
-- (cobranca_acoes), o dispatcher dispara N eventos `pagamento_recebido`
-- (1 por ação). Sem `acaoId` na chave UNIQUE, a 2ª ação seria
-- bloqueada como duplicata.
--
-- `0` (default) representa cobrança SEM ação vinculada (legado).
-- NOT NULL é intencional: NULL em UNIQUE é tratado como distinto
-- pelo MySQL, abrindo brecha pra duplicata em retry.
--
-- Idempotente: usa IF NOT EXISTS pra coluna e tenta drop+create do
-- índice (com DROP IF EXISTS).

ALTER TABLE `asaas_webhook_eventos`
  ADD COLUMN IF NOT EXISTS `acaoIdWhEv` INT NOT NULL DEFAULT 0;

-- Recria UNIQUE incluindo acaoIdWhEv. Se o índice antigo (sem acaoId)
-- existir, drop primeiro pra liberar o nome.
DROP INDEX IF EXISTS `asaas_wh_ev_uq` ON `asaas_webhook_eventos`;

CREATE UNIQUE INDEX `asaas_wh_ev_uq`
  ON `asaas_webhook_eventos`
  (`escritorioIdWhEv`, `asaasPaymentIdWhEv`, `eventTypeWhEv`, `acaoIdWhEv`);

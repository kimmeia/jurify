-- 0045_parcelamento_local: cria parcelamento "local" (N cobranças avulsas
-- agrupadas por parcelamentoLocalId) em vez do /installments do Asaas.
-- Motivo: /installments junta tudo no cartão de crédito (1 transação total
-- parcelada na fatura) — cliente perde flexibilidade de pagar parcela 1
-- com cartão e parcela 2 com PIX. Com cobranças avulsas, cada parcela é
-- independente e o CRM agrupa visualmente.

-- ─── asaas_cobrancas: 3 colunas novas ────────────────────────────────────
ALTER TABLE `asaas_cobrancas`
  ADD COLUMN `parcelamentoLocalId` VARCHAR(64) NULL,
  ADD COLUMN `parcelaAtual` INT NULL,
  ADD COLUMN `parcelaTotal` INT NULL;

-- Index pra agrupamento eficiente no CRM (lista de cobranças do cliente)
CREATE INDEX `asaas_cob_parcel_local_idx`
  ON `asaas_cobrancas` (`parcelamentoLocalId`);

-- Nota: a tabela `asaas_config_cobranca_pai` NÃO precisa mudar. No
-- parcelamento local, atendenteId/categoriaId/comissionavelOverride são
-- gravados DIRETO em cada parcela ao criá-la (não dependem de lookup pelo
-- webhook como no /installments do Asaas).

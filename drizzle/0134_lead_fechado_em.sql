-- Lead.fechadoEm: timestamp do MOMENTO em que o lead virou fechado_ganho
-- ou fechado_perdido. Pra relatórios "deste mês" é mais confiável que
-- updatedAt (que muda em qualquer edição do card).
ALTER TABLE leads
  ADD COLUMN fechadoEmLead TIMESTAMP NULL DEFAULT NULL;

-- Backfill: pra leads que já estão fechados, copia o updatedAt como melhor
-- aproximação inicial. Os fechamentos antigos podem ter updatedAt
-- desatualizado por edições posteriores, mas é o sinal mais próximo que
-- temos pra histórico. Fechamentos novos serão precisos.
UPDATE leads
SET fechadoEmLead = updatedAtLead
WHERE etapaFunil IN ('fechado_ganho', 'fechado_perdido')
  AND fechadoEmLead IS NULL;

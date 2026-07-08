-- Backfill: amarra cobranças órfãs (contatoId NULL) ao contato dono quando o
-- asaasCustomerId já tem vínculo em asaas_clientes.
--
-- Fecha o buraco estrutural: a cobrança podia sincronizar ANTES do cliente
-- estar vinculado ao Asaas -> nascia com contatoId nulo e o webhook só
-- re-adotava no próximo evento (que pode nunca vir). Resultado: a cobrança
-- ficava "órfã" no módulo Financeiro pra sempre, mesmo o cliente existindo
-- (aparecia só na ficha do cliente), e o SmartFlow de cobrança não achava
-- telefone. A partir daqui o runtime (asaas-sync.backfillContatoPorVinculo)
-- mantém isso em dia; esta migration corrige o que já está no banco.
--
-- Idempotente: só toca linhas com contatoId nulo cujo customer tem vínculo.
-- Se o mesmo customer tiver mais de um vínculo, escolhe de forma
-- determinística (primário primeiro, empate pelo menor id).
UPDATE asaas_cobrancas c
SET c.contatoIdAsaasCob = (
  SELECT ac.contatoIdAsaas FROM asaas_clientes ac
  WHERE ac.asaasCustomerId = c.asaasCustomerIdCob
    AND ac.escritorioIdAsaasCli = c.escritorioIdAsaasCob
  ORDER BY ac.primarioAsaasCli DESC, ac.id ASC
  LIMIT 1
)
WHERE c.contatoIdAsaasCob IS NULL
  AND EXISTS (
    SELECT 1 FROM asaas_clientes ac2
    WHERE ac2.asaasCustomerId = c.asaasCustomerIdCob
      AND ac2.escritorioIdAsaasCli = c.escritorioIdAsaasCob
  );

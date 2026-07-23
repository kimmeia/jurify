-- Marcos de valor da negociação de um acordo — alimentam o "termômetro" que
-- mostra, de relance, se a proposta atual está perto ou longe do alvo:
--   inicial    = âncora de largada (1ª proposta colocada na mesa)
--   pretendido = meta que se quer fechar (referência do "perto ou longe")
--   disponivel = limite aceitável (piso ao cobrar, teto ao pagar)
-- A direção (cobrar = quer o maior / pagar = quer o menor) é inferida por
-- pretendido × disponivel, então NÃO há ordem numérica fixa entre os três.
-- Non-destrutivo: DEFAULT NULL cobre acordos antigos (a UI pede pra completar
-- os marcos ao editar; sem os três não renderiza o termômetro).
ALTER TABLE acordos ADD COLUMN valorInicialAcordo INT DEFAULT NULL;
ALTER TABLE acordos ADD COLUMN valorPretendidoAcordo INT DEFAULT NULL;
ALTER TABLE acordos ADD COLUMN valorDisponivelAcordo INT DEFAULT NULL;

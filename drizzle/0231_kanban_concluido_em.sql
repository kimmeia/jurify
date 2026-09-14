-- Data de conclusão do card do Kanban.
--
-- O card sempre soube em QUAL coluna está; nunca soube QUANDO chegou nela.
-- Por isso o filtro "Período" só oferecia "Criado em" — não havia data de
-- conclusão pra comparar. O pedido do dono (13/09) foi poder filtrar pelos
-- dois.
--
-- A coluna é aditiva e nasce NULL: card que não está concluído não tem data,
-- e é isso que o filtro espera.
ALTER TABLE kanban_cards
  ADD COLUMN concluidoEmKCard TIMESTAMP NULL DEFAULT NULL;

-- Índice porque o filtro compara faixa de data sobre o escritório inteiro —
-- mesma razão de existir do índice de coluna/processo que já está aqui.
CREATE INDEX kanban_cards_concluido_idx ON kanban_cards (escritorioIdKCard, concluidoEmKCard);

-- ─── O passado ────────────────────────────────────────────────────────────
-- Primeiro zera quem NÃO está numa coluna de conclusão. Numa coluna recém-
-- criada isso não faz nada; existe pra o preenchimento poder rodar de novo sem
-- deixar data velha em card que já voltou pro fluxo (o executor repassa as
-- migrations quando alguma falha — ver `runMigrations`).
UPDATE kanban_cards c
JOIN kanban_colunas kc ON kc.id = c.colunaIdKCard
SET c.concluidoEmKCard = NULL
WHERE kc.tipoKC <> 'conclusao' AND c.concluidoEmKCard IS NOT NULL;

-- Não começa vazio: cada movimentação de card já é registrada em
-- `kanban_movimentacoes` (card, coluna de origem, coluna de destino, quando).
-- Dá pra recuperar a data de conclusão de quem JÁ está concluído.
--
-- Só preenche card que está AGORA numa coluna de conclusão — a regra escolhida
-- pelo dono é "vale a última vez, e some se o card voltar pro fluxo", então
-- card que saiu da conclusão não deve ter data.
UPDATE kanban_cards c
JOIN kanban_colunas kc ON kc.id = c.colunaIdKCard
SET c.concluidoEmKCard = (
  SELECT MAX(m.createdAtKMov)
  FROM kanban_movimentacoes m
  JOIN kanban_colunas d ON d.id = m.colunaDestinoIdKMov
  WHERE m.cardIdKMov = c.id AND d.tipoKC = 'conclusao'
)
WHERE kc.tipoKC = 'conclusao';

-- Card criado DIRETO numa coluna de conclusão nunca foi movido, então não tem
-- linha no histórico e sobrou NULL acima. Pra esses, a data de criação é a
-- melhor aproximação que existe — e é melhor do que sumir do filtro.
UPDATE kanban_cards c
JOIN kanban_colunas kc ON kc.id = c.colunaIdKCard
SET c.concluidoEmKCard = c.createdAtKCard
WHERE kc.tipoKC = 'conclusao' AND c.concluidoEmKCard IS NULL;

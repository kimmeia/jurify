-- Início do ATENDIMENTO atual da conversa (episódio).
--
-- O filtro de período do Inbox passava a régua sobre "teve mensagem na
-- janela?" — conversa antiga que continuava trocando mensagem aparecia no
-- "hoje". Regra do dono (27/08): o período conta pelo INÍCIO do
-- atendimento — primeira mensagem da conversa; se um atendimento foi
-- encerrado (resolvido/fechado) e o cliente voltou a escrever, o retorno
-- é um NOVO início.
--
-- Backfill: melhor aproximação pra linhas existentes é a PRIMEIRA mensagem
-- da conversa (imutável); sem mensagem, a criação da conversa.
ALTER TABLE conversas
  ADD COLUMN atendimentoIniciadoEmConv TIMESTAMP NULL DEFAULT NULL;

UPDATE conversas c
  LEFT JOIN (
    SELECT conversaIdMsg AS cid, MIN(createdAtMsg) AS primeira
    FROM mensagens
    GROUP BY conversaIdMsg
  ) m ON m.cid = c.id
SET c.atendimentoIniciadoEmConv = COALESCE(m.primeira, c.createdAtConv)
WHERE c.atendimentoIniciadoEmConv IS NULL;

-- Instagram e Messenger ainda não recebem nem enviam mensagem (o webhook da
-- Meta descarta tudo que não é WhatsApp e o envio recusa outros tipos), mas o
-- plano Atende vendia "WhatsApp e Instagram" no primeiro bullet.
--
-- Troca SÓ o bullet do índice 0, com JSON_REPLACE, e só quando o texto ainda
-- é o da 0217 — idempotente e sem reescrever o array (outro bullet do mesmo
-- plano pode ser mexido por outra migration).
UPDATE planos
SET features = JSON_REPLACE(features, '$[0]', 'Atendimento no WhatsApp oficial (API Meta) — 1 número · Instagram em breve')
WHERE slug = 'atende'
  AND JSON_UNQUOTE(JSON_EXTRACT(features, '$[0]')) = 'Atendimento no WhatsApp oficial (API Meta) e Instagram — 1 número';

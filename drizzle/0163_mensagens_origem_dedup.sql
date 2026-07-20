-- CoEx (coexistência WhatsApp): mensagens podem nascer FORA do sistema
-- (atendente respondendo pelo app WhatsApp Business do celular — echo da
-- Meta). `origemMsg` distingue essas linhas ('celular') das demais.
-- NULL = comportamento pré-CoEx (inferido de direcaoMsg) — non-destrutivo.
--
-- Índice em idExterno: dedup por wamid no inbound (reentrega da Meta e
-- echo de mensagem enviada pela própria API) + acelera o update de status
-- de entrega, que já filtra por idExterno sem índice.

ALTER TABLE mensagens ADD COLUMN origemMsg VARCHAR(16) NULL DEFAULT NULL;
CREATE INDEX idx_mensagens_id_externo ON mensagens (idExterno);

-- Coluna `payloadMsg` (JSON em text) na tabela mensagens.
-- Guarda metadados estruturados que não cabem em conteudoMsg (texto puro):
-- principalmente respostas a botões/lista do WhatsApp Cloud API
-- ({"interactiveReply":{"tipo":"button","id":"agendar","titulo":"📅 Quero agendar"}}).
-- Extensível pra reactions, location estruturada, contacts etc sem migration nova.
ALTER TABLE mensagens
  ADD COLUMN payloadMsg TEXT NULL;

-- Cartão de ligação na conversa: novo tipo "ligacao" no enum de mensagens.
-- Aditivo (MODIFY ENUM acrescentando valor) — não toca em linhas existentes.
ALTER TABLE mensagens
  MODIFY COLUMN tipoMsg ENUM(
    'texto','imagem','audio','video','documento',
    'localizacao','contato','sticker','sistema','ligacao'
  ) NOT NULL;

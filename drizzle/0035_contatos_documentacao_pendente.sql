-- 0035_contatos_documentacao_pendente: adiciona campos pra rastrear
-- documentação pendente do cliente. Cliente assina contrato mas pode
-- enviar documentos depois — antes era cobrança manual sem visibilidade.
--
-- Compatível com qualquer MySQL via INFORMATION_SCHEMA (evita
-- ADD COLUMN IF NOT EXISTS que só funciona no 8.0.29+).

-- 1) Coluna documentacaoPendente (boolean default false)
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'contatos'
    AND column_name = 'documentacaoPendente'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE contatos ADD COLUMN documentacaoPendente TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2) Coluna documentacaoObservacoes (text nullable)
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'contatos'
    AND column_name = 'documentacaoObservacoes'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE contatos ADD COLUMN documentacaoObservacoes TEXT NULL',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3) Índice pra acelerar count "aguardando documentação" no dashboard
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'contatos'
    AND index_name = 'contatos_doc_pendente_idx'
);
-- A coluna física é `escritorioIdContato` — `contatos` é uma das tabelas
-- que sufixam o nome. Com `escritorioId` o CREATE INDEX falhava com "Key
-- column doesn't exist", a migration nunca era marcada como aplicada, e
-- o erro se repetia em todo boot de todo ambiente desde então.
SET @sql := IF(@idx_exists = 0,
  'CREATE INDEX contatos_doc_pendente_idx ON contatos (escritorioIdContato, documentacaoPendente)',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

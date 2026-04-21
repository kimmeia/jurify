-- Migration: pastas aninhadas para documentos do cliente.
--
-- Contexto: a aba Documentos do cliente passa a suportar organização
-- em pastas com N níveis de aninhamento (parentId auto-referencial).
-- Arquivos em cliente_arquivos ganham pastaId opcional; pastaId NULL
-- = arquivo na raiz do cliente.
--
-- Exclusão de pasta é recursiva e definitiva (apaga subpastas e
-- arquivos). Exclusão do cliente em cascata já remove tudo.

CREATE TABLE IF NOT EXISTS cliente_pastas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  escritorioIdPasta INT NOT NULL,
  contatoIdPasta INT NOT NULL,
  parentIdPasta INT NULL,
  nomePasta VARCHAR(128) NOT NULL,
  criadoPorPasta INT,
  createdAtPasta TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  INDEX idx_pasta_escritorio (escritorioIdPasta),
  INDEX idx_pasta_contato (contatoIdPasta),
  INDEX idx_pasta_parent (parentIdPasta)
);

ALTER TABLE cliente_arquivos
  ADD COLUMN pastaIdArquivo INT NULL
  AFTER contatoId;

CREATE INDEX idx_arquivos_pasta ON cliente_arquivos(pastaIdArquivo);

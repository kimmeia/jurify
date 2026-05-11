-- Migration 0088: anexos do módulo financeiro (despesas e cobranças).
--
-- Modelo único (`financeiro_anexos`) com discriminador `tipoEntidade`:
-- 'despesa' | 'cobranca'. Simplifica join (1 tabela em vez de 2) e
-- futuro suporte a outros tipos (ex: 'comissao').
--
-- Storage: S3 (mesmo bucket do backup global), key
--   anexos/{escritorioId}/{tipoEntidade}/{entidadeId}/{uuid}_{filename}
-- Arquivos NÃO são deletados quando o registro pai some (despesa/cobrança).
-- A procedure de excluir do pai chama `excluirAnexosDe(...)` explicitamente.
-- Isso evita orphans no S3 + dá log claro de quem deletou o quê.
--
-- Limites práticos no app (não impostos na schema, só no input zod):
--  - até 5MB por arquivo (base64 via tRPC)
--  - tipos PDF / PNG / JPG / WEBP / XML
--
-- Permissões: anexar = `criar` no módulo financeiro; excluir = `excluir`.

CREATE TABLE financeiro_anexos (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  escritorioIdAnx INT NOT NULL,
  tipoEntidadeAnx ENUM('despesa', 'cobranca') NOT NULL,
  entidadeIdAnx INT NOT NULL,
  storageKeyAnx VARCHAR(512) NOT NULL,
  filenameAnx VARCHAR(255) NOT NULL,
  mimeTypeAnx VARCHAR(100) NOT NULL,
  tamanhoBytesAnx INT NOT NULL,
  uploadedByUserIdAnx INT NULL DEFAULT NULL,
  createdAtAnx TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX anx_entidade_idx (escritorioIdAnx, tipoEntidadeAnx, entidadeIdAnx),
  INDEX anx_escritorio_idx (escritorioIdAnx, createdAtAnx)
);

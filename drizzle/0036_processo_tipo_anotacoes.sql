-- 0036_processo_tipo_anotacoes:
-- 1) Adiciona coluna `tipoCliProc` (extrajudicial/litigioso) em
--    cliente_processos pra distinguir negociação fora do tribunal vs
--    processo ajuizado.
-- 2) Cria tabela cliente_processo_anotacoes (anotações livres de
--    andamento por processo, sem CRUD complexo — só insert/list/delete).
--
-- Compatível com qualquer MySQL (INFORMATION_SCHEMA, sem IF NOT EXISTS).

-- 1) Coluna tipoCliProc
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'cliente_processos'
    AND column_name = 'tipoCliProc'
);
SET @sql := IF(@col_exists = 0,
  "ALTER TABLE cliente_processos ADD COLUMN tipoCliProc ENUM('extrajudicial','litigioso') NOT NULL DEFAULT 'litigioso'",
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2) Tabela cliente_processo_anotacoes
CREATE TABLE IF NOT EXISTS cliente_processo_anotacoes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  processoIdAnot INT NOT NULL,
  autorUserIdAnot INT NOT NULL,
  conteudoAnot TEXT NOT NULL,
  createdAtAnot TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX cpa_processo_idx (processoIdAnot)
);

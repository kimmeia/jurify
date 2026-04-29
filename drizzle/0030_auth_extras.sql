-- 0030_auth_extras: aceitouTermosEm em users + tabela password_reset_tokens
-- Suporte a "Esqueci minha senha" + aceite LGPD de Termos.
--
-- IMPORTANTE: usa INFORMATION_SCHEMA + PREPARE pra ser compatível com
-- MySQL 5.7 e 8.0.x < 8.0.29 (que NÃO suportam ADD COLUMN IF NOT EXISTS).
-- A v1 desta migration falhou em produção exatamente por causa disso.

-- 1) Adiciona aceitouTermosEm em users só se ainda não existir.
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'users'
    AND column_name = 'aceitouTermosEm'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE users ADD COLUMN aceitouTermosEm TIMESTAMP NULL',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2) Tabela password_reset_tokens. CREATE TABLE IF NOT EXISTS é
--    suportado em todas as versões — sem problemas aqui.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  userId INT NOT NULL,
  token VARCHAR(64) NOT NULL UNIQUE,
  expiraEm TIMESTAMP NOT NULL,
  usadoEm TIMESTAMP NULL,
  createdAtTok TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX prt_user_idx (userId),
  INDEX prt_expira_idx (expiraEm)
);

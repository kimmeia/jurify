-- 0030_auth_extras: aceitouTermosEm em users + tabela password_reset_tokens
-- Suporte a "Esqueci minha senha" + aceite LGPD de Termos.

-- 1) Adiciona campo aceitouTermosEm em users (nullable; contas antigas
--    não terão até aceitarem no próximo login).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS aceitouTermosEm TIMESTAMP NULL;

-- 2) Tabela de tokens de reset.
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

-- Migration: adicionar campos para autenticação por email/senha e Google
-- Permite login direto sem depender de provedor OAuth externo (Manus)

-- Aumenta tamanho do openId para acomodar identificadores sintéticos
-- ('email-{base64}' ou 'google-{sub}')
ALTER TABLE users MODIFY COLUMN openId VARCHAR(128) NOT NULL;

-- Campo para hash de senha (scrypt) — null para usuários só Google
ALTER TABLE users ADD COLUMN passwordHash VARCHAR(255) NULL AFTER email;

-- Campo para identificador do Google — null para usuários email/senha
ALTER TABLE users ADD COLUMN googleSub VARCHAR(128) NULL AFTER passwordHash;

-- Index único parcial seria ideal, mas MySQL não suporta. Apenas index normal.
CREATE INDEX idx_users_googleSub ON users (googleSub);
CREATE INDEX idx_users_email ON users (email);

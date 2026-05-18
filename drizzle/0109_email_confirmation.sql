-- Migration 0109: confirmação de email no cadastro (Fase 2)
--
-- Signup novo passa a NÃO criar sessão imediatamente. Em vez disso, cria
-- user com `email_verificado=false` e envia email com link de confirmação
-- válido por 24h. Login fica bloqueado até o user clicar no link.
--
-- Backfill: todos os users LEGACY (criados antes desta migration) ficam
-- automaticamente verificados pra não quebrar acessos existentes.
--
-- Adiciona também `plano_pretendido` em users — armazena o slug do plano
-- que o cliente escolheu na LP (Pricing.tsx persiste em sessionStorage e
-- passa pro signup). A Fase 3 vai consumir esse valor pra iniciar trial
-- automaticamente após a confirmação.

ALTER TABLE users
  ADD COLUMN email_verificado BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN email_verificado_em TIMESTAMP NULL,
  ADD COLUMN plano_pretendido VARCHAR(64) NULL;

-- Backfill: contas existentes ficam verificadas (não obrigamos legacy
-- a confirmar email retroativamente — somente novos cadastros).
UPDATE users SET email_verificado = TRUE, email_verificado_em = NOW();

CREATE TABLE email_confirmation_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_email_conf_token (token),
  INDEX idx_email_conf_user (user_id)
);

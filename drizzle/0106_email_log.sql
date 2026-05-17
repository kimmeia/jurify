-- Migration 0106: tabela de log de emails enviados via Resend (bug #6)
--
-- Antes: erros em envios via Resend (boas-vindas, redefinir senha, convite)
-- viviam só no response e no logger — somiam depois que o request terminava.
-- Admin não tinha forma de saber que emails falharam, e o user que devia
-- receber nunca era avisado. Caso clássico: domínio não verificado no
-- Resend, quota mensal estourada, lista de bloqueio temporária.
--
-- Solução: log persistente de TODOS os envios (sucesso E falha), com
-- metadados suficientes pra:
--   - Admin auditar quem falhou
--   - Reenviar manualmente (mesmo destinatário/assunto/conteúdo)
--   - Correlacionar com escritório/usuário pra suporte
--
-- `contextoJson` armazena o payload original em JSON (subject + html + text
-- + tipo-específicos como token de redefinição). Permite reenvio idêntico
-- ao envio original; tokens criptográficos NÃO são gravados aqui (são
-- guardados na própria entidade — convites_colaborador, password_reset_tokens
-- etc).
--
-- `tentativas` permite contabilizar quantas vezes o mesmo email foi
-- reenviado. `ultimaTentativaEm` é update no momento do reenvio.

CREATE TABLE email_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tipo VARCHAR(64) NOT NULL,
  destinatario VARCHAR(320) NOT NULL,
  assunto VARCHAR(512) NOT NULL,
  status VARCHAR(16) NOT NULL,
  erro VARCHAR(1024) DEFAULT NULL,
  escritorioId INT DEFAULT NULL,
  userId INT DEFAULT NULL,
  contextoJson TEXT DEFAULT NULL,
  tentativas INT NOT NULL DEFAULT 1,
  ultimaTentativaEm TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_email_log_status_created (status, createdAt),
  INDEX idx_email_log_destinatario (destinatario),
  INDEX idx_email_log_escritorio (escritorioId)
);

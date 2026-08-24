-- Aceite de termos versionado (aprovado no mockup de 24/08).
--
-- 1) users.termosVersaoAceita: cache da última versão aceita. 0 = nunca
--    registrou versão. Contas que já tinham aceite (timestamp preenchido)
--    ganham versão 1 — o gate pede o re-aceite da versão 2 (texto novo com
--    a cláusula de responsabilidade por dados) no próximo acesso do dono.
ALTER TABLE users ADD COLUMN termosVersaoAceita INT NOT NULL DEFAULT 0;
UPDATE users SET termosVersaoAceita = 1 WHERE aceitouTermosEm IS NOT NULL;

-- 2) Trilha auditável: uma linha por aceite, com IP e versão. Nunca é
--    sobrescrita — é a prova do aceite em caso de disputa.
CREATE TABLE IF NOT EXISTS aceites_termos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  userIdAceite INT NOT NULL,
  versaoAceite INT NOT NULL,
  contextoAceite VARCHAR(32) NOT NULL DEFAULT 'cadastro',
  ipAceite VARCHAR(64) DEFAULT NULL,
  aceitoEmAceite TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_aceites_termos_user (userIdAceite)
);

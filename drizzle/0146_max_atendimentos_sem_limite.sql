-- "Sem limite" de atendimentos simultâneos: torna a coluna nullable (NULL = ∞).
-- Aditivo — linhas existentes mantêm o valor atual; default 5 segue pra novas.
ALTER TABLE colaboradores
  MODIFY COLUMN maxAtendimentosSimultaneos INT NULL DEFAULT 5;

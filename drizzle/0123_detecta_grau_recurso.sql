-- Detecção de "subiu pro 2º grau" no monitoramento de movimentações (issue #529).
-- Preenchido pelo cron a partir das movimentações do 1º grau — valida a
-- heurística com dados reais antes de ligarmos a consulta do 2º grau de fato.
-- Non-destrutivo: boolean default FALSE, texto opcional NULL (cobre rows antigas).
ALTER TABLE motor_monitoramentos
  ADD COLUMN subiu_2grau BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE motor_monitoramentos
  ADD COLUMN indicios_2grau TEXT NULL;

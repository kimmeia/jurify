-- Resultado do atendimento em compromissos: comparecimento + observação pós-reunião.
-- Ambas opcionais (NULL) — migration não-destrutiva; compromissos antigos ficam sem resultado.
ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS comparecimento ENUM('compareceu','nao_compareceu','remarcado') NULL DEFAULT NULL;
ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS observacaoAtendimento TEXT NULL DEFAULT NULL;

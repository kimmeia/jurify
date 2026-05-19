-- Tabela `prazos_sugeridos` — sugestões automáticas de prazos/audiências
-- detectadas em movimentações processuais.
--
-- Quando o cron de monitoramento detecta uma movimentação contendo
-- padrões como "Audiência designada para 15/03/2026" ou "Intimação.
-- Prazo de 15 dias", o detector cria uma entrada aqui com status=pendente.
-- O usuário decide na UI: aprovar (vira agendamento real) ou descartar
-- (mantém o registro mas marcado como descartado pra evitar reprocesar).
--
-- Por que tabela separada de `agendamentos`?
--   1. Inbox dedicado evita poluir a agenda com "lixo" não aprovado
--   2. Sugestão pode ter dataSugerida null (quando só temos "X dias úteis"
--      e precisamos calcular)
--   3. Permite UI "1 click pra aprovar" sem precisar abrir modal cheio
--   4. Mantém audit trail (motivo + trecho original) sem inflar
--      agendamentos.descricao
--
-- UNIQUE em `evento_id` garante: uma única sugestão por movimentação
-- (mesmo se cron rodar 2x ou heurística mudar, não dispara duplicata).

CREATE TABLE IF NOT EXISTS prazos_sugeridos (
  id INT NOT NULL AUTO_INCREMENT,
  escritorio_id INT NOT NULL,
  evento_id INT NOT NULL,
  monitoramento_id INT,
  tipo ENUM('audiencia', 'prazo_processual') NOT NULL,
  titulo VARCHAR(255) NOT NULL,
  data_sugerida TIMESTAMP NULL DEFAULT NULL,
  prazo_dias INT,
  prazo_uteis BOOLEAN NOT NULL DEFAULT FALSE,
  motivo TEXT,
  trecho_origem TEXT,
  status ENUM('pendente', 'aprovado', 'descartado') NOT NULL DEFAULT 'pendente',
  agendamento_id INT,
  cnj_afetado VARCHAR(64),
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  aprovado_em TIMESTAMP NULL DEFAULT NULL,
  descartado_em TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_evento (evento_id),
  INDEX idx_escr_status (escritorio_id, status),
  INDEX idx_monitoramento (monitoramento_id),
  INDEX idx_data_sugerida (data_sugerida)
);

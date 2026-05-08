-- Migration 0071: Motor próprio — Monitoramento de processos e novas ações
--
-- Sprint 2 (08/05/2026): substitui o monitoramento Judit removido na
-- migration 0070. Tabela única `motor_monitoramentos` cobre os 2 casos:
--   - tipo='movimentacoes': monitora UM processo (search_type=lawsuit_cnj)
--   - tipo='novas_acoes':   monitora pessoa (search_type=cpf|cnpj)
--
-- Eventos detectados (movs novas + novas ações) são INSERTados em
-- `eventos_processo` (já existe na migration 0050) com tipo_evento
-- correspondente e flag `lido` pra UI consumir.
--
-- Cobrança: 2 cred/mês movimentações, 15 cred/mês novas ações.
-- Polling default: 6h (4x/dia).

CREATE TABLE IF NOT EXISTS motor_monitoramentos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  escritorio_id INT NOT NULL,
  criado_por INT NOT NULL,

  -- Tipo de monitoramento
  tipo_monitoramento ENUM('movimentacoes', 'novas_acoes') NOT NULL,
  search_type ENUM('lawsuit_cnj', 'cpf', 'cnpj') NOT NULL,
  search_key VARCHAR(64) NOT NULL,

  -- Metadata
  apelido VARCHAR(255),
  tribunal VARCHAR(16) NOT NULL,        -- "tjce", "tjsp", etc
  credencial_id INT,                    -- FK cofre_credenciais.id

  -- Estado
  status ENUM('ativo', 'pausado', 'erro') NOT NULL DEFAULT 'ativo',
  recurrence_horas INT NOT NULL DEFAULT 6,

  -- Tracking
  ultima_consulta_em DATETIME,
  ultima_movimentacao_em DATETIME,
  ultima_movimentacao_texto TEXT,
  total_atualizacoes INT NOT NULL DEFAULT 0,
  total_novas_acoes INT NOT NULL DEFAULT 0,

  -- Estado pra dedup
  -- Hash SHA-256 das movs serializadas — comparar com novo hash
  -- pra detectar mudança rápido sem reler eventos_processo
  hash_ultimas_movs VARCHAR(64),
  -- JSON array de CNJs já vistos (só pra novas_acoes — usado pra
  -- detectar CNJs novos contra um CPF/CNPJ)
  cnjs_conhecidos TEXT,

  -- Cobrança
  ultima_cobranca_em DATETIME,

  -- Diagnóstico
  ultimo_erro TEXT,

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_motor_mon_escritorio (escritorio_id),
  INDEX idx_motor_mon_user (criado_por),
  INDEX idx_motor_mon_polling (status, ultima_consulta_em),
  INDEX idx_motor_mon_credencial (credencial_id)
);

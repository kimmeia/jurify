-- 0124_smartflow_aguardar_resposta: suporta passo whatsapp_aguardar_resposta.
--
-- Mudanças:
--   1. Coluna `aguardandoMensagemContatoIdExec` em `smartflow_execucoes`
--      — quando preenchida, dispatcher retoma a execução em vez de criar
--      uma nova ao receber mensagem do contato.
--   2. Valor `whatsapp_aguardar_resposta` adicionado ao enum `tipoPasso`.
--
-- Idempotente: detecta o estado atual via INFORMATION_SCHEMA.

-- 1. Coluna aguardandoMensagemContatoIdExec
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'smartflow_execucoes'
    AND column_name = 'aguardandoMensagemContatoIdExec'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE smartflow_execucoes ADD COLUMN aguardandoMensagemContatoIdExec INT DEFAULT NULL',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Index pra busca rápida do dispatcher (por escritorio + contato + status).
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'smartflow_execucoes'
    AND index_name = 'idx_exec_aguardando_contato'
);
SET @sql := IF(@idx_exists = 0,
  'CREATE INDEX idx_exec_aguardando_contato ON smartflow_execucoes (escritorioIdExec, aguardandoMensagemContatoIdExec, statusExec)',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. Enum tipoPasso com whatsapp_aguardar_resposta
SET @enum_def := (
  SELECT COLUMN_TYPE FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'smartflow_passos'
    AND column_name = 'tipoPasso'
);
SET @ja_existe := IF(@enum_def LIKE '%whatsapp_aguardar_resposta%', 1, 0);

SET @sql := IF(@ja_existe = 0,
  "ALTER TABLE smartflow_passos MODIFY COLUMN tipoPasso ENUM(
    'ia_classificar',
    'ia_responder',
    'ia_extrair_campos',
    'crm_buscar_contato',
    'crm_listar_acoes_cliente',
    'processo_buscar_movimentacoes',
    'calcom_horarios',
    'calcom_agendar',
    'calcom_listar',
    'calcom_cancelar',
    'calcom_remarcar',
    'whatsapp_enviar',
    'whatsapp_aguardar_resposta',
    'transferir',
    'condicional',
    'esperar',
    'webhook',
    'kanban_criar_card',
    'kanban_mover_card',
    'kanban_atribuir_responsavel',
    'kanban_tags',
    'asaas_gerar_cobranca',
    'asaas_cancelar_cobranca',
    'asaas_consultar_valor_aberto',
    'asaas_marcar_recebida',
    'definir_variavel',
    'definir_campo_personalizado'
  ) NOT NULL",
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 0123_smartflow_passos_crm_processo: adiciona 3 tipos de passo novos ao
-- enum `smartflow_passos.tipoPasso`:
--   * crm_buscar_contato — resolve contato por telefone/email/cpf
--   * crm_listar_acoes_cliente — lista cliente_processos do contato
--   * processo_buscar_movimentacoes — lê eventos_processo de uma ação
--
-- Esses 3 nós destravam fluxos onde a IA precisa ler dados do CRM/processos
-- antes de responder. Idempotente — detecta o estado atual do enum.

SET @enum_def := (
  SELECT COLUMN_TYPE FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'smartflow_passos'
    AND column_name = 'tipoPasso'
);

-- Precisamos detectar se TODOS os 3 já existem. Se algum faltar, reescreve.
SET @falta := IF(
  @enum_def LIKE '%crm_buscar_contato%'
    AND @enum_def LIKE '%crm_listar_acoes_cliente%'
    AND @enum_def LIKE '%processo_buscar_movimentacoes%',
  0, 1
);

SET @sql := IF(@falta = 1,
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

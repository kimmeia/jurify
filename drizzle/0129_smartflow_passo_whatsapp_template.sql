-- 0129_smartflow_passo_whatsapp_template: adiciona o passo `whatsapp_template`
-- ao enum `smartflow_passos.tipoPasso`. Esse passo envia um template aprovado
-- da Cloud API oficial (Meta), com cada variável {{N}} ligada a um dado do fluxo.
--
-- A lista é o enum COMPLETO atual de schema.ts. MODIFY pra superset é
-- não-destrutivo e idempotente. (O auto-migrate também garante isso a cada boot
-- a partir da lista fonte-da-verdade.)

SET @enum_def := (
  SELECT COLUMN_TYPE FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'smartflow_passos'
    AND column_name = 'tipoPasso'
);
SET @ja_existe := IF(@enum_def LIKE '%whatsapp_template%', 1, 0);

SET @sql := IF(@ja_existe = 0,
  "ALTER TABLE smartflow_passos MODIFY COLUMN tipoPasso ENUM(
    'ia_classificar',
    'ia_responder',
    'ia_consultar',
    'ia_atendente',
    'ia_extrair_campos',
    'crm_buscar_contato',
    'crm_listar_acoes_cliente',
    'processo_buscar_movimentacoes',
    'calcom_horarios',
    'calcom_agendar',
    'calcom_listar',
    'calcom_cancelar',
    'calcom_remarcar',
    'agenda_criar',
    'whatsapp_enviar',
    'whatsapp_template',
    'whatsapp_aguardar_resposta',
    'transferir',
    'condicional',
    'para_cada_item',
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
    'definir_campo_personalizado',
    'contato_tags'
  ) NOT NULL",
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

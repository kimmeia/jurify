-- 0127_smartflow_passo_contato_tags: adiciona o passo `contato_tags` ao enum
-- `smartflow_passos.tipoPasso`. Esse passo adiciona/remove/define as tags do
-- CONTATO no CRM (contatos.tags) — diferente de `kanban_tags`, que é de card.
--
-- Lista = enum COMPLETO atual de `drizzle/schema.ts` + `contato_tags`. MODIFY
-- pra superset é não-destrutivo. Idempotente — detecta o valor antes.

SET @enum_def := (
  SELECT COLUMN_TYPE FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'smartflow_passos'
    AND column_name = 'tipoPasso'
);
SET @ja_existe := IF(@enum_def LIKE '%contato_tags%', 1, 0);

SET @sql := IF(@ja_existe = 0,
  "ALTER TABLE smartflow_passos MODIFY COLUMN tipoPasso ENUM(
    'ia_classificar',
    'ia_responder',
    'ia_consultar',
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

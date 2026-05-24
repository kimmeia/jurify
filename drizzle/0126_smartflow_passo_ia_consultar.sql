-- 0126_smartflow_passo_ia_consultar: adiciona o passo `ia_consultar` ao enum
-- `smartflow_passos.tipoPasso`. Esse passo faz uma consulta interna à IA
-- (pergunta → resposta) e salva o resultado num campo do contexto, SEM enviar
-- nada ao cliente — diferente de `ia_responder`.
--
-- A lista abaixo é o enum COMPLETO atual de `drizzle/schema.ts` (inclui
-- `agenda_criar`, que ficou ausente de migrations anteriores) + `ia_consultar`.
-- MODIFY pra um superset é não-destrutivo: nenhum valor existente é removido.
--
-- Idempotente — detecta o valor no enum antes de reescrever.

SET @enum_def := (
  SELECT COLUMN_TYPE FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'smartflow_passos'
    AND column_name = 'tipoPasso'
);
SET @ja_existe := IF(@enum_def LIKE '%ia_consultar%', 1, 0);

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
    'definir_campo_personalizado'
  ) NOT NULL",
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

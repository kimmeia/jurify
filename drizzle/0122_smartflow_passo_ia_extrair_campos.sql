-- 0122_smartflow_passo_ia_extrair_campos: adiciona o tipo de passo
-- `ia_extrair_campos` ao enum de `smartflow_passos.tipoPasso`. Esse passo
-- novo usa tool calling pra IA devolver dados estruturados em vez de texto
-- livre — resolve o caso "cliente diz CPF, IA salva no campo personalizado
-- automaticamente".
--
-- Compatível com MySQL 5.7+: usa INFORMATION_SCHEMA pra detectar se o valor
-- já está no enum e reescreve o enum inteiro só se necessário (idempotente).

SET @enum_def := (
  SELECT COLUMN_TYPE FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'smartflow_passos'
    AND column_name = 'tipoPasso'
);

SET @ja_existe := IF(@enum_def LIKE '%ia_extrair_campos%', 1, 0);

SET @sql := IF(@ja_existe = 0,
  "ALTER TABLE smartflow_passos MODIFY COLUMN tipoPasso ENUM(
    'ia_classificar',
    'ia_responder',
    'ia_extrair_campos',
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

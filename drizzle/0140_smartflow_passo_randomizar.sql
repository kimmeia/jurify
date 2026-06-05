-- Novo tipo de passo SmartFlow: randomizar (split aleatório do fluxo).
-- Bloco com N opções, cada uma com peso opcional. Lead sorteia uma saída
-- (cond_<id>) e segue pelo ramo correspondente. Útil pra A/B testing de
-- mensagens iniciais ou distribuição balanceada entre fluxos paralelos.
-- Engine: server/smartflow/engine.ts:handleRandomizar.
ALTER TABLE smartflow_passos
  MODIFY COLUMN tipoPasso ENUM(
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
    'whatsapp_aguardar_resposta',
    'whatsapp_pergunta_opcoes',
    'transferir',
    'distribuir_atendimento',
    'condicional',
    'randomizar',
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
  ) NOT NULL;

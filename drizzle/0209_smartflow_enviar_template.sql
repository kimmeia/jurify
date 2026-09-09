-- Passo "Enviar template" no SmartFlow.
--
-- Template (HSM) aprovado da Meta que ALCANÇA o cliente fora da janela de
-- 24h e pausa o fluxo esperando a resposta — cada botão quick-reply vira
-- uma saída do bloco (follow-up sem punição: categoria Utility, opt-in do
-- guard, Marketing só com confirmação extra).
--
-- Acrescentar valor a ENUM é aditivo: nenhuma linha existente muda, e a
-- lista inteira precisa ser repetida porque o MySQL não tem "ADD VALUE".
-- (O boot também roda um MODIFY derivado do schema.ts — esta migration
-- garante o valor antes do primeiro save, sem depender da ordem do boot.)
ALTER TABLE smartflow_passos
  MODIFY COLUMN tipoPasso ENUM(
    'ia_classificar','ia_responder','ia_consultar','ia_atendente','ia_extrair_campos',
    'crm_buscar_contato','crm_listar_acoes_cliente','processo_buscar_movimentacoes',
    'calcom_horarios','calcom_agendar','calcom_listar','calcom_cancelar','calcom_remarcar',
    'agenda_criar','whatsapp_enviar','whatsapp_aguardar_resposta','whatsapp_pergunta_opcoes',
    'whatsapp_enviar_template',
    'transferir','encerrar_conversa','distribuir_atendimento',
    'condicional','randomizar','para_cada_item','esperar','webhook',
    'kanban_criar_card','kanban_mover_card','kanban_atribuir_responsavel','kanban_tags',
    'asaas_gerar_cobranca','asaas_cancelar_cobranca','asaas_consultar_valor_aberto','asaas_marcar_recebida',
    'definir_variavel','definir_campo_personalizado','contato_tags'
  ) NOT NULL;

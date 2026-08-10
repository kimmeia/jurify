-- Passo "Encerrar conversa" no SmartFlow.
--
-- Par do "Transferir p/ humano", com a diferença que importa: transferir marca
-- a conversa como em_atendimento (humano assumiu, bot cala pra sempre naquela
-- conversa); encerrar marca resolvido (ninguém assumiu, o assunto acabou — e
-- mensagem nova do cliente reabre o atendimento normalmente).
--
-- Acrescentar valor a ENUM é aditivo: nenhuma linha existente muda, e a lista
-- inteira precisa ser repetida porque o MySQL não tem "ADD VALUE".
ALTER TABLE smartflow_passos
  MODIFY COLUMN tipoPasso ENUM(
    'ia_classificar','ia_responder','ia_consultar','ia_atendente','ia_extrair_campos',
    'crm_buscar_contato','crm_listar_acoes_cliente','processo_buscar_movimentacoes',
    'calcom_horarios','calcom_agendar','calcom_listar','calcom_cancelar','calcom_remarcar',
    'agenda_criar','whatsapp_enviar','whatsapp_aguardar_resposta','whatsapp_pergunta_opcoes',
    'transferir','encerrar_conversa','distribuir_atendimento',
    'condicional','randomizar','para_cada_item','esperar','webhook',
    'kanban_criar_card','kanban_mover_card','kanban_atribuir_responsavel','kanban_tags',
    'asaas_gerar_cobranca','asaas_cancelar_cobranca','asaas_consultar_valor_aberto','asaas_marcar_recebida',
    'definir_variavel','definir_campo_personalizado','contato_tags'
  ) NOT NULL;

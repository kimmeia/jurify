import type { TipoPasso } from "@shared/smartflow-types";

/**
 * Helper puro: resolve as variáveis que cada tipo de passo publica no
 * contexto. Usado pelo editor pra montar a categoria "Resultados de passos
 * anteriores" no drawer de variáveis (`PainelVariaveis`).
 *
 * Mantém em sincronia com `server/smartflow/engine.ts` — cada handler que
 * faz `{ ...ctx, X: valor }` deve ter X listado aqui.
 */

export interface VarSaida {
  /** Caminho usado em {{...}} — ex: "respostaIA", "kanbanCardId". */
  path: string;
  /** Rótulo humano — descrição curta. */
  label: string;
  /** Tipo aproximado do valor — só pra orientar o usuário. */
  tipo: "texto" | "número" | "lista" | "objeto" | "booleano" | "link";
}

const SAIDA_POR_TIPO: Record<TipoPasso, VarSaida[]> = {
  ia_classificar: [
    { path: "intencao", label: "Categoria detectada pela IA", tipo: "texto" },
  ],
  ia_responder: [
    { path: "respostaIA", label: "Resposta gerada pela IA", tipo: "texto" },
  ],
  // Variáveis publicadas por ia_extrair_campos são dinâmicas (chaves da config) —
  // resolvidas em `variaveisPublicadasPorPasso`. Vazio aqui só satisfaz o tipo.
  ia_extrair_campos: [],
  crm_buscar_contato: [
    { path: "contatoEncontrado", label: "True se achou o contato, false se não", tipo: "booleano" },
    { path: "contatoId", label: "ID do contato encontrado (substitui o anterior)", tipo: "número" },
    { path: "nomeCliente", label: "Nome do contato", tipo: "texto" },
    { path: "telefoneCliente", label: "Telefone do contato", tipo: "texto" },
    { path: "emailCliente", label: "Email do contato", tipo: "texto" },
    { path: "cliente.campos", label: "Campos personalizados do contato (objeto)", tipo: "objeto" },
  ],
  crm_listar_acoes_cliente: [
    { path: "acoes", label: "Lista de processos do cliente (id, CNJ, classe, polo, tipo, valorCausa)", tipo: "lista" },
    { path: "acoesQuantidade", label: "Quantidade de ações listadas", tipo: "número" },
  ],
  processo_buscar_movimentacoes: [
    { path: "movimentacoes", label: "Lista de eventos (tipo, dataEvento, conteudo, fonte)", tipo: "lista" },
    { path: "movimentacoesQuantidade", label: "Quantidade de eventos retornados", tipo: "número" },
    { path: "movimentacaoMaisRecente", label: "Primeiro evento (mais recente) ou null", tipo: "objeto" },
  ],
  calcom_horarios: [
    { path: "horariosDisponiveis", label: "Lista de horários disponíveis", tipo: "lista" },
  ],
  calcom_agendar: [
    { path: "agendamentoId", label: "ID do agendamento criado", tipo: "texto" },
  ],
  calcom_listar: [
    { path: "bookings", label: "Lista de agendamentos do Cal.com", tipo: "lista" },
    { path: "bookingsQuantidade", label: "Quantidade de agendamentos", tipo: "número" },
  ],
  calcom_cancelar: [
    { path: "bookingCancelado", label: "ID do agendamento cancelado", tipo: "texto" },
  ],
  calcom_remarcar: [
    { path: "horarioEscolhido", label: "Novo horário (sobrescreve o anterior)", tipo: "texto" },
  ],
  whatsapp_enviar: [
    { path: "mensagensEnviadas", label: "Lista de mensagens enviadas", tipo: "lista" },
  ],
  whatsapp_aguardar_resposta: [
    { path: "respostaUsuario", label: "Texto da resposta do cliente (após retomar)", tipo: "texto" },
    { path: "opcaoEscolhida", label: "{indice, texto, numero} quando há menu de opções", tipo: "objeto" },
    { path: "mensagensEnviadas", label: "Mensagens enviadas no fluxo", tipo: "lista" },
  ],
  transferir: [
    { path: "transferir", label: "Sinaliza transferência pra humano (encerra)", tipo: "booleano" },
  ],
  condicional: [],
  // para_cada_item publica `item` e `indice` DENTRO do corpo do loop —
  // resolução dinâmica em `variaveisPublicadasPorPasso`.
  para_cada_item: [],
  esperar: [],
  webhook: [
    { path: "webhookResultado", label: "Resposta JSON do webhook chamado", tipo: "objeto" },
  ],
  kanban_criar_card: [
    { path: "kanbanCardId", label: "ID do card criado", tipo: "número" },
  ],
  kanban_mover_card: [
    { path: "kanbanCardId", label: "ID do card movido (preserva)", tipo: "número" },
  ],
  kanban_atribuir_responsavel: [
    { path: "kanbanCardId", label: "ID do card (preserva)", tipo: "número" },
  ],
  kanban_tags: [
    { path: "kanbanCardId", label: "ID do card (preserva)", tipo: "número" },
  ],
  asaas_gerar_cobranca: [
    { path: "pagamentoId", label: "ID da cobrança no Asaas", tipo: "texto" },
    { path: "pagamentoLink", label: "Link de pagamento (fatura)", tipo: "link" },
  ],
  asaas_cancelar_cobranca: [],
  asaas_consultar_valor_aberto: [
    { path: "valorTotalAberto", label: "Total em aberto (pendente + vencido), em reais", tipo: "número" },
    { path: "valorTotalPendente", label: "Apenas pendente (não vencido)", tipo: "número" },
    { path: "valorTotalVencido", label: "Apenas vencido", tipo: "número" },
    { path: "cobrancasAbertasQtd", label: "Quantidade de cobranças em aberto", tipo: "número" },
  ],
  asaas_marcar_recebida: [],
  definir_variavel: [],
  definir_campo_personalizado: [],
};

/** Heurística pra mapear tipo lógico do campo extraído → tipo de exibição. */
function mapearTipo(tipo?: string): VarSaida["tipo"] {
  if (tipo === "numero") return "número";
  if (tipo === "boolean") return "booleano";
  if (tipo === "lista_texto") return "lista";
  return "texto";
}

/**
 * Resolve as variáveis que um passo publica no contexto, incluindo as
 * dinâmicas (extracao.*, item/indice de loop, chave de definir_variavel).
 */
export function variaveisPublicadasPorPasso(
  tipoPasso: TipoPasso | null,
  configPasso?: Record<string, unknown>,
): VarSaida[] {
  if (!tipoPasso) return [];
  if (tipoPasso === "definir_variavel") {
    const chave = String(configPasso?.chave || "").trim();
    if (!chave) return [];
    return [{ path: chave, label: `Variável customizada definida no passo`, tipo: "texto" }];
  }
  if (tipoPasso === "definir_campo_personalizado") {
    const chave = String(configPasso?.chave || "").trim();
    if (!chave) return [];
    return [{ path: `cliente.campos.${chave}`, label: "Campo personalizado salvo no cadastro", tipo: "texto" }];
  }
  if (tipoPasso === "para_cada_item") {
    const nomeVar = String(configPasso?.nomeVarItem || "item").trim() || "item";
    return [
      { path: nomeVar, label: "Item atual da iteração (objeto da lista)", tipo: "objeto" },
      { path: "indice", label: "Posição na lista (0-indexed)", tipo: "número" },
    ];
  }
  if (tipoPasso === "ia_extrair_campos") {
    const campos = Array.isArray(configPasso?.campos)
      ? (configPasso!.campos as Array<{ chave: string; tipo?: string; persistir?: boolean }>)
      : [];
    const out: VarSaida[] = [];
    for (const c of campos) {
      const chave = String(c.chave || "").trim();
      if (!chave) continue;
      out.push({ path: `extracao.${chave}`, label: `Valor extraído (${c.tipo || "texto"})`, tipo: mapearTipo(c.tipo) });
      if (c.persistir) {
        out.push({ path: `cliente.campos.${chave}`, label: "Persistido no cadastro do cliente", tipo: mapearTipo(c.tipo) });
      }
    }
    return out;
  }
  return SAIDA_POR_TIPO[tipoPasso] || [];
}

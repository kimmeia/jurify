/**
 * Tipos compartilhados do SmartFlow — automações com IA + WhatsApp + Cal.com.
 *
 * Config discriminada por `tipo` de passo. Usada no frontend (editor ReactFlow)
 * e no backend (validação Zod, engine). Mantém compatibilidade binária com
 * PassoConfig/Passo existentes em server/smartflow/engine.ts.
 */
import type { LucideIcon } from "lucide-react";

export type GatilhoSmartflow =
  | "whatsapp_mensagem"
  | "mensagem_canal"
  | "novo_lead"
  | "agendamento_criado"
  | "agendamento_cancelado"
  | "agendamento_remarcado"
  | "agendamento_lembrete"
  | "pagamento_recebido"
  | "pagamento_vencido"
  | "pagamento_proximo_vencimento"
  | "manual";

/**
 * Tipos de canal que podem disparar o gatilho `mensagem_canal`.
 * Alinhado com o enum `tipoCanal` em `canais_integrados` (drizzle/schema.ts).
 */
export type TipoCanalMensagem =
  | "whatsapp_qr"
  | "whatsapp_api"
  | "instagram"
  | "facebook";

/**
 * Agrupa gatilhos e passos por provider/categoria. Puramente visual — a UX
 * da paleta do editor usa isso pra renderizar seções. O modelo de dados
 * permanece flat.
 */
export type GrupoSmartflow = "mensagem" | "asaas" | "calcom" | "crm" | "ia" | "acoes" | "fluxo";

export interface GrupoMeta {
  id: GrupoSmartflow;
  label: string;
  /** Ordem de exibição na paleta (menor primeiro). */
  ordem: number;
}

export const GRUPO_META: ReadonlyArray<GrupoMeta> = [
  { id: "mensagem", label: "Mensagem", ordem: 1 },
  { id: "asaas", label: "Asaas (financeiro)", ordem: 2 },
  { id: "calcom", label: "Cal.com (agenda)", ordem: 3 },
  { id: "crm", label: "CRM", ordem: 4 },
  { id: "ia", label: "Inteligência artificial", ordem: 5 },
  { id: "acoes", label: "Ações", ordem: 6 },
  { id: "fluxo", label: "Controle de fluxo", ordem: 7 },
];

export function getGrupoMeta(id: string): GrupoMeta | null {
  return GRUPO_META.find((g) => g.id === id) ?? null;
}

export type TipoPasso =
  | "ia_classificar"
  | "ia_responder"
  | "calcom_horarios"
  | "calcom_agendar"
  | "calcom_listar"
  | "calcom_cancelar"
  | "calcom_remarcar"
  | "whatsapp_enviar"
  | "transferir"
  | "condicional"
  | "esperar"
  | "webhook"
  | "kanban_criar_card"
  | "kanban_mover_card"
  | "kanban_atribuir_responsavel"
  | "kanban_tags"
  | "asaas_gerar_cobranca"
  | "asaas_cancelar_cobranca"
  | "asaas_consultar_valor_aberto"
  | "asaas_marcar_recebida"
  | "definir_variavel"
  | "definir_campo_personalizado";

/**
 * Categorias de passos com popover na paleta. Cada categoria agrupa
 * subtipos relacionados (ex: "Kanban" → criar/mover/atribuir/tags).
 * Renderização: 1 botão da categoria; clique abre popover com
 * `tipos[]`. Tipos sem categoria são listados direto na paleta.
 */
export type CategoriaPasso = "kanban" | "agendamento" | "asaas" | "geral";

export interface CategoriaPassoMeta {
  id: CategoriaPasso;
  label: string;
  /** Grupo da paleta onde a categoria aparece. Hoje todas em "acoes". */
  grupo: GrupoSmartflow;
  /** Subtipos cobertos. Ordem aqui = ordem no popover. */
  tipos: TipoPasso[];
}

export const CATEGORIAS_PASSO: ReadonlyArray<CategoriaPassoMeta> = [
  {
    id: "kanban",
    label: "Kanban",
    grupo: "acoes",
    tipos: [
      "kanban_criar_card",
      "kanban_mover_card",
      "kanban_atribuir_responsavel",
      "kanban_tags",
    ],
  },
  {
    id: "agendamento",
    label: "Agendamento (Cal.com)",
    grupo: "acoes",
    tipos: [
      "calcom_horarios",
      "calcom_agendar",
      "calcom_listar",
      "calcom_cancelar",
      "calcom_remarcar",
    ],
  },
  {
    id: "asaas",
    label: "Financeiro (Asaas)",
    grupo: "acoes",
    tipos: [
      "asaas_gerar_cobranca",
      "asaas_cancelar_cobranca",
      "asaas_consultar_valor_aberto",
      "asaas_marcar_recebida",
    ],
  },
  {
    id: "geral",
    label: "Geral",
    grupo: "acoes",
    tipos: ["definir_variavel", "definir_campo_personalizado"],
  },
];

export function getCategoriaMeta(id: string): CategoriaPassoMeta | null {
  return CATEGORIAS_PASSO.find((c) => c.id === id) ?? null;
}

export function getCategoriaDoTipo(tipo: TipoPasso): CategoriaPasso | null {
  const cat = CATEGORIAS_PASSO.find((c) => c.tipos.includes(tipo));
  return cat?.id ?? null;
}

export type StatusExecucao = "rodando" | "concluido" | "erro" | "cancelado";

export type OperadorCondicional =
  | "igual"
  | "diferente"
  | "existe"
  | "nao_existe"
  | "verdadeiro"
  | "maior"
  | "menor"
  | "contem"
  | "entre";

export type PrioridadeCard = "baixa" | "media" | "alta";

export interface ConfigIaClassificar {
  categorias?: string[];
}
export interface ConfigIaResponder {
  /**
   * ID do agente de IA pré-configurado (tabela `agentesIa`). Se preenchido,
   * o engine usa o prompt, modelo, temperatura e docs RAG do agente — ignora
   * o campo `prompt` abaixo.
   */
  agenteId?: number;
  /** Fallback: prompt textual livre quando não há agente selecionado. */
  prompt?: string;
}
export interface ConfigCalcomHorarios {
  duracao?: number;
}
export interface ConfigCalcomAgendar {
  /** reservado para futuras configs (eventTypeId, email padrão, etc.) */
}
export interface ConfigCalcomListar {
  /** Filtro de status — default: upcoming. */
  status?: "upcoming" | "past" | "cancelled" | "unconfirmed";
}
export interface ConfigCalcomCancelar {
  /**
   * ID do booking a cancelar. Se vazio, usa `ctx.agendamentoId` (default
   * quando o cenário foi disparado por gatilho de agendamento).
   */
  bookingId?: string;
  /** Motivo do cancelamento (opcional, enviado ao Cal.com). */
  motivo?: string;
}
export interface ConfigCalcomRemarcar {
  /** ID do booking. Se vazio, usa `ctx.agendamentoId`. */
  bookingId?: string;
  /**
   * Novo horário. Se vazio, usa `ctx.horarioEscolhido` (preenchido por um
   * passo `calcom_horarios` anterior ou pelo contexto do gatilho).
   */
  novoHorario?: string;
  motivo?: string;
}
export interface ConfigWhatsappEnviar {
  template?: string;
}
export interface ConfigTransferir {
  /** reservado */
}
/**
 * Uma condição individual avaliada pelo passo `condicional`. Cada condição
 * tem um `id` estável (UUID do editor) usado pela chave de roteamento em
 * `proximoSe` — `cond_<id>`. O `valor2` é opcional, usado só pelo operador
 * `entre` (range numérico inclusivo).
 */
export interface ConfigCondicionalItem {
  id: string;
  /** Nome amigável da condição ("Cliente VIP", "Urgente", etc.) — usado no
   *  nó do canvas e no painel. Quando vazio, o editor mostra "Condição N". */
  label?: string;
  campo: string;
  operador: OperadorCondicional;
  valor?: string;
  /** Limite superior do range para operador `entre`. */
  valor2?: string;
}

export interface ConfigCondicional {
  /**
   * Lista de condições avaliadas em ordem; primeira que bate determina a
   * saída. Quando nenhuma bate, o engine segue pela chave "fallback" no
   * `proximoSe` (se configurada) ou para o fluxo.
   */
  condicoes?: ConfigCondicionalItem[];
  /** @deprecated — shape legado: uma única condição embutida. Ainda
   * suportado pelo engine (convertido on-the-fly para `condicoes[0]`). */
  campo?: string;
  /** @deprecated */
  operador?: OperadorCondicional;
  /** @deprecated */
  valor?: string;
}

/**
 * Mapa `ramoId → clienteId do passo alvo`, serializado como JSON na coluna
 * `smartflow_passos.proximoSe`. Chaves possíveis:
 *   - "default" — próximo passo linear quando não há condicional.
 *   - "cond_<id>" — saída quando a condição `<id>` é verdadeira.
 *   - "fallback" — saída quando nenhuma condição bate.
 * Se `null` ou mapa vazio, o engine usa `ordem` sequencial (legado).
 */
export type ProximoSe = Record<string, string> | null;
export interface ConfigEsperar {
  delayMinutos?: number;
}
export interface ConfigWebhook {
  url?: string;
}
export interface ConfigKanbanCriarCard {
  titulo?: string;
  funilId?: number;
  colunaId?: number;
  prioridade?: PrioridadeCard;
}

/**
 * Move um card existente para outra coluna. `cardId` aceita interpolação
 * de variáveis (ex: `{{kanbanCardId}}` — preenchido por um passo
 * `kanban_criar_card` anterior). Quando vazio, usa `ctx.kanbanCardId`.
 */
export interface ConfigKanbanMoverCard {
  cardId?: string;
  colunaDestinoId?: number;
}

/**
 * Atribui um responsável (colaborador) a um card. Resolução do
 * `responsavelId` em ordem: explícito > auto (atendenteResponsavelId do
 * cliente, se `responsavelAuto` ≠ false) > fallback nulo (sem mudança).
 */
export interface ConfigKanbanAtribuirResponsavel {
  cardId?: string;
  responsavelId?: number;
  /** Default true — usa atendenteResponsavelId do cliente vinculado. */
  responsavelAuto?: boolean;
}

export type ModoTagsKanban = "adicionar" | "remover" | "definir";

/**
 * Manipula as tags de um card (CSV em `kanbanCards.tags`). `tags` aceita
 * interpolação (`{{...}}`); separador é vírgula. `modo`:
 *   - `adicionar` (default): união com tags atuais.
 *   - `remover`: remove as tags listadas das atuais.
 *   - `definir`: substitui completamente.
 */
export interface ConfigKanbanTags {
  cardId?: string;
  tags?: string;
  modo?: ModoTagsKanban;
}

export type TipoCobrancaAsaas = "BOLETO" | "PIX" | "CREDIT_CARD";

/**
 * Gera uma cobrança avulsa no Asaas pro cliente vinculado ao contexto
 * (`ctx.contatoId`). Resolve o `customerId` Asaas via `asaasClientes`
 * (vínculo primário). Valor/descrição interpoláveis.
 */
export interface ConfigAsaasGerarCobranca {
  /** Em reais (string pra permitir interpolação `{{pagamentoValor}}`). */
  valor?: string;
  descricao?: string;
  /** Default 7. Vencimento = hoje + N dias. */
  vencimentoDias?: number;
  /** Default BOLETO. */
  tipoCobranca?: TipoCobrancaAsaas;
}

export interface ConfigAsaasCancelarCobranca {
  /** Default `{{pagamentoId}}` do contexto. */
  pagamentoId?: string;
}

/** Sem config; usa `ctx.contatoId`. Escreve resumo no contexto. */
export interface ConfigAsaasConsultarValorAberto {}

export interface ConfigAsaasMarcarRecebida {
  pagamentoId?: string;
  /** Opcional: se vazio usa o valor da cobrança original. */
  valorRecebido?: string;
  /** ISO `YYYY-MM-DD`; default: hoje. */
  dataRecebimento?: string;
}

/**
 * Persiste um valor em `contatos.camposPersonalizados[chave]` do
 * cliente vinculado ao contexto. Diferente de `definir_variavel`, que
 * só vive na execução. A `chave` deve existir no catálogo do escritório
 * (`camposPersonalizadosCliente`) — caso contrário o passo falha com
 * mensagem clara.
 */
export interface ConfigDefinirCampoPersonalizado {
  chave?: string;
  valor?: string;
}

/**
 * Union discriminada por `tipo`. Usada no editor pra garantir type-safety
 * do painel de configuração. O backend aceita `config` como objeto livre
 * (por compatibilidade) mas esses tipos documentam o shape esperado.
 */
export type PassoConfigByTipo =
  | { tipo: "ia_classificar"; config: ConfigIaClassificar }
  | { tipo: "ia_responder"; config: ConfigIaResponder }
  | { tipo: "calcom_horarios"; config: ConfigCalcomHorarios }
  | { tipo: "calcom_agendar"; config: ConfigCalcomAgendar }
  | { tipo: "calcom_listar"; config: ConfigCalcomListar }
  | { tipo: "calcom_cancelar"; config: ConfigCalcomCancelar }
  | { tipo: "calcom_remarcar"; config: ConfigCalcomRemarcar }
  | { tipo: "whatsapp_enviar"; config: ConfigWhatsappEnviar }
  | { tipo: "transferir"; config: ConfigTransferir }
  | { tipo: "condicional"; config: ConfigCondicional }
  | { tipo: "esperar"; config: ConfigEsperar }
  | { tipo: "webhook"; config: ConfigWebhook }
  | { tipo: "kanban_criar_card"; config: ConfigKanbanCriarCard }
  | { tipo: "kanban_mover_card"; config: ConfigKanbanMoverCard }
  | { tipo: "kanban_atribuir_responsavel"; config: ConfigKanbanAtribuirResponsavel }
  | { tipo: "kanban_tags"; config: ConfigKanbanTags }
  | { tipo: "asaas_gerar_cobranca"; config: ConfigAsaasGerarCobranca }
  | { tipo: "asaas_cancelar_cobranca"; config: ConfigAsaasCancelarCobranca }
  | { tipo: "asaas_consultar_valor_aberto"; config: ConfigAsaasConsultarValorAberto }
  | { tipo: "asaas_marcar_recebida"; config: ConfigAsaasMarcarRecebida }
  | { tipo: "definir_campo_personalizado"; config: ConfigDefinirCampoPersonalizado };

export interface PassoSmartflow {
  id?: number;
  ordem: number;
  tipo: TipoPasso;
  config: Record<string, unknown>;
}

export interface CenarioSmartflow {
  id: number;
  nome: string;
  descricao?: string | null;
  gatilho: GatilhoSmartflow;
  ativo: boolean;
  criadoPor?: number | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
  passos?: PassoSmartflow[];
}

export interface ExecucaoSmartflow {
  id: number;
  cenarioId: number;
  escritorioId: number;
  contatoId?: number | null;
  conversaId?: number | null;
  status: StatusExecucao;
  passoAtual: number;
  contexto?: string | null;
  erro?: string | null;
  retomarEm?: Date | string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

/** Metadados de UI (usados no frontend p/ render). */
export interface TipoPassoMeta {
  id: TipoPasso;
  label: string;
  descricao: string;
  /** Classe Tailwind para background/texto do chip. */
  cor: string;
  /** Grupo para agrupar visualmente na paleta. */
  grupo: GrupoSmartflow;
}

export interface GatilhoMeta {
  id: GatilhoSmartflow;
  label: string;
  descricao: string;
  /** Grupo para agrupar visualmente na paleta. */
  grupo: GrupoSmartflow;
}

export interface TipoCanalMeta {
  id: TipoCanalMensagem;
  label: string;
  /** true = canal ainda não tem integração de entrada funcionando. */
  emBreve?: boolean;
}

/**
 * Configuração específica do gatilho — persistida em `configGatilhoSF` como
 * JSON. Cada gatilho tem um shape próprio; o editor e o dispatcher fazem
 * narrowing pelo valor de `gatilho`.
 */
export interface ConfigGatilhoMensagemCanal {
  /** Canais permitidos. Vazio/ausente = aceita qualquer canal. */
  canais?: TipoCanalMensagem[];
}

/**
 * Campos comuns de janela de disparo dos gatilhos Asaas. Todos opcionais —
 * quando `horarioInicial` está vazio, o scheduler mantém o comportamento
 * legado (dedupe de 24h, disparo assim que o cron roda).
 */
export interface JanelaDisparo {
  /** Primeiro horário do dia, formato "HH:MM" (timezone America/Sao_Paulo). */
  horarioInicial?: string;
  /** Quantos disparos por dia, a partir de `horarioInicial`. Default: 1 */
  disparosPorDia?: number;
  /** Minutos entre disparos sucessivos dentro do mesmo dia. Default: 120 */
  intervaloMinutos?: number;
  /** Por quantos dias consecutivos repetir. Default: 1 */
  repetirPorDias?: number;
}

export interface ConfigGatilhoPagamentoVencido extends JanelaDisparo {
  /** Dispara só se a cobrança estiver atrasada há pelo menos N dias. Default: 0 */
  diasAtraso?: number;
}

export interface ConfigGatilhoPagamentoProximoVencimento extends JanelaDisparo {
  /** Dispara se a cobrança vence em até N dias. Default: 3 */
  diasAntes?: number;
}

/**
 * Lembrete de agendamento do Cal.com — o scheduler dispara quando faltam
 * `diasAntes` dias pro booking no `horario` configurado. Ex: `diasAntes=1`
 * + `horario="18:00"` dispara às 18:00 da véspera.
 */
export interface ConfigGatilhoAgendamentoLembrete {
  /** Quantos dias antes do agendamento disparar. Default: 1 */
  diasAntes?: number;
  /** Horário de disparo "HH:MM". Default: "18:00" */
  horario?: string;
}

export type ConfigGatilhoByTipo =
  | { gatilho: "mensagem_canal"; config: ConfigGatilhoMensagemCanal }
  | { gatilho: "pagamento_vencido"; config: ConfigGatilhoPagamentoVencido }
  | { gatilho: "pagamento_proximo_vencimento"; config: ConfigGatilhoPagamentoProximoVencimento }
  | { gatilho: "agendamento_lembrete"; config: ConfigGatilhoAgendamentoLembrete }
  | { gatilho: Exclude<GatilhoSmartflow, "mensagem_canal" | "pagamento_vencido" | "pagamento_proximo_vencimento" | "agendamento_lembrete">; config: Record<string, unknown> };

export const TIPO_PASSO_META: ReadonlyArray<TipoPassoMeta> = [
  { id: "ia_classificar", label: "Classificar intenção (IA)", descricao: "Usa IA para categorizar a mensagem.", cor: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300", grupo: "ia" },
  { id: "ia_responder", label: "Responder com IA", descricao: "Gera resposta contextual com IA.", cor: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300", grupo: "ia" },
  { id: "calcom_horarios", label: "Buscar horários (Cal.com)", descricao: "Busca slots disponíveis no Cal.com.", cor: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300", grupo: "acoes" },
  { id: "calcom_agendar", label: "Criar agendamento", descricao: "Confirma o horário no Cal.com.", cor: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300", grupo: "acoes" },
  { id: "calcom_listar", label: "Listar agendamentos", descricao: "Busca bookings no Cal.com e grava no contexto.", cor: "bg-lime-100 text-lime-700 dark:bg-lime-900/40 dark:text-lime-300", grupo: "acoes" },
  { id: "calcom_cancelar", label: "Cancelar agendamento", descricao: "Cancela um booking pelo ID.", cor: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300", grupo: "acoes" },
  { id: "calcom_remarcar", label: "Remarcar agendamento", descricao: "Reagenda um booking para novo horário.", cor: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300", grupo: "acoes" },
  { id: "whatsapp_enviar", label: "Enviar mensagem", descricao: "Envia mensagem pelo WhatsApp.", cor: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300", grupo: "mensagem" },
  { id: "transferir", label: "Transferir p/ humano", descricao: "Encerra o fluxo e notifica atendente.", cor: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300", grupo: "mensagem" },
  { id: "condicional", label: "Condição (if/else)", descricao: "Continua só se a condição for atendida.", cor: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300", grupo: "fluxo" },
  { id: "esperar", label: "Esperar (delay)", descricao: "Pausa o fluxo por N minutos.", cor: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300", grupo: "fluxo" },
  { id: "webhook", label: "Webhook externo", descricao: "POST para uma URL externa.", cor: "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300", grupo: "fluxo" },
  { id: "kanban_criar_card", label: "Criar card Kanban", descricao: "Cria card no funil/coluna escolhido.", cor: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300", grupo: "acoes" },
  { id: "kanban_mover_card", label: "Mover card Kanban", descricao: "Move um card existente para outra coluna.", cor: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300", grupo: "acoes" },
  { id: "kanban_atribuir_responsavel", label: "Atribuir responsável (Kanban)", descricao: "Define o colaborador responsável pelo card.", cor: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300", grupo: "acoes" },
  { id: "kanban_tags", label: "Tags do card (Kanban)", descricao: "Adiciona, remove ou substitui tags de um card.", cor: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300", grupo: "acoes" },
  { id: "asaas_gerar_cobranca", label: "Gerar cobrança (Asaas)", descricao: "Cria cobrança avulsa pro cliente vinculado.", cor: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300", grupo: "acoes" },
  { id: "asaas_cancelar_cobranca", label: "Cancelar cobrança (Asaas)", descricao: "Cancela uma cobrança Asaas pelo ID.", cor: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300", grupo: "acoes" },
  { id: "asaas_consultar_valor_aberto", label: "Consultar valor em aberto (Asaas)", descricao: "Lê resumo financeiro do cliente e grava no contexto.", cor: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300", grupo: "acoes" },
  { id: "asaas_marcar_recebida", label: "Marcar como recebida (Asaas)", descricao: "Confirma recebimento manual de uma cobrança.", cor: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300", grupo: "acoes" },
  { id: "definir_variavel", label: "Definir variável", descricao: "Guarda um valor no contexto pra usar em passos seguintes.", cor: "bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300", grupo: "acoes" },
  { id: "definir_campo_personalizado", label: "Definir campo personalizado", descricao: "Persiste um valor em campos personalizados do cliente.", cor: "bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300", grupo: "acoes" },
];

export const GATILHO_META: ReadonlyArray<GatilhoMeta> = [
  { id: "mensagem_canal", label: "Mensagem recebida", descricao: "Dispara quando chega mensagem em qualquer canal (WhatsApp, Instagram, Facebook).", grupo: "mensagem" },
  { id: "whatsapp_mensagem", label: "Mensagem WhatsApp (legado)", descricao: "Gatilho antigo, específico de WhatsApp QR. Prefira 'Mensagem recebida'.", grupo: "mensagem" },
  { id: "pagamento_recebido", label: "Pagamento recebido (Asaas)", descricao: "Dispara no webhook do Asaas.", grupo: "asaas" },
  { id: "pagamento_vencido", label: "Pagamento vencido (Asaas)", descricao: "Dispara quando a cobrança está atrasada há N dias.", grupo: "asaas" },
  { id: "pagamento_proximo_vencimento", label: "Vencimento próximo (Asaas)", descricao: "Dispara N dias antes da cobrança vencer.", grupo: "asaas" },
  { id: "novo_lead", label: "Novo lead no CRM", descricao: "Dispara quando um contato novo é criado.", grupo: "crm" },
  { id: "agendamento_criado", label: "Agendamento criado", descricao: "Dispara quando booking Cal.com é confirmado.", grupo: "calcom" },
  { id: "agendamento_cancelado", label: "Agendamento cancelado", descricao: "Dispara quando booking Cal.com é cancelado.", grupo: "calcom" },
  { id: "agendamento_remarcado", label: "Agendamento remarcado", descricao: "Dispara quando booking Cal.com é reagendado.", grupo: "calcom" },
  { id: "agendamento_lembrete", label: "Lembrete de agendamento", descricao: "Dispara N dias antes do agendamento no horário configurado.", grupo: "calcom" },
  { id: "manual", label: "Acionado manualmente", descricao: "Executado pelo botão 'Executar agora'.", grupo: "fluxo" },
];

export const TIPO_CANAL_META: ReadonlyArray<TipoCanalMeta> = [
  { id: "whatsapp_qr", label: "WhatsApp QR (Baileys)" },
  { id: "whatsapp_api", label: "WhatsApp API (Meta Cloud)" },
  { id: "instagram", label: "Instagram", emBreve: true },
  { id: "facebook", label: "Facebook", emBreve: true },
];

export function getTipoPassoMeta(tipo: string): TipoPassoMeta {
  return (
    TIPO_PASSO_META.find((t) => t.id === tipo) ?? {
      id: tipo as TipoPasso,
      label: tipo,
      descricao: "",
      cor: "bg-gray-100 text-gray-700",
      grupo: "fluxo",
    }
  );
}

export function getGatilhoMeta(id: string): GatilhoMeta {
  return (
    GATILHO_META.find((g) => g.id === id) ?? {
      id: id as GatilhoSmartflow,
      label: id,
      descricao: "",
      grupo: "fluxo",
    }
  );
}

/** Variáveis de contexto disponíveis no template de mensagem WhatsApp. */
export const VARIAVEIS_TEMPLATE = [
  "{nome}",
  "{intencao}",
  "{horario}",
  "{cobrancasAbertas}",
] as const;

/**
 * Campos sugeridos no painel de condicional.
 *
 * @deprecated O editor agora usa `useSmartFlowVariaveis` (mesmo catálogo
 * do autocomplete `{{...}}`) pra listar campos disponíveis por gatilho,
 * incluindo paths com ponto (`cliente.nome`, `cliente.campos.<chave>`).
 * Esta lista permanece exportada porque cenários antigos podem ter
 * salvo esses paths em `ConfigCondicionalItem.campo`; todos continuam
 * resolvíveis pelo engine via `resolverCaminho` (`server/smartflow/interpolar.ts`).
 */
export const CAMPOS_CONDICIONAL = [
  "intencao",
  "assinaturaId",
  "primeiraCobranca",
  "pagamentoTipo",
  "pagamentoValor",
  "valorTotalCliente",
  "percentualPago",
  "diasAtraso",
  "diasAteVencer",
  "bookingsQuantidade",
  "transferir",
] as const;

/** Não exporta ícones aqui (manter arquivo agnóstico a React/lucide). */
export type { LucideIcon };

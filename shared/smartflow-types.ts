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
  | "ia_consultar"
  | "ia_atendente"
  | "ia_extrair_campos"
  | "crm_buscar_contato"
  | "crm_listar_acoes_cliente"
  | "processo_buscar_movimentacoes"
  | "calcom_horarios"
  | "calcom_agendar"
  | "calcom_listar"
  | "calcom_cancelar"
  | "calcom_remarcar"
  | "agenda_criar"
  | "whatsapp_enviar"
  | "whatsapp_aguardar_resposta"
  | "transferir"
  | "condicional"
  | "para_cada_item"
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
  | "definir_campo_personalizado"
  | "contato_tags";

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
    label: "Agendamento",
    grupo: "acoes",
    tipos: ["agenda_criar"],
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
    tipos: ["definir_variavel", "definir_campo_personalizado", "contato_tags"],
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
  | "entre"
  | "tem_tag"
  | "nao_tem_tag";

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

/**
 * Config do passo `ia_consultar` — faz uma consulta interna à IA e salva a
 * resposta num campo do contexto. NÃO envia nada ao cliente (diferente de
 * `ia_responder`). Útil pra raciocinar sobre dados do fluxo (ex: escolher
 * horários a partir de `{{horariosLivres}}`) e usar a saída em passos seguintes.
 */
export interface ConfigIaConsultar {
  /** A pergunta/instrução pra IA (interpolável: `{{mensagem}}`, `{{horariosLivres}}`...). */
  prompt?: string;
  /**
   * Opcional: usa um agente pré-configurado (`agentesIa`) como "cérebro"
   * (prompt/modelo/RAG). Sem agente, usa um assistente genérico.
   */
  agenteId?: number;
  /** Campo do contexto onde salvar a resposta da IA (ex: `analiseIA`). */
  salvarEm?: string;
}

/**
 * Ferramentas (ações) que o "Atendente IA" pode disparar durante a conversa.
 * Cada uma habilitada vira uma SAÍDA do nó — o agente decide quando usar.
 * (`capturar` é automático via campos do agente, não é saída.)
 */
export type FerramentaAtendente = "agendar" | "transferir" | "encerrar" | "gerar_cobranca" | "buscar_processo";

/** Consultas (busca-e-volta) que o Atendente IA pode usar no meio da conversa. */
export type ConsultaAtendente = "ver_horarios";

/**
 * Config do passo `ia_atendente` — o agente conduz a conversa inteira (roteiro
 * no prompt), junta mensagens picadas, captura campos do cadastro, e dispara
 * uma das ferramentas habilitadas quando decide. As ferramentas viram saídas
 * (`proximoSe[ferramenta]`); sem ferramenta escolhida, ele continua conversando.
 */
export interface ConfigIaAtendente {
  /** Agente (cérebro) que conduz. */
  agenteId?: number;
  /** Roteiro/instruções extra em português (somado ao prompt do agente). */
  roteiro?: string;
  /** Ferramentas (ações) habilitadas — cada uma é uma saída do nó. */
  ferramentas?: FerramentaAtendente[];
  /** Consultas (busca-e-volta) habilitadas — NÃO viram saída; voltam pro agente. */
  consultas?: ConsultaAtendente[];
  /** Config das consultas (ex: responsável/duração/dias da "ver_horarios"). */
  consultaConfig?: { responsavelId?: number; duracaoMin?: number; dias?: number };
  /** Janela (segundos) pra juntar mensagens picadas. 0/ausente = desligado. */
  acumularSegundos?: number;
}

/**
 * Tipos suportados pela extração estruturada. Espelham `TipoCampoExtracao`
 * em `server/integracoes/llm-extracao.ts` — mantenha em sincronia.
 */
export type TipoCampoExtracao =
  | "texto"
  | "numero"
  | "boolean"
  | "data"
  | "email"
  | "cpf"
  | "cnpj"
  | "telefone"
  | "lista_texto";

export interface CampoExtracao {
  /** Chave do campo no objeto retornado (camelCase recomendado). */
  chave: string;
  /** Tipo lógico — gera schema JSON correspondente. */
  tipo: TipoCampoExtracao;
  /** Descrição passada pra IA — quanto mais clara, melhor extração. */
  descricao?: string;
  /** Se true, vai no `required[]` do schema. IA ainda pode omitir se não achou. */
  obrigatorio?: boolean;
  /**
   * Se true, salva em `contatos.camposPersonalizados[chave]` quando há
   * `contatoId` no contexto. Requer que a `chave` exista no catálogo
   * `camposPersonalizadosCliente` do escritório.
   */
  persistir?: boolean;
}

/**
 * Config do passo `ia_extrair_campos` — IA usa tool calling pra preencher
 * cada campo da lista. Resultado vai pra `ctx.extracao.<chave>`.
 */
export interface ConfigIaExtrairCampos {
  /** Lista de campos a extrair. Mínimo 1. */
  campos?: CampoExtracao[];
  /**
   * Caminho no contexto da mensagem a analisar. Default `mensagem`. Pode
   * apontar pra outras variáveis tipo `respostaUsuario` (quando vem depois
   * de `whatsapp_aguardar_resposta`).
   */
  fonteMensagem?: string;
}

/**
 * Config do passo `crm_buscar_contato` — resolve um contato pelo telefone,
 * email ou CPF/CNPJ. Útil quando o cliente está num número novo mas se
 * identifica via outro dado na conversa.
 */
export interface ConfigCrmBuscarContato {
  /** Por qual campo buscar — default `telefone`. */
  tipoBusca?: "telefone" | "email" | "cpfCnpj";
  /** Valor a buscar (interpolável: `{{telefoneCliente}}`, `{{extracao.cpf}}`...). */
  valor?: string;
}

/**
 * Config do passo `crm_listar_acoes_cliente` — busca processos vinculados
 * ao contato (`cliente_processos.contatoId`). Filtros opcionais por tipo e polo.
 */
export interface ConfigCrmListarAcoesCliente {
  /** Filtra por tipo de processo. Default: todos. */
  tipoFiltro?: "todos" | "litigioso" | "extrajudicial";
  /** Filtra por polo do cliente. Default: todos. */
  poloFiltro?: "todos" | "ativo" | "passivo" | "interessado";
  /** Limite de resultados. Default: 10. */
  limite?: number;
}

/**
 * Tipos de evento que o passo `processo_buscar_movimentacoes` aceita filtrar.
 * Espelha o enum `eventos_processo.tipoEvento` em `drizzle/schema.ts`.
 */
export type TipoEventoProcesso =
  | "movimentacao"
  | "publicacao_dje"
  | "nova_acao"
  | "mandado"
  | "intimacao"
  | "citacao"
  | "sentenca"
  | "despacho"
  | "audiencia"
  | "outro";

/**
 * Config do passo `processo_buscar_movimentacoes` — lê de `eventos_processo`
 * o histórico de um processo (ou CNJ) por janela de dias e tipos.
 */
export interface ConfigProcessoBuscarMovimentacoes {
  /**
   * ID do processo (cliente_processos.id) ou CNJ. Interpolável.
   * Default: `{{acaoId}}` ou `{{acaoEscolhida.id}}`.
   */
  processoId?: string;
  /** Tipos de evento a incluir (multiselect). Vazio = todos. */
  tipos?: TipoEventoProcesso[];
  /** Janela em dias (a partir de hoje). Default: 30. */
  diasJanela?: number;
  /** Limite de eventos retornados. Default: 10. */
  limite?: number;
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
  /** "texto" (padrão) = mensagem livre; "template" = template aprovado (HSM) da Meta. */
  modo?: "texto" | "template";
  /** Texto livre (modo "texto"). */
  template?: string;

  // ===== modo "template" (WhatsApp oficial / API Meta) =====
  /** Nome do template aprovado na Meta. */
  templateNome?: string;
  /** Código de idioma do template (ex.: "pt_BR", "en_US"). */
  templateIdioma?: string;
  /**
   * Cabeçalho do template quando ele tem header com mídia ou variável de
   * texto. `valor` é a URL da mídia (image/video/document) ou o valor da
   * variável de texto — interpolável com `{{...}}`.
   */
  templateHeader?: {
    formato?: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";
    valor?: string;
    /** Nome do arquivo exibido (apenas DOCUMENT). */
    nomeArquivo?: string;
  };
  /** Valores das variáveis {{1}}, {{2}}… do corpo, na ordem — interpoláveis. */
  templateCorpo?: string[];
  /**
   * Botões com parte dinâmica: URL com sufixo variável, quick_reply com
   * payload, ou copy_code. `valor` é a parte dinâmica — interpolável.
   */
  templateBotoes?: Array<{
    index: number;
    tipo: "URL" | "QUICK_REPLY" | "COPY_CODE";
    valor?: string;
  }>;
}

/**
 * Config do passo `whatsapp_aguardar_resposta` — envia mensagem e pausa
 * o fluxo até o contato responder. Quando configurado com `opcoes`, formata
 * a mensagem como menu numerado e parseia a resposta do cliente pra
 * popular `opcaoEscolhida` no contexto.
 *
 * Limitação por desenho: só **uma** execução por (cenário, contato) pode
 * estar aguardando ao mesmo tempo. Mensagem nova do mesmo contato retoma
 * a execução pendente — pra começar fluxo do zero, expire/cancele a antiga.
 */
export interface ConfigWhatsappAguardarResposta {
  /**
   * Template da mensagem (suporta interpolação `{{...}}` igual ao
   * `whatsapp_enviar`). Quando há `opcoes`, o menu é anexado automaticamente
   * no final.
   */
  template?: string;
  /**
   * Quanto tempo aguardar antes de desistir. Default 1440 (24h).
   * Quando expira, a execução continua pelo ramo `"timeout"` no `proximoSe`
   * (se configurado); senão termina.
   */
  timeoutMinutos?: number;
  /**
   * Quando informada (lista de strings), vira menu numerado:
   *   1. opção 1
   *   2. opção 2
   * O parser tenta achar a escolha do cliente (número OU substring case-insensitive
   * com a opção) e popula `opcaoEscolhida = {indice, texto, numero}`.
   * Lista vazia / ausente = pergunta aberta (qualquer resposta serve).
   */
  opcoes?: string[];
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

/**
 * Config do passo `para_cada_item` — itera sobre uma lista no contexto
 * executando um subfluxo pra cada item. O nó tem 2 saídas no `proximoSe`:
 *   - `corpo`: primeiro nó do subfluxo de iteração
 *   - `depois`: continuação depois do loop terminar
 *
 * O subfluxo do corpo deve EVENTUALMENTE retornar ao próprio nó
 * `para_cada_item` (loop natural) OU ter um nó terminal sem `proximoSe`.
 * O engine detecta a volta e parte pra próxima iteração — sem stack overflow.
 *
 * Variáveis adicionadas ao contexto durante cada iteração:
 *   - `{{item}}` (ou nome configurado): item atual
 *   - `{{indice}}`: 0-indexed da iteração
 */
export interface ConfigParaCadaItem {
  /**
   * Caminho no contexto da lista a iterar. Suporta dot-notation
   * (ex: `acoes`, `cliente.processos`). Default: `acoes`.
   */
  caminhoLista?: string;
  /**
   * Nome da variável que recebe o item atual. Default `item`. Permite
   * trocar pra `acao`, `movimentacao`, etc. — útil em loops aninhados.
   */
  nomeVarItem?: string;
  /**
   * Limite máximo de iterações — guarda contra listas absurdamente grandes
   * e loops infinitos por bugs de config. Default 20, max 200.
   */
  limite?: number;
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
 * Config do passo `contato_tags` — adiciona/remove/define as tags do CONTATO
 * (CRM), não de um card. `tags` interpolável, separadas por vírgula.
 */
export interface ConfigContatoTags {
  /** Tags separadas por vírgula (interpolável). Ex: "cliente, vip". */
  tags?: string;
  /**
   * - "adicionar": junta às existentes (sem duplicar).
   * - "remover": tira as informadas.
   * - "definir": substitui TODAS pelas informadas.
   */
  modo?: "adicionar" | "remover" | "definir";
}

/**
 * Union discriminada por `tipo`. Usada no editor pra garantir type-safety
 * do painel de configuração. O backend aceita `config` como objeto livre
 * (por compatibilidade) mas esses tipos documentam o shape esperado.
 */
export type PassoConfigByTipo =
  | { tipo: "ia_classificar"; config: ConfigIaClassificar }
  | { tipo: "ia_responder"; config: ConfigIaResponder }
  | { tipo: "ia_consultar"; config: ConfigIaConsultar }
  | { tipo: "ia_atendente"; config: ConfigIaAtendente }
  | { tipo: "ia_extrair_campos"; config: ConfigIaExtrairCampos }
  | { tipo: "crm_buscar_contato"; config: ConfigCrmBuscarContato }
  | { tipo: "crm_listar_acoes_cliente"; config: ConfigCrmListarAcoesCliente }
  | { tipo: "processo_buscar_movimentacoes"; config: ConfigProcessoBuscarMovimentacoes }
  | { tipo: "calcom_horarios"; config: ConfigCalcomHorarios }
  | { tipo: "calcom_agendar"; config: ConfigCalcomAgendar }
  | { tipo: "calcom_listar"; config: ConfigCalcomListar }
  | { tipo: "calcom_cancelar"; config: ConfigCalcomCancelar }
  | { tipo: "calcom_remarcar"; config: ConfigCalcomRemarcar }
  | { tipo: "whatsapp_enviar"; config: ConfigWhatsappEnviar }
  | { tipo: "whatsapp_aguardar_resposta"; config: ConfigWhatsappAguardarResposta }
  | { tipo: "transferir"; config: ConfigTransferir }
  | { tipo: "condicional"; config: ConfigCondicional }
  | { tipo: "esperar"; config: ConfigEsperar }
  | { tipo: "para_cada_item"; config: ConfigParaCadaItem }
  | { tipo: "webhook"; config: ConfigWebhook }
  | { tipo: "kanban_criar_card"; config: ConfigKanbanCriarCard }
  | { tipo: "kanban_mover_card"; config: ConfigKanbanMoverCard }
  | { tipo: "kanban_atribuir_responsavel"; config: ConfigKanbanAtribuirResponsavel }
  | { tipo: "kanban_tags"; config: ConfigKanbanTags }
  | { tipo: "asaas_gerar_cobranca"; config: ConfigAsaasGerarCobranca }
  | { tipo: "asaas_cancelar_cobranca"; config: ConfigAsaasCancelarCobranca }
  | { tipo: "asaas_consultar_valor_aberto"; config: ConfigAsaasConsultarValorAberto }
  | { tipo: "asaas_marcar_recebida"; config: ConfigAsaasMarcarRecebida }
  | { tipo: "definir_campo_personalizado"; config: ConfigDefinirCampoPersonalizado }
  | { tipo: "contato_tags"; config: ConfigContatoTags };

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
  /**
   * true = gatilho legado/descontinuado. Continua válido (validação do
   * router e cenários antigos seguem funcionando), mas NÃO aparece como
   * opção pra criar/trocar gatilho na UI.
   */
  oculto?: boolean;
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
  /**
   * Palavras-chave que disparam ESTE fluxo. Vazio = não filtra por palavra
   * (fluxo geral). Usado pra rotear campanhas: ex. ["QUERO50"] manda quem
   * mandar "QUERO50" pra um fluxo específico.
   */
  palavrasChave?: string[];
  /**
   * Como casar as palavras-chave com a mensagem:
   *   - "exato": a mensagem (sem espaços nas pontas, case-insensitive) é igual à palavra.
   *   - "comeca_com": a mensagem começa com a palavra.
   * Default "exato". Em empate entre fluxos, o match exato vence o "começa com".
   */
  modoPalavraChave?: "exato" | "comeca_com";
  /**
   * Marca este como o FLUXO PADRÃO do canal: roda quando a mensagem não casa
   * com nenhuma palavra-chave de nenhum fluxo. Só um deveria estar marcado.
   */
  gatilhoPadrao?: boolean;
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
  { id: "ia_consultar", label: "Consultar IA (uso interno)", descricao: "Faz uma pergunta à IA e salva a resposta num campo. NÃO envia ao cliente.", cor: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300", grupo: "ia" },
  { id: "ia_atendente", label: "Atendente IA", descricao: "Conduz a conversa inteira (qualifica, explica, tira dúvidas) e dispara ações (agendar, transferir...) quando decide. O roteiro vai no prompt.", cor: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300", grupo: "ia" },
  { id: "ia_extrair_campos", label: "Extrair dados (IA)", descricao: "IA lê a mensagem e extrai campos estruturados (CPF, email, datas...). Salva no contexto e opcionalmente no cadastro do cliente.", cor: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/40 dark:text-fuchsia-300", grupo: "ia" },
  { id: "crm_buscar_contato", label: "Buscar contato (CRM)", descricao: "Resolve um cliente pelo telefone, email ou CPF. Popula contatoId, nome e campos personalizados.", cor: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300", grupo: "crm" },
  { id: "crm_listar_acoes_cliente", label: "Listar ações do cliente", descricao: "Lista os processos vinculados ao contato — útil pra IA saber sobre quais ações ele tem.", cor: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300", grupo: "crm" },
  { id: "processo_buscar_movimentacoes", label: "Buscar movimentações", descricao: "Histórico de movimentações, publicações, sentenças e audiências de um processo. Filtros por tipo e janela.", cor: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300", grupo: "acoes" },
  { id: "agenda_criar", label: "Agendamento", descricao: "Mexe na Agenda do escritório: marcar consulta, ver horários livres, editar/remarcar e cancelar. Atribui a um responsável e vincula ao cliente.", cor: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300", grupo: "acoes" },
  { id: "whatsapp_enviar", label: "Enviar mensagem", descricao: "Envia mensagem pelo WhatsApp.", cor: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300", grupo: "mensagem" },
  { id: "whatsapp_aguardar_resposta", label: "Aguardar resposta", descricao: "Envia mensagem e pausa o fluxo esperando o cliente responder. Suporta menu de opções automático.", cor: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300", grupo: "mensagem" },
  { id: "transferir", label: "Transferir p/ humano", descricao: "Encerra o fluxo e PARA o bot de responder (conversa fica 'em atendimento'). Use no fim de um caminho pra passar pro atendente.", cor: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300", grupo: "mensagem" },
  { id: "condicional", label: "Condição (if/else)", descricao: "Continua só se a condição for atendida.", cor: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300", grupo: "fluxo" },
  { id: "para_cada_item", label: "Para cada item (loop)", descricao: "Itera sobre uma lista do contexto e executa o subfluxo do corpo pra cada item.", cor: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300", grupo: "fluxo" },
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
  { id: "contato_tags", label: "Tags do contato", descricao: "Adiciona, remove ou define as tags do contato no CRM.", cor: "bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300", grupo: "acoes" },
];

export const GATILHO_META: ReadonlyArray<GatilhoMeta> = [
  { id: "mensagem_canal", label: "Mensagem recebida", descricao: "Dispara quando chega mensagem em qualquer canal (WhatsApp, Instagram, Facebook).", grupo: "mensagem" },
  { id: "whatsapp_mensagem", label: "Mensagem WhatsApp (legado)", descricao: "Gatilho antigo, específico de WhatsApp QR (Baileys). Descontinuado — use 'Mensagem recebida'.", grupo: "mensagem", oculto: true },
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

// `whatsapp_qr` (Baileys) foi REMOVIDO da seleção de canais do gatilho —
// está sendo descontinuado em favor da API oficial (whatsapp_api). O tipo
// `whatsapp_qr` continua no union TipoCanalMensagem pra não quebrar cenários
// e código legados; só não aparece mais como opção pra criar/configurar.
export const TIPO_CANAL_META: ReadonlyArray<TipoCanalMeta> = [
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

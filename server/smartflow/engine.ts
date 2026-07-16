/**
 * SmartFlow Engine — Motor de execução de cenários.
 *
 * Lógica PURA e testável. Recebe passos + contexto, executa cada passo
 * em sequência, retorna o contexto atualizado.
 *
 * Cada tipo de passo tem um handler que:
 *   - Recebe o contexto atual (dados coletados até agora)
 *   - Executa a ação (chamar IA, buscar horários, enviar mensagem)
 *   - Retorna o contexto atualizado + resultado
 *
 * O engine NÃO faz I/O direto — recebe "executores" injetados
 * (inversão de dependência) pra ser 100% testável.
 */

// Helpers PUROS de data/fuso (sem I/O, só Intl) — usados pelos operadores de
// condição por horário/dia. dispatcher-helpers só importa tipos, sem ciclo.
import { avaliarHorarioEntre, avaliarDiaSemana } from "./dispatcher-helpers";

// ─── Tipos ──────────────────────────────────────────────────────────────────

export interface SmartflowContexto {
  /** Mensagem original do cliente */
  mensagem?: string;
  /** Intenção detectada pela IA */
  intencao?: string;
  /** Resposta gerada pela IA */
  respostaIA?: string;
  /** Horários disponíveis do Cal.com */
  horariosDisponiveis?: string[];
  /** Horário escolhido pelo cliente */
  horarioEscolhido?: string;
  /** ID do agendamento criado (Cal.com) */
  agendamentoId?: string;
  /** ID do compromisso criado na Agenda interna (passo agenda_criar) */
  agendamentoInternoId?: number;
  /** Horário ISO escolhido pelo cliente no Atendente IA (ação agendar) — o bloco
   * de Agendamento usa como data. Sem ele, o Agendamento marcaria "agora". */
  agendamentoQuando?: string;
  /** Horário escolhido, formatado pt-BR (ex: "27/05/2026 14:00") — pra mensagem
   * de confirmação ("Data do Agendamento" no editor). */
  agendamentoQuandoTexto?: string;
  /** false = horário pedido estava ocupado (agenda_criar não criou) */
  agendaDisponivel?: boolean;
  /** Qtd de compromissos em conflito no horário pedido (agenda_criar) */
  agendaConflitos?: number;
  /** Se deve transferir pra humano */
  transferir?: boolean;
  /** Mensagens enviadas */
  mensagensEnviadas?: string[];
  /** Dados de pagamento (gatilho pagamento_recebido) */
  pagamentoId?: string;
  pagamentoValor?: number;
  /** Valor já formatado como moeda ("R$ 800,00") — pro texto do template/mensagem. */
  pagamentoValorFormatado?: string;
  pagamentoDescricao?: string;
  pagamentoTipo?: string; // "BOLETO", "PIX", etc
  assinaturaId?: string; // se tiver = é assinatura
  /**
   * @deprecated Bug histórico: era setado como `!cardExistente` (kanban)
   * — significava "primeira VEZ que essa cobrança específica entra no
   * SmartFlow", que era SEMPRE true (cobrança nasce com pagamentoId
   * único). Hoje vira alias correto de `primeiraCobrancaDoCliente`.
   *
   * Cenários novos: prefira `primeiraCobrancaDoCliente` ou
   * `primeiraCobrancaDaAcao` (mais específicos).
   */
  primeiraCobranca?: boolean;
  /** True se NENHUMA cobrança comissionável anterior do cliente foi paga. */
  primeiraCobrancaDoCliente?: boolean;
  /**
   * True se NENHUMA cobrança comissionável anterior DESTA ação foi paga.
   * Definido apenas quando há ação no contexto (cobrança vinculada).
   * Cobre o cenário "pacote de R$ 3000 / 3 ações": dispara 1 evento por
   * ação, e cada execução vê `primeiraCobrancaDaAcao=true` na primeira
   * parcela paga (ideal pra criar card no Kanban da ação).
   */
  primeiraCobrancaDaAcao?: boolean;
  /** ID da ação (cliente_processos.id) quando o evento veio de cobrança vinculada. */
  acaoId?: number;
  /** Apelido da ação (ex: "Revisional Banco X") — fallback pro CNJ se vazio. */
  acaoApelido?: string;
  /** Tipo: "litigioso" | "extrajudicial" | "" (sem ação). */
  acaoTipo?: string;
  /** Classe judicial (vem do Judit ou cadastro manual). */
  acaoClasse?: string;
  /** Número CNJ formatado. */
  acaoNumeroCnj?: string;
  /** Valor da causa (string pra preservar formatação BR). */
  acaoValorCausa?: string;
  /** Polo: "ativo" | "passivo" | "interessado" | "". */
  acaoPolo?: string;
  /** ID do card criado no Kanban */
  kanbanCardId?: number;
  /** ID do atendente responsável pelo cliente (do cadastro CRM) — usado
   *  como default em passos que precisam de responsável (ex: Kanban
   *  "Criar card" sem responsavelId explícito herda esse valor). */
  atendenteResponsavelId?: number;
  /** Atendente escolhido pelo passo `distribuir_atendimento` (id do colaborador
   *  + nome) — pra usar em mensagem ("Você será atendido por {{atendenteEscolhidoNome}}"). */
  atendenteEscolhidoId?: number;
  atendenteEscolhidoNome?: string;
  /** Responsável da agenda resolvido pelo passo `ia_atendente` (cascata
   *  completa). O passo `agenda_criar` reaproveita esse valor pra garantir
   *  que a agenda mostrada ao cliente é a mesma onde o compromisso é marcado. */
  agendaResponsavelResolvidoId?: number;
  /** Dados livres por passo */
  [key: string]: unknown;
}

export interface PassoConfig {
  /** Para ia_classificar: categorias possíveis */
  categorias?: string[];
  /** Para ia_responder: prompt adicional */
  prompt?: string;
  /** Para condicional: campo e valor esperado */
  campo?: string;
  valor?: string;
  /** Para esperar: delay em minutos */
  delayMinutos?: number;
  /** Para whatsapp_enviar: template da mensagem */
  template?: string;
  /** Para calcom_horarios: duração em minutos */
  duracao?: number;
  /** Para webhook: URL */
  url?: string;
  /**
   * Para kanban_criar_card: força um processo (ação) específico.
   * Caso comum: deixar vazio que o engine usa `{{acaoId}}` do contexto
   * (multi-ação). Quando preenchido, força — útil pra "sempre criar
   * card vinculado à ação X" independente do contexto.
   */
  processoId?: number;
}

export interface Passo {
  id: number;
  ordem: number;
  tipo: string;
  config: PassoConfig;
  /**
   * UUID estável do passo (persistido em `smartflow_passos.clienteIdPasso`).
   * Usado como alvo das edges — sobrevive a delete+insert no save. Null em
   * cenários legados; quando null o walker cai no modo linear por `ordem`.
   */
  clienteId?: string | null;
  /**
   * Mapa ramo→clienteId (alvo). Null = linear por `ordem`. Chaves usadas
   * hoje: "default" (passo comum, pode pular a ordem natural), `cond_<id>`
   * (condicional com ramo específico) e "fallback" (nenhuma condição bateu).
   */
  proximoSe?: Record<string, string> | null;
}

export interface PassoResultado {
  sucesso: boolean;
  contexto: SmartflowContexto;
  mensagemErro?: string;
  /** Se o fluxo deve parar (transferir, esperar, erro) */
  parar?: boolean;
  /** Mensagem pra enviar ao cliente */
  resposta?: string;
  /**
   * Chave de ramo que o walker deve usar em `proximoSe` pra decidir o
   * próximo passo. `condicional` retorna `cond_<id>` ou `"fallback"`;
   * outros handlers podem retornar `"default"` ou omitir (= linear).
   */
  proximoRamoId?: string;
}

/** Funções externas injetadas (pra testar sem I/O real) */
export interface SmartflowExecutores {
  /**
   * Chama a IA com um prompt e retorna a resposta.
   * `contatoId` opcional: quando passado, a implementação real injeta
   * `contatos.camposPersonalizados` no system prompt pra IA ter ciência
   * dos dados já capturados na conversa.
   */
  chamarIA: (prompt: string, mensagem: string, contatoId?: number, conversaId?: number) => Promise<string>;
  /**
   * Extração estruturada via tool calling. Recebe a mensagem + lista de
   * campos a extrair; devolve um objeto chave→valor com o que a IA achou.
   * Campos não encontrados na mensagem são omitidos do retorno (não viram
   * `null` — ficam fora do objeto), pra não sobrescrever dados pré-existentes.
   */
  extrairCamposIA: (params: {
    mensagem: string;
    campos: Array<{
      chave: string;
      tipo: "texto" | "numero" | "boolean" | "data" | "email" | "cpf" | "cnpj" | "telefone" | "lista_texto";
      descricao?: string;
      obrigatorio?: boolean;
    }>;
    contatoId?: number;
    /** Conversa pra carregar histórico — extrai dados de toda a conversa, não só da última msg. */
    conversaId?: number;
  }) => Promise<Record<string, unknown>>;
  /**
   * Busca contato no CRM por telefone/email/cpf. Retorna `null` quando
   * não encontra (caller decide ramo). Quando encontra, devolve dados
   * completos do contato pra popular contexto.
   */
  buscarContatoCrm: (params: {
    tipoBusca: "telefone" | "email" | "cpfCnpj";
    valor: string;
  }) => Promise<{
    contatoId: number;
    nome: string;
    telefone: string | null;
    email: string | null;
    atendenteResponsavelId: number | null;
    camposPersonalizados: Record<string, unknown>;
  } | null>;
  /**
   * Lista ações (cliente_processos) do contato — com filtros opcionais
   * por tipo (litigioso/extrajudicial) e polo (ativo/passivo/interessado).
   */
  listarAcoesCliente: (params: {
    contatoId: number;
    tipoFiltro?: "litigioso" | "extrajudicial";
    poloFiltro?: "ativo" | "passivo" | "interessado";
    limite?: number;
  }) => Promise<Array<{
    id: number;
    numeroCnj: string | null;
    apelido: string | null;
    classe: string | null;
    tipo: string;
    polo: string | null;
    valorCausa: number | null;
    createdAt: Date | string;
  }>>;
  /**
   * Histórico de eventos de um processo. `processoRef` pode ser o ID
   * numérico de `cliente_processos` ou um CNJ — o executor resolve
   * o CNJ a partir do ID quando precisar.
   */
  buscarMovimentacoesProcesso: (params: {
    processoRef: number | string;
    tipos?: string[];
    diasJanela?: number;
    limite?: number;
  }) => Promise<Array<{
    id: number;
    tipo: string;
    dataEvento: Date | string;
    conteudo: string;
    fonte: string;
    cnjAfetado: string | null;
  }>>;
  /**
   * Executa um agente IA pré-configurado (prompt + modelo + docs RAG salvos
   * em `agentesIa`) e retorna a resposta textual. Usado por `ia_responder`
   * quando o passo tem `config.agenteId`. `contatoId` é injetado no system
   * prompt como contexto do cliente (mesma motivação do `chamarIA`).
   */
  executarAgente: (agenteId: number, mensagem: string, contatoId?: number, conversaId?: number) => Promise<string>;
  /**
   * Extrai os campos personalizados configurados no agente (`camposCaptura`)
   * a partir da conversa e salva no cadastro do contato. Escopo: só roda quando
   * o agente é usado num passo do fluxo (não age sozinho). Retorna mapa
   * chave→valor dos campos capturados (pra refletir no contexto). Não-fatal.
   */
  extrairCamposDoAgente: (agenteId: number, contatoId: number, conversaId: number) => Promise<Record<string, unknown>>;
  /**
   * "Atendente IA": o agente conduz a conversa (roteiro no prompt) e decide se
   * continua conversando ou dispara uma das `ferramentas` habilitadas. Retorna
   * o texto a enviar + a ação escolhida (uma das ferramentas) ou null (continua),
   * e `quando` (ISO do horário que o cliente escolheu) quando a ação é agendar.
   */
  conversarComAgente: (params: {
    agenteId: number;
    roteiro?: string;
    ferramentas: string[];
    /** Ações customizadas (nome + "use quando…"). Viram saídas como as builtin. */
    acoesCustom?: Array<{ nome: string; descricao: string }>;
    /** Consultas habilitadas (busca-e-volta), ex: ["ver_horarios"]. */
    consultas?: string[];
    /** Config das consultas (ex: responsável/duração/dias pra "ver_horarios"). */
    consultaConfig?: { responsavelId?: number; duracaoMin?: number; dias?: number };
    /**
     * Variáveis pra interpolar no prompt do agente E no roteiro do bloco
     * ANTES de mandar pro LLM. Resolve `{{atendente}}`, `{{cliente.nome}}`, etc.
     * — assim o prompt fica dinâmico (ex: nome do atendente que recebeu a
     * conversa via Distribuir p/ setor). Sem `vars`, prompt vai cru (compat).
     */
    vars?: Record<string, unknown>;
    mensagem: string;
    contatoId?: number;
    conversaId?: number;
  }) => Promise<{ resposta: string; acao: string | null; quando?: string | null }>;
  /**
   * Distribui a conversa pra um atendente de um SETOR: escolhe por menor carga
   * (online primeiro) e seta como dono (`atendenteId`) — SEM marcar
   * "em atendimento" (o bot segue). `somenteOnline` restringe a quem tem
   * heartbeat recente. Retorna o atendente escolhido ou null (ninguém elegível).
   */
  distribuirAtendimentoPorSetor: (params: {
    setorId: number;
    /** Quem entra no rodízio: todos / online primeiro / somente online. */
    modoDistribuicao: "todos" | "online_primeiro" | "somente_online";
    conversaId?: number;
    /** Se setado, IGNORA setor/round-robin e atribui esse colaborador direto
     *  (modo "atendente fixo" do bloco). Verifica ativo; se inativo, devolve null. */
    atendenteIdFixo?: number;
  }) => Promise<{ id: number; nome: string } | null>;
  /**
   * Resolve quem é o dono da agenda pra um atendimento, em cascata:
   *   responsavelIdPreferido (advogado fixo) → atendente da conversa →
   *   responsável do contato (CRM) → padrão do escritório → dono.
   * Retorna `null` só se o escritório não tiver nenhum colaborador elegível.
   * Usado pelos passos `ia_atendente` (resolve 1x) e `agenda_criar` (fallback).
   */
  resolverResponsavelAgenda: (params: {
    responsavelIdPreferido?: number | null;
    contatoId?: number;
    conversaId?: number;
    atendenteResponsavelId?: number | null;
  }) => Promise<number | null>;
  /** Busca horários disponíveis no Cal.com */
  buscarHorarios: (duracao: number) => Promise<string[]>;
  /** Cria agendamento no Cal.com */
  criarAgendamento: (horario: string, nome: string, email: string) => Promise<string>;
  /**
   * Cria um compromisso na Agenda NATIVA do escritório (tabela `agendamentos`),
   * sem depender do Cal.com. Usado pelo passo `agenda_criar`. Retorna o id.
   */
  criarAgendamentoInterno: (params: {
    responsavelId: number;
    tipo: string;
    titulo: string;
    dataInicio: string;
    dataFim?: string;
    descricao?: string;
    local?: string;
    prioridade?: string;
    contatoId?: number;
    contatoTelefone?: string;
  }) => Promise<number>;
  /**
   * Verifica se o responsável tem conflito de horário na Agenda interna no
   * intervalo [dataInicio, dataFim]. Usado pelo passo `agenda_criar` antes de
   * criar, pra não marcar em cima de outro compromisso.
   */
  verificarDisponibilidadeAgenda: (params: {
    responsavelId: number;
    dataInicio: string;
    dataFim: string;
  }) => Promise<{ disponivel: boolean; conflitos: number }>;
  /**
   * Lista os compromissos (não cancelados) do responsável na janela
   * [dataInicio, dataFim], ordenados por início. Datas em ISO 8601. Usado pelo
   * passo `agenda_criar` na ação "consultar" — alimenta um passo de IA depois.
   */
  listarAgendaResponsavel: (params: {
    responsavelId: number;
    dataInicio: string;
    dataFim: string;
  }) => Promise<Array<{ titulo: string; inicio: string; fim: string; status: string }>>;
  /**
   * Edita/cancela um compromisso da Agenda interna pelo ID. Usado pelas ações
   * "editar" e "cancelar" do passo agenda_criar. Campos ausentes ficam intactos.
   */
  editarAgendamentoInterno: (params: {
    agendamentoId: number;
    dataInicio?: string;
    dataFim?: string;
    responsavelId?: number;
    titulo?: string;
    descricao?: string;
    status?: string;
  }) => Promise<void>;
  /**
   * Lista bookings do Cal.com (usado pelo passo `calcom_listar`). O resultado
   * vai para `ctx.bookings` sem formatação específica.
   */
  listarBookings: (params: {
    status?: "upcoming" | "past" | "cancelled" | "unconfirmed";
  }) => Promise<
    Array<{
      id: number | string;
      titulo?: string;
      startTime?: string;
      endTime?: string;
      status?: string;
      attendeeNome?: string;
      attendeeEmail?: string;
    }>
  >;
  /** Cancela um booking por ID. Retorna true se sucesso. */
  cancelarBooking: (bookingId: number | string, motivo?: string) => Promise<boolean>;
  /** Reagenda um booking para um novo horário. Retorna true se sucesso. */
  reagendarBooking: (
    bookingId: number | string,
    novoHorario: string,
    motivo?: string,
  ) => Promise<boolean>;
  /** Envia mensagem WhatsApp */
  enviarWhatsApp: (
    telefone: string,
    mensagem: string,
    opts?: { contatoId?: number; proativo?: boolean },
  ) => Promise<boolean>;
  /**
   * Envia mensagem interativa WhatsApp (botões ou lista) via Cloud API.
   * Opcional — ambientes sem Cloud API conectada não implementam, e o
   * handler do passo `whatsapp_pergunta_opcoes` reporta erro claro.
   * Retorna true em sucesso (mensagem aceita pela Meta).
   */
  enviarWhatsAppInteractive?: (params: {
    telefone: string;
    modo: "botoes" | "lista";
    body: string;
    header?: string;
    footer?: string;
    botoes?: Array<{ id: string; titulo: string }>;
    drawerLabel?: string;
    secoes?: Array<{ titulo: string; itens: Array<{ id: string; titulo: string; descricao?: string }> }>;
    /** Contato destinatário — sem ele o guard pula opt-out/opt-in. */
    contatoId?: number;
    /** false = reply a mensagem do contato (não conta teto nem checa opt-out). */
    proativo?: boolean;
    /** Disparo proativo automático: exige opt-in do contato. */
    exigirOptin?: boolean;
  }) => Promise<boolean>;
  /**
   * Envia um template (HSM) WhatsApp aprovado da Meta pelo canal oficial
   * (Cloud API). Opcional: ambientes/mocks sem Cloud API não implementam —
   * o handler do passo reporta erro claro nesse caso.
   */
  enviarWhatsAppTemplate?: (
    telefone: string,
    template: {
      nome: string;
      idioma?: string;
      componentes?: any[];
      /** Contato destinatário — usado pra persistir o envio na conversa (rastreio de entrega). */
      contatoId?: number;
      /** Prévia textual pra timeline (o corpo real vive aprovado na Meta). */
      conteudoPreview?: string;
    },
  ) => Promise<boolean | { ok: boolean; erro?: string }>;
  /**
   * Retorna a lista formatada de cobranças em aberto do cliente (PENDING /
   * OVERDUE), com link de pagamento quando disponível. Usada pra expandir
   * a variável `{cobrancasAbertas}` nos templates de mensagem. Retorna
   * string vazia se não houver cobranças.
   */
  buscarCobrancasAbertas: (params: {
    contatoId?: number;
    clienteAsaasId?: string;
  }) => Promise<string>;
  /** Chama webhook externo */
  chamarWebhook: (url: string, dados: any) => Promise<any>;
  /** Cria card no Kanban */
  criarCardKanban: (params: {
    funilId?: number;
    colunaId?: number;
    titulo: string;
    descricao?: string;
    clienteId?: number;
    prioridade?: string;
    asaasPaymentId?: string;
    /**
     * ID da ação (cliente_processos.id). Quando passado JUNTO com
     * `clienteId`, ativa idempotência forte: se já existe card pra
     * (escritorio, processoId, clienteId), não cria duplicata.
     *
     * Cobre o cenário do "pacote": dispatcher dispara N eventos (1 por
     * ação), cada um cria seu card de ação distinto, e parcelas
     * subsequentes não duplicam.
     */
    processoId?: number;
    cnj?: string;
    responsavelId?: number;
    prazoDias?: number;
    tags?: string;
  }) => Promise<number>;
  /** Move um card existente pra outra coluna. Loga em kanban_movimentacoes. */
  moverCardKanban: (params: {
    cardId: number;
    colunaDestinoId: number;
  }) => Promise<boolean>;
  /** Define o responsável de um card. Dispara notificação ao colaborador. */
  atribuirResponsavelKanban: (params: {
    cardId: number;
    responsavelId: number | null;
  }) => Promise<boolean>;
  /**
   * Atualiza tags de um card. Tags são CSV em `kanbanCards.tags`.
   *  - "adicionar": união (sem duplicar).
   *  - "remover": remove as tags listadas das atuais.
   *  - "definir": substitui completamente.
   */
  atualizarTagsCardKanban: (params: {
    cardId: number;
    tags: string[];
    modo: "adicionar" | "remover" | "definir";
  }) => Promise<boolean>;
  /**
   * Atualiza as tags do CONTATO (CRM, contatos.tags). Mesmos modos do Kanban.
   * Retorna a lista de tags resultante (pra refletir no contexto).
   */
  atualizarTagsContato: (params: {
    contatoId: number;
    tags: string[];
    modo: "adicionar" | "remover" | "definir";
  }) => Promise<string[]>;
  /**
   * Cria cobrança avulsa no Asaas pra um contato. Resolve customerId
   * via vínculo asaasClientes. Retorna payment id + link.
   */
  gerarCobrancaAsaas: (params: {
    contatoId: number;
    valor: number;
    descricao?: string;
    vencimentoDias?: number;
    tipoCobranca?: "BOLETO" | "PIX" | "CREDIT_CARD";
  }) => Promise<{ pagamentoId: string; link?: string }>;
  /** Cancela cobrança Asaas pelo ID. */
  cancelarCobrancaAsaas: (params: { pagamentoId: string }) => Promise<boolean>;
  /** Resumo financeiro do contato (valores já em reais, não centavos). */
  consultarValorAbertoAsaas: (params: { contatoId: number }) => Promise<{
    total: number;
    pendente: number;
    vencido: number;
    qtdAberto: number;
  }>;
  /** Confirma recebimento manual de uma cobrança (em dinheiro/PIX manual). */
  marcarCobrancaRecebidaAsaas: (params: {
    pagamentoId: string;
    valorRecebido?: number;
    dataRecebimento?: string;
  }) => Promise<boolean>;
  /**
   * Persiste valor em `contatos.camposPersonalizados[chave]`. Valida que
   * `chave` existe no catálogo do escritório (`camposPersonalizadosCliente`).
   */
  definirCampoPersonalizadoCliente: (params: {
    contatoId: number;
    chave: string;
    valor: string;
  }) => Promise<boolean>;
}

// ─── Handlers por tipo de passo ─────────────────────────────────────────────

async function handleIAClassificar(
  passo: Passo,
  ctx: SmartflowContexto,
  exec: SmartflowExecutores,
): Promise<PassoResultado> {
  if (!ctx.mensagem) {
    return { sucesso: false, contexto: ctx, mensagemErro: "Sem mensagem para classificar" };
  }

  const categorias = passo.config.categorias || ["agendar", "duvida", "emergencia", "outro"];
  const prompt = `Classifique a intenção da mensagem em UMA das categorias: ${categorias.join(", ")}.\n\nResponda APENAS com a categoria, sem explicação.`;

  try {
    const resposta = await exec.chamarIA(prompt, ctx.mensagem);
    const intencao = resposta.toLowerCase().trim().replace(/[^a-záéíóúãõçê_]/g, "");
    return {
      sucesso: true,
      contexto: { ...ctx, intencao: categorias.includes(intencao) ? intencao : "outro" },
    };
  } catch (err: any) {
    return { sucesso: false, contexto: ctx, mensagemErro: `IA: ${err.message}` };
  }
}

/**
 * Handler do passo `ia_extrair_campos` — IA lê uma mensagem e extrai
 * campos estruturados via tool calling. Salva em `ctx.extracao.<chave>`
 * pra que próximos passos possam usar via `{{extracao.cpf}}` etc.
 *
 * Quando o campo tem `persistir: true` e `ctx.contatoId` existe, também
 * grava em `contatos.camposPersonalizados` via `definirCampoPersonalizadoCliente`.
 * Falha de persistência NÃO derruba o passo — só loga aviso, porque a
 * extração em si funcionou.
 */
async function handleIAExtrairCampos(
  passo: Passo,
  ctx: SmartflowContexto,
  exec: SmartflowExecutores,
): Promise<PassoResultado> {
  const cfg = passo.config as {
    campos?: Array<{
      chave: string;
      tipo: "texto" | "numero" | "boolean" | "data" | "email" | "cpf" | "cnpj" | "telefone" | "lista_texto";
      descricao?: string;
      obrigatorio?: boolean;
      persistir?: boolean;
    }>;
    fonteMensagem?: string;
  };
  const campos = Array.isArray(cfg.campos) ? cfg.campos : [];
  if (campos.length === 0) {
    return { sucesso: false, contexto: ctx, mensagemErro: "Configure pelo menos 1 campo a extrair." };
  }
  // Resolve a mensagem-fonte: por default vem de ctx.mensagem, mas a config
  // pode apontar pra outra chave (ex: 'respostaUsuario' depois de aguardar).
  const fonteKey = (cfg.fonteMensagem || "mensagem").trim();
  const partes = fonteKey.split(".");
  let mensagemRaw: any = ctx;
  for (const p of partes) {
    if (mensagemRaw == null || typeof mensagemRaw !== "object") {
      mensagemRaw = undefined;
      break;
    }
    mensagemRaw = (mensagemRaw as any)[p];
  }
  const mensagem = typeof mensagemRaw === "string" ? mensagemRaw : "";
  if (!mensagem) {
    return {
      sucesso: false,
      contexto: ctx,
      mensagemErro: `Mensagem vazia em "${fonteKey}" — nada pra extrair.`,
    };
  }

  let extraidos: Record<string, unknown>;
  try {
    extraidos = await exec.extrairCamposIA({
      mensagem,
      campos: campos.map((c) => ({
        chave: c.chave,
        tipo: c.tipo,
        descricao: c.descricao,
        obrigatorio: c.obrigatorio,
      })),
      contatoId: typeof ctx.contatoId === "number" ? ctx.contatoId : undefined,
      // Histórico: extrai dados de toda a conversa, não só da última mensagem.
      conversaId: typeof ctx.conversaId === "number" ? ctx.conversaId : undefined,
    });
  } catch (err: any) {
    return { sucesso: false, contexto: ctx, mensagemErro: `Extração IA: ${err.message}` };
  }

  // Mescla com extração anterior (se chamado múltiplas vezes no fluxo,
  // mantém o que já foi achado e adiciona/sobrescreve com o novo).
  const extracaoAnterior = (ctx.extracao as Record<string, unknown>) || {};
  const novaExtracao = { ...extracaoAnterior, ...extraidos };

  // Espelha em ctx.cliente.campos pra próximos passos lerem via {{cliente.campos.X}}
  // — só pros campos marcados como persistir (semântica: "isso é dado do cliente").
  const clienteAtual = (ctx.cliente as Record<string, any>) || {};
  const camposClienteAtuais = (clienteAtual.campos as Record<string, any>) || {};
  const novosCamposCliente = { ...camposClienteAtuais };

  // Persistir no contato quando aplicável. Continua o fluxo mesmo se um campo
  // específico falhar (loga via mensagemErro só se TODOS falharem).
  const persistRequests = campos.filter((c) => c.persistir && c.chave in extraidos);
  const contatoIdNum = typeof ctx.contatoId === "number" ? ctx.contatoId : null;
  // Coleta motivos de falha na persistência. Antes isso era engolido calado
  // (catch {}), então o usuário via "não salvou" sem nenhuma pista. Agora
  // vai pro contexto (captacaoAvisos) pra ficar visível.
  const avisosCaptura: string[] = [];
  if (persistRequests.length > 0 && contatoIdNum == null) {
    avisosCaptura.push(
      "Não dá pra salvar nos campos do cliente sem identificar o contato (use um passo \"Buscar contato\" antes). Os dados ficaram só no contexto do fluxo.",
    );
  } else if (persistRequests.length > 0 && contatoIdNum != null) {
    for (const c of persistRequests) {
      const valor = extraidos[c.chave];
      if (valor == null || valor === "") continue;
      try {
        await exec.definirCampoPersonalizadoCliente({
          contatoId: contatoIdNum,
          chave: c.chave,
          valor: String(valor),
        });
        novosCamposCliente[c.chave] = String(valor);
      } catch (err: any) {
        // Não falha o passo (a extração funcionou), mas NÃO engole o erro:
        // registra o motivo (ex: campo não existe no catálogo do escritório).
        avisosCaptura.push(`Campo "${c.chave}" não salvo: ${err?.message ?? "erro desconhecido"}`);
      }
    }
  }

  return {
    sucesso: true,
    contexto: {
      ...ctx,
      extracao: novaExtracao,
      cliente: { ...clienteAtual, campos: novosCamposCliente },
      ...(avisosCaptura.length > 0 ? { captacaoAvisos: avisosCaptura } : {}),
    },
  };
}

/**
 * Handler do passo `crm_buscar_contato`. Resolve um cliente pelo telefone,
 * email ou CPF/CNPJ. Quando acha, popula contexto com dados do contato
 * (sem sobrescrever `contatoId` original se ele já existe, exceto quando
 * a busca encontrou outro — aí prefere o novo, é a intenção do passo).
 *
 * `contatoEncontrado` (boolean) é publicado pra permitir ramos condicionais
 * — fluxo típico: condição com base no resultado → ramo "achou" vs "não achou".
 */
async function handleCrmBuscarContato(
  passo: Passo,
  ctx: SmartflowContexto,
  exec: SmartflowExecutores,
): Promise<PassoResultado> {
  const cfg = passo.config as { tipoBusca?: "telefone" | "email" | "cpfCnpj"; valor?: string };
  const tipoBusca = cfg.tipoBusca || "telefone";
  const { interpolarVariaveis } = await import("./interpolar");
  const valor = interpolarVariaveis(String(cfg.valor || ""), ctx as any).trim();

  if (!valor) {
    return {
      sucesso: false,
      contexto: ctx,
      mensagemErro: "Configure o valor a buscar (suporta interpolação tipo `{{telefoneCliente}}`).",
    };
  }

  let contato: Awaited<ReturnType<SmartflowExecutores["buscarContatoCrm"]>>;
  try {
    contato = await exec.buscarContatoCrm({ tipoBusca, valor });
  } catch (err: any) {
    return { sucesso: false, contexto: ctx, mensagemErro: `CRM buscar contato: ${err.message}` };
  }

  if (!contato) {
    // Não achou — sucesso (não é erro), mas marca flag pra próximo passo decidir.
    return {
      sucesso: true,
      contexto: {
        ...ctx,
        contatoEncontrado: false,
        contatoBuscado: { tipoBusca, valor },
      },
    };
  }

  // Achou — popula contexto.
  const clienteAtual = (ctx.cliente as Record<string, any>) || {};
  return {
    sucesso: true,
    contexto: {
      ...ctx,
      contatoEncontrado: true,
      contatoId: contato.contatoId,
      nomeCliente: contato.nome,
      telefoneCliente: contato.telefone || ctx.telefoneCliente,
      emailCliente: contato.email || ctx.emailCliente,
      atendenteResponsavelId: contato.atendenteResponsavelId ?? ctx.atendenteResponsavelId,
      cliente: { ...clienteAtual, campos: contato.camposPersonalizados },
    },
  };
}

/**
 * Handler do passo `crm_listar_acoes_cliente`. Lista os processos vinculados
 * ao contato (`cliente_processos.contatoId`). Publica `acoes` + `acoesQuantidade`.
 *
 * `contatoId` vem do contexto (campo pré-existente). Se não tiver, falha.
 */
async function handleCrmListarAcoesCliente(
  passo: Passo,
  ctx: SmartflowContexto,
  exec: SmartflowExecutores,
): Promise<PassoResultado> {
  const cfg = passo.config as {
    tipoFiltro?: "todos" | "litigioso" | "extrajudicial";
    poloFiltro?: "todos" | "ativo" | "passivo" | "interessado";
    limite?: number;
  };
  const contatoId = ctx.contatoId;
  if (typeof contatoId !== "number") {
    return {
      sucesso: false,
      contexto: ctx,
      mensagemErro: "Sem `contatoId` no contexto — use um passo de gatilho com contato vinculado ou `crm_buscar_contato` antes.",
    };
  }

  const tipoFiltro = cfg.tipoFiltro && cfg.tipoFiltro !== "todos" ? cfg.tipoFiltro : undefined;
  const poloFiltro = cfg.poloFiltro && cfg.poloFiltro !== "todos" ? cfg.poloFiltro : undefined;
  const limite = Math.max(1, Math.min(50, Number(cfg.limite) || 10));

  try {
    const acoes = await exec.listarAcoesCliente({ contatoId, tipoFiltro, poloFiltro, limite });
    return {
      sucesso: true,
      contexto: {
        ...ctx,
        acoes,
        acoesQuantidade: acoes.length,
      },
    };
  } catch (err: any) {
    return { sucesso: false, contexto: ctx, mensagemErro: `CRM listar ações: ${err.message}` };
  }
}

/**
 * Handler do passo `processo_buscar_movimentacoes`. Lê `eventos_processo`
 * filtrando por janela de dias e tipos. `processoId` aceita interpolação
 * (default `{{acaoId}}` se não configurado).
 */
async function handleProcessoBuscarMovimentacoes(
  passo: Passo,
  ctx: SmartflowContexto,
  exec: SmartflowExecutores,
): Promise<PassoResultado> {
  const cfg = passo.config as {
    processoId?: string;
    tipos?: string[];
    diasJanela?: number;
    limite?: number;
  };
  const { interpolarVariaveis } = await import("./interpolar");
  const raw = String(cfg.processoId || "").trim();
  let processoRef: number | string;
  if (raw) {
    const interpolado = interpolarVariaveis(raw, ctx as any).trim();
    if (!interpolado) {
      return { sucesso: false, contexto: ctx, mensagemErro: "processoId interpola pra string vazia." };
    }
    const asNum = Number(interpolado);
    processoRef = Number.isFinite(asNum) && asNum > 0 ? asNum : interpolado;
  } else {
    // Default: tenta `acaoId` do contexto (dispatcher popula em pagamento
    // recebido com cobrança vinculada a ação).
    const acaoId = (ctx as any).acaoId;
    if (typeof acaoId !== "number") {
      return {
        sucesso: false,
        contexto: ctx,
        mensagemErro: "Sem processo a consultar — configure `processoId` ou use depois de um passo que popule `acaoId`.",
      };
    }
    processoRef = acaoId;
  }

  const diasJanela = Math.max(1, Math.min(365, Number(cfg.diasJanela) || 30));
  const limite = Math.max(1, Math.min(50, Number(cfg.limite) || 10));
  const tipos = Array.isArray(cfg.tipos) && cfg.tipos.length > 0 ? cfg.tipos : undefined;

  try {
    const movs = await exec.buscarMovimentacoesProcesso({
      processoRef,
      tipos,
      diasJanela,
      limite,
    });
    return {
      sucesso: true,
      contexto: {
        ...ctx,
        movimentacoes: movs,
        movimentacoesQuantidade: movs.length,
        movimentacaoMaisRecente: movs[0] || null,
      },
    };
  } catch (err: any) {
    return { sucesso: false, contexto: ctx, mensagemErro: `Processo movimentações: ${err.message}` };
  }
}

async function handleIAResponder(
  passo: Passo,
  ctx: SmartflowContexto,
  exec: SmartflowExecutores,
): Promise<PassoResultado> {
  const agenteId = (passo.config as any).agenteId;
  const mensagem = ctx.mensagem || "";

  try {
    // Se o passo tem `agenteId`, usa o agente pré-configurado (prompt +
    // modelo + docs RAG vêm da tabela `agentesIa`). Caso contrário, fallback
    // pro fluxo antigo com prompt textual livre.
    // Passamos `ctx.contatoId` pros executores reais poderem injetar campos
    // personalizados já capturados no system prompt — a IA precisa saber o
    // que já foi coletado pra não repetir perguntas. ia_classificar NÃO
    // recebe esse contexto (é classificação determinística).
    const contatoIdCtx = typeof ctx.contatoId === "number" ? ctx.contatoId : undefined;
    // `conversaId` dá memória pra IA: o executor real carrega as mensagens
    // anteriores dessa conversa pra ela lembrar do que já foi dito.
    const conversaIdCtx = typeof ctx.conversaId === "number" ? ctx.conversaId : undefined;
    let resposta: string;
    let contextoOut: SmartflowContexto = { ...ctx };
    if (typeof agenteId === "number" && agenteId > 0) {
      resposta = await exec.executarAgente(agenteId, mensagem, contatoIdCtx, conversaIdCtx);
      // Captura ESCOPADA: como o agente está sendo usado num passo do fluxo,
      // ele extrai os campos configurados (camposCaptura) da conversa e salva
      // no cadastro — sem "agir sozinho" fora de fluxo. Não-fatal.
      if (contatoIdCtx && conversaIdCtx) {
        const capturados = await exec.extrairCamposDoAgente(agenteId, contatoIdCtx, conversaIdCtx);
        if (capturados && Object.keys(capturados).length > 0) {
          const clienteAtual = (ctx.cliente && typeof ctx.cliente === "object" ? ctx.cliente : {}) as Record<string, unknown>;
          const camposAtual = (clienteAtual.campos && typeof clienteAtual.campos === "object" ? clienteAtual.campos : {}) as Record<string, unknown>;
          contextoOut = { ...contextoOut, cliente: { ...clienteAtual, campos: { ...camposAtual, ...capturados } } };
        }
      }
    } else {
      const promptExtra = passo.config.prompt || "";
      const prompt = `Você é um assistente jurídico educado e profissional. ${promptExtra}\n\nResponda de forma clara e concisa.`;
      resposta = await exec.chamarIA(prompt, mensagem, contatoIdCtx, conversaIdCtx);
    }

    return {
      sucesso: true,
      contexto: { ...contextoOut, respostaIA: resposta },
      resposta,
    };
  } catch (err: any) {
    return { sucesso: false, contexto: ctx, mensagemErro: `IA: ${err.message}` };
  }
}

/**
 * Handler do passo `ia_consultar` — consulta INTERNA à IA. Diferente de
 * `ia_responder`, NÃO retorna `resposta` (logo não vai pro cliente): apenas
 * salva o texto gerado em `ctx[salvarEm]` pra uso em passos seguintes.
 *
 * Entrada = `config.prompt` interpolado (a pergunta). Sem `conversaId` de
 * propósito — é uma consulta focada no prompt, não uma resposta de chat.
 */
async function handleIAConsultar(
  passo: Passo,
  ctx: SmartflowContexto,
  exec: SmartflowExecutores,
): Promise<PassoResultado> {
  const cfg = passo.config as { prompt?: string; agenteId?: number; salvarEm?: string };
  const salvarEm = (cfg.salvarEm || "").trim();
  if (!salvarEm) {
    return { sucesso: false, contexto: ctx, mensagemErro: "Consultar IA: escolha o campo em 'Salvar em' pra guardar a resposta." };
  }
  const usaAgente = typeof cfg.agenteId === "number" && cfg.agenteId > 0;
  const { interpolarVariaveis } = await import("./interpolar");
  const pergunta = interpolarVariaveis(String(cfg.prompt ?? ""), ctx as any).trim();
  if (!pergunta && !usaAgente) {
    return { sucesso: false, contexto: ctx, mensagemErro: "Consultar IA: escreva a pergunta (prompt) ou escolha um agente." };
  }
  const contatoIdCtx = typeof ctx.contatoId === "number" ? ctx.contatoId : undefined;
  const conversaIdCtx = typeof ctx.conversaId === "number" ? ctx.conversaId : undefined;
  try {
    let resposta: string;
    let novoCtx: SmartflowContexto = { ...ctx };
    if (usaAgente) {
      resposta = await exec.executarAgente(cfg.agenteId as number, pergunta, contatoIdCtx, undefined);
      // Captura ESCOPADA: o agente está sendo usado num passo do fluxo → extrai
      // os campos configurados (camposCaptura) da conversa e salva no cadastro.
      if (contatoIdCtx && conversaIdCtx) {
        const capturados = await exec.extrairCamposDoAgente(cfg.agenteId as number, contatoIdCtx, conversaIdCtx);
        if (capturados && Object.keys(capturados).length > 0) {
          const clienteAtual = (ctx.cliente && typeof ctx.cliente === "object" ? ctx.cliente : {}) as Record<string, unknown>;
          const camposAtual = (clienteAtual.campos && typeof clienteAtual.campos === "object" ? clienteAtual.campos : {}) as Record<string, unknown>;
          novoCtx = { ...novoCtx, cliente: { ...clienteAtual, campos: { ...camposAtual, ...capturados } } };
        }
      }
    } else {
      const sistema = "Você é um assistente que responde consultas internas de um fluxo de atendimento jurídico. Responda de forma direta e objetiva, retornando apenas a resposta — sem saudações nem comentários.";
      resposta = await exec.chamarIA(sistema, pergunta, contatoIdCtx, undefined);
    }
    // Sem campo `resposta` → não é enviado ao cliente. Só guarda no contexto.
    return { sucesso: true, contexto: { ...novoCtx, [salvarEm]: resposta } };
  } catch (err: any) {
    return { sucesso: false, contexto: ctx, mensagemErro: `Consultar IA: ${err.message}` };
  }
}

/**
 * Interpreta a saída do "Atendente IA". O agente deve devolver JSON
 * `{resposta, acao, consulta}`. Tolerante: tira cercas markdown; se não for
 * JSON válido ou faltar `resposta`, trata o texto inteiro como resposta sem
 * ação/consulta. Só aceita `acao`/`consulta` que estejam nas listas habilitadas.
 *   - `acao`: ferramenta de AÇÃO (encerra o turno, roteia o fluxo).
 *   - `consulta`: ferramenta de CONSULTA (busca um dado e volta pro agente).
 */
export function interpretarSaidaAtendente(
  raw: string,
  ferramentas: string[],
  consultas: string[] = [],
): { resposta: string; acao: string | null; consulta: string | null; quando: string | null } {
  const stripped = (raw || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  // Candidatos a JSON, em ordem: (1) a string inteira; (2) do 1º "{" ao último
  // "}". O (2) recupera o caso comum do LLM que escreve uma frase ANTES do JSON
  // — sem ele, o JSON.parse falha, o objeto cru VAZA pro cliente e a consulta
  // (ex: ver_horarios) some.
  const candidatos = [stripped];
  const ini = stripped.indexOf("{");
  const fim = stripped.lastIndexOf("}");
  if (ini >= 0 && fim > ini) candidatos.push(stripped.slice(ini, fim + 1));
  for (const cand of candidatos) {
    try {
      const p = JSON.parse(cand) as { resposta?: unknown; acao?: unknown; consulta?: unknown; quando?: unknown };
      if (p && typeof p.resposta === "string") {
        const acao = typeof p.acao === "string" && ferramentas.includes(p.acao) ? p.acao : null;
        const consulta = typeof p.consulta === "string" && consultas.includes(p.consulta) ? p.consulta : null;
        // `quando`: horário ISO que o cliente escolheu (preenchido junto com a
        // ação agendar). Vira variável pro bloco de Agendamento usar como data.
        const quando = typeof p.quando === "string" && p.quando.trim() ? p.quando.trim() : null;
        return { resposta: p.resposta, acao, consulta, quando };
      }
    } catch {
      /* tenta o próximo candidato */
    }
  }
  return { resposta: raw || "", acao: null, consulta: null, quando: null };
}

/**
 * Orquestra o "vai-e-volta" do Atendente IA: chama o agente; se ele pedir uma
 * CONSULTA, executa-a, injeta o resultado e RE-CHAMA o agente (até `maxRodadas`
 * pra evitar loop infinito). Retorna a resposta final + a ação escolhida (ou
 * null). Puro/injetável — `chamarLLM` e `executarConsulta` vêm de fora (testável).
 *
 * `chamarLLM(extraContexto)`: devolve o JSON cru do agente; `extraContexto`
 * acumula os resultados das consultas já feitas neste turno.
 */
export async function orquestrarAtendente(opts: {
  ferramentas: string[];
  consultas: string[];
  chamarLLM: (extraContexto: string) => Promise<string>;
  executarConsulta: (nome: string) => Promise<string>;
  maxRodadas?: number;
}): Promise<{ resposta: string; acao: string | null; quando: string | null }> {
  const max = Math.max(1, opts.maxRodadas ?? 3);
  let extra = "";
  let forcouConsulta = false;
  for (let i = 0; i < max; i++) {
    const raw = await opts.chamarLLM(extra);
    const { resposta, acao, consulta, quando } = interpretarSaidaAtendente(raw, opts.ferramentas, opts.consultas);
    if (consulta) {
      const resultado = await opts.executarConsulta(consulta);
      extra += `${extra ? "\n\n" : ""}[Resultado da consulta "${consulta}"]:\n${resultado}`;
      continue; // re-chama o agente com o resultado em mãos
    }
    // Anti-stall: o modelo prometeu "vou verificar" mas NÃO disparou a consulta
    // (nem escolheu ação). Antes isso virava um "um momento" + pausa, deixando o
    // cliente esperando uma resposta que nunca vinha sozinha (ele só voltava na
    // próxima mensagem). Agora re-chamamos UMA vez forçando a consulta. Só quando
    // há consulta disponível — senão o "um momento" é uma resposta legítima.
    if (!acao && !forcouConsulta && opts.consultas.length > 0 && pareceStallDeConsulta(resposta)) {
      forcouConsulta = true;
      extra += `${extra ? "\n\n" : ""}[Você indicou que ia verificar algo mas não disparou nenhuma consulta. Dispare AGORA a consulta apropriada (ex: "${opts.consultas[0]}") e já responda com o resultado — não responda só "um momento".]`;
      continue;
    }
    return { resposta, acao, quando };
  }
  // Esgotou as rodadas de consulta — força uma resposta final sem ação,
  // pedindo pro agente concluir com o que já tem.
  const raw = await opts.chamarLLM(`${extra}\n\n[Pare de consultar e responda ao cliente agora.]`);
  const { resposta } = interpretarSaidaAtendente(raw, opts.ferramentas, opts.consultas);
  return { resposta, acao: null, quando: null };
}

/**
 * Heurística do anti-stall: a resposta parece um "vou verificar e volto" sem
 * entregar nada? Normaliza acentos (pra casar "só"/"horário") e procura frases
 * típicas de adiamento. Usada só quando o modelo NÃO disparou consulta nem ação.
 */
function pareceStallDeConsulta(resposta: string): boolean {
  const t = (resposta || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (!t.trim()) return false;
  return /(um momento|um instante|aguarde|aguardo|vou verificar|estou verificando|verificando|vou checar|vou conferir|vou olhar|deixa eu ver|deixe-me ver|ja te (retorno|falo|respondo|trago|aviso)|vou consultar|consultando|ver os horari|verificar os horari|checar a agenda)/.test(t);
}

/**
 * Handler do passo `ia_atendente` — o "Atendente IA". O agente conduz a conversa
 * inteira (roteiro no prompt) e, a cada turno:
 *   - se decide uma AÇÃO (uma das ferramentas habilitadas) → envia a resposta e
 *     ROTEIA pela saída daquela ferramenta (proximoSe[acao]).
 *   - senão → envia a resposta e PAUSA esperando a próxima mensagem; ao retomar,
 *     o nó re-executa (continua a conversa). É o loop, sem o usuário desenhar.
 * Captura campos do cadastro automaticamente (escopado ao uso no fluxo).
 */
async function handleIaAtendente(
  passo: Passo,
  ctx: SmartflowContexto,
  exec: SmartflowExecutores,
): Promise<PassoResultado> {
  const cfg = passo.config as {
    agenteId?: number;
    roteiro?: string;
    ferramentas?: string[];
    acoesCustom?: Array<{ nome: string; descricao: string }>;
    consultas?: string[];
    consultaConfig?: { responsavelModo?: "auto" | "fixo"; responsavelId?: number; duracaoMin?: number; dias?: number };
    acumularSegundos?: number;
  };
  if (typeof cfg.agenteId !== "number" || cfg.agenteId <= 0) {
    return { sucesso: false, contexto: ctx, mensagemErro: "Atendente IA: escolha um agente." };
  }
  const acumularSegundos = Number(cfg.acumularSegundos) > 0 ? Math.floor(Number(cfg.acumularSegundos)) : 0;
  const ferramentas = Array.isArray(cfg.ferramentas) ? cfg.ferramentas.filter((f) => typeof f === "string") : [];
  const acoesCustom = Array.isArray(cfg.acoesCustom)
    ? cfg.acoesCustom.filter((a): a is { nome: string; descricao: string } => !!a && typeof a.nome === "string" && a.nome.trim().length > 0)
    : [];
  // Lista combinada (builtin + custom) — usada pra validar/rotear a ação escolhida.
  const ferramentasTodas = [...ferramentas, ...acoesCustom.map((a) => a.nome.trim())];
  const consultas = Array.isArray(cfg.consultas) ? cfg.consultas.filter((c) => typeof c === "string") : [];
  // Mensagem do turno: a resposta nova (retomada) ou a 1ª mensagem.
  const mensagem = typeof ctx.respostaUsuario === "string" && ctx.respostaUsuario.trim()
    ? ctx.respostaUsuario
    : String(ctx.mensagem ?? "");
  const contatoId = typeof ctx.contatoId === "number" ? ctx.contatoId : undefined;
  const conversaId = typeof ctx.conversaId === "number" ? ctx.conversaId : undefined;

  try {
    const cc = cfg.consultaConfig;
    // Dono da agenda — resolvido UMA vez (cascata) e reaproveitado pelo passo
    // Agendar, garantindo que a agenda oferecida é a mesma onde marca.
    let agendaResponsavelResolvidoId: number | undefined;
    if (consultas.includes("ver_horarios") || ferramentas.includes("agendar")) {
      const modo = cc?.responsavelModo ?? (cc?.responsavelId ? "fixo" : "auto");
      const resolvido = await exec.resolverResponsavelAgenda({
        responsavelIdPreferido: modo === "fixo" ? (cc?.responsavelId ?? null) : null,
        contatoId,
        conversaId,
        atendenteResponsavelId: typeof ctx.atendenteResponsavelId === "number" ? ctx.atendenteResponsavelId : null,
      });
      if (typeof resolvido === "number") agendaResponsavelResolvidoId = resolvido;
    }
    const consultaConfigResolvida = (cc || agendaResponsavelResolvidoId != null)
      ? { responsavelId: agendaResponsavelResolvidoId ?? cc?.responsavelId, duracaoMin: cc?.duracaoMin, dias: cc?.dias }
      : undefined;

    const { resposta, acao, quando } = await exec.conversarComAgente({
      agenteId: cfg.agenteId,
      roteiro: cfg.roteiro,
      ferramentas,
      acoesCustom,
      consultas,
      consultaConfig: consultaConfigResolvida,
      // Passa o ctx pra interpolação no prompt/roteiro: {{atendente}},
      // {{cliente.nome}}, etc. — assim variáveis publicadas por blocos
      // anteriores (ex: Distribuir p/ setor) entram no prompt do agente.
      vars: ctx as unknown as Record<string, unknown>,
      mensagem,
      contatoId,
      conversaId,
    });

    // Limpa flags de retomada (este nó re-executa, não "passa direto").
    let novoCtx: SmartflowContexto = { ...ctx };
    if (typeof agendaResponsavelResolvidoId === "number") novoCtx.agendaResponsavelResolvidoId = agendaResponsavelResolvidoId;
    // Horário escolhido pelo cliente (vindo junto com a ação agendar) — vira
    // variável `agendamentoQuando` (ISO, p/ o bloco de Agendamento usar como
    // data) + `agendamentoQuandoTexto` (formatada pt-BR, p/ mensagem de
    // confirmação). Sem isso o Agendamento não sabe o horário e marca "agora".
    if (typeof quando === "string" && quando.trim()) {
      const isoQuando = quando.trim();
      novoCtx.agendamentoQuando = isoQuando;
      const d = new Date(isoQuando);
      if (!Number.isNaN(d.getTime())) {
        novoCtx.agendamentoQuandoTexto = d.toLocaleString("pt-BR", {
          timeZone: "America/Sao_Paulo",
          day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
        });
      }
    }
    delete (novoCtx as any).__resumindoWaitClienteId;
    delete (novoCtx as any).__resumindoWaitMotivo;

    // Captura escopada de campos do cadastro.
    if (contatoId && conversaId) {
      const capturados = await exec.extrairCamposDoAgente(cfg.agenteId, contatoId, conversaId);
      if (capturados && Object.keys(capturados).length > 0) {
        const cli = (novoCtx.cliente && typeof novoCtx.cliente === "object" ? novoCtx.cliente : {}) as Record<string, unknown>;
        const campos = (cli.campos && typeof cli.campos === "object" ? cli.campos : {}) as Record<string, unknown>;
        novoCtx = { ...novoCtx, cliente: { ...cli, campos: { ...campos, ...capturados } } };
      }
    }

    // Ação escolhida (e habilitada — builtin ou custom) → envia a resposta e sai pela saída.
    if (acao && ferramentasTodas.includes(acao)) {
      const enviadas = novoCtx.mensagensEnviadas || [];
      return {
        sucesso: true,
        resposta: resposta || undefined,
        contexto: { ...novoCtx, mensagensEnviadas: resposta ? [...enviadas, resposta] : enviadas, acaoAtendente: acao },
        proximoRamoId: acao,
      };
    }

    // Sem ação → continua a conversa: envia a resposta e pausa esperando o cliente.
    const enviadas = novoCtx.mensagensEnviadas || [];
    return {
      sucesso: true,
      parar: true,
      resposta: resposta || undefined,
      contexto: {
        ...novoCtx,
        mensagensEnviadas: resposta ? [...enviadas, resposta] : enviadas,
        aguardandoMensagem: true,
        aguardandoContatoId: contatoId,
        aguardandoTimeoutMinutos: 1440,
        aguardandoNodeClienteId: passo.clienteId ?? null,
        aguardandoAcumularSegundos: acumularSegundos,
      },
    };
  } catch (err: any) {
    return { sucesso: false, contexto: ctx, mensagemErro: `Atendente IA: ${err?.message || String(err)}` };
  }
}

async function handleCalcomHorarios(
  passo: Passo,
  ctx: SmartflowContexto,
  exec: SmartflowExecutores,
): Promise<PassoResultado> {
  const duracao = passo.config.duracao || 30;
  try {
    const horarios = await exec.buscarHorarios(duracao);
    if (horarios.length === 0) {
      return {
        sucesso: true,
        contexto: { ...ctx, horariosDisponiveis: [] },
        resposta: "No momento não temos horários disponíveis. Entraremos em contato em breve.",
        parar: true,
      };
    }

    // Formata horários pra mensagem
    const lista = horarios.slice(0, 5).map((h, i) => `${i + 1}. ${h}`).join("\n");
    return {
      sucesso: true,
      contexto: { ...ctx, horariosDisponiveis: horarios },
      resposta: `Temos os seguintes horários disponíveis:\n\n${lista}\n\nQual prefere? Responda com o número.`,
    };
  } catch (err: any) {
    return { sucesso: false, contexto: ctx, mensagemErro: `Cal.com: ${err.message}` };
  }
}

async function handleCalcomAgendar(
  passo: Passo,
  ctx: SmartflowContexto,
  exec: SmartflowExecutores,
): Promise<PassoResultado> {
  const horario = ctx.horarioEscolhido;
  if (!horario) {
    return { sucesso: false, contexto: ctx, mensagemErro: "Nenhum horário escolhido" };
  }

  try {
    const agendamentoId = await exec.criarAgendamento(
      horario,
      (ctx.nomeCliente as string) || "Cliente",
      (ctx.emailCliente as string) || "",
    );
    return {
      sucesso: true,
      contexto: { ...ctx, agendamentoId },
      resposta: `Reunião agendada com sucesso para ${horario}! Você receberá uma confirmação por email.`,
    };
  } catch (err: any) {
    return { sucesso: false, contexto: ctx, mensagemErro: `Agendamento: ${err.message}` };
  }
}

async function handleCalcomListar(
  passo: Passo,
  ctx: SmartflowContexto,
  exec: SmartflowExecutores,
): Promise<PassoResultado> {
  const status = ((passo.config as any).status as
    | "upcoming"
    | "past"
    | "cancelled"
    | "unconfirmed"
    | undefined) || "upcoming";

  try {
    const bookings = await exec.listarBookings({ status });
    return {
      sucesso: true,
      contexto: { ...ctx, bookings, bookingsQuantidade: bookings.length },
    };
  } catch (err: any) {
    return { sucesso: false, contexto: ctx, mensagemErro: `Cal.com listar: ${err.message}` };
  }
}

async function handleCalcomCancelar(
  passo: Passo,
  ctx: SmartflowContexto,
  exec: SmartflowExecutores,
): Promise<PassoResultado> {
  const bookingId =
    ((passo.config as any).bookingId as string | undefined) ||
    (ctx.agendamentoId as string | undefined);
  if (!bookingId) {
    return { sucesso: false, contexto: ctx, mensagemErro: "Sem bookingId para cancelar" };
  }
  const motivo = ((passo.config as any).motivo as string | undefined) || undefined;

  try {
    const ok = await exec.cancelarBooking(bookingId, motivo);
    if (!ok) {
      return { sucesso: false, contexto: ctx, mensagemErro: "Cal.com recusou o cancelamento" };
    }
    return {
      sucesso: true,
      contexto: { ...ctx, bookingCancelado: bookingId },
      resposta: "Agendamento cancelado com sucesso.",
    };
  } catch (err: any) {
    return { sucesso: false, contexto: ctx, mensagemErro: `Cal.com cancelar: ${err.message}` };
  }
}

async function handleCalcomRemarcar(
  passo: Passo,
  ctx: SmartflowContexto,
  exec: SmartflowExecutores,
): Promise<PassoResultado> {
  const bookingId =
    ((passo.config as any).bookingId as string | undefined) ||
    (ctx.agendamentoId as string | undefined);
  const novoHorario =
    ((passo.config as any).novoHorario as string | undefined) ||
    (ctx.horarioEscolhido as string | undefined);

  if (!bookingId) {
    return { sucesso: false, contexto: ctx, mensagemErro: "Sem bookingId para remarcar" };
  }
  if (!novoHorario) {
    return { sucesso: false, contexto: ctx, mensagemErro: "Sem novo horário para remarcar" };
  }
  const motivo = ((passo.config as any).motivo as string | undefined) || undefined;

  try {
    const ok = await exec.reagendarBooking(bookingId, novoHorario, motivo);
    if (!ok) {
      return { sucesso: false, contexto: ctx, mensagemErro: "Cal.com recusou o reagendamento" };
    }
    return {
      sucesso: true,
      contexto: { ...ctx, horarioEscolhido: novoHorario },
      resposta: `Agendamento remarcado para ${novoHorario}.`,
    };
  } catch (err: any) {
    return { sucesso: false, contexto: ctx, mensagemErro: `Cal.com remarcar: ${err.message}` };
  }
}

/**
 * Monta o array `components` que a Cloud API espera, interpolando as
 * variáveis do fluxo nos valores configurados. Só inclui as PARTES VARIÁVEIS
 * (mídia do header, parâmetros do corpo, botões dinâmicos) — texto/botão
 * estáticos do template já vivem aprovados na Meta e não vão no payload.
 */
function montarComponentesTemplate(cfg: any, ip: (s?: string) => string): any[] {
  const comps: any[] = [];
  const h = cfg.templateHeader;
  if (h && typeof h === "object") {
    const fmt = String(h.formato || "").toUpperCase();
    const valor = ip(h.valor).trim();
    if (valor) {
      if (fmt === "IMAGE") comps.push({ type: "header", parameters: [{ type: "image", image: { link: valor } }] });
      else if (fmt === "VIDEO") comps.push({ type: "header", parameters: [{ type: "video", video: { link: valor } }] });
      else if (fmt === "DOCUMENT") {
        const doc: any = { link: valor };
        const fn = ip(h.nomeArquivo).trim();
        if (fn) doc.filename = fn;
        comps.push({ type: "header", parameters: [{ type: "document", document: doc }] });
      } else if (fmt === "TEXT") {
        comps.push({ type: "header", parameters: [{ type: "text", text: ip(h.valor) }] });
      }
    }
  }
  const corpo = Array.isArray(cfg.templateCorpo) ? cfg.templateCorpo : [];
  if (corpo.length > 0) {
    comps.push({ type: "body", parameters: corpo.map((v: string) => ({ type: "text", text: ip(v) })) });
  }
  const botoes = Array.isArray(cfg.templateBotoes) ? cfg.templateBotoes : [];
  for (const b of botoes) {
    const idx = Number(b?.index);
    const tipo = String(b?.tipo || "").toUpperCase();
    const valor = ip(b?.valor).trim();
    if (!Number.isFinite(idx) || !valor) continue;
    if (tipo === "URL") comps.push({ type: "button", sub_type: "url", index: String(idx), parameters: [{ type: "text", text: valor }] });
    else if (tipo === "COPY_CODE") comps.push({ type: "button", sub_type: "copy_code", index: String(idx), parameters: [{ type: "coupon_code", coupon_code: valor }] });
    else if (tipo === "QUICK_REPLY") comps.push({ type: "button", sub_type: "quick_reply", index: String(idx), parameters: [{ type: "payload", payload: valor }] });
  }
  return comps;
}

/**
 * Valida os parâmetros do template ANTES de mandar pra Meta e devolve uma
 * mensagem clara apontando a variável vazia — em vez do genérico #131008
 * ("Required parameter is missing"). Cobre corpo, cabeçalho e botões.
 */
function validarParametrosTemplate(cfg: any, ip: (s?: string) => string): string | null {
  const corpo = Array.isArray(cfg.templateCorpo) ? cfg.templateCorpo : [];
  for (let i = 0; i < corpo.length; i++) {
    if (!ip(corpo[i]).trim()) {
      return `A variável {{${i + 1}}} do corpo do template está vazia. Preencha no passo (ex: {{nomeCliente}}) ou confira se a variável existe no contexto do gatilho.`;
    }
  }
  const h = cfg.templateHeader;
  if (h && typeof h === "object" && h.formato && !ip(h.valor).trim()) {
    return "O cabeçalho do template está sem valor (variável/URL). Preencha no passo.";
  }
  const botoes = Array.isArray(cfg.templateBotoes) ? cfg.templateBotoes : [];
  for (const b of botoes) {
    if (b && b.tipo && !ip(b?.valor).trim()) {
      return `O parâmetro do botão (${String(b.tipo).toLowerCase()}) do template está vazio. Preencha no passo.`;
    }
  }
  return null;
}

/**
 * Envia um template (HSM) aprovado da Meta. Diferente do texto livre, o
 * template é disparado DIRETO pela Cloud API (não volta como `resposta`
 * pelo canal — texto e template são chamadas distintas na API), então
 * registramos só em `mensagensEnviadas` pra não duplicar.
 */
async function enviarTemplateWhatsApp(
  passo: Passo,
  ctx: SmartflowContexto,
  exec: SmartflowExecutores,
): Promise<PassoResultado> {
  const cfg = passo.config as any;
  const nome = String(cfg.templateNome || "").trim();
  const idioma = String(cfg.templateIdioma || "pt_BR").trim() || "pt_BR";
  const telefone = typeof ctx.telefoneCliente === "string" ? ctx.telefoneCliente.trim() : "";
  if (!telefone) {
    return {
      sucesso: false,
      contexto: ctx,
      mensagemErro: "Template precisa do telefone do contato — use um passo 'Buscar contato' antes ou um gatilho que traga o telefone.",
    };
  }
  if (!exec.enviarWhatsAppTemplate) {
    return { sucesso: false, contexto: ctx, mensagemErro: "Envio de template indisponível neste ambiente." };
  }
  const { interpolarVariaveis } = await import("./interpolar");
  const ip = (s?: string) => interpolarVariaveis(String(s ?? ""), ctx as any);
  const componentes = montarComponentesTemplate(cfg, ip);
  // Aponta a variável vazia ANTES de a Meta recusar com o genérico #131008.
  const faltando = validarParametrosTemplate(cfg, ip);
  if (faltando) {
    return { sucesso: false, contexto: ctx, mensagemErro: faltando };
  }
  // Conteúdo pra timeline de Atendimentos. Quando o corpo aprovado foi
  // guardado (`templateCorpoTexto`, com {{1}}..{{n}}), reconstrói a MENSAGEM
  // REAL — preenche cada {{k}} com o valor interpolado — igual ao que o
  // cliente recebe. Sem o corpo guardado (cenários antigos), cai no resumo
  // compacto "[Template: nome] valores".
  const corpoValsRaw: string[] = Array.isArray(cfg.templateCorpo) ? cfg.templateCorpo : [];
  const corpoTexto = typeof cfg.templateCorpoTexto === "string" ? cfg.templateCorpoTexto : "";
  let conteudoPreview: string;
  if (corpoTexto) {
    conteudoPreview = corpoTexto.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m: string, d: string) => {
      const idx = Number(d) - 1;
      return idx >= 0 && idx < corpoValsRaw.length ? ip(corpoValsRaw[idx]) : "";
    });
  } else {
    const corpoVals = corpoValsRaw.map((v: string) => ip(v).trim()).filter(Boolean);
    conteudoPreview = corpoVals.length
      ? `[Template: ${nome}] ${corpoVals.join(" · ")}`
      : `[Template: ${nome}]`;
  }
  const contatoId = typeof ctx.contatoId === "number" ? ctx.contatoId : undefined;
  try {
    const r = await exec.enviarWhatsAppTemplate(telefone, { nome, idioma, componentes, contatoId, conteudoPreview });
    // Aceita boolean (compat) ou { ok, erro }. Quando vem o erro real (da
    // Meta / resolução de canal), mostra ele — em vez da mensagem genérica
    // que confundia (dizia "confira canal/template" mesmo quando o motivo
    // era outro, ex: número inválido, nome/idioma divergente, parâmetro).
    const ok = typeof r === "boolean" ? r : r.ok;
    const erroReal = typeof r === "boolean" ? undefined : r.erro;
    if (!ok) {
      return {
        sucesso: false,
        contexto: ctx,
        mensagemErro: erroReal
          ? `Falha ao enviar template: ${erroReal}`
          : "Falha ao enviar template — confira se há canal WhatsApp oficial (API) conectado e se o template está aprovado na Meta.",
      };
    }
  } catch (err: any) {
    return { sucesso: false, contexto: ctx, mensagemErro: `WhatsApp template: ${err?.message || String(err)}` };
  }
  const enviadas = ctx.mensagensEnviadas || [];
  return {
    sucesso: true,
    contexto: { ...ctx, mensagensEnviadas: [...enviadas, `[template: ${nome}]`] },
  };
}

async function handleWhatsAppEnviar(
  passo: Passo,
  ctx: SmartflowContexto,
  exec: SmartflowExecutores,
): Promise<PassoResultado> {
  // Modo "template" (HSM aprovado da Meta) — caminho próprio: dispara direto
  // pela Cloud API oficial, sem passar pela lógica de texto/canalId abaixo.
  if ((passo.config as any).modo === "template" && String((passo.config as any).templateNome || "").trim()) {
    return await enviarTemplateWhatsApp(passo, ctx, exec);
  }

  const template = passo.config.template || ctx.respostaIA || "";
  if (!template) {
    return { sucesso: false, contexto: ctx, mensagemErro: "Sem mensagem para enviar" };
  }

  // `{cobrancasAbertas}` é resolvido via executor (faz query em
  // asaas_cobrancas). Só chama se o template realmente menciona a variável
  // — evita custo desnecessário.
  let blocoCobrancas = "";
  if (/\{cobrancasAbertas\}/.test(template)) {
    try {
      blocoCobrancas = await exec.buscarCobrancasAbertas({
        contatoId: typeof ctx.contatoId === "number" ? ctx.contatoId : undefined,
        clienteAsaasId: typeof ctx.clienteAsaasId === "string" ? ctx.clienteAsaasId : undefined,
      });
    } catch {
      blocoCobrancas = "";
    }
  }

  // Bloco multi-linha {cobrancasAbertas} é tratado ANTES da interpolação
  // genérica (não dá pra ter linha quebrada num placeholder simples).
  const templateComCobrancas = template.replace(/\{cobrancasAbertas\}/g, blocoCobrancas);

  // Interpolação genérica: aceita `{{cliente.nome}}` (novo) e mantém
  // compat com `{nome}`, `{intencao}`, `{horario}` (legado via alias).
  const { interpolarVariaveis } = await import("./interpolar");
  const mensagem = interpolarVariaveis(templateComCobrancas, ctx as any);

  // Quando o gatilho veio via `dispararMensagemCanal` (ou legado
  // `tentarSmartFlow`), o contexto carrega `canalId` — o whatsapp-handler
  // que chamou o dispatcher vai entregar as `respostas` pelo próprio
  // `chatId` da conversa. Nesse caso, o handler aqui NÃO deve enviar
  // diretamente (evita duplicata).
  //
  // Pra gatilhos não-mensagem (pagamento_recebido, pagamento_vencido,
  // agendamento_*, etc.), `canalId` não está no contexto mas `telefoneCliente`
  // deve ter sido populado pelo dispatcher. Nesse caso, o engine envia
  // diretamente via executor (que busca o canal WhatsApp ativo do escritório).
  const telefone = typeof ctx.telefoneCliente === "string" ? ctx.telefoneCliente.trim() : "";
  const temCanal = typeof ctx.canalId === "number" && ctx.canalId > 0;
  if (!temCanal && telefone) {
    try {
      const ok = await exec.enviarWhatsApp(telefone, mensagem, {
        contatoId: typeof ctx.contatoId === "number" ? ctx.contatoId : undefined,
        proativo: true,
      });
      if (!ok) {
        return {
          sucesso: false,
          contexto: ctx,
          mensagemErro: "Falha ao enviar WhatsApp — verifique se há canal conectado.",
        };
      }
    } catch (err: any) {
      return {
        sucesso: false,
        contexto: ctx,
        mensagemErro: `WhatsApp: ${err?.message || String(err)}`,
      };
    }
  }

  const enviadas = ctx.mensagensEnviadas || [];
  return {
    sucesso: true,
    contexto: { ...ctx, mensagensEnviadas: [...enviadas, mensagem] },
    resposta: mensagem,
  };
}

/**
 * Handler do passo `whatsapp_aguardar_resposta`. Envia a mensagem (igual
 * ao `whatsapp_enviar`) e sinaliza ao dispatcher que esta execução está
 * aguardando próxima mensagem do contato.
 *
 * Sinalização via flags no contexto:
 *   - `aguardandoMensagem` (boolean): finalizarExecucao detecta e grava
 *     `aguardandoMensagemContatoId` na execução.
 *   - `aguardandoContatoId`: pra qual contato esperamos.
 *   - `aguardandoTimeoutMinutos`: deadline (vira `retomarEm`).
 *   - `aguardandoOpcoes`: lista pro parser interpretar a resposta quando
 *     ela vier.
 *
 * Retorna `parar: true` — engine fecha a execução nesse passo. O fluxo
 * só continua quando o dispatcher detectar a próxima mensagem do contato
 * E chamar `retomarExecucaoComResposta`.
 */
async function handleWhatsappAguardarResposta(
  passo: Passo,
  ctx: SmartflowContexto,
  exec: SmartflowExecutores,
): Promise<PassoResultado> {
  const cfg = passo.config as {
    template?: string;
    timeoutMinutos?: number;
    opcoes?: string[];
  };
  const contatoId = ctx.contatoId;
  if (typeof contatoId !== "number") {
    return {
      sucesso: false,
      contexto: ctx,
      mensagemErro: "Sem `contatoId` no contexto — não dá pra saber de quem aguardar resposta.",
    };
  }

  const opcoes = Array.isArray(cfg.opcoes) ? cfg.opcoes.filter((o) => typeof o === "string" && o.trim()) : [];
  const timeoutMinutos = Math.max(1, Math.min(7 * 24 * 60, Number(cfg.timeoutMinutos) || 1440)); // 1min ~ 7 dias

  // Monta template — base + menu numerado se houver opções
  let template = String(cfg.template ?? "").trim();
  if (opcoes.length > 0) {
    const menu = opcoes.map((o, i) => `${i + 1}. ${o}`).join("\n");
    template = template ? `${template}\n\n${menu}` : menu;
  }
  if (!template) {
    return { sucesso: false, contexto: ctx, mensagemErro: "Configure o template da mensagem (ou pelo menos uma opção)." };
  }

  const { interpolarVariaveis } = await import("./interpolar");
  const mensagem = interpolarVariaveis(template, ctx as any);

  // Envia. Mesma lógica do whatsapp_enviar — usa canalId do contexto se
  // presente (mensagem veio via canal), senão executor real busca canal
  // ativo do escritório.
  const telefone = typeof ctx.telefoneCliente === "string" ? ctx.telefoneCliente.trim() : "";
  const temCanal = typeof ctx.canalId === "number" && ctx.canalId > 0;
  if (!temCanal && telefone) {
    try {
      const ok = await exec.enviarWhatsApp(telefone, mensagem, {
        contatoId: typeof ctx.contatoId === "number" ? ctx.contatoId : undefined,
        proativo: true,
      });
      if (!ok) {
        return {
          sucesso: false,
          contexto: ctx,
          mensagemErro: "Falha ao enviar WhatsApp — verifique se há canal conectado.",
        };
      }
    } catch (err: any) {
      return {
        sucesso: false,
        contexto: ctx,
        mensagemErro: `WhatsApp: ${err?.message || String(err)}`,
      };
    }
  }
  // Se temCanal=true, mensagem volta na lista `respostas` e o whatsapp-handler
  // que invocou o cenário envia direto pelo canal já estabelecido.

  const enviadas = ctx.mensagensEnviadas || [];
  return {
    sucesso: true,
    parar: true, // ← pausa o fluxo aqui
    resposta: mensagem,
    contexto: {
      ...ctx,
      mensagensEnviadas: [...enviadas, mensagem],
      // Flags que o dispatcher.finalizarExecucao consome pra persistir
      // o estado de espera-mensagem na linha da execução.
      aguardandoMensagem: true,
      aguardandoContatoId: contatoId,
      aguardandoTimeoutMinutos: timeoutMinutos,
      aguardandoOpcoes: opcoes,
      // Em qual NÓ pausou — permite retomada graph-aware (seguir as setas a
      // partir daqui, inclusive loops). Vazio = retomada linear (legado).
      aguardandoNodeClienteId: passo.clienteId ?? null,
    },
  };
}

/**
 * Handler do passo `whatsapp_pergunta_opcoes` — envia mensagem interativa
 * (botões ou lista) e pausa execução. Quando retomado (cliente clicou ou
 * digitou), roteia pelo ramo correspondente:
 *   - `cond_<id>` se cliente clicou um botão/item específico
 *   - `cond_<id>` se cliente digitou texto e fallback=fuzzy bateu
 *   - `outra_resposta` se texto digitado não bateu (ou fallback=ignorar)
 *   - `sem_resposta` se timeout (scheduler chama com __resumindoWaitMotivo="timeout")
 *
 * SÓ funciona em canal Cloud API. Em canais que não suportam interativo,
 * falha cedo com erro claro pra operador entender por que não chegou.
 */
async function handleWhatsappPerguntaOpcoes(
  passo: Passo,
  ctx: SmartflowContexto,
  exec: SmartflowExecutores,
): Promise<PassoResultado> {
  const cfg = passo.config as {
    modo?: "botoes" | "lista";
    header?: string;
    body?: string;
    footer?: string;
    opcoes?: Array<{ id: string; titulo: string }>;
    drawerLabel?: string;
    secoes?: Array<{ titulo: string; itens: Array<{ id: string; titulo: string; descricao?: string }> }>;
    timeoutMinutos?: number;
    fallbackTexto?: "fuzzy" | "ignorar";
  };

  // MODO RETOMADA: contexto traz a marca de re-entrada nesse nó. Decide o ramo
  // baseado em respostaOpcao (clique), respostaUsuario (texto livre) ou motivo
  // de retomada (timeout do scheduler).
  const resumindoEsseNo = (ctx as any).__resumindoWaitClienteId === passo.clienteId;
  if (resumindoEsseNo) {
    const motivo = (ctx as any).__resumindoWaitMotivo as string | undefined;
    const novoCtx: SmartflowContexto = { ...ctx };
    delete (novoCtx as any).__resumindoWaitClienteId;
    delete (novoCtx as any).__resumindoWaitMotivo;
    delete (novoCtx as any).aguardandoNodeClienteId;

    if (motivo === "timeout") {
      return { sucesso: true, contexto: novoCtx, proximoRamoId: "sem_resposta" };
    }

    // Clique tem prioridade — ID veio direto da Meta, sem ambiguidade.
    const reply = (novoCtx as any).respostaOpcao as { id?: string; titulo?: string } | undefined;
    if (reply && typeof reply.id === "string" && reply.id) {
      return { sucesso: true, contexto: novoCtx, proximoRamoId: `cond_${reply.id}` };
    }

    // Texto livre: tenta fuzzy match contra todos os títulos disponíveis,
    // ou cai direto em "outra_resposta" se fallback=ignorar.
    const fallback = cfg.fallbackTexto ?? "fuzzy";
    if (fallback === "fuzzy") {
      const texto = String((novoCtx as any).respostaUsuario || "").trim();
      const todasOpcoes = listarOpcoesParaMatch(cfg);
      const match = encontrarMatchPorTitulo(texto, todasOpcoes);
      if (match) return { sucesso: true, contexto: novoCtx, proximoRamoId: `cond_${match.id}` };
    }
    return { sucesso: true, contexto: novoCtx, proximoRamoId: "outra_resposta" };
  }

  // MODO ENVIO: primeira execução desse passo.
  const contatoId = ctx.contatoId;
  if (typeof contatoId !== "number") {
    return { sucesso: false, contexto: ctx, mensagemErro: "Sem contatoId no contexto — não dá pra perguntar com opções." };
  }
  const modo: "botoes" | "lista" = cfg.modo === "lista" ? "lista" : "botoes";
  const body = String(cfg.body ?? "").trim();
  if (!body) {
    return { sucesso: false, contexto: ctx, mensagemErro: "Pergunta com opções: preencha o corpo da mensagem." };
  }

  // Valida cardinalidade conforme limites da API Meta.
  if (modo === "botoes") {
    const opcoes = Array.isArray(cfg.opcoes) ? cfg.opcoes : [];
    if (opcoes.length === 0 || opcoes.length > 3) {
      return { sucesso: false, contexto: ctx, mensagemErro: "Pergunta com opções: configure de 1 a 3 botões." };
    }
    for (const o of opcoes) {
      if (!o?.id || !o?.titulo) {
        return { sucesso: false, contexto: ctx, mensagemErro: "Pergunta com opções: cada botão precisa de id e título." };
      }
    }
  } else {
    const secoes = Array.isArray(cfg.secoes) ? cfg.secoes : [];
    if (secoes.length === 0 || secoes.length > 10) {
      return { sucesso: false, contexto: ctx, mensagemErro: "Pergunta com opções (lista): configure de 1 a 10 seções." };
    }
    for (const s of secoes) {
      if (!Array.isArray(s.itens) || s.itens.length === 0 || s.itens.length > 10) {
        return { sucesso: false, contexto: ctx, mensagemErro: "Pergunta com opções (lista): cada seção precisa de 1 a 10 itens." };
      }
    }
  }

  if (!exec.enviarWhatsAppInteractive) {
    return { sucesso: false, contexto: ctx, mensagemErro: "Canal WhatsApp não suporta mensagens interativas (precisa ser Cloud API oficial)." };
  }

  const telefone = typeof ctx.telefoneCliente === "string" ? ctx.telefoneCliente.trim() : "";
  if (!telefone) {
    return { sucesso: false, contexto: ctx, mensagemErro: "Sem telefone no contexto — não dá pra enviar mensagem interativa." };
  }

  const { interpolarVariaveis } = await import("./interpolar");
  const bodyInterp = interpolarVariaveis(body, ctx as any);
  const headerInterp = cfg.header ? interpolarVariaveis(cfg.header, ctx as any) : undefined;
  const footerInterp = cfg.footer ? interpolarVariaveis(cfg.footer, ctx as any) : undefined;

  // Reply (gatilho = mensagem do contato, ctx.canalId presente) não conta o
  // teto proativo nem checa opt-out — política Meta permite responder quem
  // escreveu. Gatilho não-mensagem (scheduler/webhook) é proativo: opt-out e
  // opt-in valem (antes esse caminho furava os dois — contato que pediu SAIR
  // continuava recebendo pergunta interativa).
  const veioDeMensagem = typeof ctx.canalId === "number" && ctx.canalId > 0;
  let ok = false;
  try {
    ok = await exec.enviarWhatsAppInteractive({
      telefone,
      modo,
      body: bodyInterp,
      header: headerInterp,
      footer: footerInterp,
      botoes: modo === "botoes" ? cfg.opcoes : undefined,
      drawerLabel: cfg.drawerLabel,
      secoes: modo === "lista" ? cfg.secoes : undefined,
      contatoId: typeof ctx.contatoId === "number" ? ctx.contatoId : undefined,
      proativo: !veioDeMensagem,
      exigirOptin: !veioDeMensagem,
    });
  } catch (err: any) {
    return { sucesso: false, contexto: ctx, mensagemErro: `WhatsApp interativo: ${err?.message || String(err)}` };
  }
  if (!ok) {
    return { sucesso: false, contexto: ctx, mensagemErro: "Falha ao enviar mensagem interativa (verifique canal Cloud API conectado)." };
  }

  const timeoutMinutos = Math.max(1, Math.min(7 * 24 * 60, Number(cfg.timeoutMinutos) || 60));
  const enviadas = ctx.mensagensEnviadas || [];
  return {
    sucesso: true,
    parar: true,
    // Em fluxo de mensagem o interativo JÁ foi entregue acima pelo executor;
    // devolver `resposta` fazia o whatsapp-handler reenviar o corpo como
    // texto puro — o contato recebia a mesma mensagem 2×.
    ...(veioDeMensagem ? {} : { resposta: bodyInterp }),
    contexto: {
      ...ctx,
      mensagensEnviadas: [...enviadas, bodyInterp],
      aguardandoMensagem: true,
      aguardandoContatoId: contatoId,
      aguardandoTimeoutMinutos: timeoutMinutos,
      aguardandoNodeClienteId: passo.clienteId ?? null,
    },
  };
}

function listarOpcoesParaMatch(cfg: {
  modo?: "botoes" | "lista";
  opcoes?: Array<{ id: string; titulo: string }>;
  secoes?: Array<{ itens: Array<{ id: string; titulo: string; descricao?: string }> }>;
}): Array<{ id: string; titulo: string }> {
  if (cfg.modo === "lista") {
    const out: Array<{ id: string; titulo: string }> = [];
    for (const s of cfg.secoes || []) for (const i of s.itens || []) out.push({ id: i.id, titulo: i.titulo });
    return out;
  }
  return cfg.opcoes || [];
}

function encontrarMatchPorTitulo(
  texto: string,
  opcoes: Array<{ id: string; titulo: string }>,
): { id: string; titulo: string } | null {
  const t = texto.trim().toLowerCase();
  if (!t) return null;
  // Match exato primeiro (case-insensitive, ignora emoji/pontuação no início)
  const normalizar = (s: string) => s.toLowerCase().replace(/^[^\p{L}\p{N}]+/u, "").trim();
  for (const o of opcoes) if (normalizar(o.titulo) === t) return o;
  // Substring — só se o título normalizado tem 3+ chars pra evitar match espúrio
  for (const o of opcoes) {
    const n = normalizar(o.titulo);
    if (n.length >= 3 && (t.includes(n) || n.includes(t))) return o;
  }
  return null;
}

/**
 * Helper: parseia a resposta do cliente contra a lista de opções configurada.
 * Tenta primeiro como número (1, 2, 3...), depois como substring case-insensitive
 * contra cada opção. Retorna a opção escolhida ou `null` se nenhuma bate
 * (ramo "opcao_invalida" no `proximoSe` cobre esse caso).
 */
export function parsearOpcaoResposta(
  resposta: string,
  opcoes: string[],
): { indice: number; texto: string; numero: string } | null {
  const trimmed = resposta.trim();
  if (!trimmed || opcoes.length === 0) return null;

  // 1. Tentativa numérica — extrai primeiro número da resposta
  const matchNum = trimmed.match(/\d+/);
  if (matchNum) {
    const n = Number(matchNum[0]);
    if (n >= 1 && n <= opcoes.length) {
      return { indice: n - 1, texto: opcoes[n - 1], numero: String(n) };
    }
  }

  // 2. Match exato (case-insensitive)
  const lower = trimmed.toLowerCase();
  for (let i = 0; i < opcoes.length; i++) {
    if (opcoes[i].toLowerCase() === lower) {
      return { indice: i, texto: opcoes[i], numero: String(i + 1) };
    }
  }

  // 3. Substring (resposta contém ou está contida na opção)
  for (let i = 0; i < opcoes.length; i++) {
    const opc = opcoes[i].toLowerCase();
    if (opc.length >= 3 && (lower.includes(opc) || opc.includes(lower))) {
      return { indice: i, texto: opcoes[i], numero: String(i + 1) };
    }
  }

  return null;
}

async function handleTransferir(
  passo: Passo,
  ctx: SmartflowContexto,
): Promise<PassoResultado> {
  // `transferir: true` no contexto sinaliza ao dispatcher pra marcar a
  // conversa como em_atendimento (humano assume) — o que PARA o bot de
  // responder novas mensagens dessa conversa.
  const cfg = passo.config as { mensagem?: string };
  // Mensagem configurável: se o usuário definiu (mesmo vazia), respeita.
  // Vazia = só para o bot, sem enviar nada. Não definida = texto padrão.
  let resposta: string | undefined;
  if (typeof cfg.mensagem === "string") {
    const texto = cfg.mensagem.trim();
    if (texto) {
      const { interpolarVariaveis } = await import("./interpolar");
      resposta = interpolarVariaveis(texto, ctx as any);
    } else {
      resposta = undefined; // explicitamente vazio → silêncio
    }
  } else {
    resposta = "Vou transferir você para um de nossos advogados. Um momento, por favor.";
  }
  return {
    sucesso: true,
    contexto: { ...ctx, transferir: true },
    resposta,
    parar: true,
  };
}

/**
 * Handler do passo `distribuir_atendimento`. Escolhe um atendente do setor e o
 * seta como dono da conversa (via executor), SEM parar o bot — o fluxo segue.
 * Saídas: `atribuido` (achou) e `sem_atendente` (ninguém elegível). Publica
 * `atendenteEscolhidoId`/`atendenteEscolhidoNome` e propaga como
 * `atendenteResponsavelId` (cascata da agenda).
 */
async function handleDistribuirAtendimento(
  passo: Passo,
  ctx: SmartflowContexto,
  exec: SmartflowExecutores,
): Promise<PassoResultado> {
  const cfg = passo.config as { modo?: string; setorId?: number; atendenteId?: number; modoDistribuicao?: "todos" | "online_primeiro" | "somente_online"; somenteOnline?: boolean };
  const modo = cfg.modo === "atendente_fixo" ? "atendente_fixo" : "setor";
  // Modo de rodízio: novo campo vence; fluxos antigos derivam do `somenteOnline`.
  const modoDistribuicao = cfg.modoDistribuicao ?? (cfg.somenteOnline === true ? "somente_online" : "online_primeiro");
  const conversaId = typeof ctx.conversaId === "number" ? ctx.conversaId : undefined;

  // Validação por modo: setor exige setorId; atendente_fixo exige atendenteId.
  let setorId = 0;
  let atendenteIdFixo: number | undefined = undefined;
  if (modo === "atendente_fixo") {
    atendenteIdFixo = Number(cfg.atendenteId);
    if (!Number.isInteger(atendenteIdFixo) || atendenteIdFixo <= 0) {
      console.warn("[distribuir_atendimento] passo inválido (atendente_fixo sem atendenteId)", {
        passoId: passo.id,
        clienteId: passo.clienteId,
        ordem: passo.ordem,
        cfg,
      });
      return { sucesso: false, contexto: ctx, mensagemErro: "Distribuir atendimento (atendente fixo): escolha o atendente." };
    }
  } else {
    setorId = Number(cfg.setorId);
    if (!Number.isInteger(setorId) || setorId <= 0) {
      console.warn("[distribuir_atendimento] passo inválido (setor sem setorId)", {
        passoId: passo.id,
        clienteId: passo.clienteId,
        ordem: passo.ordem,
        cfg,
      });
      return { sucesso: false, contexto: ctx, mensagemErro: "Distribuir atendimento (setor): escolha um setor." };
    }
  }

  try {
    const escolhido = await exec.distribuirAtendimentoPorSetor({
      setorId,
      modoDistribuicao,
      conversaId,
      atendenteIdFixo,
    });
    if (!escolhido) {
      return { sucesso: true, contexto: ctx, proximoRamoId: "sem_atendente" };
    }
    return {
      sucesso: true,
      contexto: {
        ...ctx,
        atendenteEscolhidoId: escolhido.id,
        atendenteEscolhidoNome: escolhido.nome,
        // Alias curto pra usar em prompts: {{atendente}} → nome do atendente
        // que recebeu a conversa. Facilita personalização ("Olá, sou {{atendente}}").
        atendente: escolhido.nome,
        atendenteResponsavelId: escolhido.id,
      },
      proximoRamoId: "atribuido",
    };
  } catch (err: any) {
    return { sucesso: false, contexto: ctx, mensagemErro: `Distribuir atendimento: ${err?.message || String(err)}` };
  }
}

/**
 * Normaliza um telefone BR pra comparação tolerante: só dígitos, sem o código
 * do país (55) e sem o "9" extra de celular. Assim o MESMO número casa venha
 * como o app EXIBE ("558596042189"), como o CRM SALVA ("85996042189"), com o
 * 9º dígito ("5585996042189") ou formatado ("(85) 99604-2189"). Retorna null
 * se não parece telefone — aí o comparador mantém o match exato de string.
 */
function normalizarTelefoneBR(valor: string): string | null {
  let d = valor.replace(/\D/g, "");
  if (d.length < 10 || d.length > 13) return null;
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2); // tira DDI 55
  if (d.length !== 10 && d.length !== 11) return null; // esperado DDD(2) + 8|9
  if (d.length === 11 && d[2] === "9") d = d.slice(0, 2) + d.slice(3); // tira 9 extra de celular
  return d;
}

/** Campos que guardam telefone — recebem comparação tolerante em `igual`/`diferente`. */
function campoEhTelefone(campo: string): boolean {
  return /telefone|whatsapp|celular|phone/i.test(campo);
}

/**
 * Igualdade de uma condição If/else. Tenta match exato de string primeiro; se
 * o campo é de telefone, cai pra comparação normalizada (ignora DDI, 9º dígito
 * e pontuação). Sem isso, o número certo escrito em outro formato — ex.: o que
 * o app mostra vs. o que o CRM salva — reprova a condição e o fluxo desvia pro
 * ramo errado (o "só envia pra mim" nunca casava).
 */
function condicaoIgual(campo: string, valorAtual: unknown, valor: string): boolean {
  const s = String(valorAtual ?? "");
  if (s === valor) return true;
  if (campoEhTelefone(campo)) {
    const a = normalizarTelefoneBR(s);
    const b = normalizarTelefoneBR(valor);
    if (a != null && b != null) return a === b;
  }
  return false;
}

/**
 * Avalia uma única condição sobre um contexto. Retorna `true` se bate.
 * Operadores `maior`, `menor`, `entre` são numéricos; `contem` é string-case
 * insensitive; os demais preservam semântica legada.
 *
 * `campo` aceita dot-notation (ex: `cliente.nome`, `cliente.campos.oab`),
 * resolvido pelo mesmo helper que o autocomplete `{{...}}` usa. Paths
 * legados top-level (`intencao`, `pagamentoValor`, …) seguem funcionando
 * porque `resolverCaminho` lida com chaves simples sem ponto.
 */
function avaliarCondicao(
  campo: string,
  operador: string,
  valor: string,
  valor2: string | undefined,
  ctx: SmartflowContexto,
): boolean {
  // Mantém comportamento original pra `existe`, `nao_existe` e `verdadeiro`,
  // que precisam diferenciar undefined/null/0/false do resto. Pra esses
  // três operadores resolvemos manualmente o path no contexto sem
  // forçar string vazia (que `resolverCaminho` faz).
  const partes = campo.split(".");
  let valorAtualRaw: any = ctx;
  for (const p of partes) {
    if (valorAtualRaw == null || typeof valorAtualRaw !== "object") {
      valorAtualRaw = undefined;
      break;
    }
    valorAtualRaw = valorAtualRaw[p];
  }
  const valorAtual: unknown = valorAtualRaw;

  switch (operador) {
    case "igual":
      return condicaoIgual(campo, valorAtual, valor);
    case "diferente":
      return !condicaoIgual(campo, valorAtual, valor);
    case "existe":
      return !!valorAtual && valorAtual !== "" && valorAtual !== "0" && valorAtual !== "false";
    case "nao_existe":
      return !valorAtual || valorAtual === "" || valorAtual === "0" || valorAtual === "false";
    case "verdadeiro":
      return valorAtual === true || valorAtual === "true";
    case "maior": {
      const a = Number(valorAtual);
      const b = Number(valor);
      return !Number.isNaN(a) && !Number.isNaN(b) && a > b;
    }
    case "menor": {
      const a = Number(valorAtual);
      const b = Number(valor);
      return !Number.isNaN(a) && !Number.isNaN(b) && a < b;
    }
    case "contem": {
      const a = String(valorAtual ?? "").toLowerCase();
      const b = String(valor ?? "").toLowerCase();
      return b.length > 0 && a.includes(b);
    }
    case "entre": {
      const a = Number(valorAtual);
      const lo = Number(valor);
      const hi = Number(valor2);
      if (Number.isNaN(a) || Number.isNaN(lo) || Number.isNaN(hi)) return false;
      const [min, max] = lo <= hi ? [lo, hi] : [hi, lo];
      return a >= min && a <= max;
    }
    case "tem_tag":
    case "nao_tem_tag": {
      // `valorAtual` deve resolver pra lista de tags do contato (cliente.tags).
      const arr = Array.isArray(valorAtual) ? valorAtual : [];
      const alvo = String(valor ?? "").trim().toLowerCase();
      const tem = alvo.length > 0 && arr.some((t) => String(t).trim().toLowerCase() === alvo);
      return operador === "tem_tag" ? tem : !tem;
    }
    case "horario_entre":
      // Ignora `campo` — usa o horário ATUAL (Brasília). valor=início, valor2=fim.
      return avaliarHorarioEntre(new Date(), valor, valor2 ?? "", "America/Sao_Paulo");
    case "dia_semana":
      // Ignora `campo` — usa o dia ATUAL (Brasília). valor="seg,ter,qua,qui,sex".
      return avaliarDiaSemana(new Date(), valor, "America/Sao_Paulo");
    default:
      // Operador desconhecido — fallback `igual` para não quebrar cenários
      // legados que salvaram strings estranhas no campo.
      return condicaoIgual(campo, valorAtual, valor);
  }
}

/**
 * Handler do passo `condicional`.
 *
 * Modos de operação:
 *   1. Shape novo (`config.condicoes[]`): avalia cada condição em ordem;
 *      primeira que bate → retorna `proximoRamoId = "cond_<id>"`. Se
 *      nenhuma bate → `"fallback"`.
 *   2. Shape legado (`config.campo/operador/valor`): converte em 1 condição
 *      única e replica o comportamento antigo — passa quando verdadeiro;
 *      `parar: true` quando falso (pra cenários antigos sem `proximoSe`
 *      continuarem idênticos).
 *
 * O walker em `executarCenario` usa `proximoRamoId` junto com `proximoSe`
 * do passo pra decidir pra onde pular. Se o passo não tem `proximoSe`
 * configurado (cenário linear), a saída do condicional é ignorada e o
 * walker usa o fluxo padrão por `ordem`.
 */
function handleCondicional(
  passo: Passo,
  ctx: SmartflowContexto,
): PassoResultado {
  type Requisito = { campo?: string; operador?: string; valor?: string; valor2?: string };
  const cfg = passo.config as {
    condicoes?: Array<{
      id: string;
      // Compostas: lista de requisitos + lógica de combinação.
      requisitos?: Requisito[];
      logica?: "E" | "OU";
      // Legado: 1 requisito inline.
      campo?: string;
      operador?: string;
      valor?: string;
      valor2?: string;
    }>;
    campo?: string;
    operador?: string;
    valor?: string;
  };

  const condicoes = Array.isArray(cfg.condicoes) ? cfg.condicoes : [];

  // Caminho novo: condicoes[] populadas
  if (condicoes.length > 0) {
    for (const c of condicoes) {
      // Normaliza pra lista de requisitos: compostos (requisitos[]) ou o
      // requisito único legado (campo/operador/valor da própria condição).
      const reqs: Requisito[] =
        Array.isArray(c.requisitos) && c.requisitos.length > 0
          ? c.requisitos
          : [{ campo: c.campo, operador: c.operador, valor: c.valor, valor2: c.valor2 }];

      const resultados = reqs.map((r) =>
        avaliarCondicao(r.campo || "intencao", r.operador || "igual", r.valor || "", r.valor2, ctx),
      );
      // "OU" = qualquer requisito basta; "E" (default) = todos precisam bater.
      const bate = c.logica === "OU" ? resultados.some(Boolean) : resultados.every(Boolean);

      if (bate) {
        return { sucesso: true, contexto: ctx, proximoRamoId: `cond_${c.id}` };
      }
    }
    // Nenhuma condição bateu — sinaliza fallback.
    return { sucesso: true, contexto: ctx, proximoRamoId: "fallback" };
  }

  // Caminho legado: 1 condição inline — mantém semântica if/stop original
  // pra cenários antigos sem `proximoSe`.
  const bate = avaliarCondicao(
    cfg.campo || "intencao",
    cfg.operador || "igual",
    cfg.valor || "",
    undefined,
    ctx,
  );
  if (bate) return { sucesso: true, contexto: ctx };
  return { sucesso: true, contexto: ctx, parar: true };
}

/**
 * Handler do passo `randomizar` — split aleatório do fluxo. Sorteia uma das
 * opções (com pesos opcionais) e retorna `proximoRamoId: cond_<id>` que o
 * walker usa pra rotear via `proximoSe[cond_<id>]`. Cada execução do mesmo
 * lead pode cair numa saída diferente (não é determinístico).
 *
 * Pesos: default 1 cada (uniforme). Pesos relativos = [1,1,2] → 25/25/50.
 * Peso ≤ 0 é ignorado (opção não pode ser sorteada). Se nenhuma opção tem
 * peso válido, o passo falha cedo com erro claro.
 *
 * A escolha é registrada no contexto como `ramoSorteado = { id, label }`
 * pra debugging/telemetria (ex: relatório de A/B testing por execucao).
 */
function handleRandomizar(
  passo: Passo,
  ctx: SmartflowContexto,
): PassoResultado {
  const cfg = passo.config as { opcoes?: Array<{ id: string; label?: string; peso?: number }> };
  const opcoes = Array.isArray(cfg.opcoes) ? cfg.opcoes : [];
  if (opcoes.length < 2) {
    return { sucesso: false, contexto: ctx, mensagemErro: "Randomizador precisa de pelo menos 2 opções." };
  }
  const validos = opcoes
    .map((o) => ({ id: String(o.id || ""), label: o.label, peso: Math.max(0, Number(o.peso ?? 1)) }))
    .filter((o) => o.id && o.peso > 0);
  if (validos.length === 0) {
    return { sucesso: false, contexto: ctx, mensagemErro: "Randomizador: nenhuma opção com peso > 0 e id válido." };
  }
  const total = validos.reduce((s, o) => s + o.peso, 0);
  const sorteio = Math.random() * total;
  let acumulado = 0;
  let escolhido = validos[validos.length - 1];
  for (const o of validos) {
    acumulado += o.peso;
    if (sorteio <= acumulado) { escolhido = o; break; }
  }
  return {
    sucesso: true,
    contexto: {
      ...ctx,
      ramoSorteado: { id: escolhido.id, label: escolhido.label ?? null },
    },
    proximoRamoId: `cond_${escolhido.id}`,
  };
}

function handleEsperar(
  passo: Passo,
  ctx: SmartflowContexto,
): PassoResultado {
  return {
    sucesso: true,
    contexto: { ...ctx, esperando: true, delayMinutos: passo.config.delayMinutos || 5 },
    parar: true,
  };
}

/** Define uma variável no contexto pra usar em passos seguintes.
 *  Suporta interpolação de outras variáveis no valor — ex: chave="dobro",
 *  valor="{{pagamentoValor}}" guarda o valor do pagamento como string em
 *  ctx.dobro. Permite escrever variáveis aninhadas via dot-notation
 *  (chave="cliente.observado" cria/atualiza cliente.observado). */
async function handleDefinirVariavel(
  passo: Passo,
  ctx: SmartflowContexto,
): Promise<PassoResultado> {
  const cfg = passo.config as { chave?: string; valor?: string };
  const chave = (cfg.chave || "").trim();
  if (!chave) {
    return { sucesso: false, contexto: ctx, mensagemErro: "Chave da variável vazia" };
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(chave)) {
    return {
      sucesso: false,
      contexto: ctx,
      mensagemErro: `Chave inválida: "${chave}". Use letras, números, _ e . (pra aninhar).`,
    };
  }

  const { interpolarVariaveis } = await import("./interpolar");
  const valorInterpolado = interpolarVariaveis(String(cfg.valor ?? ""), ctx as any);

  // Aplica suporte a dot-notation (chave="a.b.c" cria estrutura aninhada)
  const novoCtx: SmartflowContexto = { ...ctx };
  const partes = chave.split(".");
  if (partes.length === 1) {
    novoCtx[partes[0]] = valorInterpolado;
  } else {
    let alvo: Record<string, unknown> = novoCtx as any;
    for (let i = 0; i < partes.length - 1; i++) {
      const p = partes[i];
      const atual = alvo[p];
      if (!atual || typeof atual !== "object") {
        alvo[p] = {};
      } else {
        // Clona pra não mutar referência compartilhada com ctx anterior
        alvo[p] = { ...(atual as Record<string, unknown>) };
      }
      alvo = alvo[p] as Record<string, unknown>;
    }
    alvo[partes[partes.length - 1]] = valorInterpolado;
  }

  return { sucesso: true, contexto: novoCtx };
}

async function handleWebhook(
  passo: Passo,
  ctx: SmartflowContexto,
  exec: SmartflowExecutores,
): Promise<PassoResultado> {
  if (!passo.config.url) {
    return { sucesso: false, contexto: ctx, mensagemErro: "URL do webhook não configurada" };
  }
  try {
    const resultado = await exec.chamarWebhook(passo.config.url, ctx);
    return { sucesso: true, contexto: { ...ctx, webhookResultado: resultado } };
  } catch (err: any) {
    return { sucesso: false, contexto: ctx, mensagemErro: `Webhook: ${err.message}` };
  }
}

async function handleKanbanCriarCard(
  passo: Passo,
  ctx: SmartflowContexto,
  exec: SmartflowExecutores,
): Promise<PassoResultado> {
  const cfg = passo.config as any;
  const { interpolarVariaveis } = await import("./interpolar");

  // Interpolar variáveis dos campos textuais. cfg.titulo/descricao/tags
  // podem conter `{{cliente.nome}}`, `{{pagamento.valor}}`, etc — substitui
  // pelos valores do contexto antes de criar o card.
  const tituloRaw = cfg.titulo
    || ctx.pagamentoDescricao
    || `${(ctx.nomeCliente as string) || "Cliente"} — Pagamento recebido`;
  const titulo = interpolarVariaveis(String(tituloRaw), ctx as any);

  // Descrição: a do editor sobrepõe o default baseado no pagamento.
  const descricaoPadrao =
    `Pagamento: R$ ${((ctx.pagamentoValor || 0) / 100).toFixed(2)}\n${ctx.pagamentoDescricao || ""}`.trim();
  const descricaoRaw = cfg.descricao ? String(cfg.descricao) : descricaoPadrao;
  const descricao = interpolarVariaveis(descricaoRaw, ctx as any);

  const tagsInterpoladas = cfg.tags
    ? interpolarVariaveis(String(cfg.tags), ctx as any)
    : undefined;

  const prazoDiasNum = Number(cfg.prazoDias);

  // Resolução do responsável (em ordem de prioridade):
  //  1. cfg.responsavelId — selecionado explicitamente no editor pra um
  //     colaborador específico
  //  2. cfg.responsavelAuto = true (default) → usa atendenteResponsavelId
  //     do cliente vinculado (cadastro CRM)
  //  3. fallback null (card sem responsável)
  let responsavelIdResolvido: number | undefined;
  if (cfg.responsavelId) {
    responsavelIdResolvido = Number(cfg.responsavelId);
  } else if (cfg.responsavelAuto !== false) {
    // Default: auto — pega do cadastro do cliente
    const auto = ctx.atendenteResponsavelId;
    if (typeof auto === "number") responsavelIdResolvido = auto;
  }

  try {
    const cardId = await exec.criarCardKanban({
      funilId: cfg.funilId,
      colunaId: cfg.colunaId,
      titulo,
      descricao,
      clienteId: ctx.contatoId as number | undefined,
      prioridade: cfg.prioridade || "media",
      asaasPaymentId: ctx.pagamentoId,
      // processoId vem do contexto do dispatcher (multi-ação) — quando
      // a cobrança está vinculada a uma ação, esse valor está populado e
      // o passo usa idempotência por (escritorio, processoId, clienteId)
      // em vez de asaasPaymentId. Cobre cenário "pacote 1 cobrança / N
      // ações" sem duplicar cards.
      // O config do passo pode forçar um processoId fixo via cfg.processoId
      // (ex: "sempre vincular a esse processo"), mas o caso comum é vir
      // do contexto via {{acaoId}}.
      processoId: (() => {
        const fromCfg = cfg.processoId ? Number(cfg.processoId) : NaN;
        if (Number.isFinite(fromCfg) && fromCfg > 0) return fromCfg;
        const fromCtx = (ctx as any).acaoId;
        return typeof fromCtx === "number" && fromCtx > 0 ? fromCtx : undefined;
      })(),
      cnj: cfg.cnj || (typeof (ctx as any).acaoNumeroCnj === "string" ? (ctx as any).acaoNumeroCnj : undefined) || undefined,
      responsavelId: responsavelIdResolvido,
      prazoDias: Number.isFinite(prazoDiasNum) && prazoDiasNum > 0 ? prazoDiasNum : undefined,
      tags: tagsInterpoladas || undefined,
    });
    return {
      sucesso: true,
      contexto: { ...ctx, kanbanCardId: cardId },
      resposta: undefined,
    };
  } catch (err: any) {
    return { sucesso: false, contexto: ctx, mensagemErro: `Kanban: ${err.message}` };
  }
}

/**
 * Resolve o ID de card alvo dos passos `kanban_mover_card`,
 * `kanban_atribuir_responsavel` e `kanban_tags`.
 * Ordem de prioridade:
 *   1. `cfg.cardId` interpolado (ex: `{{kanbanCardId}}` → ctx.kanbanCardId).
 *   2. `ctx.kanbanCardId` direto (preenchido por `kanban_criar_card`).
 * Retorna null quando o resultado não é um número válido.
 */
async function resolverCardIdKanban(
  cfgCardId: unknown,
  ctx: SmartflowContexto,
): Promise<number | null> {
  const { interpolarVariaveis } = await import("./interpolar");
  const raw = String(cfgCardId ?? "").trim();
  if (raw) {
    const interpolado = interpolarVariaveis(raw, ctx as any).trim();
    const n = Number(interpolado);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const fromCtx = ctx.kanbanCardId;
  if (typeof fromCtx === "number" && fromCtx > 0) return fromCtx;
  return null;
}

async function handleKanbanMoverCard(
  passo: Passo,
  ctx: SmartflowContexto,
  exec: SmartflowExecutores,
): Promise<PassoResultado> {
  const cfg = passo.config as { cardId?: string; colunaDestinoId?: number };
  const cardId = await resolverCardIdKanban(cfg.cardId, ctx);
  if (!cardId) {
    return { sucesso: false, contexto: ctx, mensagemErro: "Card alvo não identificado (cardId vazio e ctx.kanbanCardId ausente)" };
  }
  const colunaDestinoId = Number(cfg.colunaDestinoId);
  if (!Number.isFinite(colunaDestinoId) || colunaDestinoId <= 0) {
    return { sucesso: false, contexto: ctx, mensagemErro: "Coluna destino não configurada" };
  }
  try {
    await exec.moverCardKanban({ cardId, colunaDestinoId });
    return { sucesso: true, contexto: { ...ctx, kanbanCardId: cardId } };
  } catch (err: any) {
    return { sucesso: false, contexto: ctx, mensagemErro: `Kanban mover: ${err.message}` };
  }
}

async function handleKanbanAtribuirResponsavel(
  passo: Passo,
  ctx: SmartflowContexto,
  exec: SmartflowExecutores,
): Promise<PassoResultado> {
  const cfg = passo.config as {
    cardId?: string;
    responsavelId?: number;
    responsavelAuto?: boolean;
  };
  const cardId = await resolverCardIdKanban(cfg.cardId, ctx);
  if (!cardId) {
    return { sucesso: false, contexto: ctx, mensagemErro: "Card alvo não identificado" };
  }

  // Mesma lógica de resolução do `handleKanbanCriarCard`.
  let responsavelIdResolvido: number | null = null;
  if (cfg.responsavelId) {
    responsavelIdResolvido = Number(cfg.responsavelId);
  } else if (cfg.responsavelAuto !== false) {
    const auto = ctx.atendenteResponsavelId;
    if (typeof auto === "number") responsavelIdResolvido = auto;
  }
  if (!responsavelIdResolvido) {
    return { sucesso: false, contexto: ctx, mensagemErro: "Nenhum responsável resolvido (configure responsavelId ou marque responsavelAuto)" };
  }

  try {
    await exec.atribuirResponsavelKanban({ cardId, responsavelId: responsavelIdResolvido });
    return { sucesso: true, contexto: { ...ctx, kanbanCardId: cardId } };
  } catch (err: any) {
    return { sucesso: false, contexto: ctx, mensagemErro: `Kanban responsável: ${err.message}` };
  }
}

async function handleKanbanTags(
  passo: Passo,
  ctx: SmartflowContexto,
  exec: SmartflowExecutores,
): Promise<PassoResultado> {
  const cfg = passo.config as {
    cardId?: string;
    tags?: string;
    modo?: "adicionar" | "remover" | "definir";
  };
  const cardId = await resolverCardIdKanban(cfg.cardId, ctx);
  if (!cardId) {
    return { sucesso: false, contexto: ctx, mensagemErro: "Card alvo não identificado" };
  }
  const { interpolarVariaveis } = await import("./interpolar");
  const tagsInterpoladas = interpolarVariaveis(String(cfg.tags ?? ""), ctx as any);
  const tags = tagsInterpoladas
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const modo = cfg.modo ?? "adicionar";
  if (modo !== "definir" && tags.length === 0) {
    return { sucesso: false, contexto: ctx, mensagemErro: "Lista de tags vazia" };
  }
  try {
    await exec.atualizarTagsCardKanban({ cardId, tags, modo });
    return { sucesso: true, contexto: { ...ctx, kanbanCardId: cardId } };
  } catch (err: any) {
    return { sucesso: false, contexto: ctx, mensagemErro: `Kanban tags: ${err.message}` };
  }
}

/**
 * Handler do passo `contato_tags` — adiciona/remove/define as tags do CONTATO
 * (CRM). Atualiza também `ctx.cliente.tags` pra que uma Decisão "tem a tag X"
 * logo depois enxergue a mudança.
 */
async function handleContatoTags(
  passo: Passo,
  ctx: SmartflowContexto,
  exec: SmartflowExecutores,
): Promise<PassoResultado> {
  const cfg = passo.config as { tags?: string; modo?: "adicionar" | "remover" | "definir" };
  const contatoId = ctx.contatoId;
  if (typeof contatoId !== "number") {
    return { sucesso: false, contexto: ctx, mensagemErro: "Tags do contato: sem contatoId no contexto." };
  }
  const { interpolarVariaveis } = await import("./interpolar");
  const tags = interpolarVariaveis(String(cfg.tags ?? ""), ctx as any)
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const modo = cfg.modo ?? "adicionar";
  if (modo !== "definir" && tags.length === 0) {
    return { sucesso: false, contexto: ctx, mensagemErro: "Tags do contato: lista de tags vazia." };
  }
  try {
    const novas = await exec.atualizarTagsContato({ contatoId, tags, modo });
    const clienteAtual = (ctx.cliente && typeof ctx.cliente === "object" ? ctx.cliente : {}) as Record<string, unknown>;
    return { sucesso: true, contexto: { ...ctx, cliente: { ...clienteAtual, tags: novas } } };
  } catch (err: any) {
    return { sucesso: false, contexto: ctx, mensagemErro: `Tags do contato: ${err.message}` };
  }
}

// ─── Asaas + campo personalizado ────────────────────────────────────────────

async function handleAsaasGerarCobranca(
  passo: Passo,
  ctx: SmartflowContexto,
  exec: SmartflowExecutores,
): Promise<PassoResultado> {
  const cfg = passo.config as {
    valor?: string;
    descricao?: string;
    vencimentoDias?: number;
    tipoCobranca?: "BOLETO" | "PIX" | "CREDIT_CARD";
  };
  const contatoId = ctx.contatoId;
  if (typeof contatoId !== "number") {
    return { sucesso: false, contexto: ctx, mensagemErro: "Sem contatoId no contexto — não dá pra emitir cobrança" };
  }
  const { interpolarVariaveis } = await import("./interpolar");
  const valorRaw = interpolarVariaveis(String(cfg.valor ?? ""), ctx as any).trim();
  const valorNum = Number(valorRaw.replace(",", "."));
  if (!Number.isFinite(valorNum) || valorNum <= 0) {
    return { sucesso: false, contexto: ctx, mensagemErro: `Valor inválido: "${valorRaw}"` };
  }
  const descricao = cfg.descricao
    ? interpolarVariaveis(String(cfg.descricao), ctx as any)
    : undefined;
  try {
    const r = await exec.gerarCobrancaAsaas({
      contatoId,
      valor: valorNum,
      descricao,
      vencimentoDias: cfg.vencimentoDias,
      tipoCobranca: cfg.tipoCobranca,
    });
    return {
      sucesso: true,
      contexto: { ...ctx, pagamentoId: r.pagamentoId, pagamentoLink: r.link ?? "" },
    };
  } catch (err: any) {
    return { sucesso: false, contexto: ctx, mensagemErro: `Asaas gerar: ${err.message}` };
  }
}

async function handleAsaasCancelarCobranca(
  passo: Passo,
  ctx: SmartflowContexto,
  exec: SmartflowExecutores,
): Promise<PassoResultado> {
  const cfg = passo.config as { pagamentoId?: string };
  const { interpolarVariaveis } = await import("./interpolar");
  const raw = String(cfg.pagamentoId ?? "").trim();
  const interpolado = raw
    ? interpolarVariaveis(raw, ctx as any).trim()
    : String(ctx.pagamentoId ?? "");
  if (!interpolado) {
    return { sucesso: false, contexto: ctx, mensagemErro: "pagamentoId vazio (config + ctx.pagamentoId ausente)" };
  }
  try {
    await exec.cancelarCobrancaAsaas({ pagamentoId: interpolado });
    return { sucesso: true, contexto: ctx };
  } catch (err: any) {
    return { sucesso: false, contexto: ctx, mensagemErro: `Asaas cancelar: ${err.message}` };
  }
}

async function handleAsaasConsultarValorAberto(
  _passo: Passo,
  ctx: SmartflowContexto,
  exec: SmartflowExecutores,
): Promise<PassoResultado> {
  const contatoId = ctx.contatoId;
  if (typeof contatoId !== "number") {
    return { sucesso: false, contexto: ctx, mensagemErro: "Sem contatoId no contexto" };
  }
  try {
    const r = await exec.consultarValorAbertoAsaas({ contatoId });
    return {
      sucesso: true,
      contexto: {
        ...ctx,
        valorTotalAberto: r.pendente + r.vencido,
        valorTotalVencido: r.vencido,
        valorTotalPendente: r.pendente,
        cobrancasAbertasQtd: r.qtdAberto,
      },
    };
  } catch (err: any) {
    return { sucesso: false, contexto: ctx, mensagemErro: `Asaas consultar: ${err.message}` };
  }
}

async function handleAsaasMarcarRecebida(
  passo: Passo,
  ctx: SmartflowContexto,
  exec: SmartflowExecutores,
): Promise<PassoResultado> {
  const cfg = passo.config as {
    pagamentoId?: string;
    valorRecebido?: string;
    dataRecebimento?: string;
  };
  const { interpolarVariaveis } = await import("./interpolar");
  const raw = String(cfg.pagamentoId ?? "").trim();
  const pagamentoId = raw
    ? interpolarVariaveis(raw, ctx as any).trim()
    : String(ctx.pagamentoId ?? "");
  if (!pagamentoId) {
    return { sucesso: false, contexto: ctx, mensagemErro: "pagamentoId vazio" };
  }
  let valorRecebido: number | undefined;
  if (cfg.valorRecebido) {
    const v = Number(interpolarVariaveis(String(cfg.valorRecebido), ctx as any).replace(",", "."));
    if (!Number.isFinite(v) || v <= 0) {
      return { sucesso: false, contexto: ctx, mensagemErro: `Valor recebido inválido: "${cfg.valorRecebido}"` };
    }
    valorRecebido = v;
  }
  try {
    await exec.marcarCobrancaRecebidaAsaas({
      pagamentoId,
      valorRecebido,
      dataRecebimento: cfg.dataRecebimento,
    });
    return { sucesso: true, contexto: ctx };
  } catch (err: any) {
    return { sucesso: false, contexto: ctx, mensagemErro: `Asaas marcar recebida: ${err.message}` };
  }
}

async function handleDefinirCampoPersonalizado(
  passo: Passo,
  ctx: SmartflowContexto,
  exec: SmartflowExecutores,
): Promise<PassoResultado> {
  const cfg = passo.config as { chave?: string; valor?: string };
  const chave = String(cfg.chave ?? "").trim();
  if (!chave) {
    return { sucesso: false, contexto: ctx, mensagemErro: "Chave do campo personalizado vazia" };
  }
  const contatoId = ctx.contatoId;
  if (typeof contatoId !== "number") {
    return { sucesso: false, contexto: ctx, mensagemErro: "Sem contatoId no contexto" };
  }
  const { interpolarVariaveis } = await import("./interpolar");
  const valor = interpolarVariaveis(String(cfg.valor ?? ""), ctx as any);
  try {
    await exec.definirCampoPersonalizadoCliente({ contatoId, chave, valor });
    // Espelha no ctx.cliente.campos pra próximos passos lerem sem refetch.
    const clienteAtual = (ctx.cliente as Record<string, any>) || {};
    const camposAtuais = (clienteAtual.campos as Record<string, any>) || {};
    return {
      sucesso: true,
      contexto: {
        ...ctx,
        cliente: { ...clienteAtual, campos: { ...camposAtuais, [chave]: valor } },
      },
    };
  } catch (err: any) {
    return { sucesso: false, contexto: ctx, mensagemErro: `Campo personalizado: ${err.message}` };
  }
}

export interface SlotLivre {
  inicioISO: string;
  fimISO: string;
}

/**
 * Formata um instante (epoch ms) em ISO 8601 COM offset (ex:
 * `2026-05-26T09:00:00-03:00`). Mantém o relógio de parede local visível —
 * a IA consegue ler "09:00" direto, sem precisar converter de UTC.
 */
export function formatarISOComOffset(epochMs: number, offsetHoras: number): string {
  const local = new Date(epochMs + offsetHoras * 3600 * 1000); // desloca p/ os componentes UTC baterem com o relógio local
  const p = (n: number) => String(n).padStart(2, "0");
  const sinal = offsetHoras <= 0 ? "-" : "+";
  const abs = Math.abs(offsetHoras);
  return `${local.getUTCFullYear()}-${p(local.getUTCMonth() + 1)}-${p(local.getUTCDate())}T${p(local.getUTCHours())}:${p(local.getUTCMinutes())}:00${sinal}${p(abs)}:00`;
}

/**
 * Calcula os horários LIVRES do responsável pra oferecer numa reunião.
 *
 * Varre `dias` dias pra frente a partir de `agora`, em janelas diárias
 * [`horaInicio`, `horaFim`) fatiadas em blocos de `duracaoMin`, pulando:
 *   - fim de semana (sáb/dom) se `incluirFimDeSemana=false`;
 *   - slots no passado;
 *   - slots que colidem com algum compromisso de `ocupados`.
 *
 * Fuso fixo Brasília (-03:00) — o Brasil não tem horário de verão desde 2019.
 * Retorna ISO 8601 com offset. Limita a `maxSlots` (default 60) pra não estourar
 * o prompt da IA.
 */
export function gerarSlotsLivres(params: {
  agora: Date;
  dias: number;
  incluirFimDeSemana: boolean;
  duracaoMin: number;
  horaInicio: number;
  horaFim: number;
  ocupados: Array<{ inicio: string; fim: string }>;
  offsetHoras?: number;
  maxSlots?: number;
  // Bloqueios da agenda do escritório (feriados + indisponibilidades).
  // diasInteiros: Set de YYYY-MM-DD que devem ser pulados completamente.
  // intervalos: lista de janelas {data, horaIni HH:MM, horaFim HH:MM} a
  // remover do dia. Já vem com recorrência anual expandida pelo caller.
  diasInteirosBloqueados?: Set<string>;
  intervalosBloqueados?: Array<{ data: string; horaIni: string; horaFim: string }>;
}): SlotLivre[] {
  const offset = params.offsetHoras ?? -3;
  const maxSlots = params.maxSlots ?? 60;
  const dur = params.duracaoMin;
  const agoraMs = params.agora.getTime();
  const ocup = params.ocupados.map((o) => [new Date(o.inicio).getTime(), new Date(o.fim).getTime()] as const);
  const diasBloq = params.diasInteirosBloqueados ?? new Set<string>();
  const intervBloq = params.intervalosBloqueados ?? [];

  // "Hoje" no relógio local: desloca `agora` pelo offset e lê componentes UTC.
  const baseLocal = new Date(agoraMs + offset * 3600 * 1000);
  const out: SlotLivre[] = [];

  const hhmmParaMin = (s: string) => {
    const [h, m] = s.split(":").map(Number);
    return h * 60 + m;
  };

  for (let d = 0; d < params.dias && out.length < maxSlots; d++) {
    const diaLocal = new Date(baseLocal.getTime() + d * 86400000);
    const ano = diaLocal.getUTCFullYear();
    const mes = diaLocal.getUTCMonth();
    const dom = diaLocal.getUTCDate();
    const weekday = diaLocal.getUTCDay(); // 0=Dom, 6=Sáb
    if (!params.incluirFimDeSemana && (weekday === 0 || weekday === 6)) continue;
    const dataISO = `${ano}-${String(mes + 1).padStart(2, "0")}-${String(dom).padStart(2, "0")}`;
    if (diasBloq.has(dataISO)) continue;
    const intervDoDia = intervBloq
      .filter((b) => b.data === dataISO)
      .map((b) => [hhmmParaMin(b.horaIni), hhmmParaMin(b.horaFim)] as const);

    for (let min = params.horaInicio * 60; min + dur <= params.horaFim * 60 && out.length < maxSlots; min += dur) {
      const hh = Math.floor(min / 60);
      const mm = min % 60;
      const startMs = Date.UTC(ano, mes, dom, hh, mm) - offset * 3600 * 1000;
      const endMs = startMs + dur * 60 * 1000;
      if (startMs < agoraMs) continue; // passado
      const ocupado = ocup.some(([os, oe]) => os < endMs && oe > startMs);
      if (ocupado) continue;
      const minFim = min + dur;
      const dentroDeBloqueio = intervDoDia.some(([bi, bf]) => bi < minFim && bf > min);
      if (dentroDeBloqueio) continue;
      out.push({
        inicioISO: formatarISOComOffset(startMs, offset),
        fimISO: formatarISOComOffset(endMs, offset),
      });
    }
  }
  return out;
}

/**
 * Formata os horários livres pro Atendente IA, agrupados por dia. LISTA
 * COMPLETA (sem truncar por dia) — o agente precisa de toda a disponibilidade
 * pra confirmar/negar um horário específico que o cliente pedir. Truncar
 * escondia slots livres (ex: o 5º+ do dia) e o agente negava um horário que
 * existia. Quem limita o tamanho é o `maxSlots` do gerador.
 */
export function formatarHorariosLivres(livres: SlotLivre[]): string {
  if (livres.length === 0) return "Sem horários livres nos próximos dias.";
  const porDia = new Map<string, string[]>();
  for (const s of livres) {
    const dia = s.inicioISO.slice(0, 10); // YYYY-MM-DD
    const arr = porDia.get(dia);
    if (arr) arr.push(s.inicioISO);
    else porDia.set(dia, [s.inicioISO]);
  }
  const blocos = [...porDia.entries()]
    .map(([dia, isos]) => `${dia}:\n${isos.map((iso) => `  - ${iso}`).join("\n")}`)
    .join("\n");
  return `Horários livres (ISO, fuso Brasília -03:00) — LISTA COMPLETA por dia. Ofereça POUCOS ao cliente (uns 3 por dia, espalhados), mas use a lista INTEIRA pra confirmar ou negar um horário específico que ele pedir — se está na lista, está livre:\n${blocos}`;
}

/**
 * Handler do passo `agenda_criar`. Cria um compromisso na Agenda NATIVA do
 * escritório (não no Cal.com), atribuído a um responsável e vinculado ao
 * cliente. Pensado pro "agendar consulta sem custo" do SDR: o lead cai na
 * agenda do escritório como "reunião comercial pendente" pra equipe confirmar.
 *
 * Data: `config.dataInicio` é interpolado; se vier vazio ou inválido, usa
 * agora (o compromisso nasce "pendente" mesmo — a equipe ajusta o horário).
 */
async function handleAgendaCriar(
  passo: Passo,
  ctx: SmartflowContexto,
  exec: SmartflowExecutores,
): Promise<PassoResultado> {
  const cfg = passo.config as {
    acao?: "agendar" | "verificar_horario" | "consultar" | "editar" | "cancelar";
    responsavelId?: number;
    responsavelAuto?: boolean;
    responsavelVar?: string;
    tipo?: string;
    titulo?: string;
    descricao?: string;
    dataInicio?: string;
    duracaoMinutos?: number;
    prioridade?: string;
    local?: string;
    verificarDisponibilidade?: boolean;
    agendamentoIdVar?: string;
    diasParaFrente?: number;
    salvarEm?: string;
    incluirFimDeSemana?: boolean;
    duracaoSlotMinutos?: number;
    horaInicio?: number;
    horaFim?: number;
  };
  const acao = cfg.acao || "agendar";
  const { interpolarVariaveis } = await import("./interpolar");

  // Responsável: variável > fixo (id) > reaproveita o resolvido pelo Atendente
  // IA nesta conversa (consistência agenda mostrada == marcada) > automático
  // (atendente do cliente) > cascata completa do escritório (só quando a ação
  // exige um responsável, ex: agendar/consultar — `obrigatorio`).
  const resolverResponsavel = async (obrigatorio: boolean): Promise<number | undefined> => {
    if (cfg.responsavelVar && cfg.responsavelVar.trim()) {
      const v = Number(interpolarVariaveis(cfg.responsavelVar, ctx as any).trim());
      return Number.isNaN(v) ? undefined : v;
    }
    if (cfg.responsavelId && !cfg.responsavelAuto) {
      const v = Number(cfg.responsavelId);
      return Number.isNaN(v) ? undefined : v;
    }
    if (cfg.responsavelAuto || obrigatorio) {
      if (typeof ctx.agendaResponsavelResolvidoId === "number") return ctx.agendaResponsavelResolvidoId;
      if (cfg.responsavelAuto && typeof ctx.atendenteResponsavelId === "number") return ctx.atendenteResponsavelId;
      const resolvido = await exec.resolverResponsavelAgenda({
        responsavelIdPreferido: null,
        contatoId: typeof ctx.contatoId === "number" ? ctx.contatoId : undefined,
        conversaId: typeof ctx.conversaId === "number" ? ctx.conversaId : undefined,
        atendenteResponsavelId: typeof ctx.atendenteResponsavelId === "number" ? ctx.atendenteResponsavelId : null,
      });
      if (typeof resolvido === "number") return resolvido;
    }
    return undefined;
  };

  // Mensagem clara quando o responsável não resolve — distingue o caso
  // "automático sem atendente" (comum em lead novo) do "não configurado".
  const erroResponsavel = (): string => {
    if (cfg.responsavelAuto) {
      return "Responsável automático: este contato ainda não tem atendente atribuído. Escolha um advogado fixo neste passo (ex: você mesmo), ou atribua um atendente ao contato no CRM.";
    }
    if (cfg.responsavelVar && cfg.responsavelVar.trim()) {
      return `Responsável via variável não resolveu (${cfg.responsavelVar}). Confira se a variável tem um ID válido neste ponto do fluxo.`;
    }
    return "Configure o responsável (advogado) neste passo.";
  };

  // Data: distingue "horário específico" de "sem horário" (vazio → agora/pendente).
  const resolverData = () => {
    // Fontes da data, em ordem de prioridade: (1) `dataInicio` da config (o
    // usuário pode fixar/usar variável); (2) `agendamentoQuando` — o horário ISO
    // que o cliente escolheu no Atendente IA. Sem nenhuma data válida, cai em
    // "agora" (compat). A fonte (2) conserta o bug "agendou no horário errado":
    // antes o horário escolhido não chegava aqui e marcava sempre em new Date().
    const fontes = [
      cfg.dataInicio ? interpolarVariaveis(cfg.dataInicio, ctx as any).trim() : "",
      typeof ctx.agendamentoQuando === "string" ? ctx.agendamentoQuando.trim() : "",
    ];
    let escolhida: Date | null = null;
    for (const f of fontes) {
      if (!f) continue;
      const d = new Date(f);
      if (!Number.isNaN(d.getTime())) { escolhida = d; break; }
    }
    const especifico = !!escolhida;
    const dataInicio = escolhida ?? new Date();
    const duracao = Number(cfg.duracaoMinutos) > 0 ? Number(cfg.duracaoMinutos) : 60;
    const dataFim = new Date(dataInicio.getTime() + duracao * 60 * 1000);
    return { dataInicio, dataFim, especifico };
  };

  // ID do agendamento alvo (editar/cancelar): da config ou de {{agendamentoInternoId}}.
  const resolverAgendamentoId = (): number | undefined => {
    const raw = (cfg.agendamentoIdVar && cfg.agendamentoIdVar.trim())
      ? interpolarVariaveis(cfg.agendamentoIdVar, ctx as any).trim()
      : (typeof ctx.agendamentoInternoId === "number" ? String(ctx.agendamentoInternoId) : "");
    const v = Number(raw);
    return Number.isNaN(v) || v <= 0 ? undefined : v;
  };

  try {
    // ── Verificar horário disponível (não cria nada) ──
    if (acao === "verificar_horario") {
      const responsavelId = await resolverResponsavel(true);
      if (!responsavelId) return { sucesso: false, contexto: ctx, mensagemErro: `Verificar horário — ${erroResponsavel()}` };
      const { dataInicio, dataFim } = resolverData();
      const r = await exec.verificarDisponibilidadeAgenda({
        responsavelId,
        dataInicio: dataInicio.toISOString(),
        dataFim: dataFim.toISOString(),
      });
      return { sucesso: true, contexto: { ...ctx, agendaDisponivel: r.disponivel, agendaConflitos: r.conflitos } };
    }

    // ── Consultar agenda: calcula HORÁRIOS LIVRES p/ oferecer (não cria nada) ──
    if (acao === "consultar") {
      const responsavelId = await resolverResponsavel(true);
      if (!responsavelId) return { sucesso: false, contexto: ctx, mensagemErro: `Consultar agenda — ${erroResponsavel()}` };
      const dias = Math.max(1, Math.min(365, Number(cfg.diasParaFrente) || 7));
      const incluirFimDeSemana = !!cfg.incluirFimDeSemana;
      const duracaoMin = [15, 30, 60].includes(Number(cfg.duracaoSlotMinutos)) ? Number(cfg.duracaoSlotMinutos) : 30;
      const horaInicio = Math.max(0, Math.min(23, Number.isFinite(Number(cfg.horaInicio)) ? Number(cfg.horaInicio) : 9));
      const horaFim = Math.max(horaInicio + 1, Math.min(24, Number.isFinite(Number(cfg.horaFim)) ? Number(cfg.horaFim) : 18));

      const agora = new Date();
      const fim = new Date(agora.getTime() + dias * 24 * 60 * 60 * 1000);
      const ocupados = await exec.listarAgendaResponsavel({
        responsavelId,
        dataInicio: agora.toISOString(),
        dataFim: fim.toISOString(),
      });

      const livres = gerarSlotsLivres({
        agora,
        dias,
        incluirFimDeSemana,
        duracaoMin,
        horaInicio,
        horaFim,
        ocupados,
      });

      const fds = incluirFimDeSemana ? "incluindo fim de semana" : "sem fim de semana";
      const cabecalho = `Horários LIVRES do responsável — próximos ${dias} dia(s), reuniões de ${duracaoMin} min, ${horaInicio}h–${horaFim}h, ${fds}. Datas em ISO 8601 (fuso -03:00, Brasília).`;
      const corpo = livres.length === 0
        ? "Nenhum horário livre encontrado com esses critérios."
        : livres.map((s) => `- ${s.inicioISO} (até ${s.fimISO})`).join("\n");
      const texto = `${cabecalho}\n${corpo}`;

      const novoCtx: SmartflowContexto = {
        ...ctx,
        agendaSlotsLivres: livres, // estruturado (ISO), caso queira usar em outro lugar
        agendaConsultaInicio: agora.toISOString(),
        agendaConsultaFim: fim.toISOString(),
      };
      const salvarEm = (cfg.salvarEm || "").trim();
      if (salvarEm) novoCtx[salvarEm] = texto;
      return { sucesso: true, contexto: novoCtx };
    }

    // ── Cancelar ──
    if (acao === "cancelar") {
      const agId = resolverAgendamentoId();
      if (!agId) return { sucesso: false, contexto: ctx, mensagemErro: "Cancelar: sem ID do agendamento (use {{agendamentoInternoId}} ou informe um)." };
      await exec.editarAgendamentoInterno({ agendamentoId: agId, status: "cancelado" });
      return { sucesso: true, contexto: { ...ctx, agendamentoCancelado: agId } };
    }

    // ── Editar (remarcar / reatribuir / mudar dados) ──
    if (acao === "editar") {
      const agId = resolverAgendamentoId();
      if (!agId) return { sucesso: false, contexto: ctx, mensagemErro: "Editar: sem ID do agendamento (use {{agendamentoInternoId}} ou informe um)." };
      const patch: Parameters<typeof exec.editarAgendamentoInterno>[0] = { agendamentoId: agId };
      const respEdit = await resolverResponsavel(false);
      if (respEdit) patch.responsavelId = respEdit;
      const dataRaw = cfg.dataInicio ? interpolarVariaveis(cfg.dataInicio, ctx as any).trim() : "";
      if (dataRaw) {
        const { dataInicio, dataFim } = resolverData();
        patch.dataInicio = dataInicio.toISOString();
        patch.dataFim = dataFim.toISOString();
      }
      if (cfg.titulo && cfg.titulo.trim()) patch.titulo = interpolarVariaveis(cfg.titulo, ctx as any).trim();
      if (cfg.descricao) patch.descricao = interpolarVariaveis(cfg.descricao, ctx as any).trim();
      await exec.editarAgendamentoInterno(patch);
      return { sucesso: true, contexto: { ...ctx, agendamentoEditado: agId } };
    }

    // ── Agendar (default): cria o compromisso ──
    const responsavelId = await resolverResponsavel(true);
    if (!responsavelId) {
      return { sucesso: false, contexto: ctx, mensagemErro: `Agendar — ${erroResponsavel()}` };
    }
    const { dataInicio, dataFim, especifico } = resolverData();
    const tituloRaw = (cfg.titulo && cfg.titulo.trim())
      ? interpolarVariaveis(cfg.titulo, ctx as any).trim()
      : `Consulta inicial — ${ctx.nomeCliente || "cliente"}`;
    const descricao = cfg.descricao ? interpolarVariaveis(cfg.descricao, ctx as any).trim() : undefined;
    const contatoId = typeof ctx.contatoId === "number" ? ctx.contatoId : undefined;
    const contatoTelefone = typeof ctx.telefoneCliente === "string" ? ctx.telefoneCliente : undefined;

    // Em conflito (com checagem ligada e horário específico), NÃO cria — sinaliza
    // agendaDisponivel pra o fluxo oferecer outro horário.
    if (cfg.verificarDisponibilidade && especifico) {
      const r = await exec.verificarDisponibilidadeAgenda({
        responsavelId,
        dataInicio: dataInicio.toISOString(),
        dataFim: dataFim.toISOString(),
      });
      if (!r.disponivel) {
        return { sucesso: true, contexto: { ...ctx, agendaDisponivel: false, agendaConflitos: r.conflitos } };
      }
    }

    const id = await exec.criarAgendamentoInterno({
      responsavelId,
      tipo: cfg.tipo || "reuniao_comercial",
      titulo: tituloRaw,
      dataInicio: dataInicio.toISOString(),
      dataFim: dataFim.toISOString(),
      descricao,
      local: cfg.local ? interpolarVariaveis(cfg.local, ctx as any).trim() : undefined,
      prioridade: cfg.prioridade,
      contatoId,
      contatoTelefone,
    });
    return { sucesso: true, contexto: { ...ctx, agendamentoInternoId: id, agendaDisponivel: true } };
  } catch (err: any) {
    return { sucesso: false, contexto: ctx, mensagemErro: `Agenda: ${err.message}` };
  }
}

// ─── Engine principal ───────────────────────────────────────────────────────

const HANDLERS: Record<string, (p: Passo, c: SmartflowContexto, e: SmartflowExecutores) => Promise<PassoResultado> | PassoResultado> = {
  ia_classificar: handleIAClassificar,
  ia_responder: handleIAResponder,
  ia_consultar: handleIAConsultar,
  ia_atendente: handleIaAtendente,
  ia_extrair_campos: handleIAExtrairCampos,
  crm_buscar_contato: handleCrmBuscarContato,
  crm_listar_acoes_cliente: handleCrmListarAcoesCliente,
  processo_buscar_movimentacoes: handleProcessoBuscarMovimentacoes,
  calcom_horarios: handleCalcomHorarios,
  calcom_agendar: handleCalcomAgendar,
  calcom_listar: handleCalcomListar,
  calcom_cancelar: handleCalcomCancelar,
  calcom_remarcar: handleCalcomRemarcar,
  agenda_criar: handleAgendaCriar,
  whatsapp_enviar: handleWhatsAppEnviar,
  whatsapp_aguardar_resposta: handleWhatsappAguardarResposta,
  whatsapp_pergunta_opcoes: handleWhatsappPerguntaOpcoes,
  transferir: handleTransferir,
  distribuir_atendimento: handleDistribuirAtendimento,
  condicional: handleCondicional,
  randomizar: handleRandomizar,
  esperar: handleEsperar,
  webhook: handleWebhook,
  kanban_criar_card: handleKanbanCriarCard,
  kanban_mover_card: handleKanbanMoverCard,
  kanban_atribuir_responsavel: handleKanbanAtribuirResponsavel,
  kanban_tags: handleKanbanTags,
  asaas_gerar_cobranca: handleAsaasGerarCobranca,
  asaas_cancelar_cobranca: handleAsaasCancelarCobranca,
  asaas_consultar_valor_aberto: handleAsaasConsultarValorAberto,
  asaas_marcar_recebida: handleAsaasMarcarRecebida,
  definir_variavel: handleDefinirVariavel,
  definir_campo_personalizado: handleDefinirCampoPersonalizado,
  contato_tags: handleContatoTags,
};

export interface ExecutarCenarioResultado {
  sucesso: boolean;
  contexto: SmartflowContexto;
  passosExecutados: number;
  respostas: string[];
  erro?: string;
}

/** Guarda contra loops infinitos em grafos malformados. */
const MAX_PASSOS_EXECUCAO = 50;

/**
 * Espaçamento (ms) entre iterações de `para_cada_item` quando o corpo dispara
 * WhatsApp — anti-rajada num broadcast pra muitos contatos. Injetável pra teste
 * (setar 0 evita o sleep real e mantém os testes rápidos/determinísticos).
 */
let throttleParaCadaItemMs = 1200;
export function _setThrottleParaCadaItem(ms: number): void {
  throttleParaCadaItemMs = ms;
}

/**
 * Executa um cenário como um walker de grafo.
 *
 * Comportamento:
 *   - Começa no passo com menor `ordem`.
 *   - Após cada handler, se o passo atual tem `proximoSe`, procura o próximo
 *     passo pelo `clienteId` referenciado na chave apropriada. Chaves:
 *       · para `condicional`: o `proximoRamoId` retornado pelo handler
 *         (`cond_<id>` ou `"fallback"`).
 *       · para outros passos: `"default"`, se existir.
 *   - Se `proximoSe` não tem a chave esperada ou o passo não tem `proximoSe`,
 *     cai no comportamento linear — passo com próxima `ordem`.
 *
 * Compat:
 *   - Cenários legados (todos `proximoSe=null`, `clienteId=null`) executam
 *     exatamente como antes: percorrem por `ordem`.
 *   - `condicional` legado (sem `condicoes[]`) usa `parar: true` quando falha,
 *     que o walker respeita.
 *
 * Proteções:
 *   - `MAX_PASSOS_EXECUCAO`: aborta com erro claro se o fluxo passar dele.
 *   - Próximo passo não encontrado (clienteId inexistente) → encerra com
 *     sucesso; tratamos como fim natural do ramo.
 */
export async function executarCenario(
  passos: Passo[],
  contextoInicial: SmartflowContexto,
  executores: SmartflowExecutores,
): Promise<ExecutarCenarioResultado> {
  const passosOrdenados = [...passos].sort((a, b) => a.ordem - b.ordem);
  if (passosOrdenados.length === 0) {
    return { sucesso: true, contexto: { ...contextoInicial }, passosExecutados: 0, respostas: [] };
  }

  // Detecção de modo:
  //   - modo grafo: pelo menos um passo tem `proximoSe` preenchido. Saída
  //     explícita manda; passo sem `proximoSe` = fim do fluxo (sem fallback
  //     linear — evitaria cair em ramos errados após um branching).
  //   - modo linear: nenhum passo tem `proximoSe`. Walker percorre por
  //     `ordem` (comportamento legado idêntico).
  const modoGrafo = passosOrdenados.some(
    (p) => p.proximoSe && typeof p.proximoSe === "object" && Object.keys(p.proximoSe).length > 0,
  );

  // Índices pra lookup O(1) durante o walk.
  const porClienteId = new Map<string, Passo>();
  for (const p of passosOrdenados) {
    if (p.clienteId) porClienteId.set(p.clienteId, p);
  }
  const indicePorId = new Map<number, number>();
  passosOrdenados.forEach((p, i) => indicePorId.set(p.id, i));

  // Contador global de passos executados — compartilhado entre o walk
  // principal e os sub-walks de loop pra que MAX_PASSOS_EXECUCAO valha
  // pra execução inteira (não por iteração de loop).
  const estadoGlobal = { passosExecutados: 0 };

  // Retomada graph-aware: se o contexto traz `__resumindoWaitClienteId`, o
  // walk começa NESSE nó de aguardar (que será passado direto, já que a
  // resposta do cliente já chegou) e segue pelas setas — inclusive loops.
  const resumeWaitId = (contextoInicial as any).__resumindoWaitClienteId as string | undefined;
  const startNode = (resumeWaitId && porClienteId.get(resumeWaitId)) || passosOrdenados[0];

  return walkInterno({
    passos: passosOrdenados,
    porClienteId,
    indicePorId,
    modoGrafo,
    startNode,
    contexto: { ...contextoInicial },
    stopAt: new Set<number>(),
    estadoGlobal,
    executores,
    respostas: [],
  });
}

/**
 * Walker reusável: anda pelo grafo a partir de `startNode`, parando quando:
 *   - Acaba o caminho (sem próximo passo).
 *   - Encontra um nó cujo id está em `stopAt` (usado por loops pra fechar
 *     a iteração quando o corpo aponta de volta pro `para_cada_item`).
 *   - `MAX_PASSOS_EXECUCAO` excedido (proteção global).
 *   - Handler retornou erro ou `parar: true`.
 *
 * Pra `para_cada_item`: lê a lista do contexto, e pra cada item chama
 * recursivamente o walker do nó apontado por `proximoSe.corpo`, com `stopAt`
 * estendido com o id do loop atual — fechando naturalmente a iteração ao
 * voltar ao loop. Depois de iterar, segue pelo `proximoSe.depois`.
 */
async function walkInterno(opts: {
  passos: Passo[];
  porClienteId: Map<string, Passo>;
  indicePorId: Map<number, number>;
  modoGrafo: boolean;
  startNode: Passo | null;
  contexto: SmartflowContexto;
  stopAt: Set<number>;
  estadoGlobal: { passosExecutados: number };
  executores: SmartflowExecutores;
  respostas: string[];
}): Promise<ExecutarCenarioResultado> {
  const { passos, porClienteId, indicePorId, modoGrafo, stopAt, estadoGlobal, executores } = opts;
  let contexto = opts.contexto;
  const respostas = opts.respostas;
  let atual: Passo | null = opts.startNode;

  while (atual !== null) {
    if (stopAt.has(atual.id)) {
      // Voltou pra origem do loop (ou outro nó marcado como "pare"). Encerra
      // este sub-walk sem erro — o caller (loop) parte pra próxima iteração.
      return { sucesso: true, contexto, passosExecutados: estadoGlobal.passosExecutados, respostas };
    }
    if (estadoGlobal.passosExecutados >= MAX_PASSOS_EXECUCAO) {
      return {
        sucesso: false,
        contexto,
        passosExecutados: estadoGlobal.passosExecutados,
        respostas,
        erro: `Limite de ${MAX_PASSOS_EXECUCAO} passos excedido — possível loop no cenário.`,
      };
    }

    const passoAtual: Passo = atual;

    // Retomada graph-aware: ao re-entrar no nó "aguardar resposta" onde
    // pausamos, NÃO pausa de novo (a resposta do cliente já está no contexto).
    // Passa direto pro próximo nó pelas setas (default) — é o que permite o
    // loop "volta pra IA até bater a condição".
    const resumeWaitId = (contexto as any).__resumindoWaitClienteId as string | undefined;
    if (
      resumeWaitId &&
      passoAtual.clienteId === resumeWaitId &&
      passoAtual.tipo === "whatsapp_aguardar_resposta"
    ) {
      // Motivo da retomada decide o ramo: "timeout" → ramo "timeout" (cliente
      // não respondeu no prazo); senão → "default" (respondeu). Sem ramo
      // "timeout" configurado, resolverProximo devolve null → fluxo encerra.
      const motivo = (contexto as any).__resumindoWaitMotivo as string | undefined;
      const chave = motivo === "timeout" ? "timeout" : "default";
      contexto = { ...contexto };
      delete (contexto as any).__resumindoWaitClienteId;
      delete (contexto as any).__resumindoWaitMotivo;
      delete (contexto as any).aguardandoNodeClienteId;
      atual = resolverProximo(passoAtual, chave, porClienteId, indicePorId, modoGrafo, passos);
      continue;
    }

    // Caso especial: para_cada_item — não passa pelo HANDLERS, é resolvido
    // aqui no walker (precisa de acesso ao grafo de passos).
    if (passoAtual.tipo === "para_cada_item") {
      const r = await executarParaCadaItem({
        passo: passoAtual,
        contexto,
        passos,
        porClienteId,
        indicePorId,
        modoGrafo,
        stopAt,
        estadoGlobal,
        executores,
        respostas,
      });
      if (!r.sucesso) return r;
      contexto = r.contexto;
      // Continua pelo próximo do loop (proximoSe.depois ou ordem linear)
      atual = resolverProximo(passoAtual, "depois", porClienteId, indicePorId, modoGrafo, passos);
      continue;
    }

    const handler = HANDLERS[passoAtual.tipo];
    if (!handler) {
      return {
        sucesso: false,
        contexto,
        passosExecutados: estadoGlobal.passosExecutados,
        respostas,
        erro: `Tipo de passo desconhecido: ${passoAtual.tipo}`,
      };
    }

    const resultado: PassoResultado = await handler(passoAtual, contexto, executores);
    estadoGlobal.passosExecutados++;
    contexto = resultado.contexto;

    if (resultado.resposta) respostas.push(resultado.resposta);

    if (!resultado.sucesso) {
      return {
        sucesso: false,
        contexto,
        passosExecutados: estadoGlobal.passosExecutados,
        respostas,
        erro: resultado.mensagemErro || "Erro no passo " + passoAtual.tipo,
      };
    }

    if (resultado.parar) break;

    atual = resolverProximo(
      passoAtual,
      resultado.proximoRamoId,
      porClienteId,
      indicePorId,
      modoGrafo,
      passos,
    );
  }

  return { sucesso: true, contexto, passosExecutados: estadoGlobal.passosExecutados, respostas };
}

/**
 * Resolve qual é o próximo passo dado o atual + a chave do ramo retornada
 * pelo handler. Encapsula a lógica antes inline no walker pra ser reusada
 * pelo `para_cada_item`.
 *
 * Regras:
 *   - Se passo tem `proximoSe`: usa `proximoSe[chave]` (default `"default"`
 *     quando handler não retorna `proximoRamoId`). Sem entrada → encerra fluxo.
 *   - Senão, em modo linear: próxima `ordem` (legado).
 *   - Em modo grafo sem `proximoSe`: fim do ramo.
 */
function resolverProximo(
  passoAtual: Passo,
  proximoRamoId: string | undefined,
  porClienteId: Map<string, Passo>,
  indicePorId: Map<number, number>,
  modoGrafo: boolean,
  passos: Passo[],
): Passo | null {
  const mapa = passoAtual.proximoSe;
  if (mapa && typeof mapa === "object") {
    const chave = proximoRamoId || "default";
    const alvoClienteId = mapa[chave];
    if (alvoClienteId) {
      return porClienteId.get(alvoClienteId) ?? null;
    }
    return null;
  }
  if (!modoGrafo) {
    const idx = indicePorId.get(passoAtual.id);
    if (idx != null && idx + 1 < passos.length) {
      return passos[idx + 1];
    }
  }
  return null;
}

/**
 * Executa o passo `para_cada_item`. Lê a lista do contexto, itera até o
 * limite, e pra cada iteração chama `walkInterno` começando pelo nó do
 * "corpo" do loop — com `stopAt` estendido com o id do `para_cada_item`
 * atual pra fechar a iteração quando o corpo voltar pro próprio loop.
 *
 * Cada iteração trabalha numa cópia do contexto e mescla resultado de
 * volta no acumulado (excluindo `item`/`indice` — esses só vivem dentro
 * da iteração). Loops aninhados funcionam naturalmente porque cada um
 * adiciona seu id ao `stopAt` recebido.
 */
async function executarParaCadaItem(opts: {
  passo: Passo;
  contexto: SmartflowContexto;
  passos: Passo[];
  porClienteId: Map<string, Passo>;
  indicePorId: Map<number, number>;
  modoGrafo: boolean;
  stopAt: Set<number>;
  estadoGlobal: { passosExecutados: number };
  executores: SmartflowExecutores;
  respostas: string[];
}): Promise<ExecutarCenarioResultado> {
  const { passo, passos, porClienteId, indicePorId, modoGrafo, stopAt, estadoGlobal, executores, respostas } = opts;
  let contexto = opts.contexto;
  const cfg = passo.config as { caminhoLista?: string; nomeVarItem?: string; limite?: number };
  const caminho = (cfg.caminhoLista || "acoes").trim();
  const nomeVar = (cfg.nomeVarItem || "item").trim();
  const limite = Math.max(1, Math.min(200, Number(cfg.limite) || 20));

  // Resolve lista via dot-notation (suporta `acoes`, `cliente.processos`, etc.)
  const partes = caminho.split(".");
  let listaRaw: any = contexto;
  for (const p of partes) {
    if (listaRaw == null || typeof listaRaw !== "object") { listaRaw = undefined; break; }
    listaRaw = listaRaw[p];
  }
  if (listaRaw == null) {
    // Lista ausente — tratado como zero iterações, NÃO erro. Permite usar
    // o passo sem garantir que a lista exista.
    estadoGlobal.passosExecutados++;
    return { sucesso: true, contexto, passosExecutados: estadoGlobal.passosExecutados, respostas };
  }
  if (!Array.isArray(listaRaw)) {
    return {
      sucesso: false,
      contexto,
      passosExecutados: estadoGlobal.passosExecutados,
      respostas,
      erro: `\`${caminho}\` não é uma lista — não dá pra iterar.`,
    };
  }

  estadoGlobal.passosExecutados++; // conta o próprio loop como 1 passo
  const lista = listaRaw.slice(0, limite);
  if (lista.length === 0) {
    return { sucesso: true, contexto, passosExecutados: estadoGlobal.passosExecutados, respostas };
  }

  // Resolve nó-corpo a partir de `proximoSe.corpo` no editor.
  const mapaProx = passo.proximoSe || {};
  const corpoClienteId = mapaProx.corpo;
  if (!corpoClienteId) {
    return {
      sucesso: false,
      contexto,
      passosExecutados: estadoGlobal.passosExecutados,
      respostas,
      erro: "Loop sem corpo conectado — conecte a saída 'corpo' a um passo.",
    };
  }
  const corpoStart = porClienteId.get(corpoClienteId);
  if (!corpoStart) {
    return {
      sucesso: false,
      contexto,
      passosExecutados: estadoGlobal.passosExecutados,
      respostas,
      erro: "Corpo do loop aponta pra um passo que não existe.",
    };
  }

  const stopComLoop = new Set(stopAt);
  stopComLoop.add(passo.id);

  // Anti-rajada: se o corpo do loop dispara WhatsApp, espaça as iterações. Um
  // broadcast pra centenas de contatos back-to-back é o que a Meta flagra como
  // spam. Loops sem envio (criar card, tags) não pagam o delay. O teto de volume
  // real continua sendo o guard (rate + tier diário) dentro de cada envio.
  const TIPOS_ENVIO_WHATS = new Set(["whatsapp_enviar", "whatsapp_aguardar_resposta", "whatsapp_pergunta_opcoes"]);
  const espacaEnvio = passos.some((p) => TIPOS_ENVIO_WHATS.has(p.tipo));

  for (let i = 0; i < lista.length; i++) {
    if (espacaEnvio && i > 0 && throttleParaCadaItemMs > 0) {
      await new Promise((r) => setTimeout(r, throttleParaCadaItemMs));
    }
    if (estadoGlobal.passosExecutados >= MAX_PASSOS_EXECUCAO) {
      return {
        sucesso: false,
        contexto,
        passosExecutados: estadoGlobal.passosExecutados,
        respostas,
        erro: `Limite de ${MAX_PASSOS_EXECUCAO} passos excedido — possível loop infinito.`,
      };
    }
    const subContexto: SmartflowContexto = { ...contexto, [nomeVar]: lista[i], indice: i };
    const sub = await walkInterno({
      passos,
      porClienteId,
      indicePorId,
      modoGrafo,
      startNode: corpoStart,
      contexto: subContexto,
      stopAt: stopComLoop,
      estadoGlobal,
      executores,
      respostas,
    });
    if (!sub.sucesso) return sub;

    // Mescla contexto resultante de volta no global. Remove `item` (ou
    // nome configurado) e `indice` — eles só fazem sentido durante a iteração.
    const proxCtx = { ...sub.contexto } as Record<string, unknown>;
    delete proxCtx[nomeVar];
    delete proxCtx.indice;
    contexto = proxCtx as SmartflowContexto;
  }

  return { sucesso: true, contexto, passosExecutados: estadoGlobal.passosExecutados, respostas };
}

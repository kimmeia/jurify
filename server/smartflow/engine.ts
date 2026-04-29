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
  /** ID do agendamento criado */
  agendamentoId?: string;
  /** Se deve transferir pra humano */
  transferir?: boolean;
  /** Mensagens enviadas */
  mensagensEnviadas?: string[];
  /** Dados de pagamento (gatilho pagamento_recebido) */
  pagamentoId?: string;
  pagamentoValor?: number;
  pagamentoDescricao?: string;
  pagamentoTipo?: string; // "BOLETO", "PIX", etc
  assinaturaId?: string; // se tiver = é assinatura
  primeiraCobranca?: boolean;
  /** ID do card criado no Kanban */
  kanbanCardId?: number;
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
  /** Chama a IA com um prompt e retorna a resposta */
  chamarIA: (prompt: string, mensagem: string) => Promise<string>;
  /**
   * Executa um agente IA pré-configurado (prompt + modelo + docs RAG salvos
   * em `agentesIa`) e retorna a resposta textual. Usado por `ia_responder`
   * quando o passo tem `config.agenteId`.
   */
  executarAgente: (agenteId: number, mensagem: string) => Promise<string>;
  /** Busca horários disponíveis no Cal.com */
  buscarHorarios: (duracao: number) => Promise<string[]>;
  /** Cria agendamento no Cal.com */
  criarAgendamento: (horario: string, nome: string, email: string) => Promise<string>;
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
  enviarWhatsApp: (telefone: string, mensagem: string) => Promise<boolean>;
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
    cnj?: string;
    responsavelId?: number;
    prazoDias?: number;
    tags?: string;
  }) => Promise<number>;
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
    let resposta: string;
    if (typeof agenteId === "number" && agenteId > 0) {
      resposta = await exec.executarAgente(agenteId, mensagem);
    } else {
      const promptExtra = passo.config.prompt || "";
      const prompt = `Você é um assistente jurídico educado e profissional. ${promptExtra}\n\nResponda de forma clara e concisa.`;
      resposta = await exec.chamarIA(prompt, mensagem);
    }

    return {
      sucesso: true,
      contexto: { ...ctx, respostaIA: resposta },
      resposta,
    };
  } catch (err: any) {
    return { sucesso: false, contexto: ctx, mensagemErro: `IA: ${err.message}` };
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

async function handleWhatsAppEnviar(
  passo: Passo,
  ctx: SmartflowContexto,
  exec: SmartflowExecutores,
): Promise<PassoResultado> {
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

  const mensagem = template
    .replace(/\{nome\}/g, (ctx.nomeCliente as string) || "")
    .replace(/\{intencao\}/g, ctx.intencao || "")
    .replace(/\{horario\}/g, ctx.horarioEscolhido || "")
    .replace(/\{cobrancasAbertas\}/g, blocoCobrancas);

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
      const ok = await exec.enviarWhatsApp(telefone, mensagem);
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

function handleTransferir(
  _passo: Passo,
  ctx: SmartflowContexto,
): PassoResultado {
  return {
    sucesso: true,
    contexto: { ...ctx, transferir: true },
    resposta: "Vou transferir você para um de nossos advogados. Um momento, por favor.",
    parar: true,
  };
}

/**
 * Avalia uma única condição sobre um contexto. Retorna `true` se bate.
 * Operadores `maior`, `menor`, `entre` são numéricos; `contem` é string-case
 * insensitive; os demais preservam semântica legada.
 */
function avaliarCondicao(
  campo: string,
  operador: string,
  valor: string,
  valor2: string | undefined,
  ctx: SmartflowContexto,
): boolean {
  const valorAtual = ctx[campo];

  switch (operador) {
    case "igual":
      return String(valorAtual ?? "") === valor;
    case "diferente":
      return String(valorAtual ?? "") !== valor;
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
    default:
      // Operador desconhecido — fallback `igual` para não quebrar cenários
      // legados que salvaram strings estranhas no campo.
      return String(valorAtual ?? "") === valor;
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
  const cfg = passo.config as {
    condicoes?: Array<{ id: string; campo: string; operador: string; valor?: string; valor2?: string }>;
    campo?: string;
    operador?: string;
    valor?: string;
  };

  const condicoes = Array.isArray(cfg.condicoes) ? cfg.condicoes : [];

  // Caminho novo: condicoes[] populadas
  if (condicoes.length > 0) {
    for (const c of condicoes) {
      const bate = avaliarCondicao(
        c.campo || "intencao",
        c.operador || "igual",
        c.valor || "",
        c.valor2,
        ctx,
      );
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
  const titulo = cfg.titulo
    || ctx.pagamentoDescricao
    || `${(ctx.nomeCliente as string) || "Cliente"} — Pagamento recebido`;

  // Descrição: a do editor sobrepõe o default baseado no pagamento.
  const descricaoPadrao =
    `Pagamento: R$ ${((ctx.pagamentoValor || 0) / 100).toFixed(2)}\n${ctx.pagamentoDescricao || ""}`.trim();
  const descricao = cfg.descricao ? String(cfg.descricao) : descricaoPadrao;

  const prazoDiasNum = Number(cfg.prazoDias);

  try {
    const cardId = await exec.criarCardKanban({
      funilId: cfg.funilId,
      colunaId: cfg.colunaId,
      titulo,
      descricao,
      clienteId: ctx.contatoId as number | undefined,
      prioridade: cfg.prioridade || "media",
      asaasPaymentId: ctx.pagamentoId,
      cnj: cfg.cnj || undefined,
      responsavelId: cfg.responsavelId ? Number(cfg.responsavelId) : undefined,
      prazoDias: Number.isFinite(prazoDiasNum) && prazoDiasNum > 0 ? prazoDiasNum : undefined,
      tags: cfg.tags || undefined,
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

// ─── Engine principal ───────────────────────────────────────────────────────

const HANDLERS: Record<string, (p: Passo, c: SmartflowContexto, e: SmartflowExecutores) => Promise<PassoResultado> | PassoResultado> = {
  ia_classificar: handleIAClassificar,
  ia_responder: handleIAResponder,
  calcom_horarios: handleCalcomHorarios,
  calcom_agendar: handleCalcomAgendar,
  calcom_listar: handleCalcomListar,
  calcom_cancelar: handleCalcomCancelar,
  calcom_remarcar: handleCalcomRemarcar,
  whatsapp_enviar: handleWhatsAppEnviar,
  transferir: handleTransferir,
  condicional: handleCondicional,
  esperar: handleEsperar,
  webhook: handleWebhook,
  kanban_criar_card: handleKanbanCriarCard,
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
  let contexto = { ...contextoInicial };
  const respostas: string[] = [];
  let passosExecutados = 0;

  const passosOrdenados = [...passos].sort((a, b) => a.ordem - b.ordem);
  if (passosOrdenados.length === 0) {
    return { sucesso: true, contexto, passosExecutados, respostas };
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

  let atual: Passo | null = passosOrdenados[0];

  while (atual !== null) {
    const passoAtual: Passo = atual;
    if (passosExecutados >= MAX_PASSOS_EXECUCAO) {
      return {
        sucesso: false,
        contexto,
        passosExecutados,
        respostas,
        erro: `Limite de ${MAX_PASSOS_EXECUCAO} passos excedido — possível loop no cenário.`,
      };
    }

    const handler = HANDLERS[passoAtual.tipo];
    if (!handler) {
      return {
        sucesso: false,
        contexto,
        passosExecutados,
        respostas,
        erro: `Tipo de passo desconhecido: ${passoAtual.tipo}`,
      };
    }

    const resultado: PassoResultado = await handler(passoAtual, contexto, executores);
    passosExecutados++;
    contexto = resultado.contexto;

    if (resultado.resposta) respostas.push(resultado.resposta);

    if (!resultado.sucesso) {
      return {
        sucesso: false,
        contexto,
        passosExecutados,
        respostas,
        erro: resultado.mensagemErro || "Erro no passo " + passoAtual.tipo,
      };
    }

    if (resultado.parar) break;

    // Próximo passo.
    //   modo grafo: só segue se `proximoSe` declarar o ramo — senão encerra.
    //   modo linear: sempre tenta a próxima `ordem` (comportamento legado).
    let proximo: Passo | null = null;
    const mapa: Record<string, string> | null | undefined = passoAtual.proximoSe;

    if (mapa && typeof mapa === "object") {
      const chave: string = resultado.proximoRamoId || "default";
      const alvoClienteId: string | undefined = mapa[chave];
      if (alvoClienteId) {
        proximo = porClienteId.get(alvoClienteId) ?? null;
      }
    } else if (!modoGrafo) {
      const idx = indicePorId.get(passoAtual.id);
      if (idx != null && idx + 1 < passosOrdenados.length) {
        proximo = passosOrdenados[idx + 1];
      }
    }

    atual = proximo;
  }

  return { sucesso: true, contexto, passosExecutados, respostas };
}

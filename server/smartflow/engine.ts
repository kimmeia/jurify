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
}

export interface PassoResultado {
  sucesso: boolean;
  contexto: SmartflowContexto;
  mensagemErro?: string;
  /** Se o fluxo deve parar (transferir, esperar, erro) */
  parar?: boolean;
  /** Mensagem pra enviar ao cliente */
  resposta?: string;
}

/** Funções externas injetadas (pra testar sem I/O real) */
export interface SmartflowExecutores {
  /** Chama a IA com um prompt e retorna a resposta */
  chamarIA: (prompt: string, mensagem: string) => Promise<string>;
  /** Busca horários disponíveis no Cal.com */
  buscarHorarios: (duracao: number) => Promise<string[]>;
  /** Cria agendamento no Cal.com */
  criarAgendamento: (horario: string, nome: string, email: string) => Promise<string>;
  /** Envia mensagem WhatsApp */
  enviarWhatsApp: (telefone: string, mensagem: string) => Promise<boolean>;
  /** Chama webhook externo */
  chamarWebhook: (url: string, dados: any) => Promise<any>;
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
  const promptExtra = passo.config.prompt || "";
  const prompt = `Você é um assistente jurídico educado e profissional. ${promptExtra}\n\nResponda de forma clara e concisa.`;

  try {
    const resposta = await exec.chamarIA(prompt, ctx.mensagem || "");
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

async function handleWhatsAppEnviar(
  passo: Passo,
  ctx: SmartflowContexto,
  exec: SmartflowExecutores,
): Promise<PassoResultado> {
  const template = passo.config.template || ctx.respostaIA || "";
  if (!template) {
    return { sucesso: false, contexto: ctx, mensagemErro: "Sem mensagem para enviar" };
  }

  // Substitui variáveis no template
  const mensagem = template
    .replace(/\{nome\}/g, (ctx.nomeCliente as string) || "")
    .replace(/\{intencao\}/g, ctx.intencao || "")
    .replace(/\{horario\}/g, ctx.horarioEscolhido || "");

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

function handleCondicional(
  passo: Passo,
  ctx: SmartflowContexto,
): PassoResultado {
  const campo = passo.config.campo || "intencao";
  const valorEsperado = passo.config.valor || "";
  const valorAtual = String(ctx[campo] || "");

  if (valorAtual === valorEsperado) {
    return { sucesso: true, contexto: ctx };
  }

  // Condição não atendida — pula pra próximo passo
  return { sucesso: true, contexto: ctx, parar: false };
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

// ─── Engine principal ───────────────────────────────────────────────────────

const HANDLERS: Record<string, (p: Passo, c: SmartflowContexto, e: SmartflowExecutores) => Promise<PassoResultado> | PassoResultado> = {
  ia_classificar: handleIAClassificar,
  ia_responder: handleIAResponder,
  calcom_horarios: handleCalcomHorarios,
  calcom_agendar: handleCalcomAgendar,
  whatsapp_enviar: handleWhatsAppEnviar,
  transferir: handleTransferir,
  condicional: handleCondicional,
  esperar: handleEsperar,
  webhook: handleWebhook,
};

export interface ExecutarCenarioResultado {
  sucesso: boolean;
  contexto: SmartflowContexto;
  passosExecutados: number;
  respostas: string[];
  erro?: string;
}

/**
 * Executa um cenário completo — processa cada passo em ordem.
 * Retorna o contexto final + respostas coletadas.
 *
 * @param passos lista de passos ordenados
 * @param contextoInicial dados de entrada (mensagem, nome, etc)
 * @param executores funções externas injetadas
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

  for (const passo of passosOrdenados) {
    const handler = HANDLERS[passo.tipo];
    if (!handler) {
      return {
        sucesso: false,
        contexto,
        passosExecutados,
        respostas,
        erro: `Tipo de passo desconhecido: ${passo.tipo}`,
      };
    }

    const resultado = await handler(passo, contexto, executores);
    passosExecutados++;
    contexto = resultado.contexto;

    if (resultado.resposta) {
      respostas.push(resultado.resposta);
    }

    if (!resultado.sucesso) {
      return {
        sucesso: false,
        contexto,
        passosExecutados,
        respostas,
        erro: resultado.mensagemErro || "Erro no passo " + passo.tipo,
      };
    }

    if (resultado.parar) {
      break;
    }
  }

  return { sucesso: true, contexto, passosExecutados, respostas };
}

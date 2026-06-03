/**
 * WhatsApp Business Calling API (Meta Cloud API) — tipos compartilhados.
 *
 * A Calling API roda no MESMO número/`phone_number_id` já usado na mensageria.
 * Eventos de chamada chegam no mesmo webhook (`field: "calls"`) com um envelope
 * `value.calls[]`. Este módulo normaliza esse envelope pro modelo interno
 * (direção/status) com funções puras — testáveis sem rede nem DB.
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/calling
 */

export type DirecaoChamada = "entrada" | "saida";

export type StatusChamada =
  | "tocando" // connect recebido, aguardando atendente
  | "conectando" // pre_accept/connect enviado, negociando mídia
  | "em_andamento" // accept enviado, áudio fluindo
  | "encerrada" // terminate normal (COMPLETED)
  | "rejeitada" // atendente recusou
  | "perdida" // ninguém atendeu
  | "falha"; // erro de mídia/conexão (FAILED)

/** Envelope de um item de `value.calls[]` do webhook da Meta. */
export interface EventoChamadaMeta {
  id?: string;
  from?: string;
  to?: string;
  event?: string; // "connect" | "terminate"
  direction?: string; // "USER_INITIATED" | "BUSINESS_INITIATED"
  timestamp?: string;
  status?: string; // no terminate: "COMPLETED" | "FAILED" | ...
  duration?: number;
  biz_opaque_callback_data?: string;
  session?: { sdp?: string; sdp_type?: string };
}

/** Forma normalizada (interna) de um evento de chamada. */
export interface EventoChamadaNormalizado {
  callId: string;
  evento: "connect" | "terminate" | "desconhecido";
  direcao: DirecaoChamada;
  /** Telefone do CLIENTE (não do número da empresa), só dígitos. */
  telefone: string;
  status: StatusChamada;
  duracaoSegundos: number | null;
  bizOpaqueCallbackData: string | null;
  sdp: string | null;
  sdpType: string | null;
  timestamp: number | null;
}

/** `BUSINESS_INITIATED` = empresa ligou (saída). Qualquer outro = entrada. */
export function direcaoChamadaDeMeta(direction?: string): DirecaoChamada {
  return (direction || "").toUpperCase() === "BUSINESS_INITIATED" ? "saida" : "entrada";
}

/** Mapeia o `status` do evento `terminate` da Meta pro status interno. */
export function statusChamadaDeTerminate(metaStatus?: string): StatusChamada {
  switch ((metaStatus || "").toUpperCase()) {
    case "COMPLETED":
      return "encerrada";
    case "FAILED":
      return "falha";
    case "REJECTED":
      return "rejeitada";
    case "NO_ANSWER":
    case "MISSED":
    case "UNANSWERED":
      return "perdida";
    default:
      return "encerrada";
  }
}

const soDigitos = (v?: string): string => (v || "").replace(/\D/g, "");

/**
 * Normaliza um item de `value.calls[]` pro modelo interno. Pura.
 *
 * O telefone do cliente é o `from` quando a chamada é de entrada (cliente
 * ligou) e o `to` quando é de saída (empresa ligou) — assim o log sempre
 * aponta pro contato, nunca pro próprio número da empresa.
 */
export function normalizarEventoChamada(call: EventoChamadaMeta): EventoChamadaNormalizado {
  const evento: EventoChamadaNormalizado["evento"] =
    call.event === "connect" ? "connect" : call.event === "terminate" ? "terminate" : "desconhecido";
  const direcao = direcaoChamadaDeMeta(call.direction);
  const telefone = direcao === "entrada" ? soDigitos(call.from) : soDigitos(call.to);
  const status: StatusChamada = evento === "terminate" ? statusChamadaDeTerminate(call.status) : "tocando";
  const ts = call.timestamp ? parseInt(call.timestamp, 10) : NaN;

  return {
    callId: call.id || "",
    evento,
    direcao,
    telefone,
    status,
    duracaoSegundos: typeof call.duration === "number" ? call.duration : null,
    bizOpaqueCallbackData: call.biz_opaque_callback_data || null,
    sdp: call.session?.sdp || null,
    sdpType: call.session?.sdp_type || null,
    timestamp: Number.isFinite(ts) ? ts : null,
  };
}

// ─── Sinalização em tempo real (SSE) ─────────────────────────────────────────
// O servidor empurra o evento de chamada pro navegador do atendente pelo MESMO
// canal SSE das notificações. O sentido oposto (SDP answer/offer, desligar) vai
// pelas mutations tRPC. Trickle ICE não é usado: o SDP vai completo de uma vez,
// então não precisa de canal de candidatos.

export interface ContextoChamadaSSE {
  contatoId?: number | null;
  contatoNome?: string | null;
  conversaId?: number | null;
}

export type TipoSinalChamada =
  | "chamada_entrante"
  | "chamada_resposta"
  | "chamada_encerrada"
  | "chamada_fila";

export interface SinalizacaoChamada {
  tipo: TipoSinalChamada;
  titulo: string;
  mensagem: string;
  /** `kind: "sinalizacao_chamada"` faz o hook de SSE pular toast/contador. */
  dados: Record<string, unknown>;
}

/**
 * Monta o payload SSE de um evento de chamada (ou null quando o evento não
 * gera sinal — ex.: connect sem SDP). Pura.
 *
 * - entrada + offer  → `chamada_entrante` (toca pro atendente, carrega o offer)
 * - saída   + answer → `chamada_resposta` (resposta da Meta com o answer)
 * - terminate        → `chamada_encerrada`
 */
export function montarSinalizacaoChamada(
  ev: EventoChamadaNormalizado,
  ctx?: ContextoChamadaSSE,
): SinalizacaoChamada | null {
  const baseDados = {
    kind: "sinalizacao_chamada" as const,
    callId: ev.callId,
    telefone: ev.telefone,
    direcao: ev.direcao,
    contatoId: ctx?.contatoId ?? null,
    contatoNome: ctx?.contatoNome ?? null,
    conversaId: ctx?.conversaId ?? null,
  };
  const nome = ctx?.contatoNome || ev.telefone || "Contato";

  if (ev.evento === "terminate") {
    return {
      tipo: "chamada_encerrada",
      titulo: "Chamada encerrada",
      mensagem: nome,
      dados: { ...baseDados, motivo: ev.status },
    };
  }

  if (ev.evento === "connect" && ev.sdp) {
    if (ev.sdpType === "answer") {
      return {
        tipo: "chamada_resposta",
        titulo: "Chamada atendida",
        mensagem: nome,
        dados: { ...baseDados, sdpAnswer: ev.sdp },
      };
    }
    if (ev.sdpType === "offer") {
      return {
        tipo: "chamada_entrante",
        titulo: "Chamada recebida",
        mensagem: nome,
        dados: { ...baseDados, sdpOffer: ev.sdp },
      };
    }
  }

  return null;
}

// ─── Fila de chamadas (painel + widget app-wide) ─────────────────────────────
// Além do toque pro responsável (chamada_entrante), a chamada recebida é
// transmitida pro escritório todo como evento de FILA — pra qualquer atendente
// ver e "assumir" se o responsável não pegar. Carrega o SDP offer pra quem
// assumir conseguir responder sem round-trip extra.

export type AcaoFila = "tocando" | "removida";

export interface ContextoFila {
  contatoId?: number | null;
  contatoNome?: string | null;
  telefone?: string | null;
  conversaId?: number | null;
  responsavelId?: number | null;
  responsavelNome?: string | null;
}

/** Monta o evento SSE de fila (escritório-wide). Pura. */
export function montarSinalFila(
  callId: string,
  acao: AcaoFila,
  ctx: ContextoFila,
  sdpOffer?: string | null,
): SinalizacaoChamada {
  const nome = ctx.contatoNome || ctx.telefone || "Contato";
  return {
    tipo: "chamada_fila",
    titulo: acao === "tocando" ? "Chamada na fila" : "Chamada saiu da fila",
    mensagem: nome,
    dados: {
      kind: "sinalizacao_chamada",
      acao,
      callId,
      sdpOffer: acao === "tocando" ? sdpOffer || null : null,
      contatoId: ctx.contatoId ?? null,
      contatoNome: ctx.contatoNome ?? null,
      telefone: ctx.telefone ?? null,
      conversaId: ctx.conversaId ?? null,
      responsavelId: ctx.responsavelId ?? null,
      responsavelNome: ctx.responsavelNome ?? null,
    },
  };
}

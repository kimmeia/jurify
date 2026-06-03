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

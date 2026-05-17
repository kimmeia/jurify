/**
 * Tipos compartilhados — Integração Cal.com
 * Etapa 2: Agendamento online de consultas via Cal.com
 */

export type StatusCalcom = "desconectado" | "conectado" | "erro";

export interface CalcomConfig {
  apiKey: string;
  baseUrl: string; // ex: https://cal.com ou self-hosted
  eventTypeId?: number; // ID do tipo de evento no Cal.com
  defaultDuration?: number; // minutos (padrão 30)
  /**
   * Segredo HMAC do webhook Cal.com — quando configurado, o handler
   * `/api/webhooks/calcom` valida o header `X-Cal-Signature-256` (hex
   * SHA-256 do body raw com este segredo) e rejeita 401 se não bater.
   *
   * Quando ausente em TODOS os canais Cal.com cadastrados, o webhook
   * processa sem validação e loga warn (modo legado / setups antigos).
   * Assim que pelo menos um canal definir secret, validação fica
   * obrigatória pra requests que se identificam como daquele canal.
   *
   * Cal.com SaaS gera o secret quando você cria o webhook no painel
   * (Settings → Webhooks → Subscribe to → "Webhook Secret"). Self-hosted
   * permite definir manualmente. Cole o valor exato aqui.
   */
  webhookSecret?: string;
}

export interface CalcomEventType {
  id: number;
  title: string;
  slug: string;
  length: number; // duração em minutos
  description?: string;
}

export interface CalcomBooking {
  id: number;
  uid: string;
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
  status: "ACCEPTED" | "PENDING" | "CANCELLED" | "REJECTED";
  attendees: CalcomAttendee[];
  meetingUrl?: string;
  location?: string;
}

export interface CalcomAttendee {
  name: string;
  email: string;
  timeZone: string;
}

export interface CalcomAvailableSlot {
  time: string; // ISO string
}

export interface CalcomWebhookPayload {
  triggerEvent: "BOOKING_CREATED" | "BOOKING_CANCELLED" | "BOOKING_RESCHEDULED" | "BOOKING_COMPLETED";
  createdAt: string;
  payload: {
    id: number;
    uid: string;
    title: string;
    startTime: string;
    endTime: string;
    status: string;
    attendees: CalcomAttendee[];
    organizer: {
      name: string;
      email: string;
      timeZone: string;
    };
    metadata?: Record<string, unknown>;
  };
}

export const CALCOM_STATUS_LABELS: Record<StatusCalcom, string> = {
  desconectado: "Desconectado",
  conectado: "Conectado",
  erro: "Erro na Conexão",
};

export const CALCOM_STATUS_CORES: Record<StatusCalcom, string> = {
  desconectado: "text-gray-600 bg-gray-50 border-gray-200",
  conectado: "text-emerald-600 bg-emerald-50 border-emerald-200",
  erro: "text-red-600 bg-red-50 border-red-200",
};

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

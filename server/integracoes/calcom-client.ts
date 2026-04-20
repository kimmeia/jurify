/**
 * Serviço Cal.com — Cliente da API v2 para agendamentos
 * 
 * MIGRADO DE v1 PARA v2:
 * - Base URL: https://api.cal.com/v2 (cloud) ou {baseUrl}/api/v2 (self-hosted)
 * - Auth: Bearer token (header Authorization)
 * - Header obrigatório: cal-api-version: 2024-08-13
 * - Sem axios (usa fetch nativo)
 */

import type {
  CalcomConfig,
  CalcomEventType,
  CalcomBooking,
  CalcomAvailableSlot,
} from "../../shared/calcom-types";
import { createLogger } from "../_core/logger";
const log = createLogger("integracoes-calcom-client");

export class CalcomClient {
  private baseUrl: string;
  private apiKey: string;
  private headers: Record<string, string>;

  constructor(config: CalcomConfig) {
    const base = config.baseUrl.replace(/\/$/, "");
    // Detecta e corrige URLs comuns:
    // - Profile URL (cal.com/usuario) → redireciona pra api.cal.com/v2
    // - API URL (api.cal.com) → usa direto com /v2
    // - Self-hosted (meusite.com) → adiciona /api/v2
    if (base.match(/^https?:\/\/cal\.com\//)) {
      // URL de perfil ou cal.com genérico → usa API cloud
      this.baseUrl = "https://api.cal.com/v2";
    } else if (base.includes("api.cal.com")) {
      this.baseUrl = "https://api.cal.com/v2";
    } else if (base.endsWith("/api/v2") || base.endsWith("/api/v1")) {
      this.baseUrl = base;
    } else {
      this.baseUrl = `${base}/api/v2`;
    }
    this.apiKey = config.apiKey;
    this.headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${this.apiKey}`,
      "cal-api-version": "2024-08-13",
    };
  }

  private async request(method: string, path: string, body?: any, params?: Record<string, string>): Promise<any> {
    let url = `${this.baseUrl}${path}`;
    if (params) {
      const qs = new URLSearchParams(params).toString();
      url += `?${qs}`;
    }
    const res = await fetch(url, {
      method,
      headers: this.headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Cal.com API ${res.status}: ${errText}`);
    }
    return res.json();
  }

  // ─── Verificação de Conexão ──────────────────────────────────────────────

  async testarConexao(): Promise<{ ok: boolean; user?: string; error?: string }> {
    try {
      const data = await this.request("GET", "/me");
      const user = data.data || data.user || data;
      return {
        ok: true,
        user: user?.name || user?.email || "Conectado",
      };
    } catch (err: any) {
      return { ok: false, error: err.message || "Falha na conexão" };
    }
  }

  // ─── Tipos de Evento ─────────────────────────────────────────────────────

  async listarEventTypes(): Promise<CalcomEventType[]> {
    try {
      const data = await this.request("GET", "/event-types");
      const types = data.data || data.event_types || data.eventTypes || [];
      return types.map((et: any) => ({
        id: et.id,
        title: et.title,
        slug: et.slug,
        length: et.lengthInMinutes || et.length,
        description: et.description || undefined,
      }));
    } catch (err: any) {
      log.error("[CalcomClient v2] Erro event types:", err.message);
      return [];
    }
  }

  // ─── Disponibilidade (Slots) ──────────────────────────────────────────────

  async buscarSlots(params: {
    eventTypeId: number;
    startTime: string;
    endTime: string;
    timeZone?: string;
  }): Promise<CalcomAvailableSlot[]> {
    try {
      const data = await this.request("GET", "/slots/available", undefined, {
        eventTypeId: String(params.eventTypeId),
        startTime: params.startTime,
        endTime: params.endTime,
        timeZone: params.timeZone || "America/Sao_Paulo",
      });

      const slots: CalcomAvailableSlot[] = [];
      const slotsData = data.data?.slots || data.slots || {};
      if (typeof slotsData === "object") {
        for (const dateKey of Object.keys(slotsData)) {
          for (const slot of slotsData[dateKey]) {
            slots.push({ time: slot.time || slot.startTime || slot });
          }
        }
      }
      return slots;
    } catch (err: any) {
      log.error("[CalcomClient v2] Erro slots:", err.message);
      return [];
    }
  }

  // ─── Bookings ──────────────────────────────────────────────────────────────

  async criarBooking(params: {
    eventTypeId: number;
    start: string;
    name: string;
    email: string;
    timeZone?: string;
    notes?: string;
    metadata?: Record<string, unknown>;
  }): Promise<CalcomBooking | null> {
    try {
      const data = await this.request("POST", "/bookings", {
        eventTypeId: params.eventTypeId,
        start: params.start,
        attendee: {
          name: params.name,
          email: params.email,
          timeZone: params.timeZone || "America/Sao_Paulo",
          language: "pt-BR",
        },
        metadata: params.metadata || {},
      });

      return this.mapBooking(data.data || data);
    } catch (err: any) {
      log.error("[CalcomClient v2] Erro criar booking:", err.message);
      return null;
    }
  }

  async cancelarBooking(bookingId: number, reason?: string): Promise<boolean> {
    try {
      await this.request("POST", `/bookings/${bookingId}/cancel`, {
        cancellationReason: reason || "Cancelado pelo sistema",
      });
      return true;
    } catch (err: any) {
      log.error("[CalcomClient v2] Erro cancelar:", err.message);
      return false;
    }
  }

  async listarBookings(params?: {
    status?: "upcoming" | "recurring" | "past" | "cancelled" | "unconfirmed";
    dateFrom?: string;
    dateTo?: string;
  }): Promise<CalcomBooking[]> {
    try {
      const qp: Record<string, string> = {};
      if (params?.status) qp.status = params.status;
      if (params?.dateFrom) qp.afterStart = params.dateFrom;
      if (params?.dateTo) qp.beforeEnd = params.dateTo;

      const data = await this.request("GET", "/bookings", undefined, qp);
      const bookings = data.data?.bookings || data.data || data.bookings || [];
      return bookings.map((b: any) => this.mapBooking(b)).filter(Boolean) as CalcomBooking[];
    } catch (err: any) {
      log.error("[CalcomClient v2] Erro listar bookings:", err.message);
      return [];
    }
  }

  async obterBooking(bookingId: number): Promise<CalcomBooking | null> {
    try {
      const data = await this.request("GET", `/bookings/${bookingId}`);
      return this.mapBooking(data.data || data.booking || data);
    } catch (err: any) {
      log.error("[CalcomClient v2] Erro obter booking:", err.message);
      return null;
    }
  }

  /**
   * Reagenda um booking para um novo horário. A API v2 do Cal.com trata
   * "reschedule" via POST /bookings/{id}/reschedule com o novo `start` no
   * corpo (não é PATCH no booking original).
   */
  async reagendarBooking(
    bookingId: number,
    params: { start: string; reason?: string },
  ): Promise<CalcomBooking | null> {
    try {
      const data = await this.request("POST", `/bookings/${bookingId}/reschedule`, {
        start: params.start,
        reschedulingReason: params.reason || "Reagendado pelo sistema",
      });
      return this.mapBooking(data.data || data);
    } catch (err: any) {
      log.error("[CalcomClient v2] Erro reagendar:", err.message);
      return null;
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private mapBooking(raw: any): CalcomBooking | null {
    if (!raw || !raw.id) return null;
    return {
      id: raw.id,
      uid: raw.uid || "",
      title: raw.title || "",
      description: raw.description || undefined,
      startTime: raw.startTime || raw.start || "",
      endTime: raw.endTime || raw.end || "",
      status: raw.status || "PENDING",
      attendees: (raw.attendees || []).map((a: any) => ({
        name: a.name || "",
        email: a.email || "",
        timeZone: a.timeZone || "America/Sao_Paulo",
      })),
      meetingUrl: raw.meetingUrl || raw.metadata?.videoCallUrl || undefined,
      location: raw.location || undefined,
    };
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function criarCalcomClient(config: CalcomConfig): CalcomClient {
  return new CalcomClient(config);
}

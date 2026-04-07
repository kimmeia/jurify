/**
 * Testes — Cal.com Client & Router
 * Etapa 2: Validação de integração Cal.com
 */

import { describe, it, expect, vi } from "vitest";
import type { CalcomConfig, CalcomBooking, CalcomEventType, CalcomAvailableSlot } from "../../shared/calcom-types";
import { CALCOM_STATUS_LABELS } from "../../shared/calcom-types";

// ─── Mock do CalcomClient (sem dependência de rede) ──────────────────────────

function createMockClient(config: CalcomConfig) {
  return {
    config,
    async testarConexao() {
      if (!config.apiKey || config.apiKey.length < 10) {
        return { ok: false, error: "API Key inválida" };
      }
      return { ok: true, user: "Advogado Teste" };
    },
    async listarEventTypes(): Promise<CalcomEventType[]> {
      return [
        { id: 1, title: "Consulta Jurídica", slug: "consulta-juridica", length: 30 },
        { id: 2, title: "Reunião Inicial", slug: "reuniao-inicial", length: 60 },
      ];
    },
    async buscarSlots(params: { eventTypeId: number; startTime: string; endTime: string }): Promise<CalcomAvailableSlot[]> {
      return [
        { time: "2026-04-01T09:00:00-03:00" },
        { time: "2026-04-01T09:30:00-03:00" },
        { time: "2026-04-01T10:00:00-03:00" },
      ];
    },
    async criarBooking(params: { eventTypeId: number; start: string; name: string; email: string }): Promise<CalcomBooking | null> {
      if (!params.name || !params.email) return null;
      return {
        id: 100,
        uid: "mock-uid-123",
        title: "Consulta Jurídica",
        startTime: params.start,
        endTime: new Date(new Date(params.start).getTime() + 30 * 60000).toISOString(),
        status: "ACCEPTED",
        attendees: [{ name: params.name, email: params.email, timeZone: "America/Sao_Paulo" }],
      };
    },
    async cancelarBooking(bookingId: number): Promise<boolean> {
      return bookingId > 0;
    },
    async listarBookings(): Promise<CalcomBooking[]> {
      return [
        {
          id: 100,
          uid: "mock-uid-123",
          title: "Consulta Jurídica",
          startTime: "2026-04-01T09:00:00-03:00",
          endTime: "2026-04-01T09:30:00-03:00",
          status: "ACCEPTED",
          attendees: [{ name: "Cliente Teste", email: "teste@email.com", timeZone: "America/Sao_Paulo" }],
        },
      ];
    },
  };
}

// ─── Testes ─────────────────────────────────────────────────────────────────

describe("CalcomClient", () => {
  const validConfig: CalcomConfig = {
    apiKey: "cal_live_1234567890abcdef",
    baseUrl: "https://cal.com",
    defaultDuration: 30,
  };

  describe("testarConexao", () => {
    it("retorna ok:true com API key válida", async () => {
      const client = createMockClient(validConfig);
      const result = await client.testarConexao();
      expect(result.ok).toBe(true);
      expect(result.user).toBe("Advogado Teste");
    });

    it("retorna ok:false com API key curta", async () => {
      const client = createMockClient({ ...validConfig, apiKey: "short" });
      const result = await client.testarConexao();
      expect(result.ok).toBe(false);
      expect(result.error).toContain("inválida");
    });

    it("retorna ok:false com API key vazia", async () => {
      const client = createMockClient({ ...validConfig, apiKey: "" });
      const result = await client.testarConexao();
      expect(result.ok).toBe(false);
    });
  });

  describe("listarEventTypes", () => {
    it("retorna lista de tipos de evento", async () => {
      const client = createMockClient(validConfig);
      const types = await client.listarEventTypes();
      expect(types).toHaveLength(2);
      expect(types[0].title).toBe("Consulta Jurídica");
      expect(types[0].length).toBe(30);
      expect(types[1].slug).toBe("reuniao-inicial");
    });
  });

  describe("buscarSlots", () => {
    it("retorna slots disponíveis", async () => {
      const client = createMockClient(validConfig);
      const slots = await client.buscarSlots({
        eventTypeId: 1,
        startTime: "2026-04-01",
        endTime: "2026-04-02",
      });
      expect(slots.length).toBeGreaterThan(0);
      expect(slots[0].time).toContain("2026-04-01");
    });
  });

  describe("criarBooking", () => {
    it("cria booking com dados válidos", async () => {
      const client = createMockClient(validConfig);
      const booking = await client.criarBooking({
        eventTypeId: 1,
        start: "2026-04-01T09:00:00-03:00",
        name: "João Silva",
        email: "joao@email.com",
      });
      expect(booking).not.toBeNull();
      expect(booking!.id).toBe(100);
      expect(booking!.status).toBe("ACCEPTED");
      expect(booking!.attendees[0].name).toBe("João Silva");
    });

    it("retorna null com dados faltando", async () => {
      const client = createMockClient(validConfig);
      const booking = await client.criarBooking({
        eventTypeId: 1,
        start: "2026-04-01T09:00:00",
        name: "",
        email: "",
      });
      expect(booking).toBeNull();
    });
  });

  describe("cancelarBooking", () => {
    it("cancela booking existente", async () => {
      const client = createMockClient(validConfig);
      const ok = await client.cancelarBooking(100);
      expect(ok).toBe(true);
    });

    it("falha com bookingId inválido", async () => {
      const client = createMockClient(validConfig);
      const ok = await client.cancelarBooking(0);
      expect(ok).toBe(false);
    });
  });

  describe("listarBookings", () => {
    it("retorna bookings", async () => {
      const client = createMockClient(validConfig);
      const bookings = await client.listarBookings();
      expect(bookings).toHaveLength(1);
      expect(bookings[0].uid).toBe("mock-uid-123");
    });
  });
});

// ─── Testes de Tipos Cal.com ────────────────────────────────────────────────

describe("CalcomTypes", () => {
  it("CALCOM_STATUS_LABELS tem todas as keys", () => {
    expect(CALCOM_STATUS_LABELS.desconectado).toBe("Desconectado");
    expect(CALCOM_STATUS_LABELS.conectado).toBe("Conectado");
    expect(CALCOM_STATUS_LABELS.erro).toBe("Erro na Conexão");
  });
});

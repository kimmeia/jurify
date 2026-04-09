/**
 * Router tRPC — Cal.com: Configuração e Agendamentos
 * Etapa 2: Endpoints para conectar, testar e usar Cal.com
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { obterConfigCanal, atualizarConfigCanal, atualizarStatusCanal, registrarAudit } from "../escritorio/db-canais";
import { criarCalcomClient } from "./calcom-client";
import type { CalcomConfig } from "../../shared/calcom-types";

/** Helper: obtém o CalcomClient a partir do canalId do escritório */
async function getCalcomClientFromCanal(canalId: number, escritorioId: number) {
  const config = await obterConfigCanal(canalId, escritorioId);
  if (!config || !config.apiKey || !config.baseUrl) {
    throw new Error("Canal Cal.com não configurado. Adicione a API Key nas configurações.");
  }
  return criarCalcomClient(config as CalcomConfig);
}

export const calcomRouter = router({
  /** Testa conexão diretamente com apiKey (sem canal existente) */
  testarConexaoDireta: protectedProcedure
    .input(z.object({
      apiKey: z.string().min(5),
      baseUrl: z.string().default("https://cal.com"),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");

      const client = criarCalcomClient({
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
        defaultDuration: 30,
      });
      return client.testarConexao();
    }),

  /** Salva config Cal.com criando canal automaticamente se não existir */
  salvarConfigDireta: protectedProcedure
    .input(z.object({
      apiKey: z.string().min(5),
      baseUrl: z.string().default("https://cal.com"),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      if (esc.colaborador.cargo !== "dono" && esc.colaborador.cargo !== "gestor") {
        throw new Error("Sem permissão.");
      }

      // Testar antes de salvar
      const client = criarCalcomClient({ apiKey: input.apiKey, baseUrl: input.baseUrl, defaultDuration: 30 });
      const teste = await client.testarConexao();
      if (!teste.ok) throw new Error(teste.error || "Falha ao conectar com Cal.com");

      // Criar canal do tipo whatsapp_api (reuso temporário) com config criptografada
      // Idealmente teríamos tipo "calcom" mas por ora usamos o sistema de canais existente
      const { criarCanal } = await import("../escritorio/db-canais");
      const canalId = await criarCanal({
        escritorioId: esc.escritorio.id,
        tipo: "calcom",
        nome: `Cal.com (${teste.user})`,
        config: { apiKey: input.apiKey, baseUrl: input.baseUrl, defaultDuration: "30" },
      });

      await atualizarStatusCanal(canalId, esc.escritorio.id, "conectado");

      await registrarAudit({
        escritorioId: esc.escritorio.id,
        colaboradorId: esc.colaborador.id,
        canalId,
        acao: "conectou",
        detalhes: `Cal.com conectado como ${teste.user}`,
      });

      return { success: true, canalId, user: teste.user };
    }),

  /** Testa a conexão com o Cal.com (via canal existente) */
  testarConexao: protectedProcedure
    .input(z.object({ canalId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");

      const client = await getCalcomClientFromCanal(input.canalId, esc.escritorio.id);
      const result = await client.testarConexao();

      // Atualizar status do canal
      if (result.ok) {
        await atualizarStatusCanal(input.canalId, esc.escritorio.id, "conectado");
      } else {
        await atualizarStatusCanal(input.canalId, esc.escritorio.id, "erro", result.error);
      }

      await registrarAudit({
        escritorioId: esc.escritorio.id,
        colaboradorId: esc.colaborador.id,
        canalId: input.canalId,
        acao: "testou",
        detalhes: result.ok ? `Cal.com conectado: ${result.user}` : `Erro: ${result.error}`,
      });

      return result;
    }),

  /** Salva configuração Cal.com (API key + URL base) */
  salvarConfig: protectedProcedure
    .input(z.object({
      canalId: z.number(),
      apiKey: z.string().min(10, "API Key inválida"),
      baseUrl: z.string().url("URL inválida").default("https://cal.com"),
      defaultDuration: z.number().min(15).max(240).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      if (esc.colaborador.cargo !== "dono" && esc.colaborador.cargo !== "gestor") {
        throw new Error("Sem permissão.");
      }

      await atualizarConfigCanal(input.canalId, esc.escritorio.id, {
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
        defaultDuration: String(input.defaultDuration || 30),
      });

      // Testar automaticamente após salvar
      const client = criarCalcomClient({
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
        defaultDuration: input.defaultDuration || 30,
      });
      const teste = await client.testarConexao();

      if (teste.ok) {
        await atualizarStatusCanal(input.canalId, esc.escritorio.id, "conectado");
      } else {
        await atualizarStatusCanal(input.canalId, esc.escritorio.id, "erro", teste.error);
      }

      await registrarAudit({
        escritorioId: esc.escritorio.id,
        colaboradorId: esc.colaborador.id,
        canalId: input.canalId,
        acao: "editou_config",
        detalhes: `Cal.com config salva. Teste: ${teste.ok ? "OK" : teste.error}`,
      });

      return { success: true, teste };
    }),

  /** Lista tipos de evento do Cal.com */
  eventTypes: protectedProcedure
    .input(z.object({ canalId: z.number() }))
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return [];

      try {
        const client = await getCalcomClientFromCanal(input.canalId, esc.escritorio.id);
        return client.listarEventTypes();
      } catch {
        return [];
      }
    }),

  /** Busca slots disponíveis */
  slots: protectedProcedure
    .input(z.object({
      canalId: z.number(),
      eventTypeId: z.number(),
      dataInicio: z.string(), // YYYY-MM-DD
      dataFim: z.string(),    // YYYY-MM-DD
    }))
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return [];

      const client = await getCalcomClientFromCanal(input.canalId, esc.escritorio.id);
      return client.buscarSlots({
        eventTypeId: input.eventTypeId,
        startTime: input.dataInicio,
        endTime: input.dataFim,
      });
    }),

  /** Cria um booking */
  criarBooking: protectedProcedure
    .input(z.object({
      canalId: z.number(),
      eventTypeId: z.number(),
      start: z.string(), // ISO datetime
      nomeCliente: z.string().min(2),
      emailCliente: z.string().email(),
      observacoes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");

      const client = await getCalcomClientFromCanal(input.canalId, esc.escritorio.id);
      const booking = await client.criarBooking({
        eventTypeId: input.eventTypeId,
        start: input.start,
        name: input.nomeCliente,
        email: input.emailCliente,
        notes: input.observacoes,
        metadata: {
          escritorioId: esc.escritorio.id,
          criadoPor: ctx.user.name || ctx.user.email,
        },
      });

      if (!booking) {
        throw new Error("Não foi possível criar o agendamento. Verifique a disponibilidade.");
      }

      return booking;
    }),

  /** Cancela um booking */
  cancelarBooking: protectedProcedure
    .input(z.object({
      canalId: z.number(),
      bookingId: z.number(),
      motivo: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");

      const client = await getCalcomClientFromCanal(input.canalId, esc.escritorio.id);
      const ok = await client.cancelarBooking(input.bookingId, input.motivo);
      if (!ok) throw new Error("Falha ao cancelar agendamento.");
      return { success: true };
    }),

  /** Lista bookings */
  bookings: protectedProcedure
    .input(z.object({
      canalId: z.number(),
      status: z.enum(["upcoming", "recurring", "past", "cancelled", "unconfirmed"]).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return [];

      try {
        const client = await getCalcomClientFromCanal(input.canalId, esc.escritorio.id);
        return client.listarBookings({ status: input.status });
      } catch {
        return [];
      }
    }),
});

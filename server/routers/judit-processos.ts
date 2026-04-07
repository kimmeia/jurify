/**
 * Router — Judit Processos (Créditos por escritório)
 *
 * Sistema de créditos pré-pagos para consultas processuais via Judit.IO.
 * Cada operação consome créditos: consulta CNJ, monitoramento, etc.
 */

import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { juditCreditos, juditTransacoes } from "../../drizzle/schema";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";

// ─── Constantes ──────────────────────────────────────────────────────────────

const PACOTES_CREDITOS = [
  { id: "pack_50", nome: "50 creditos", creditos: 50, preco: 49.9, popular: false },
  { id: "pack_200", nome: "200 creditos", creditos: 200, preco: 149.9, popular: true },
  { id: "pack_500", nome: "500 creditos", creditos: 500, preco: 299.9, popular: false },
  { id: "pack_1000", nome: "1000 creditos", creditos: 1000, preco: 499.9, popular: false },
] as const;

const CUSTOS_OPERACOES = {
  consulta_cnj: 1,
  consulta_historica: 5,
  consulta_sintetica: 2,
  monitorar_processo: 5,
  monitorar_pessoa: 50,
  resumo_ia: 1,
  anexos: 10,
} as const;

const PACOTE_QUANTIDADES: Record<string, number> = {
  pack_50: 50,
  pack_200: 200,
  pack_500: 500,
  pack_1000: 1000,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getJuditClientOrThrow() {
  const { getJuditClient } = await import("../integracoes/judit-webhook");
  const client = await getJuditClient();
  if (!client) throw new Error("Judit não configurada. Peça ao administrador.");
  return client;
}

async function consumirCreditos(
  escritorioId: number,
  userId: number,
  custo: number,
  operacao: string,
  detalhes: string,
) {
  const db = await getDb();
  if (!db) throw new Error("DB indisponível");
  const [cr] = await db
    .select()
    .from(juditCreditos)
    .where(eq(juditCreditos.escritorioId, escritorioId))
    .limit(1);
  const saldo = cr?.saldo ?? 0;
  if (saldo < custo) {
    throw new Error(`Créditos insuficientes. Necessário: ${custo}, disponível: ${saldo}.`);
  }
  await db
    .update(juditCreditos)
    .set({ saldo: saldo - custo, totalConsumido: (cr?.totalConsumido || 0) + custo })
    .where(eq(juditCreditos.escritorioId, escritorioId));
  await db.insert(juditTransacoes).values({
    escritorioId,
    tipo: "consumo",
    quantidade: custo,
    saldoAnterior: saldo,
    saldoDepois: saldo - custo,
    operacao,
    detalhes,
    userId,
  });
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const juditProcessosRouter = router({
  saldo: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    const baseResponse = {
      saldo: 0,
      totalComprado: 0,
      totalConsumido: 0,
      pacotes: PACOTES_CREDITOS,
      custos: CUSTOS_OPERACOES,
    };
    if (!esc) return baseResponse;
    const db = await getDb();
    if (!db) return baseResponse;
    try {
      const [row] = await db
        .select()
        .from(juditCreditos)
        .where(eq(juditCreditos.escritorioId, esc.escritorio.id))
        .limit(1);
      return {
        saldo: row?.saldo ?? 0,
        totalComprado: row?.totalComprado ?? 0,
        totalConsumido: row?.totalConsumido ?? 0,
        pacotes: PACOTES_CREDITOS,
        custos: CUSTOS_OPERACOES,
      };
    } catch {
      return baseResponse;
    }
  }),

  transacoes: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return [];
      const db = await getDb();
      if (!db) return [];
      try {
        return await db
          .select()
          .from(juditTransacoes)
          .where(eq(juditTransacoes.escritorioId, esc.escritorio.id))
          .orderBy(desc(juditTransacoes.createdAt))
          .limit(input?.limit ?? 50);
      } catch {
        return [];
      }
    }),

  adicionarCreditos: protectedProcedure
    .input(z.object({ pacoteId: z.string().optional(), quantidade: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      const db = await getDb();
      if (!db) throw new Error("DB indisponível");
      const qty = input.pacoteId ? PACOTE_QUANTIDADES[input.pacoteId] || 0 : input.quantidade || 0;
      if (qty <= 0) throw new Error("Quantidade inválida");

      const [row] = await db
        .select()
        .from(juditCreditos)
        .where(eq(juditCreditos.escritorioId, esc.escritorio.id))
        .limit(1);
      const saldoAtual = row?.saldo ?? 0;
      const novoSaldo = saldoAtual + qty;

      if (row) {
        await db
          .update(juditCreditos)
          .set({ saldo: novoSaldo, totalComprado: (row.totalComprado || 0) + qty })
          .where(eq(juditCreditos.escritorioId, esc.escritorio.id));
      } else {
        await db
          .insert(juditCreditos)
          .values({ escritorioId: esc.escritorio.id, saldo: qty, totalComprado: qty, totalConsumido: 0 });
      }

      await db.insert(juditTransacoes).values({
        escritorioId: esc.escritorio.id,
        tipo: "compra",
        quantidade: qty,
        saldoAnterior: saldoAtual,
        saldoDepois: novoSaldo,
        operacao: input.pacoteId || "manual",
        detalhes: `+${qty} créditos`,
        userId: ctx.user.id,
      });
      return { novoSaldo, adicionados: qty };
    }),

  consultarCNJ: protectedProcedure
    .input(z.object({ cnj: z.string().min(15).max(30) }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      const client = await getJuditClientOrThrow();
      await consumirCreditos(esc.escritorio.id, ctx.user.id, CUSTOS_OPERACOES.consulta_cnj, "consulta_cnj", `CNJ: ${input.cnj}`);
      const request = await client.criarRequest({
        search: { search_type: "lawsuit_cnj", search_key: input.cnj.replace(/[^\d.-]/g, "") },
      });
      return { requestId: request.request_id, status: request.status };
    }),

  consultarDocumento: protectedProcedure
    .input(z.object({ tipo: z.enum(["cpf", "cnpj", "oab", "name"]), valor: z.string().min(3).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      const client = await getJuditClientOrThrow();
      await consumirCreditos(
        esc.escritorio.id,
        ctx.user.id,
        CUSTOS_OPERACOES.consulta_historica,
        "consulta_historica",
        `${input.tipo.toUpperCase()}: ${input.valor}`,
      );
      const searchKey = input.tipo === "cpf" || input.tipo === "cnpj" ? input.valor.replace(/\D/g, "") : input.valor;
      const request = await client.criarRequest({ search: { search_type: input.tipo, search_key: searchKey } });
      return { requestId: request.request_id, status: request.status };
    }),

  statusConsulta: protectedProcedure
    .input(z.object({ requestId: z.string() }))
    .query(async ({ input }) => {
      const client = await getJuditClientOrThrow();
      const status = await client.consultarRequest(input.requestId);
      return { status: status.status, requestId: status.request_id, updatedAt: status.updated_at };
    }),

  resultados: protectedProcedure
    .input(z.object({ requestId: z.string(), page: z.number().optional() }))
    .query(async ({ input }) => {
      const client = await getJuditClientOrThrow();
      return await client.buscarRespostas(input.requestId, input.page ?? 1, 20);
    }),

  monitorarProcesso: protectedProcedure
    .input(z.object({ cnj: z.string().min(15).max(30) }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      const client = await getJuditClientOrThrow();
      await consumirCreditos(
        esc.escritorio.id,
        ctx.user.id,
        CUSTOS_OPERACOES.monitorar_processo,
        "monitorar_processo",
        `Monitorar CNJ: ${input.cnj}`,
      );
      const tracking = await client.criarMonitoramento({
        recurrence: 1,
        search: { search_type: "lawsuit_cnj", search_key: input.cnj.replace(/[^\d.-]/g, "") },
      });
      return { trackingId: tracking.tracking_id, status: tracking.status };
    }),

  monitorarPessoa: protectedProcedure
    .input(z.object({ tipo: z.enum(["cpf", "cnpj", "oab", "name"]), valor: z.string().min(3).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      const client = await getJuditClientOrThrow();
      await consumirCreditos(
        esc.escritorio.id,
        ctx.user.id,
        CUSTOS_OPERACOES.monitorar_pessoa,
        "monitorar_pessoa",
        `Monitorar ${input.tipo.toUpperCase()}: ${input.valor}`,
      );
      const searchKey = input.tipo === "cpf" || input.tipo === "cnpj" ? input.valor.replace(/\D/g, "") : input.valor;
      const tracking = await client.criarMonitoramento({
        recurrence: 1,
        search: { search_type: input.tipo, search_key: searchKey },
      });
      return { trackingId: tracking.tracking_id, status: tracking.status };
    }),

  listarMonitoramentos: protectedProcedure
    .input(z.object({ page: z.number().optional(), tipo: z.string().optional() }).optional())
    .query(async ({ input }) => {
      try {
        const { getJuditClient } = await import("../integracoes/judit-webhook");
        const client = await getJuditClient();
        if (!client) return { monitoramentos: [], total: 0 };
        const res = await client.listarMonitoramentos(input?.page ?? 1, 20, undefined, input?.tipo);
        return { monitoramentos: res.page_data, total: res.all_count, pages: res.all_pages_count };
      } catch {
        return { monitoramentos: [], total: 0 };
      }
    }),

  pausarMonitoramento: protectedProcedure
    .input(z.object({ trackingId: z.string() }))
    .mutation(async ({ input }) => {
      const client = await getJuditClientOrThrow();
      await client.pausarMonitoramento(input.trackingId);
      return { success: true };
    }),

  reativarMonitoramento: protectedProcedure
    .input(z.object({ trackingId: z.string() }))
    .mutation(async ({ input }) => {
      const client = await getJuditClientOrThrow();
      await client.reativarMonitoramento(input.trackingId);
      return { success: true };
    }),

  deletarMonitoramento: protectedProcedure
    .input(z.object({ trackingId: z.string() }))
    .mutation(async ({ input }) => {
      const client = await getJuditClientOrThrow();
      await client.deletarMonitoramento(input.trackingId);
      return { success: true };
    }),

  historicoMonitoramento: protectedProcedure
    .input(z.object({ trackingId: z.string(), page: z.number().optional() }))
    .query(async ({ input }) => {
      try {
        const { getJuditClient } = await import("../integracoes/judit-webhook");
        const client = await getJuditClient();
        if (!client) return null;
        return await client.buscarRespostasTracking(input.trackingId, input.page ?? 1, 20);
      } catch {
        return null;
      }
    }),
});

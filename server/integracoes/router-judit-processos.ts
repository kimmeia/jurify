/**
 * Router tRPC — Processos Judit (com sistema de créditos)
 *
 * Substitui DataJud como fonte primária. Cada operação consome créditos.
 * Créditos são por escritório, não por usuário.
 *
 * Custos em créditos:
 * - Consulta por CNJ: 1 crédito
 * - Consulta por CPF/CNPJ/OAB/Nome (histórica): 5 créditos
 * - Consulta sintética (contador): 2 créditos
 * - Monitorar processo (CNJ): 5 créditos/mês
 * - Monitorar pessoa (CPF/CNPJ): 50 créditos/mês
 * - Resumo IA: 1 crédito
 * - Baixar anexos: 10 créditos
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { juditCreditos, juditTransacoes } from "../../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { getJuditClient } from "./judit-webhook";
import { TRPCError } from "@trpc/server";

// ═══════════════════════════════════════════════════════════════════════════════
// PACOTES DE CRÉDITOS
// ═══════════════════════════════════════════════════════════════════════════════

const PACOTES = [
  { id: "pack_50", nome: "50 créditos", creditos: 50, preco: 49.90, popular: false },
  { id: "pack_200", nome: "200 créditos", creditos: 200, preco: 149.90, popular: true },
  { id: "pack_500", nome: "500 créditos", creditos: 500, preco: 299.90, popular: false },
  { id: "pack_1000", nome: "1.000 créditos", creditos: 1000, preco: 499.90, popular: false },
];

const CUSTO_OPERACAO: Record<string, number> = {
  consulta_cnj: 1,
  consulta_historica: 5,
  consulta_sintetica: 2,
  monitorar_processo: 5,
  monitorar_pessoa: 50,
  resumo_ia: 1,
  anexos: 10,
};

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

async function getSaldo(escritorioId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db.select().from(juditCreditos)
    .where(eq(juditCreditos.escritorioId, escritorioId)).limit(1);
  return row?.saldo ?? 0;
}

async function consumirCreditos(
  escritorioId: number,
  userId: number,
  quantidade: number,
  operacao: string,
  detalhes?: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

  const [row] = await db.select().from(juditCreditos)
    .where(eq(juditCreditos.escritorioId, escritorioId)).limit(1);

  const saldoAtual = row?.saldo ?? 0;
  if (saldoAtual < quantidade) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Créditos insuficientes. Necessário: ${quantidade}, disponível: ${saldoAtual}. Compre mais créditos.`,
    });
  }

  const novoSaldo = saldoAtual - quantidade;

  if (row) {
    await db.update(juditCreditos)
      .set({ saldo: novoSaldo, totalConsumido: (row.totalConsumido || 0) + quantidade })
      .where(eq(juditCreditos.escritorioId, escritorioId));
  }

  await db.insert(juditTransacoes).values({
    escritorioId,
    tipo: "consumo",
    quantidade,
    saldoAnterior: saldoAtual,
    saldoDepois: novoSaldo,
    operacao,
    detalhes: detalhes || null,
    userId,
  });
}

async function adicionarCreditos(
  escritorioId: number,
  userId: number,
  quantidade: number,
  tipo: "compra" | "bonus" | "estorno",
  operacao: string,
  detalhes?: string
): Promise<number> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

  const [row] = await db.select().from(juditCreditos)
    .where(eq(juditCreditos.escritorioId, escritorioId)).limit(1);

  const saldoAtual = row?.saldo ?? 0;
  const novoSaldo = saldoAtual + quantidade;

  if (row) {
    await db.update(juditCreditos)
      .set({ saldo: novoSaldo, totalComprado: (row.totalComprado || 0) + quantidade })
      .where(eq(juditCreditos.escritorioId, escritorioId));
  } else {
    await db.insert(juditCreditos).values({
      escritorioId,
      saldo: quantidade,
      totalComprado: quantidade,
      totalConsumido: 0,
    });
  }

  await db.insert(juditTransacoes).values({
    escritorioId,
    tipo,
    quantidade,
    saldoAnterior: saldoAtual,
    saldoDepois: novoSaldo,
    operacao,
    detalhes: detalhes || null,
    userId,
  });

  return novoSaldo;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTER
// ═══════════════════════════════════════════════════════════════════════════════

export const juditProcessosRouter = router({
  // ─── CRÉDITOS ────────────────────────────────────────────────────────────

  /** Saldo de créditos do escritório */
  saldo: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return { saldo: 0, totalComprado: 0, totalConsumido: 0, pacotes: PACOTES, custos: CUSTO_OPERACAO };

    const db = await getDb();
    if (!db) return { saldo: 0, totalComprado: 0, totalConsumido: 0, pacotes: PACOTES, custos: CUSTO_OPERACAO };

    const [row] = await db.select().from(juditCreditos)
      .where(eq(juditCreditos.escritorioId, esc.escritorio.id)).limit(1);

    return {
      saldo: row?.saldo ?? 0,
      totalComprado: row?.totalComprado ?? 0,
      totalConsumido: row?.totalConsumido ?? 0,
      pacotes: PACOTES,
      custos: CUSTO_OPERACAO,
    };
  }),

  /** Histórico de transações */
  transacoes: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return [];
      const db = await getDb();
      if (!db) return [];

      return db.select().from(juditTransacoes)
        .where(eq(juditTransacoes.escritorioId, esc.escritorio.id))
        .orderBy(desc(juditTransacoes.createdAt))
        .limit(input?.limit ?? 50);
    }),

  /** Adicionar créditos (por enquanto via admin, futuro: Stripe) */
  adicionarCreditos: protectedProcedure
    .input(z.object({ pacoteId: z.string().optional(), quantidade: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Escritório não encontrado." });

      let qty = input.quantidade || 0;
      let op = "compra_manual";

      if (input.pacoteId) {
        const pacote = PACOTES.find(p => p.id === input.pacoteId);
        if (!pacote) throw new TRPCError({ code: "BAD_REQUEST", message: "Pacote não encontrado." });
        qty = pacote.creditos;
        op = `compra_${pacote.id}`;
      }

      if (qty <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Quantidade inválida." });

      const novoSaldo = await adicionarCreditos(
        esc.escritorio.id, ctx.user.id, qty, "compra", op, `+${qty} créditos`
      );

      return { novoSaldo, adicionados: qty };
    }),

  // ─── CONSULTAS ──────────────────────────────────────────────────────────

  /** Consulta por CNJ — 1 crédito */
  consultarCNJ: protectedProcedure
    .input(z.object({ cnj: z.string().min(15).max(30) }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "PRECONDITION_FAILED" });

      const client = await getJuditClient();
      if (!client) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Judit não configurada. Peça ao administrador." });

      // Consumir crédito
      await consumirCreditos(esc.escritorio.id, ctx.user.id, CUSTO_OPERACAO.consulta_cnj, "consulta_cnj", `CNJ: ${input.cnj}`);

      // Criar request na Judit
      const request = await client.criarRequest({
        search: { search_type: "lawsuit_cnj", search_key: input.cnj.replace(/[^\d.-]/g, "") },
      });

      return { requestId: request.request_id, status: request.status };
    }),

  /** Consulta por CPF/CNPJ/OAB/Nome — 5 créditos */
  consultarDocumento: protectedProcedure
    .input(z.object({
      tipo: z.enum(["cpf", "cnpj", "oab", "name"]),
      valor: z.string().min(3).max(100),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "PRECONDITION_FAILED" });

      const client = await getJuditClient();
      if (!client) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Judit não configurada." });

      await consumirCreditos(esc.escritorio.id, ctx.user.id, CUSTO_OPERACAO.consulta_historica, "consulta_historica", `${input.tipo.toUpperCase()}: ${input.valor}`);

      const searchKey = input.tipo === "cpf" || input.tipo === "cnpj"
        ? input.valor.replace(/\D/g, "")
        : input.valor;

      const request = await client.criarRequest({
        search: { search_type: input.tipo, search_key: searchKey },
      });

      return { requestId: request.request_id, status: request.status };
    }),

  /** Verificar status de uma consulta */
  statusConsulta: protectedProcedure
    .input(z.object({ requestId: z.string() }))
    .query(async ({ ctx, input }) => {
      const client = await getJuditClient();
      if (!client) throw new TRPCError({ code: "PRECONDITION_FAILED" });

      const status = await client.consultarRequest(input.requestId);
      return { status: status.status, requestId: status.request_id, updatedAt: status.updated_at };
    }),

  /** Buscar resultados de uma consulta */
  resultados: protectedProcedure
    .input(z.object({ requestId: z.string(), page: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      const client = await getJuditClient();
      if (!client) throw new TRPCError({ code: "PRECONDITION_FAILED" });

      const res = await client.buscarRespostas(input.requestId, input.page ?? 1, 20);
      return res;
    }),

  // ─── MONITORAMENTO ──────────────────────────────────────────────────────

  /** Criar monitoramento de processo (CNJ) — 5 créditos */
  monitorarProcesso: protectedProcedure
    .input(z.object({
      cnj: z.string().min(15).max(30),
      recorrencia: z.number().min(1).max(30).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "PRECONDITION_FAILED" });

      const client = await getJuditClient();
      if (!client) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Judit não configurada." });

      await consumirCreditos(esc.escritorio.id, ctx.user.id, CUSTO_OPERACAO.monitorar_processo, "monitorar_processo", `Monitorar CNJ: ${input.cnj}`);

      const webhookUrl = process.env.BASE_URL
        ? `${process.env.BASE_URL}/api/webhooks/judit`
        : undefined;

      const tracking = await client.criarMonitoramento({
        recurrence: input.recorrencia ?? 1,
        search: { search_type: "lawsuit_cnj", search_key: input.cnj.replace(/[^\d.-]/g, "") },
        callback_url: webhookUrl,
      });

      return { trackingId: tracking.tracking_id, status: tracking.status };
    }),

  /** Monitorar pessoa/empresa (CPF/CNPJ) — 50 créditos */
  monitorarPessoa: protectedProcedure
    .input(z.object({
      tipo: z.enum(["cpf", "cnpj", "oab", "name"]),
      valor: z.string().min(3).max(100),
      recorrencia: z.number().min(1).max(30).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "PRECONDITION_FAILED" });

      const client = await getJuditClient();
      if (!client) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Judit não configurada." });

      await consumirCreditos(esc.escritorio.id, ctx.user.id, CUSTO_OPERACAO.monitorar_pessoa, "monitorar_pessoa", `Monitorar ${input.tipo.toUpperCase()}: ${input.valor}`);

      const searchKey = input.tipo === "cpf" || input.tipo === "cnpj"
        ? input.valor.replace(/\D/g, "")
        : input.valor;

      const webhookUrl = process.env.BASE_URL
        ? `${process.env.BASE_URL}/api/webhooks/judit`
        : undefined;

      const tracking = await client.criarMonitoramento({
        recurrence: input.recorrencia ?? 1,
        search: { search_type: input.tipo, search_key: searchKey },
        callback_url: webhookUrl,
      });

      return { trackingId: tracking.tracking_id, status: tracking.status };
    }),

  /** Listar monitoramentos ativos */
  listarMonitoramentos: protectedProcedure
    .input(z.object({ page: z.number().optional(), tipo: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const client = await getJuditClient();
      if (!client) return { monitoramentos: [], total: 0 };

      try {
        const res = await client.listarMonitoramentos(
          input?.page ?? 1,
          20,
          undefined,
          input?.tipo
        );
        return {
          monitoramentos: res.page_data,
          total: res.all_count,
          pages: res.all_pages_count,
        };
      } catch {
        return { monitoramentos: [], total: 0 };
      }
    }),

  /** Pausar monitoramento */
  pausarMonitoramento: protectedProcedure
    .input(z.object({ trackingId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const client = await getJuditClient();
      if (!client) throw new TRPCError({ code: "PRECONDITION_FAILED" });
      await client.pausarMonitoramento(input.trackingId);
      return { success: true };
    }),

  /** Reativar monitoramento */
  reativarMonitoramento: protectedProcedure
    .input(z.object({ trackingId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const client = await getJuditClient();
      if (!client) throw new TRPCError({ code: "PRECONDITION_FAILED" });
      await client.reativarMonitoramento(input.trackingId);
      return { success: true };
    }),

  /** Deletar monitoramento */
  deletarMonitoramento: protectedProcedure
    .input(z.object({ trackingId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const client = await getJuditClient();
      if (!client) throw new TRPCError({ code: "PRECONDITION_FAILED" });
      await client.deletarMonitoramento(input.trackingId);
      return { success: true };
    }),

  /** Buscar histórico de movimentações de um monitoramento */
  historicoMonitoramento: protectedProcedure
    .input(z.object({ trackingId: z.string(), page: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      const client = await getJuditClient();
      if (!client) throw new TRPCError({ code: "PRECONDITION_FAILED" });

      try {
        const res = await client.buscarRespostasTracking(input.trackingId, input.page ?? 1, 20);
        return res;
      } catch {
        return null;
      }
    }),
});

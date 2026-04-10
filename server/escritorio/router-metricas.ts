/**
 * Router Métricas — KPIs de produção do escritório.
 * Duas visões: Comercial (vendas) e Operacional (jurídico).
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getEscritorioPorUsuario } from "./db-escritorio";
import { getDb } from "../db";
import {
  conversas, leads, contatos, kanbanCards, kanbanColunas, kanbanFunis,
  kanbanMovimentacoes, mensagens,
} from "../../drizzle/schema";
import { eq, and, sql, gte, lte, desc, count } from "drizzle-orm";

export const metricasRouter = router({
  /** Métricas comerciais — atendimento e vendas */
  comercial: protectedProcedure
    .input(z.object({ dias: z.number().min(1).max(365).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return null;
      const db = await getDb();
      if (!db) return null;

      const dias = input?.dias || 30;
      const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
      const escId = esc.escritorio.id;

      // Leads atendidos no período
      const [leadsTotal] = await db
        .select({ total: sql<number>`COUNT(*)` })
        .from(leads)
        .where(and(eq(leads.escritorioId, escId), gte(leads.createdAt, desde)));

      // Leads ganhos (fechados)
      const [leadsGanhos] = await db
        .select({ total: sql<number>`COUNT(*)` })
        .from(leads)
        .where(and(eq(leads.escritorioId, escId), eq(leads.etapaFunil, "fechado_ganho"), gte(leads.createdAt, desde)));

      // Leads perdidos
      const [leadsPerdidos] = await db
        .select({ total: sql<number>`COUNT(*)` })
        .from(leads)
        .where(and(eq(leads.escritorioId, escId), eq(leads.etapaFunil, "fechado_perdido"), gte(leads.createdAt, desde)));

      // Valor estimado dos leads ganhos
      const [valorGanho] = await db
        .select({ total: sql<number>`COALESCE(SUM(CAST(${leads.valorEstimado} AS DECIMAL)), 0)` })
        .from(leads)
        .where(and(eq(leads.escritorioId, escId), eq(leads.etapaFunil, "fechado_ganho"), gte(leads.createdAt, desde)));

      // Conversas atendidas no período
      const [conversasTotal] = await db
        .select({ total: sql<number>`COUNT(*)` })
        .from(conversas)
        .where(and(eq(conversas.escritorioId, escId), gte(conversas.createdAt, desde)));

      // Conversas resolvidas
      const [conversasResolvidas] = await db
        .select({ total: sql<number>`COUNT(*)` })
        .from(conversas)
        .where(and(eq(conversas.escritorioId, escId), eq(conversas.status, "resolvido"), gte(conversas.createdAt, desde)));

      // Taxa de conversão
      const totalLeads = Number(leadsTotal?.total || 0);
      const totalGanhos = Number(leadsGanhos?.total || 0);
      const taxaConversao = totalLeads > 0 ? Math.round((totalGanhos / totalLeads) * 100) : 0;

      return {
        periodo: dias,
        leadsAtendidos: totalLeads,
        leadsGanhos: totalGanhos,
        leadsPerdidos: Number(leadsPerdidos?.total || 0),
        valorGanho: Number(valorGanho?.total || 0),
        conversasAtendidas: Number(conversasTotal?.total || 0),
        conversasResolvidas: Number(conversasResolvidas?.total || 0),
        taxaConversao,
      };
    }),

  /** Métricas operacionais — produção jurídica via Kanban */
  operacional: protectedProcedure
    .input(z.object({ funilId: z.number().optional(), dias: z.number().min(1).max(365).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return null;
      const db = await getDb();
      if (!db) return null;

      const dias = input?.dias || 30;
      const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
      const escId = esc.escritorio.id;

      // Total de cards no período
      const conditions: any[] = [eq(kanbanCards.escritorioId, escId), gte(kanbanCards.createdAt, desde)];

      const [cardsTotal] = await db
        .select({ total: sql<number>`COUNT(*)` })
        .from(kanbanCards)
        .where(and(...conditions));

      // Cards atrasados
      const [cardsAtrasados] = await db
        .select({ total: sql<number>`COUNT(*)` })
        .from(kanbanCards)
        .where(and(eq(kanbanCards.escritorioId, escId), eq(kanbanCards.atrasado, true)));

      // Cards dentro do prazo (não atrasados com prazo futuro ou sem prazo)
      const [cardsDentroPrazo] = await db
        .select({ total: sql<number>`COUNT(*)` })
        .from(kanbanCards)
        .where(and(eq(kanbanCards.escritorioId, escId), eq(kanbanCards.atrasado, false), gte(kanbanCards.createdAt, desde)));

      // Movimentações no período (entradas dadas = cards movidos da 1ª coluna)
      const [movsTotal] = await db
        .select({ total: sql<number>`COUNT(*)` })
        .from(kanbanMovimentacoes)
        .where(gte(kanbanMovimentacoes.createdAt, desde));

      // Cards por coluna (distribuição atual)
      const cardsPorColuna = await db
        .select({
          colunaNome: kanbanColunas.nome,
          colunaId: kanbanColunas.id,
          total: sql<number>`COUNT(${kanbanCards.id})`,
        })
        .from(kanbanCards)
        .innerJoin(kanbanColunas, eq(kanbanCards.colunaId, kanbanColunas.id))
        .where(eq(kanbanCards.escritorioId, escId))
        .groupBy(kanbanColunas.id, kanbanColunas.nome);

      return {
        periodo: dias,
        cardsTotal: Number(cardsTotal?.total || 0),
        cardsAtrasados: Number(cardsAtrasados?.total || 0),
        cardsDentroPrazo: Number(cardsDentroPrazo?.total || 0),
        movimentacoes: Number(movsTotal?.total || 0),
        cardsPorColuna: cardsPorColuna.map((c) => ({ coluna: c.colunaNome, total: Number(c.total) })),
        taxaDentroPrazo: Number(cardsTotal?.total || 0) > 0
          ? Math.round((Number(cardsDentroPrazo?.total || 0) / Number(cardsTotal?.total || 0)) * 100)
          : 100,
      };
    }),
});

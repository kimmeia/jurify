/**
 * Router Relatórios — KPIs + Análises do escritório.
 *
 * Consolidação de Métricas + Relatórios (antes eram 2 módulos separados
 * com funções sobrepostas). Agora 4 endpoints com filtro de período:
 *
 * - atendimento: conversas + mensagens (Operacional antigo de Relatórios)
 * - comercial: leads + funil + origem + taxa de conversão
 * - producao: Kanban — cards, atrasados, movimentações (Operacional de Métricas)
 * - calculos: histórico de cálculos do usuário (Financeiro antigo)
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { getDb } from "../db";
import {
  conversas, mensagens, leads, contatos, calculosHistorico,
  kanbanCards, kanbanColunas, kanbanMovimentacoes,
} from "../../drizzle/schema";
import { eq, and, sql, gte } from "drizzle-orm";

const PeriodoInput = z
  .object({ dias: z.number().min(1).max(365).optional() })
  .optional();

const ProducaoInput = z
  .object({
    dias: z.number().min(1).max(365).optional(),
    /** Se presente, filtra os KPIs de Produção ao funil escolhido.
     *  Ausente/null = todos os funis do escritório. */
    funilId: z.number().optional(),
  })
  .optional();

function desdeDias(dias: number): Date {
  return new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
}

export const relatoriosRouter = router({
  /** Atendimento — conversas e mensagens */
  atendimento: protectedProcedure.input(PeriodoInput).query(async ({ ctx, input }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return null;
    const db = await getDb();
    if (!db) return null;
    const eid = esc.escritorio.id;
    const dias = input?.dias || 30;
    const desde = desdeDias(dias);

    const statusRows = await db
      .select({ status: conversas.status, total: sql<number>`COUNT(*)` })
      .from(conversas)
      .where(and(eq(conversas.escritorioId, eid), gte(conversas.createdAt, desde)))
      .groupBy(conversas.status);

    const msgRows = await db
      .select({ direcao: mensagens.direcao, total: sql<number>`COUNT(*)` })
      .from(mensagens)
      .innerJoin(conversas, eq(mensagens.conversaId, conversas.id))
      .where(and(eq(conversas.escritorioId, eid), gte(mensagens.createdAt, desde)))
      .groupBy(mensagens.direcao);

    const convsPorDia = await db
      .select({ dia: sql<string>`DATE(createdAtConv)`, total: sql<number>`COUNT(*)` })
      .from(conversas)
      .where(and(eq(conversas.escritorioId, eid), gte(conversas.createdAt, desde)))
      .groupBy(sql`DATE(createdAtConv)`)
      .orderBy(sql`DATE(createdAtConv)`);

    const msgsPorDia = await db
      .select({ dia: sql<string>`DATE(createdAtMsg)`, total: sql<number>`COUNT(*)` })
      .from(mensagens)
      .innerJoin(conversas, eq(mensagens.conversaId, conversas.id))
      .where(and(eq(conversas.escritorioId, eid), gte(mensagens.createdAt, desde)))
      .groupBy(sql`DATE(createdAtMsg)`)
      .orderBy(sql`DATE(createdAtMsg)`);

    const conversasPorStatus: Record<string, number> = {};
    for (const r of statusRows) conversasPorStatus[r.status as string] = Number(r.total);

    const msgsDirecao: Record<string, number> = {};
    for (const r of msgRows) msgsDirecao[r.direcao as string] = Number(r.total);

    return {
      periodo: dias,
      conversasPorStatus,
      totalConversas: Object.values(conversasPorStatus).reduce((a, b) => a + b, 0),
      mensagensEnviadas: msgsDirecao["saida"] || 0,
      mensagensRecebidas: msgsDirecao["entrada"] || 0,
      totalMensagens: (msgsDirecao["saida"] || 0) + (msgsDirecao["entrada"] || 0),
      conversasPorDia: convsPorDia.map((r) => ({ dia: String(r.dia), total: Number(r.total) })),
      mensagensPorDia: msgsPorDia.map((r) => ({ dia: String(r.dia), total: Number(r.total) })),
    };
  }),

  /** Comercial — leads, funil, origem e taxa de conversão (consolidado) */
  comercial: protectedProcedure.input(PeriodoInput).query(async ({ ctx, input }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return null;
    const db = await getDb();
    if (!db) return null;
    const eid = esc.escritorio.id;
    const dias = input?.dias || 30;
    const desde = desdeDias(dias);

    // Etapas do funil (com valor estimado)
    const etapaRows = await db
      .select({
        etapa: leads.etapaFunil,
        total: sql<number>`COUNT(*)`,
        valor: sql<number>`COALESCE(SUM(CAST(valorEstimado AS DECIMAL(14,2))), 0)`,
      })
      .from(leads)
      .where(and(eq(leads.escritorioId, eid), gte(leads.createdAt, desde)))
      .groupBy(leads.etapaFunil);

    // Leads por mês (6m — histórico sempre útil independente do filtro de curto prazo)
    const leadsPorMes = await db
      .select({
        mes: sql<string>`DATE_FORMAT(createdAtLead,'%Y-%m')`,
        total: sql<number>`COUNT(*)`,
      })
      .from(leads)
      .where(
        and(
          eq(leads.escritorioId, eid),
          sql`createdAtLead >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)`,
        ),
      )
      .groupBy(sql`DATE_FORMAT(createdAtLead,'%Y-%m')`)
      .orderBy(sql`DATE_FORMAT(createdAtLead,'%Y-%m')`);

    // Contatos por origem (histórico completo)
    const origemRows = await db
      .select({ origem: contatos.origem, total: sql<number>`COUNT(*)` })
      .from(contatos)
      .where(eq(contatos.escritorioId, eid))
      .groupBy(contatos.origem);

    // Conversas atendidas no período
    const [conversasTotal] = await db
      .select({ total: sql<number>`COUNT(*)` })
      .from(conversas)
      .where(and(eq(conversas.escritorioId, eid), gte(conversas.createdAt, desde)));

    const etapas: Record<string, { total: number; valor: number }> = {};
    for (const r of etapaRows) {
      etapas[r.etapa as string] = { total: Number(r.total), valor: Number(r.valor) };
    }
    const totalLeads = Object.values(etapas).reduce((a, b) => a + b.total, 0);
    const leadsGanhos = etapas["fechado_ganho"]?.total || 0;
    const leadsPerdidos = etapas["fechado_perdido"]?.total || 0;
    const taxaConversao =
      totalLeads > 0 ? parseFloat(((leadsGanhos / totalLeads) * 100).toFixed(1)) : 0;
    const valorPipeline = Object.entries(etapas)
      .filter(([k]) => !["fechado_ganho", "fechado_perdido"].includes(k))
      .reduce((a, [, v]) => a + v.valor, 0);
    const valorGanho = etapas["fechado_ganho"]?.valor || 0;

    return {
      periodo: dias,
      // KPIs
      conversasAtendidas: Number(conversasTotal?.total || 0),
      totalLeads,
      leadsGanhos,
      leadsPerdidos,
      taxaConversao,
      valorGanho,
      valorPipeline,
      // Detalhes
      etapas,
      leadsPorMes: leadsPorMes.map((r) => ({ mes: String(r.mes), total: Number(r.total) })),
      contatosPorOrigem: origemRows.map((r) => ({
        origem: r.origem as string,
        total: Number(r.total),
      })),
    };
  }),

  /** Produção — Kanban, cards, atrasados, movimentações.
   *  Aceita filtro opcional por `funilId` (ou todos os funis do escritório).
   */
  producao: protectedProcedure.input(ProducaoInput).query(async ({ ctx, input }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return null;
    const db = await getDb();
    if (!db) return null;
    const eid = esc.escritorio.id;
    const dias = input?.dias || 30;
    const desde = desdeDias(dias);
    const funilId = input?.funilId;

    // ── Helpers ─────────────────────────────────────────────────────────────
    // Quando há filtro de funil, todos os counts de cards precisam fazer
    // JOIN com kanbanColunas (pois o funilId mora na coluna, não no card).

    const cardsBase = (extraWhere: any) => {
      const conditions = [eq(kanbanCards.escritorioId, eid), extraWhere];
      const q = db
        .select({ total: sql<number>`COUNT(${kanbanCards.id})` })
        .from(kanbanCards);
      if (funilId !== undefined) {
        return q
          .innerJoin(kanbanColunas, eq(kanbanCards.colunaId, kanbanColunas.id))
          .where(and(...conditions, eq(kanbanColunas.funilId, funilId)));
      }
      return q.where(and(...conditions));
    };

    const [cardsTotal] = await cardsBase(gte(kanbanCards.createdAt, desde));
    const [cardsAtrasados] = await cardsBase(eq(kanbanCards.atrasado, true));
    const [cardsDentroPrazo] = await cardsBase(
      and(eq(kanbanCards.atrasado, false), gte(kanbanCards.createdAt, desde)),
    );

    // ── Movimentações ──────────────────────────────────────────────────────
    // IMPORTANTE: antes a query não filtrava por escritório, contando movs
    // de todos os escritórios do sistema. Agora SEMPRE faz JOIN com card +
    // coluna para garantir isolamento (e aplicar filtro de funil quando vier).
    const movsQuery = db
      .select({ total: sql<number>`COUNT(${kanbanMovimentacoes.id})` })
      .from(kanbanMovimentacoes)
      .innerJoin(kanbanCards, eq(kanbanMovimentacoes.cardId, kanbanCards.id))
      .innerJoin(kanbanColunas, eq(kanbanCards.colunaId, kanbanColunas.id));

    const movsConditions = [
      gte(kanbanMovimentacoes.createdAt, desde),
      eq(kanbanCards.escritorioId, eid),
    ];
    if (funilId !== undefined) movsConditions.push(eq(kanbanColunas.funilId, funilId));
    const [movsTotal] = await movsQuery.where(and(...movsConditions));

    // ── Distribuição por etapa (coluna) ────────────────────────────────────
    const colunasConditions = [eq(kanbanCards.escritorioId, eid)];
    if (funilId !== undefined) colunasConditions.push(eq(kanbanColunas.funilId, funilId));
    const cardsPorColuna = await db
      .select({
        colunaNome: kanbanColunas.nome,
        total: sql<number>`COUNT(${kanbanCards.id})`,
      })
      .from(kanbanCards)
      .innerJoin(kanbanColunas, eq(kanbanCards.colunaId, kanbanColunas.id))
      .where(and(...colunasConditions))
      .groupBy(kanbanColunas.id, kanbanColunas.nome);

    const total = Number(cardsTotal?.total || 0);
    const dentro = Number(cardsDentroPrazo?.total || 0);

    return {
      periodo: dias,
      funilId: funilId ?? null,
      cardsTotal: total,
      cardsAtrasados: Number(cardsAtrasados?.total || 0),
      cardsDentroPrazo: dentro,
      movimentacoes: Number(movsTotal?.total || 0),
      cardsPorColuna: cardsPorColuna.map((c) => ({
        coluna: c.colunaNome,
        total: Number(c.total),
      })),
      taxaDentroPrazo: total > 0 ? Math.round((dentro / total) * 100) : 100,
    };
  }),

  /** Cálculos — histórico de cálculos do usuário */
  calculos: protectedProcedure.input(PeriodoInput).query(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) return null;
    const dias = input?.dias || 30;
    const desde = desdeDias(dias);

    const calcRows = await db
      .select({ tipo: calculosHistorico.tipo, total: sql<number>`COUNT(*)` })
      .from(calculosHistorico)
      .where(
        and(
          eq(calculosHistorico.userId, ctx.user.id),
          gte(calculosHistorico.createdAt, desde),
        ),
      )
      .groupBy(calculosHistorico.tipo);

    const calcPorMes = await db
      .select({
        mes: sql<string>`DATE_FORMAT(createdAt,'%Y-%m')`,
        total: sql<number>`COUNT(*)`,
      })
      .from(calculosHistorico)
      .where(
        and(
          eq(calculosHistorico.userId, ctx.user.id),
          sql`createdAt >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)`,
        ),
      )
      .groupBy(sql`DATE_FORMAT(createdAt,'%Y-%m')`)
      .orderBy(sql`DATE_FORMAT(createdAt,'%Y-%m')`);

    const calculosPorTipo: Record<string, number> = {};
    for (const r of calcRows) calculosPorTipo[r.tipo as string] = Number(r.total);

    return {
      periodo: dias,
      calculosPorTipo,
      totalCalculos: Object.values(calculosPorTipo).reduce((a, b) => a + b, 0),
      calculosPorMes: calcPorMes.map((r) => ({
        mes: String(r.mes),
        total: Number(r.total),
      })),
    };
  }),
});

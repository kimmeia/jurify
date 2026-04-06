import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { getDb } from "../db";
import { conversas, mensagens, leads, contatos, calculosHistorico } from "../../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";

export const relatoriosRouter = router({
  operacional: protectedProcedure.input(z.object({ dataInicio: z.string().optional(), dataFim: z.string().optional() }).optional()).query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id); if (!esc) return null;
    const db = await getDb(); if (!db) return null; const eid = esc.escritorio.id;
    const statusRows = await db.select({ status: conversas.status, total: sql<number>`COUNT(*)` }).from(conversas).where(eq(conversas.escritorioId, eid)).groupBy(conversas.status);
    const msgRows = await db.select({ direcao: mensagens.direcao, total: sql<number>`COUNT(*)` }).from(mensagens).innerJoin(conversas, eq(mensagens.conversaId, conversas.id)).where(eq(conversas.escritorioId, eid)).groupBy(mensagens.direcao);
    const convsPorDia = await db.select({ dia: sql<string>`DATE(createdAtConv)`, total: sql<number>`COUNT(*)` }).from(conversas).where(and(eq(conversas.escritorioId, eid), sql`createdAtConv >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`)).groupBy(sql`DATE(createdAtConv)`).orderBy(sql`DATE(createdAtConv)`);
    const msgsPorDia = await db.select({ dia: sql<string>`DATE(createdAtMsg)`, total: sql<number>`COUNT(*)` }).from(mensagens).innerJoin(conversas, eq(mensagens.conversaId, conversas.id)).where(and(eq(conversas.escritorioId, eid), sql`createdAtMsg >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`)).groupBy(sql`DATE(createdAtMsg)`).orderBy(sql`DATE(createdAtMsg)`);
    const sm: Record<string, number> = {}; for (const r of statusRows) sm[r.status as string] = Number(r.total);
    const mm: Record<string, number> = {}; for (const r of msgRows) mm[r.direcao as string] = Number(r.total);
    return { conversasPorStatus: sm, totalConversas: Object.values(sm).reduce((a, b) => a + b, 0), mensagensEnviadas: mm["saida"] || 0, mensagensRecebidas: mm["entrada"] || 0, totalMensagens: (mm["saida"] || 0) + (mm["entrada"] || 0), conversasPorDia: convsPorDia.map(r => ({ dia: String(r.dia), total: Number(r.total) })), mensagensPorDia: msgsPorDia.map(r => ({ dia: String(r.dia), total: Number(r.total) })) };
  }),

  comercial: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id); if (!esc) return null;
    const db = await getDb(); if (!db) return null; const eid = esc.escritorio.id;
    const etapaRows = await db.select({ etapa: leads.etapaFunil, total: sql<number>`COUNT(*)`, valor: sql<number>`COALESCE(SUM(CAST(valorEstimado AS DECIMAL(10,2))),0)` }).from(leads).where(eq(leads.escritorioId, eid)).groupBy(leads.etapaFunil);
    const leadsPorMes = await db.select({ mes: sql<string>`DATE_FORMAT(createdAtLead,'%Y-%m')`, total: sql<number>`COUNT(*)` }).from(leads).where(and(eq(leads.escritorioId, eid), sql`createdAtLead >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)`)).groupBy(sql`DATE_FORMAT(createdAtLead,'%Y-%m')`).orderBy(sql`DATE_FORMAT(createdAtLead,'%Y-%m')`);
    const origemRows = await db.select({ origem: contatos.origem, total: sql<number>`COUNT(*)` }).from(contatos).where(eq(contatos.escritorioId, eid)).groupBy(contatos.origem);
    const etapas: Record<string, { total: number; valor: number }> = {}; for (const r of etapaRows) etapas[r.etapa as string] = { total: Number(r.total), valor: Number(r.valor) };
    const totalLeads = Object.values(etapas).reduce((a, b) => a + b.total, 0);
    const leadsGanhos = etapas["fechado_ganho"]?.total || 0; const leadsPerdidos = etapas["fechado_perdido"]?.total || 0;
    const taxaConversao = totalLeads > 0 ? parseFloat(((leadsGanhos / totalLeads) * 100).toFixed(1)) : 0;
    const valorPipeline = Object.entries(etapas).filter(([k]) => !["fechado_ganho", "fechado_perdido"].includes(k)).reduce((a, [, v]) => a + v.valor, 0);
    return { etapas, totalLeads, leadsGanhos, leadsPerdidos, taxaConversao, valorPipeline, valorGanho: etapas["fechado_ganho"]?.valor || 0, leadsPorMes: leadsPorMes.map(r => ({ mes: String(r.mes), total: Number(r.total) })), contatosPorOrigem: origemRows.map(r => ({ origem: r.origem as string, total: Number(r.total) })) };
  }),

  financeiro: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb(); if (!db) return null;
    const calcRows = await db.select({ tipo: calculosHistorico.tipo, total: sql<number>`COUNT(*)` }).from(calculosHistorico).where(eq(calculosHistorico.userId, ctx.user.id)).groupBy(calculosHistorico.tipo);
    const calcPorMes = await db.select({ mes: sql<string>`DATE_FORMAT(createdAt,'%Y-%m')`, total: sql<number>`COUNT(*)` }).from(calculosHistorico).where(and(eq(calculosHistorico.userId, ctx.user.id), sql`createdAt >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)`)).groupBy(sql`DATE_FORMAT(createdAt,'%Y-%m')`).orderBy(sql`DATE_FORMAT(createdAt,'%Y-%m')`);
    const tm: Record<string, number> = {}; for (const r of calcRows) tm[r.tipo as string] = Number(r.total);
    return { calculosPorTipo: tm, totalCalculos: Object.values(tm).reduce((a, b) => a + b, 0), calculosPorMes: calcPorMes.map(r => ({ mes: String(r.mes), total: Number(r.total) })) };
  }),
});

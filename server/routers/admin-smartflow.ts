/**
 * Router admin — Modelos de SmartFlow.
 *
 * O admin cria/edita modelos (blueprints) e marca quais ficam disponíveis
 * para os escritórios clientes clonarem. O conteúdo do fluxo (gatilho +
 * passos) é o mesmo `TemplateSmartflow` usado pela galeria/wizard do cliente
 * — aqui só persistimos em `smartflow_templates` com metadados de publicação.
 *
 * Modelos NÃO executam: viram cenário do cliente apenas via
 * `smartflow.criarDeTemplate` (que materializa no escritório de quem clona).
 */

import { z } from "zod";
import { eq, desc, sql, inArray } from "drizzle-orm";
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { smartflowTemplates, smartflowCenarios } from "../../drizzle/schema";

const passoTemplateSchema = z.object({
  clienteId: z.string().min(1).max(64),
  tipo: z.string().min(1).max(48),
  config: z.record(z.any()).default({}),
  proximoSe: z.record(z.string()).optional(),
});

const templateInputSchema = z.object({
  nome: z.string().min(2).max(128),
  descricao: z.string().max(512).default(""),
  icone: z.string().max(48).default("sparkles"),
  gradiente: z.string().max(64).default("from-violet-500 to-indigo-500"),
  gatilho: z.string().min(1).max(48),
  configGatilho: z.record(z.any()).optional(),
  passos: z.array(passoTemplateSchema).min(1),
  categoria: z.string().max(48).optional(),
  badge: z.enum(["popular", "novo"]).optional(),
  dica: z.string().max(512).optional(),
  disponivelParaClientes: z.boolean().default(false),
});

export const adminSmartflowRouter = router({
  /** Lista todos os modelos + contagem de clones (cenários originados deles). */
  listar: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];

    const tpls = await db
      .select()
      .from(smartflowTemplates)
      .orderBy(desc(smartflowTemplates.updatedAt));
    if (tpls.length === 0) return [];

    const ids = tpls.map((t) => t.id);
    const clones = await db
      .select({ origemTemplateId: smartflowCenarios.origemTemplateId, total: sql<number>`COUNT(*)` })
      .from(smartflowCenarios)
      .where(inArray(smartflowCenarios.origemTemplateId, ids))
      .groupBy(smartflowCenarios.origemTemplateId);
    const clonesMap = new Map<number, number>();
    for (const c of clones) {
      if (c.origemTemplateId != null) clonesMap.set(c.origemTemplateId, Number(c.total));
    }

    return tpls.map((t) => {
      let nPassos = 0;
      try { nPassos = Array.isArray(JSON.parse(t.passos)) ? JSON.parse(t.passos).length : 0; } catch { /* noop */ }
      return {
        id: t.id,
        nome: t.nome,
        descricao: t.descricao,
        icone: t.icone,
        gradiente: t.gradiente,
        gatilho: t.gatilho,
        categoria: t.categoria,
        badge: t.badge,
        disponivelParaClientes: t.disponivelParaClientes,
        qtdPassos: nPassos,
        clones: clonesMap.get(t.id) ?? 0,
        updatedAt: t.updatedAt,
      };
    });
  }),

  /** Detalhe completo de um modelo (pra editar metadados/passos). */
  detalhe: adminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const [t] = await db
        .select()
        .from(smartflowTemplates)
        .where(eq(smartflowTemplates.id, input.id))
        .limit(1);
      if (!t) return null;
      let passos: unknown = [];
      let configGatilho: unknown = null;
      try { passos = t.passos ? JSON.parse(t.passos) : []; } catch { passos = []; }
      try { configGatilho = t.configGatilho ? JSON.parse(t.configGatilho) : null; } catch { configGatilho = null; }
      return { ...t, passos, configGatilho };
    }),

  /** Cria um modelo. O conteúdo (gatilho+passos) normalmente vem de um
   *  fluxo que o admin montou no editor e está "promovendo" a modelo. */
  criar: adminProcedure
    .input(templateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database não disponível");
      const [r] = await db.insert(smartflowTemplates).values({
        nome: input.nome,
        descricao: input.descricao,
        icone: input.icone,
        gradiente: input.gradiente,
        gatilho: input.gatilho,
        configGatilho: input.configGatilho ? JSON.stringify(input.configGatilho) : null,
        passos: JSON.stringify(input.passos),
        categoria: input.categoria ?? null,
        badge: input.badge ?? null,
        dica: input.dica ?? null,
        disponivelParaClientes: input.disponivelParaClientes,
        criadoPor: ctx.user.id,
      });
      return { id: (r as { insertId: number }).insertId };
    }),

  /** Atualiza um modelo existente. */
  atualizar: adminProcedure
    .input(templateInputSchema.extend({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database não disponível");
      await db
        .update(smartflowTemplates)
        .set({
          nome: input.nome,
          descricao: input.descricao,
          icone: input.icone,
          gradiente: input.gradiente,
          gatilho: input.gatilho,
          configGatilho: input.configGatilho ? JSON.stringify(input.configGatilho) : null,
          passos: JSON.stringify(input.passos),
          categoria: input.categoria ?? null,
          badge: input.badge ?? null,
          dica: input.dica ?? null,
          disponivelParaClientes: input.disponivelParaClientes,
        })
        .where(eq(smartflowTemplates.id, input.id));
      return { success: true };
    }),

  /** Toggle de publicação (disponível para clientes). */
  publicar: adminProcedure
    .input(z.object({ id: z.number(), disponivel: z.boolean() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database não disponível");
      await db
        .update(smartflowTemplates)
        .set({ disponivelParaClientes: input.disponivel })
        .where(eq(smartflowTemplates.id, input.id));
      return { success: true };
    }),

  /** Remove um modelo. Cenários já clonados não são afetados. */
  deletar: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database não disponível");
      await db.delete(smartflowTemplates).where(eq(smartflowTemplates.id, input.id));
      return { success: true };
    }),
});

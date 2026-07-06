/**
 * Router do Agente Jurídico — Fase 1 (base de conhecimento + busca).
 *
 * Expõe a base curada (súmulas/leis/precedentes) e a busca por similaridade
 * que alimenta a avaliação de sucesso e a redação de peças (incrementos 2 e 3).
 * Embeddings usam a chave OpenAI do escritório (fallback plataforma).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, isNull, or, sql, desc, like } from "drizzle-orm";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { fontesJuridicas } from "../../drizzle/schema";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { resolverAPIKey } from "../integracoes/router-agentes-ia";
import { gerarEmbedding } from "./embeddings";
import { recuperarFontes, seedFontesRevisional, reindexarEmbeddings } from "./base";
import { AREA_REVISIONAL } from "./fontes-revisional";

/** Resolve a chave OpenAI (embeddings sempre via OpenAI). null se não houver. */
async function resolverChaveOpenAI(escritorioId: number): Promise<string | null> {
  const r = await resolverAPIKey(escritorioId, null, "openai");
  return r && r.provider === "openai" ? r.key : null;
}

export const juridicoRouter = router({
  /** Contagem da base por tipo/área + quantas já estão indexadas (com embedding). */
  estatisticasBase: protectedProcedure
    .input(z.object({ area: z.string().max(80).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return { total: 0, indexadas: 0, porTipo: {} as Record<string, number> };
      const db = await getDb();
      if (!db) return { total: 0, indexadas: 0, porTipo: {} as Record<string, number> };

      const escCond = or(isNull(fontesJuridicas.escritorioId), eq(fontesJuridicas.escritorioId, esc.escritorio.id))!;
      const conds = [escCond];
      if (input?.area) conds.push(eq(fontesJuridicas.area, input.area));

      const rows = await db
        .select({ tipo: fontesJuridicas.tipo, temEmb: sql<number>`CASE WHEN ${fontesJuridicas.embedding} IS NULL THEN 0 ELSE 1 END` })
        .from(fontesJuridicas)
        .where(and(...conds));

      const porTipo: Record<string, number> = {};
      let indexadas = 0;
      for (const r of rows) {
        porTipo[r.tipo] = (porTipo[r.tipo] ?? 0) + 1;
        if (Number(r.temEmb) === 1) indexadas++;
      }
      return { total: rows.length, indexadas, porTipo };
    }),

  /** Lista as fontes da base (sem o blob de embedding) — pra gestão/consulta. */
  listarFontes: protectedProcedure
    .input(z.object({ area: z.string().max(80).optional(), busca: z.string().max(160).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return [];
      const db = await getDb();
      if (!db) return [];

      const escCond = or(isNull(fontesJuridicas.escritorioId), eq(fontesJuridicas.escritorioId, esc.escritorio.id))!;
      const conds = [escCond];
      if (input?.area) conds.push(eq(fontesJuridicas.area, input.area));
      if (input?.busca) {
        const b = `%${input.busca}%`;
        conds.push(or(like(fontesJuridicas.identificador, b), like(fontesJuridicas.titulo, b), like(fontesJuridicas.texto, b))!);
      }
      return db
        .select({
          id: fontesJuridicas.id,
          tipo: fontesJuridicas.tipo,
          identificador: fontesJuridicas.identificador,
          orgao: fontesJuridicas.orgao,
          area: fontesJuridicas.area,
          titulo: fontesJuridicas.titulo,
          texto: fontesJuridicas.texto,
          indexada: sql<number>`CASE WHEN ${fontesJuridicas.embedding} IS NULL THEN 0 ELSE 1 END`,
        })
        .from(fontesJuridicas)
        .where(and(...conds))
        .orderBy(desc(fontesJuridicas.id))
        .limit(200);
    }),

  /** Busca por similaridade — recupera as fontes mais relevantes à consulta. */
  buscar: protectedProcedure
    .input(z.object({
      query: z.string().min(3).max(2000),
      area: z.string().max(80).optional(),
      topK: z.number().int().min(1).max(20).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Escritório não encontrado." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const key = await resolverChaveOpenAI(esc.escritorio.id);
      if (!key) {
        return {
          disponivel: false,
          motivo: "Nenhuma chave OpenAI configurada — a busca inteligente da base usa embeddings da OpenAI. Configure em Integrações.",
          fontes: [],
        };
      }
      let queryEmb: number[];
      try {
        queryEmb = await gerarEmbedding(input.query, key);
      } catch (err: any) {
        return { disponivel: false, motivo: err?.message || "Falha ao consultar embeddings.", fontes: [] };
      }
      const fontes = await recuperarFontes(db, queryEmb, {
        area: input.area ?? AREA_REVISIONAL,
        escritorioId: esc.escritorio.id,
        topK: input.topK ?? 6,
      });
      return { disponivel: true, motivo: null as string | null, fontes };
    }),

  /** [admin] Semeia a base revisional (global) e indexa os embeddings. */
  seedBaseRevisional: adminProcedure.mutation(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    const seed = await seedFontesRevisional(db);
    let indexadas = 0;
    const key = esc ? await resolverChaveOpenAI(esc.escritorio.id) : null;
    if (key) {
      const r = await reindexarEmbeddings(db, key, { escritorioId: null, area: AREA_REVISIONAL });
      indexadas = r.indexadas;
    }
    return { ...seed, indexadas, indexou: !!key };
  }),

  /** [admin] Reindexa fontes globais ainda sem embedding. */
  reindexar: adminProcedure
    .input(z.object({ area: z.string().max(80).optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const key = esc ? await resolverChaveOpenAI(esc.escritorio.id) : null;
      if (!key) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Sem chave OpenAI pra indexar." });
      return reindexarEmbeddings(db, key, { escritorioId: null, area: input?.area });
    }),
});

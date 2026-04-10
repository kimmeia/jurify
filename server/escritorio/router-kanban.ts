/**
 * Router Kanban — Funis, colunas e cards de processos.
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getEscritorioPorUsuario } from "./db-escritorio";
import { getDb } from "../db";
import { kanbanFunis, kanbanColunas, kanbanCards, kanbanMovimentacoes, contatos, colaboradores } from "../../drizzle/schema";
import { eq, and, desc, asc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export const kanbanRouter = router({
  // ─── FUNIS ────────────────────────────────────────────────────────────────

  listarFunis: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return [];
    const db = await getDb();
    if (!db) return [];
    return db.select().from(kanbanFunis)
      .where(eq(kanbanFunis.escritorioId, esc.escritorio.id))
      .orderBy(asc(kanbanFunis.createdAt));
  }),

  criarFunil: protectedProcedure
    .input(z.object({
      nome: z.string().min(2).max(128),
      descricao: z.string().max(512).optional(),
      cor: z.string().max(16).optional(),
      /** Se true, cria colunas padrão */
      comColunasPadrao: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [result] = await db.insert(kanbanFunis).values({
        escritorioId: esc.escritorio.id,
        nome: input.nome,
        descricao: input.descricao || null,
        cor: input.cor || null,
        criadoPor: ctx.user.id,
      });
      const funilId = (result as { insertId: number }).insertId;

      if (input.comColunasPadrao !== false) {
        const colunas = [
          { nome: "Entrada", cor: "#6b7280", ordem: 1 },
          { nome: "Análise", cor: "#3b82f6", ordem: 2 },
          { nome: "Em andamento", cor: "#f59e0b", ordem: 3 },
          { nome: "Aguardando", cor: "#8b5cf6", ordem: 4 },
          { nome: "Concluído", cor: "#22c55e", ordem: 5 },
        ];
        for (const c of colunas) {
          await db.insert(kanbanColunas).values({ funilId, nome: c.nome, cor: c.cor, ordem: c.ordem });
        }
      }

      return { id: funilId };
    }),

  editarFunil: protectedProcedure
    .input(z.object({ id: z.number(), nome: z.string().min(2).max(128).optional(), descricao: z.string().max(512).optional(), cor: z.string().max(16).optional() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const update: any = {};
      if (input.nome) update.nome = input.nome;
      if (input.descricao !== undefined) update.descricao = input.descricao;
      if (input.cor !== undefined) update.cor = input.cor;
      await db.update(kanbanFunis).set(update)
        .where(and(eq(kanbanFunis.id, input.id), eq(kanbanFunis.escritorioId, esc.escritorio.id)));
      return { success: true };
    }),

  deletarFunil: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      // Busca colunas pra deletar cards
      const cols = await db.select({ id: kanbanColunas.id }).from(kanbanColunas).where(eq(kanbanColunas.funilId, input.id));
      for (const c of cols) await db.delete(kanbanCards).where(eq(kanbanCards.colunaId, c.id));
      await db.delete(kanbanColunas).where(eq(kanbanColunas.funilId, input.id));
      await db.delete(kanbanFunis).where(and(eq(kanbanFunis.id, input.id), eq(kanbanFunis.escritorioId, esc.escritorio.id)));
      return { success: true };
    }),

  // ─── COLUNAS ──────────────────────────────────────────────────────────────

  criarColuna: protectedProcedure
    .input(z.object({ funilId: z.number(), nome: z.string().min(1).max(64), cor: z.string().max(16).optional() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      // Pegar próxima ordem
      const existentes = await db.select({ ordem: kanbanColunas.ordem }).from(kanbanColunas)
        .where(eq(kanbanColunas.funilId, input.funilId)).orderBy(desc(kanbanColunas.ordem)).limit(1);
      const ordem = (existentes[0]?.ordem || 0) + 1;
      const [r] = await db.insert(kanbanColunas).values({ funilId: input.funilId, nome: input.nome, cor: input.cor || null, ordem });
      return { id: (r as { insertId: number }).insertId };
    }),

  editarColuna: protectedProcedure
    .input(z.object({ id: z.number(), nome: z.string().max(64).optional(), cor: z.string().max(16).optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const update: any = {};
      if (input.nome) update.nome = input.nome;
      if (input.cor !== undefined) update.cor = input.cor;
      await db.update(kanbanColunas).set(update).where(eq(kanbanColunas.id, input.id));
      return { success: true };
    }),

  deletarColuna: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(kanbanCards).where(eq(kanbanCards.colunaId, input.id));
      await db.delete(kanbanColunas).where(eq(kanbanColunas.id, input.id));
      return { success: true };
    }),

  // ─── CARDS ────────────────────────────────────────────────────────────────

  /** Busca todas as colunas + cards de um funil */
  obterFunil: protectedProcedure
    .input(z.object({ funilId: z.number() }))
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return { funil: null, colunas: [] };
      const db = await getDb();
      if (!db) return { funil: null, colunas: [] };

      const [funil] = await db.select().from(kanbanFunis)
        .where(and(eq(kanbanFunis.id, input.funilId), eq(kanbanFunis.escritorioId, esc.escritorio.id)))
        .limit(1);
      if (!funil) return { funil: null, colunas: [] };

      const colunas = await db.select().from(kanbanColunas)
        .where(eq(kanbanColunas.funilId, input.funilId))
        .orderBy(asc(kanbanColunas.ordem));

      const result = [];
      for (const col of colunas) {
        const cards = await db.select().from(kanbanCards)
          .where(eq(kanbanCards.colunaId, col.id))
          .orderBy(asc(kanbanCards.ordem));

        // Enriquecer cards com nome do cliente
        const cardsEnriquecidos = [];
        for (const card of cards) {
          let clienteNome: string | null = null;
          if (card.clienteId) {
            const [c] = await db.select({ nome: contatos.nome }).from(contatos)
              .where(eq(contatos.id, card.clienteId)).limit(1);
            clienteNome = c?.nome || null;
          }
          let responsavelNome: string | null = null;
          if (card.responsavelId) {
            const [r] = await db.select({ userId: colaboradores.userId }).from(colaboradores)
              .where(eq(colaboradores.id, card.responsavelId)).limit(1);
            responsavelNome = r ? `Colab #${card.responsavelId}` : null;
          }
          cardsEnriquecidos.push({ ...card, clienteNome, responsavelNome });
        }

        result.push({ ...col, cards: cardsEnriquecidos });
      }

      return { funil, colunas: result };
    }),

  criarCard: protectedProcedure
    .input(z.object({
      colunaId: z.number(),
      titulo: z.string().min(1).max(255),
      descricao: z.string().optional(),
      cnj: z.string().max(30).optional(),
      clienteId: z.number().optional(),
      responsavelId: z.number().optional(),
      prioridade: z.enum(["alta", "media", "baixa"]).optional(),
      prazo: z.string().optional(),
      tags: z.string().max(255).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      // Próxima ordem
      const existentes = await db.select({ ordem: kanbanCards.ordem }).from(kanbanCards)
        .where(eq(kanbanCards.colunaId, input.colunaId)).orderBy(desc(kanbanCards.ordem)).limit(1);
      const ordem = (existentes[0]?.ordem || 0) + 1;

      // Se não informou prazo, aplica prazo padrão do funil
      let prazo: Date | null = null;
      if (input.prazo) {
        prazo = new Date(input.prazo);
      } else {
        // Buscar funil da coluna pra pegar prazoPadraoDias
        const [col] = await db.select({ funilId: kanbanColunas.funilId }).from(kanbanColunas)
          .where(eq(kanbanColunas.id, input.colunaId)).limit(1);
        if (col) {
          const [funil] = await db.select({ prazoPadraoDias: kanbanFunis.prazoPadraoDias }).from(kanbanFunis)
            .where(eq(kanbanFunis.id, col.funilId)).limit(1);
          const dias = funil?.prazoPadraoDias || 15;
          prazo = new Date(Date.now() + dias * 24 * 60 * 60 * 1000);
        }
      }

      const [r] = await db.insert(kanbanCards).values({
        escritorioId: esc.escritorio.id,
        colunaId: input.colunaId,
        titulo: input.titulo,
        descricao: input.descricao || null,
        cnj: input.cnj || null,
        clienteId: input.clienteId || null,
        responsavelId: input.responsavelId || null,
        prioridade: (input.prioridade as any) || "media",
        prazo,
        tags: input.tags || null,
        ordem,
      });
      return { id: (r as { insertId: number }).insertId };
    }),

  editarCard: protectedProcedure
    .input(z.object({
      id: z.number(),
      titulo: z.string().max(255).optional(),
      descricao: z.string().optional(),
      cnj: z.string().max(30).optional(),
      clienteId: z.number().optional(),
      responsavelId: z.number().optional(),
      prioridade: z.enum(["alta", "media", "baixa"]).optional(),
      prazo: z.string().optional(),
      tags: z.string().max(255).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { id, ...update } = input;
      const setData: any = {};
      if (update.titulo) setData.titulo = update.titulo;
      if (update.descricao !== undefined) setData.descricao = update.descricao;
      if (update.cnj !== undefined) setData.cnj = update.cnj;
      if (update.prioridade) setData.prioridade = update.prioridade;
      if (update.prazo !== undefined) setData.prazo = update.prazo ? new Date(update.prazo) : null;
      if (update.tags !== undefined) setData.tags = update.tags;
      if (update.clienteId !== undefined) setData.clienteId = update.clienteId;
      if (update.responsavelId !== undefined) setData.responsavelId = update.responsavelId;
      await db.update(kanbanCards).set(setData).where(eq(kanbanCards.id, id));
      return { success: true };
    }),

  deletarCard: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(kanbanCards).where(eq(kanbanCards.id, input.id));
      return { success: true };
    }),

  /** Move card pra outra coluna (e/ou reordena) — registra movimentação */
  moverCard: protectedProcedure
    .input(z.object({ cardId: z.number(), colunaDestinoId: z.number(), ordem: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Buscar coluna origem antes de mover
      const [card] = await db.select({ colunaId: kanbanCards.colunaId }).from(kanbanCards)
        .where(eq(kanbanCards.id, input.cardId)).limit(1);

      await db.update(kanbanCards)
        .set({ colunaId: input.colunaDestinoId, ordem: input.ordem ?? 0 })
        .where(eq(kanbanCards.id, input.cardId));

      // Registrar movimentação (pra métricas de tempo por etapa)
      if (card && card.colunaId !== input.colunaDestinoId) {
        await db.insert(kanbanMovimentacoes).values({
          cardId: input.cardId,
          colunaOrigemId: card.colunaId,
          colunaDestinoId: input.colunaDestinoId,
          movidoPorId: esc?.colaborador.id || null,
        });
      }

      return { success: true };
    }),
});

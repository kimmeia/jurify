/**
 * Router SmartFlow — CRUD de cenários + execução.
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { getDb } from "../db";
import { smartflowCenarios, smartflowPassos, smartflowExecucoes } from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { executarCenario, SmartflowExecutores, SmartflowContexto, Passo, PassoConfig } from "./engine";
import { createLogger } from "../_core/logger";

const log = createLogger("smartflow");

export const smartflowRouter = router({
  /** Lista cenários do escritório */
  listar: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return [];
    const db = await getDb();
    if (!db) return [];

    const cenarios = await db
      .select()
      .from(smartflowCenarios)
      .where(eq(smartflowCenarios.escritorioId, esc.escritorio.id))
      .orderBy(desc(smartflowCenarios.updatedAt));

    // Buscar passos de cada cenário
    const result = [];
    for (const c of cenarios) {
      const passos = await db
        .select()
        .from(smartflowPassos)
        .where(eq(smartflowPassos.cenarioId, c.id))
        .orderBy(smartflowPassos.ordem);
      result.push({ ...c, passos });
    }
    return result;
  }),

  /** Cria cenário com passos */
  criar: protectedProcedure
    .input(z.object({
      nome: z.string().min(2).max(128),
      descricao: z.string().max(512).optional(),
      gatilho: z.enum(["whatsapp_mensagem", "novo_lead", "agendamento_criado", "manual"]),
      passos: z.array(z.object({
        tipo: z.enum(["ia_classificar", "ia_responder", "calcom_horarios", "calcom_agendar", "whatsapp_enviar", "transferir", "condicional", "esperar", "webhook"]),
        config: z.record(z.any()).optional(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [result] = await db.insert(smartflowCenarios).values({
        escritorioId: esc.escritorio.id,
        nome: input.nome,
        descricao: input.descricao || null,
        gatilho: input.gatilho,
        criadoPor: ctx.user.id,
      });
      const cenarioId = (result as { insertId: number }).insertId;

      // Criar passos
      for (let i = 0; i < input.passos.length; i++) {
        const p = input.passos[i];
        await db.insert(smartflowPassos).values({
          cenarioId,
          ordem: i + 1,
          tipo: p.tipo,
          config: p.config ? JSON.stringify(p.config) : null,
        });
      }

      return { id: cenarioId };
    }),

  /** Toggle ativo/inativo */
  toggleAtivo: protectedProcedure
    .input(z.object({ id: z.number(), ativo: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await db.update(smartflowCenarios)
        .set({ ativo: input.ativo })
        .where(and(eq(smartflowCenarios.id, input.id), eq(smartflowCenarios.escritorioId, esc.escritorio.id)));

      return { success: true };
    }),

  /** Deleta cenário + passos */
  deletar: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await db.delete(smartflowPassos).where(eq(smartflowPassos.cenarioId, input.id));
      await db.delete(smartflowCenarios)
        .where(and(eq(smartflowCenarios.id, input.id), eq(smartflowCenarios.escritorioId, esc.escritorio.id)));

      return { success: true };
    }),

  /** Cria cenário template "Atendimento + Agendamento" */
  criarTemplateAtendimento: protectedProcedure.mutation(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) throw new TRPCError({ code: "FORBIDDEN" });
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    const [result] = await db.insert(smartflowCenarios).values({
      escritorioId: esc.escritorio.id,
      nome: "Atendimento + Agendamento",
      descricao: "Atende cliente via WhatsApp, tira dúvidas iniciais e agenda reunião automaticamente pelo Cal.com.",
      gatilho: "whatsapp_mensagem",
      criadoPor: ctx.user.id,
    });
    const cenarioId = (result as { insertId: number }).insertId;

    const passos = [
      { ordem: 1, tipo: "ia_classificar", config: { categorias: ["agendar", "duvida", "emergencia", "outro"] } },
      { ordem: 2, tipo: "ia_responder", config: { prompt: "Você é recepcionista de um escritório de advocacia. Se o cliente quer agendar, diga que vai verificar os horários. Se tem dúvida, responda de forma educada. Se é emergência, diga que vai transferir." } },
      { ordem: 3, tipo: "calcom_horarios", config: { duracao: 30 } },
    ];

    for (const p of passos) {
      await db.insert(smartflowPassos).values({
        cenarioId,
        ordem: p.ordem,
        tipo: p.tipo as any,
        config: JSON.stringify(p.config),
      });
    }

    return { id: cenarioId, nome: "Atendimento + Agendamento" };
  }),

  /** Execuções recentes */
  execucoes: protectedProcedure
    .input(z.object({ cenarioId: z.number().optional(), limite: z.number().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return [];
      const db = await getDb();
      if (!db) return [];

      const conditions: any[] = [eq(smartflowExecucoes.escritorioId, esc.escritorio.id)];
      if (input?.cenarioId) conditions.push(eq(smartflowExecucoes.cenarioId, input.cenarioId));

      return db
        .select()
        .from(smartflowExecucoes)
        .where(and(...conditions))
        .orderBy(desc(smartflowExecucoes.createdAt))
        .limit(input?.limite || 20);
    }),
});

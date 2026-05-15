/**
 * Router tRPC — Tarefas / To-dos
 * 
 * Tarefas podem ser vinculadas a um cliente (contatoId) e/ou processo.
 * Atribuídas a um responsável, com data de vencimento e prioridade.
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getEscritorioPorUsuario } from "./db-escritorio";
import { getDb } from "../db";
import { tarefas, colaboradores, users } from "../../drizzle/schema";
import { eq, and, desc, or, sql, gte, lte, like } from "drizzle-orm";
import { checkPermission } from "./check-permission";
import { TRPCError } from "@trpc/server";

/** Valida ownership de uma tarefa quando a permissão é "verProprios" only.
 *  Retorna true se o colaborador pode mexer nela. */
async function podeMexerNaTarefa(
  db: any,
  tarefaId: number,
  escritorioId: number,
  colaboradorId: number,
): Promise<boolean> {
  const [t] = await db.select({ responsavelId: tarefas.responsavelId, criadoPor: tarefas.criadoPor })
    .from(tarefas)
    .where(and(eq(tarefas.id, tarefaId), eq(tarefas.escritorioId, escritorioId)))
    .limit(1);
  if (!t) return false;
  return t.responsavelId === colaboradorId || t.criadoPor === colaboradorId;
}

export const tarefasRouter = router({
  /** Listar tarefas do escritório (com filtros) */
  listar: protectedProcedure
    .input(z.object({
      status: z.enum(["pendente", "em_andamento", "concluida", "cancelada", "todas"]).optional(),
      contatoId: z.number().optional(),
      processoId: z.number().optional(),
      responsavelId: z.number().optional(),
      prioridade: z.enum(["baixa", "normal", "alta", "urgente"]).optional(),
      busca: z.string().optional(),
      vencimentoAte: z.string().optional(), // ISO date
    }).optional())
    .query(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "tarefas", "ver", { fallbackModulo: "agenda" });
      if (!perm.allowed) return [];
      const db = await getDb();
      if (!db) return [];

      const conditions: any[] = [eq(tarefas.escritorioId, perm.escritorioId)];

      // Filtra próprias quando a permissão é ver-próprios only
      if (!perm.verTodos && perm.verProprios) {
        conditions.push(or(
          eq(tarefas.responsavelId, perm.colaboradorId),
          eq(tarefas.criadoPor, perm.colaboradorId),
        ));
      }

      if (input?.status && input.status !== "todas") {
        conditions.push(eq(tarefas.status, input.status));
      }
      if (input?.contatoId) conditions.push(eq(tarefas.contatoId, input.contatoId));
      if (input?.processoId) conditions.push(eq(tarefas.processoId, input.processoId));
      if (input?.responsavelId) conditions.push(eq(tarefas.responsavelId, input.responsavelId));
      if (input?.prioridade) conditions.push(eq(tarefas.prioridade, input.prioridade));
      if (input?.busca) {
        const b = `%${input.busca}%`;
        conditions.push(or(like(tarefas.titulo, b), like(tarefas.descricao, b))!);
      }
      if (input?.vencimentoAte) {
        conditions.push(lte(tarefas.dataVencimento, new Date(input.vencimentoAte)));
      }

      const rows = await db.select().from(tarefas)
        .where(and(...conditions))
        .orderBy(
          sql`CASE WHEN statusTarefa = 'pendente' THEN 0 WHEN statusTarefa = 'em_andamento' THEN 1 WHEN statusTarefa = 'concluida' THEN 2 ELSE 3 END`,
          sql`CASE WHEN prioridadeTarefa = 'urgente' THEN 0 WHEN prioridadeTarefa = 'alta' THEN 1 WHEN prioridadeTarefa = 'normal' THEN 2 ELSE 3 END`,
          desc(tarefas.createdAt)
        )
        .limit(200);

      // Buscar nomes dos responsáveis
      const respIds = [...new Set(rows.filter(r => r.responsavelId).map(r => r.responsavelId!))];
      const nomeMap: Record<number, string> = {};
      if (respIds.length > 0) {
        const colabs = await db.select().from(colaboradores).where(sql`id IN (${sql.join(respIds.map(id => sql`${id}`), sql`, `)})`);
        const userIds = colabs.map(c => c.userId);
        if (userIds.length > 0) {
          const allUsers = await db.select({ id: users.id, name: users.name }).from(users).where(sql`id IN (${sql.join(userIds.map(id => sql`${id}`), sql`, `)})`);
          const userMap: Record<number, string> = {};
          for (const u of allUsers) userMap[u.id] = u.name || "Sem nome";
          for (const c of colabs) nomeMap[c.id] = userMap[c.userId] || "Sem nome";
        }
      }

      return rows.map(r => ({
        ...r,
        responsavelNome: r.responsavelId ? (nomeMap[r.responsavelId] || null) : null,
        dataVencimento: r.dataVencimento ? (r.dataVencimento as Date).toISOString() : null,
        concluidaAt: r.concluidaAt ? (r.concluidaAt as Date).toISOString() : null,
        createdAt: r.createdAt ? (r.createdAt as Date).toISOString() : "",
        updatedAt: r.updatedAt ? (r.updatedAt as Date).toISOString() : "",
        vencida: r.dataVencimento && r.status !== "concluida" && r.status !== "cancelada" && new Date(r.dataVencimento) < new Date(),
      }));
    }),

  /** Criar tarefa */
  criar: protectedProcedure
    .input(z.object({
      titulo: z.string().min(2).max(255),
      descricao: z.string().max(2000).optional(),
      contatoId: z.number().optional(),
      processoId: z.number().optional(),
      responsavelId: z.number().optional(),
      prioridade: z.enum(["baixa", "normal", "alta", "urgente"]).optional(),
      dataVencimento: z.string().optional(), // ISO date
    }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "tarefas", "criar", { fallbackModulo: "agenda" });
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para criar tarefas." });
      const db = await getDb();
      if (!db) throw new Error("Database indisponível");

      const [r] = await db.insert(tarefas).values({
        escritorioId: perm.escritorioId,
        criadoPor: perm.colaboradorId,
        titulo: input.titulo,
        descricao: input.descricao || null,
        contatoId: input.contatoId || null,
        processoId: input.processoId || null,
        responsavelId: input.responsavelId || perm.colaboradorId,
        prioridade: (input.prioridade || "normal") as any,
        dataVencimento: input.dataVencimento ? new Date(input.dataVencimento) : null,
      });

      return { id: (r as { insertId: number }).insertId };
    }),

  /** Atualizar tarefa */
  atualizar: protectedProcedure
    .input(z.object({
      id: z.number(),
      titulo: z.string().min(2).max(255).optional(),
      descricao: z.string().max(2000).optional(),
      status: z.enum(["pendente", "em_andamento", "concluida", "cancelada"]).optional(),
      prioridade: z.enum(["baixa", "normal", "alta", "urgente"]).optional(),
      responsavelId: z.number().optional(),
      dataVencimento: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "tarefas", "editar", { fallbackModulo: "agenda" });
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para editar tarefas." });
      const db = await getDb();
      if (!db) throw new Error("Database indisponível");

      if (!perm.verTodos && perm.verProprios) {
        const ok = await podeMexerNaTarefa(db, input.id, perm.escritorioId, perm.colaboradorId);
        if (!ok) throw new TRPCError({ code: "FORBIDDEN", message: "Você só pode editar suas próprias tarefas." });
      }

      const { id, ...dados } = input;
      const update: any = {};
      if (dados.titulo !== undefined) update.titulo = dados.titulo;
      if (dados.descricao !== undefined) update.descricao = dados.descricao;
      if (dados.status !== undefined) {
        update.status = dados.status;
        if (dados.status === "concluida") update.concluidaAt = new Date();
        if (dados.status === "pendente" || dados.status === "em_andamento") update.concluidaAt = null;
      }
      if (dados.prioridade !== undefined) update.prioridade = dados.prioridade;
      if (dados.responsavelId !== undefined) update.responsavelId = dados.responsavelId;
      if (dados.dataVencimento !== undefined) {
        update.dataVencimento = dados.dataVencimento ? new Date(dados.dataVencimento) : null;
      }

      await db.update(tarefas).set(update)
        .where(and(eq(tarefas.id, id), eq(tarefas.escritorioId, perm.escritorioId)));

      return { success: true };
    }),

  /** Excluir tarefa */
  excluir: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "tarefas", "excluir", { fallbackModulo: "agenda" });
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para excluir tarefas." });
      const db = await getDb();
      if (!db) throw new Error("Database indisponível");

      if (!perm.verTodos && perm.verProprios) {
        const ok = await podeMexerNaTarefa(db, input.id, perm.escritorioId, perm.colaboradorId);
        if (!ok) throw new TRPCError({ code: "FORBIDDEN", message: "Você só pode excluir suas próprias tarefas." });
      }

      await db.delete(tarefas).where(and(eq(tarefas.id, input.id), eq(tarefas.escritorioId, perm.escritorioId)));
      return { success: true };
    }),

  /** Contadores rápidos para badges */
  contadores: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return { pendentes: 0, vencidas: 0, minhas: 0 };
    const db = await getDb();
    if (!db) return { pendentes: 0, vencidas: 0, minhas: 0 };

    const eid = esc.escritorio.id;
    const cid = esc.colaborador.id;

    const [pend] = await db.select({ count: sql<number>`COUNT(*)` }).from(tarefas)
      .where(and(eq(tarefas.escritorioId, eid), or(eq(tarefas.status, "pendente"), eq(tarefas.status, "em_andamento"))));

    const [venc] = await db.select({ count: sql<number>`COUNT(*)` }).from(tarefas)
      .where(and(eq(tarefas.escritorioId, eid), or(eq(tarefas.status, "pendente"), eq(tarefas.status, "em_andamento")), sql`dataVencimento < NOW() AND dataVencimento IS NOT NULL`));

    const [minhas] = await db.select({ count: sql<number>`COUNT(*)` }).from(tarefas)
      .where(and(eq(tarefas.escritorioId, eid), eq(tarefas.responsavelId, cid), or(eq(tarefas.status, "pendente"), eq(tarefas.status, "em_andamento"))));

    return {
      pendentes: Number((pend as { count: number } | undefined)?.count || 0),
      vencidas: Number((venc as { count: number } | undefined)?.count || 0),
      minhas: Number((minhas as { count: number } | undefined)?.count || 0),
    };
  }),
});

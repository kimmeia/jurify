/**
 * Router — Processos vinculados a clientes
 *
 * Permite vincular processos (CNJ) a clientes do escritório,
 * com opção de criar monitoramento automático em Movimentações.
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getEscritorioPorUsuario } from "./db-escritorio";
import { getDb } from "../db";
import { clienteProcessos, contatos, juditMonitoramentos } from "../../drizzle/schema";
import { eq, and, desc, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { checkPermission } from "./check-permission";

/** Verifica que o colaborador pode acessar esse cliente.
 *  - verTodos: qualquer cliente do escritório
 *  - verProprios: só se responsavelId === colabId
 *  Retorna false se não pode (UI não deve mostrar dados).
 */
async function podeVerCliente(
  db: any,
  contatoId: number,
  escritorioId: number,
  colabId: number,
  verTodos: boolean,
): Promise<boolean> {
  const [c] = await db
    .select({ responsavelId: contatos.responsavelId })
    .from(contatos)
    .where(and(eq(contatos.id, contatoId), eq(contatos.escritorioId, escritorioId)))
    .limit(1);
  if (!c) return false;
  if (verTodos) return true;
  return c.responsavelId === colabId;
}

export const clienteProcessosRouter = router({
  /** Lista processos vinculados a um cliente.
   *  Respeita verProprios: só retorna processos se o colaborador puder
   *  ver o cliente em questão. */
  listar: protectedProcedure
    .input(z.object({ contatoId: z.number() }))
    .query(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "clientes", "ver");
      if (!perm.allowed) return [];
      const db = await getDb();
      if (!db) return [];

      const ok = await podeVerCliente(
        db, input.contatoId, perm.escritorioId, perm.colaboradorId, perm.verTodos,
      );
      if (!ok) return [];

      const rows = await db
        .select()
        .from(clienteProcessos)
        .where(
          and(
            eq(clienteProcessos.escritorioId, perm.escritorioId),
            eq(clienteProcessos.contatoId, input.contatoId),
          ),
        )
        .orderBy(desc(clienteProcessos.createdAt));

      // Enriquecer com status do monitoramento (se vinculado)
      const result = [];
      for (const row of rows) {
        let monitoramentoStatus: string | null = null;
        if (row.monitoramentoId) {
          const [mon] = await db
            .select({ statusJudit: juditMonitoramentos.statusJudit, updatedAt: juditMonitoramentos.updatedAt })
            .from(juditMonitoramentos)
            .where(eq(juditMonitoramentos.id, row.monitoramentoId))
            .limit(1);
          monitoramentoStatus = mon?.statusJudit || null;
        }
        result.push({
          ...row,
          monitoramentoStatus,
        });
      }

      return result;
    }),

  /** Vincula um processo a um cliente */
  vincular: protectedProcedure
    .input(z.object({
      contatoId: z.number(),
      numeroCnj: z.string().min(15).max(30),
      apelido: z.string().max(255).optional(),
      polo: z.enum(["ativo", "passivo", "interessado"]).optional(),
      tipo: z.enum(["extrajudicial", "litigioso"]).optional(),
      monitorar: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Verificar que o contato pertence ao escritório
      const [contato] = await db
        .select({ id: contatos.id })
        .from(contatos)
        .where(and(eq(contatos.id, input.contatoId), eq(contatos.escritorioId, esc.escritorio.id)))
        .limit(1);
      if (!contato) throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado" });

      // Verificar duplicata
      const [existente] = await db
        .select({ id: clienteProcessos.id })
        .from(clienteProcessos)
        .where(
          and(
            eq(clienteProcessos.contatoId, input.contatoId),
            eq(clienteProcessos.numeroCnj, input.numeroCnj),
            eq(clienteProcessos.escritorioId, esc.escritorio.id),
          ),
        )
        .limit(1);
      if (existente) throw new TRPCError({ code: "CONFLICT", message: "Este processo já está vinculado a este cliente." });

      // Verificar se já existe monitoramento pra este CNJ (vincula automaticamente)
      let monitoramentoId: number | null = null;
      try {
        const [monExistente] = await db
          .select({ id: juditMonitoramentos.id })
          .from(juditMonitoramentos)
          .where(
            and(
              eq(juditMonitoramentos.searchKey, input.numeroCnj),
              eq(juditMonitoramentos.clienteUserId, ctx.user.id),
              or(
                eq(juditMonitoramentos.statusJudit, "created"),
                eq(juditMonitoramentos.statusJudit, "updating"),
                eq(juditMonitoramentos.statusJudit, "updated"),
              ),
            ),
          )
          .limit(1);

        if (monExistente) {
          monitoramentoId = monExistente.id;
        } else if (input.monitorar) {
          const { getJuditClient } = await import("../integracoes/judit-webhook");
          const client = await getJuditClient();
          if (client) {
            const tracking = await client.criarMonitoramento({
              recurrence: 1,
              search: { search_type: "lawsuit_cnj", search_key: input.numeroCnj },
              with_attachments: false,
            });
            const [monResult] = await db.insert(juditMonitoramentos).values({
              trackingId: tracking.tracking_id,
              searchType: "lawsuit_cnj",
              searchKey: input.numeroCnj,
              tipoMonitoramento: "movimentacoes",
              recurrence: 1,
              statusJudit: tracking.status as any,
              apelido: input.apelido || null,
              clienteUserId: ctx.user.id,
              withAttachments: false,
            });
            monitoramentoId = (monResult as { insertId: number }).insertId;
          }
        }
      } catch {
        // Falha no monitoramento não bloqueia o vínculo
      }

      const [result] = await db.insert(clienteProcessos).values({
        escritorioId: esc.escritorio.id,
        contatoId: input.contatoId,
        numeroCnj: input.numeroCnj,
        apelido: input.apelido || null,
        polo: (input.polo as any) || null,
        tipo: (input.tipo as any) || "litigioso",
        monitoramentoId,
        criadoPor: ctx.user.id,
      });

      return {
        id: (result as { insertId: number }).insertId,
        monitoramentoId,
        monitorando: !!monitoramentoId,
      };
    }),

  /** Desvincula um processo de um cliente (não exclui monitoramento) */
  desvincular: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await db.delete(clienteProcessos).where(
        and(
          eq(clienteProcessos.id, input.id),
          eq(clienteProcessos.escritorioId, esc.escritorio.id),
        ),
      );

      return { success: true };
    }),

  /** Atualiza apelido, polo ou tipo de um vínculo */
  atualizar: protectedProcedure
    .input(z.object({
      id: z.number(),
      apelido: z.string().max(255).optional(),
      polo: z.enum(["ativo", "passivo", "interessado"]).optional(),
      tipo: z.enum(["extrajudicial", "litigioso"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const update: Record<string, any> = {};
      if (input.apelido !== undefined) update.apelido = input.apelido;
      if (input.polo !== undefined) update.polo = input.polo;
      if (input.tipo !== undefined) update.tipo = input.tipo;

      if (Object.keys(update).length > 0) {
        await db.update(clienteProcessos)
          .set(update)
          .where(and(eq(clienteProcessos.id, input.id), eq(clienteProcessos.escritorioId, esc.escritorio.id)));
      }

      return { success: true };
    }),

  // ─── Anotações por processo ──────────────────────────────────────────────

  /** Lista anotações de um processo (mais recente primeiro) */
  listarAnotacoes: protectedProcedure
    .input(z.object({ processoId: z.number() }))
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return [];
      const db = await getDb();
      if (!db) return [];

      const { clienteProcessoAnotacoes, users } = await import("../../drizzle/schema");
      // Garante que o processo pertence ao escritório do usuário
      const [proc] = await db
        .select({ id: clienteProcessos.id })
        .from(clienteProcessos)
        .where(and(eq(clienteProcessos.id, input.processoId), eq(clienteProcessos.escritorioId, esc.escritorio.id)))
        .limit(1);
      if (!proc) return [];

      const anots = await db
        .select({
          id: clienteProcessoAnotacoes.id,
          conteudo: clienteProcessoAnotacoes.conteudo,
          createdAt: clienteProcessoAnotacoes.createdAt,
          autorUserId: clienteProcessoAnotacoes.autorUserId,
          autorNome: users.name,
        })
        .from(clienteProcessoAnotacoes)
        .leftJoin(users, eq(users.id, clienteProcessoAnotacoes.autorUserId))
        .where(eq(clienteProcessoAnotacoes.processoId, input.processoId))
        .orderBy(desc(clienteProcessoAnotacoes.createdAt));

      return anots.map((a) => ({
        ...a,
        autorNome: a.autorNome ?? "Usuário",
        createdAt: (a.createdAt as Date).toISOString(),
      }));
    }),

  /** Cria anotação no processo */
  criarAnotacao: protectedProcedure
    .input(z.object({
      processoId: z.number(),
      conteudo: z.string().min(1).max(2000),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const { clienteProcessoAnotacoes } = await import("../../drizzle/schema");
      // Confirma que o processo é do escritório
      const [proc] = await db
        .select({ id: clienteProcessos.id })
        .from(clienteProcessos)
        .where(and(eq(clienteProcessos.id, input.processoId), eq(clienteProcessos.escritorioId, esc.escritorio.id)))
        .limit(1);
      if (!proc) throw new TRPCError({ code: "NOT_FOUND" });

      const [r] = await db.insert(clienteProcessoAnotacoes).values({
        processoId: input.processoId,
        autorUserId: ctx.user.id,
        conteudo: input.conteudo.trim(),
      });
      return { id: (r as { insertId: number }).insertId };
    }),

  /** Exclui anotação. Só o autor ou admin do escritório (verTodos) pode. */
  excluirAnotacao: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const { clienteProcessoAnotacoes } = await import("../../drizzle/schema");
      const [anot] = await db
        .select({
          autorUserId: clienteProcessoAnotacoes.autorUserId,
          processoId: clienteProcessoAnotacoes.processoId,
        })
        .from(clienteProcessoAnotacoes)
        .where(eq(clienteProcessoAnotacoes.id, input.id))
        .limit(1);
      if (!anot) throw new TRPCError({ code: "NOT_FOUND" });

      // Confirma escritório do processo
      const [proc] = await db
        .select({ id: clienteProcessos.id })
        .from(clienteProcessos)
        .where(and(eq(clienteProcessos.id, anot.processoId), eq(clienteProcessos.escritorioId, esc.escritorio.id)))
        .limit(1);
      if (!proc) throw new TRPCError({ code: "NOT_FOUND" });

      // Permissão: autor pode excluir a própria; outros precisam de verTodos.
      const perm = await checkPermission(ctx.user.id, "clientes", "editar");
      const ehAutor = anot.autorUserId === ctx.user.id;
      if (!ehAutor && !perm.verTodos) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Você só pode excluir anotações que você criou." });
      }

      await db.delete(clienteProcessoAnotacoes).where(eq(clienteProcessoAnotacoes.id, input.id));
      return { success: true };
    }),
});

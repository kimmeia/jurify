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

export const clienteProcessosRouter = router({
  /** Lista processos vinculados a um cliente */
  listar: protectedProcedure
    .input(z.object({ contatoId: z.number() }))
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return [];
      const db = await getDb();
      if (!db) return [];

      const rows = await db
        .select()
        .from(clienteProcessos)
        .where(
          and(
            eq(clienteProcessos.escritorioId, esc.escritorio.id),
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

      // Se pedir monitoramento, criar em juditUsuario
      let monitoramentoId: number | null = null;
      if (input.monitorar) {
        try {
          // Verificar se já existe monitoramento pra este CNJ
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
          } else {
            // Criar monitoramento via Judit
            const { getJuditClient } = await import("../integracoes/judit-webhook");
            const client = await getJuditClient();
            if (client) {
              const tracking = await client.criarMonitoramento({
                recurrence: 1,
                search: { search_type: "lawsuit_cnj", search_key: input.numeroCnj },
                with_attachments: false,
              });

              const [result] = await db.insert(juditMonitoramentos).values({
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
              monitoramentoId = (result as { insertId: number }).insertId;
            }
          }
        } catch {
          // Falha no monitoramento não bloqueia o vínculo
        }
      }

      const [result] = await db.insert(clienteProcessos).values({
        escritorioId: esc.escritorio.id,
        contatoId: input.contatoId,
        numeroCnj: input.numeroCnj,
        apelido: input.apelido || null,
        polo: (input.polo as any) || null,
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

  /** Atualiza apelido ou polo de um vínculo */
  atualizar: protectedProcedure
    .input(z.object({
      id: z.number(),
      apelido: z.string().max(255).optional(),
      polo: z.enum(["ativo", "passivo", "interessado"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const update: Record<string, any> = {};
      if (input.apelido !== undefined) update.apelido = input.apelido;
      if (input.polo !== undefined) update.polo = input.polo;

      if (Object.keys(update).length > 0) {
        await db.update(clienteProcessos)
          .set(update)
          .where(and(eq(clienteProcessos.id, input.id), eq(clienteProcessos.escritorioId, esc.escritorio.id)));
      }

      return { success: true };
    }),
});

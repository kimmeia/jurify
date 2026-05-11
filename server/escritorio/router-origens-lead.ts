/**
 * Router das origens de lead configuráveis por escritório.
 *
 * - `listar` chama `garantirOrigensPadrao` preguiçosamente — primeiro
 *   acesso popula com as 5 opções legadas (Indicação, Ligação, Evento,
 *   Presencial, Outro). Sem isso, escritórios novos abrem o select
 *   vazio.
 * - `excluir` faz soft-delete (ativo=false) pra preservar histórico:
 *   leads antigos com origem "BNI" continuam exibindo "BNI" mesmo
 *   depois que o admin desativou essa origem.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, eq } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { origensLead } from "../../drizzle/schema";
import { getEscritorioPorUsuario } from "./db-escritorio";
import { checkPermission } from "./check-permission";

const ORIGENS_PADRAO: string[] = [
  "Indicação",
  "Ligação",
  "Evento",
  "Presencial",
  "Outro",
];

/**
 * Garante que o escritório tem as origens padrão. Idempotente: se já
 * existem (mesma estratégia de `garantirCategoriasPadrao` no financeiro).
 */
export async function garantirOrigensPadrao(escritorioId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const existentes = await db
    .select({ nome: origensLead.nome })
    .from(origensLead)
    .where(eq(origensLead.escritorioId, escritorioId));

  const setExistentes = new Set(existentes.map((o) => o.nome));
  const aCriar = ORIGENS_PADRAO.filter((nome) => !setExistentes.has(nome));

  if (aCriar.length > 0) {
    await db.insert(origensLead).values(
      aCriar.map((nome, idx) => ({
        escritorioId,
        nome,
        ordem: idx,
      })),
    );
  }
}

async function requireEscritorio(userId: number) {
  const result = await getEscritorioPorUsuario(userId);
  if (!result) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Escritório não encontrado.",
    });
  }
  return result;
}

async function exigirConfigurar(userId: number): Promise<void> {
  // Gerenciar a lista exige permissão de editar configurações; listar
  // pra usar no select é livre (qualquer um que pode criar cliente).
  const perm = await checkPermission(userId, "configuracoes", "editar");
  if (!perm.editar) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Sem permissão para gerenciar origens de lead.",
    });
  }
}

export const origensLeadRouter = router({
  /**
   * Lista origens do escritório. Por default só as ativas (uso em
   * select); passar `incluirInativas: true` em telas de gerenciamento
   * pra mostrar tudo.
   */
  listar: protectedProcedure
    .input(z.object({ incluirInativas: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const esc = await requireEscritorio(ctx.user.id);
      await garantirOrigensPadrao(esc.escritorio.id);

      const db = await getDb();
      if (!db) return [];

      const conds = [eq(origensLead.escritorioId, esc.escritorio.id)];
      if (!input?.incluirInativas) {
        conds.push(eq(origensLead.ativo, true));
      }

      return db
        .select()
        .from(origensLead)
        .where(and(...conds))
        .orderBy(asc(origensLead.ordem), asc(origensLead.id));
    }),

  criar: protectedProcedure
    .input(z.object({ nome: z.string().min(1).max(80) }))
    .mutation(async ({ ctx, input }) => {
      await exigirConfigurar(ctx.user.id);
      const esc = await requireEscritorio(ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Próxima ordem = maior+1 (cresce até reordenação manual)
      const todas = await db
        .select({ ordem: origensLead.ordem })
        .from(origensLead)
        .where(eq(origensLead.escritorioId, esc.escritorio.id));
      const proxOrdem = todas.length === 0
        ? 0
        : Math.max(...todas.map((o) => o.ordem)) + 1;

      try {
        const [r] = await db
          .insert(origensLead)
          .values({
            escritorioId: esc.escritorio.id,
            nome: input.nome.trim(),
            ordem: proxOrdem,
          })
          .$returningId();
        return { id: r.id };
      } catch (err: any) {
        if (
          err.code === "ER_DUP_ENTRY" ||
          /Duplicate entry/i.test(err.message ?? "")
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Já existe uma origem chamada "${input.nome.trim()}".`,
          });
        }
        throw err;
      }
    }),

  atualizar: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        nome: z.string().min(1).max(80).optional(),
        ativo: z.boolean().optional(),
        ordem: z.number().int().min(0).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await exigirConfigurar(ctx.user.id);
      const esc = await requireEscritorio(ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const set: Record<string, unknown> = {};
      if (input.nome !== undefined) set.nome = input.nome.trim();
      if (input.ativo !== undefined) set.ativo = input.ativo;
      if (input.ordem !== undefined) set.ordem = input.ordem;
      if (Object.keys(set).length === 0) return { success: true };

      try {
        await db
          .update(origensLead)
          .set(set)
          .where(
            and(
              eq(origensLead.id, input.id),
              eq(origensLead.escritorioId, esc.escritorio.id),
            ),
          );
        return { success: true };
      } catch (err: any) {
        if (
          err.code === "ER_DUP_ENTRY" ||
          /Duplicate entry/i.test(err.message ?? "")
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Já existe outra origem com esse nome.`,
          });
        }
        throw err;
      }
    }),

  /**
   * Soft-delete: marca `ativo=false`. Preserva histórico — leads
   * antigos com essa origem continuam exibindo o nome correto pelo
   * fallback `origemLead.nome` (texto livre).
   */
  desativar: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await exigirConfigurar(ctx.user.id);
      const esc = await requireEscritorio(ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await db
        .update(origensLead)
        .set({ ativo: false })
        .where(
          and(
            eq(origensLead.id, input.id),
            eq(origensLead.escritorioId, esc.escritorio.id),
          ),
        );
      return { success: true };
    }),

  reordenar: protectedProcedure
    .input(z.object({ idsEmOrdem: z.array(z.number().int().positive()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      await exigirConfigurar(ctx.user.id);
      const esc = await requireEscritorio(ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Aplica ordem 0, 1, 2... na ordem dos IDs recebidos
      for (let i = 0; i < input.idsEmOrdem.length; i++) {
        await db
          .update(origensLead)
          .set({ ordem: i })
          .where(
            and(
              eq(origensLead.id, input.idsEmOrdem[i]),
              eq(origensLead.escritorioId, esc.escritorio.id),
            ),
          );
      }
      return { success: true };
    }),
});

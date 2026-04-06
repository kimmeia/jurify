/**
 * Router de OABs — Cadastro e gestão de inscrições na OAB.
 * 
 * SEGURANÇA:
 * - Todas as queries filtram por ctx.user.id (isolamento por utilizador)
 * - Utilizador normal: só pode cadastrar OAB cujo nome do titular corresponda ao seu nome de cadastro
 * - Admin: pode cadastrar OAB de qualquer titular (bypass da validação de nome)
 * - Nunca expor OABs de outros utilizadores
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { oabsAdvogado } from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";

// ============================================================
// Helpers de validação de nome
// ============================================================

/**
 * Normaliza um nome para comparação:
 * - Remove acentos
 * - Converte para minúsculas
 * - Remove preposições comuns (de, da, do, dos, das, e)
 * - Remove espaços extras
 */
function normalizarNome(nome: string): string {
  const semAcentos = nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

  const preposicoes = /\b(de|da|do|dos|das|e)\b/g;
  return semAcentos
    .replace(preposicoes, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extrai as partes significativas de um nome (primeiro + último, ou todas).
 */
function partesSignificativas(nomeNormalizado: string): string[] {
  return nomeNormalizado.split(" ").filter((p) => p.length > 1);
}

/**
 * Verifica se dois nomes correspondem.
 * Critério: pelo menos o primeiro nome E o último nome devem coincidir.
 * Isso permite variações como "Rafael Rocha" vs "Rafael da Silva Rocha".
 */
export function nomesCorrespondem(nomeUsuario: string, nomeTitularOab: string): boolean {
  const partesUsuario = partesSignificativas(normalizarNome(nomeUsuario));
  const partesTitular = partesSignificativas(normalizarNome(nomeTitularOab));

  if (partesUsuario.length === 0 || partesTitular.length === 0) return false;

  // Primeiro nome deve coincidir
  const primeiroCoincide = partesUsuario[0] === partesTitular[0];
  if (!primeiroCoincide) return false;

  // Se só tem um nome, basta o primeiro coincidir
  if (partesUsuario.length === 1 && partesTitular.length === 1) return true;

  // Último nome deve coincidir
  const ultimoUsuario = partesUsuario[partesUsuario.length - 1];
  const ultimoTitular = partesTitular[partesTitular.length - 1];

  return ultimoUsuario === ultimoTitular;
}

// ============================================================
// UFs válidas
// ============================================================

const UFS_VALIDAS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO",
  "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI",
  "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

// ============================================================
// Router
// ============================================================

export const oabRouter = router({
  /**
   * Listar OABs do utilizador autenticado.
   * SEGURANÇA: filtra por ctx.user.id
   */
  listar: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de dados indisponível" });
    const oabs = await db
      .select()
      .from(oabsAdvogado)
      .where(eq(oabsAdvogado.userId, ctx.user.id))
      .orderBy(desc(oabsAdvogado.createdAt));

    return oabs;
  }),

  /**
   * Cadastrar uma nova OAB.
   * SEGURANÇA:
   * - Utilizador normal: valida que nomeTitular corresponde ao nome de cadastro
   * - Admin: pode cadastrar para qualquer utilizador (bypass)
   */
  cadastrar: protectedProcedure
    .input(
      z.object({
        numero: z.string().min(1, "Número da OAB é obrigatório").max(20),
        uf: z.string().length(2, "UF deve ter 2 caracteres").refine(
          (v) => UFS_VALIDAS.includes(v.toUpperCase() as any),
          "UF inválida"
        ),
        tipo: z.enum(["principal", "suplementar"]).default("principal"),
        nomeTitular: z.string().min(2, "Nome do titular é obrigatório").max(255),
        /** Apenas admin pode informar userId diferente */
        targetUserId: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const isAdmin = ctx.user.role === "admin";
      const targetUserId = isAdmin && input.targetUserId ? input.targetUserId : ctx.user.id;
      const ufUpper = input.uf.toUpperCase();
      const numeroLimpo = input.numero.replace(/\D/g, "");

      if (!numeroLimpo || numeroLimpo.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Número da OAB inválido.",
        });
      }

      // Validação de nome para utilizadores normais
      if (!isAdmin) {
        if (!ctx.user.name) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Seu nome de cadastro não está disponível. Atualize seu perfil antes de cadastrar uma OAB.",
          });
        }

        if (!nomesCorrespondem(ctx.user.name, input.nomeTitular)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "O nome do titular da OAB não corresponde ao seu nome de cadastro. Apenas o administrador pode cadastrar OABs de outros titulares.",
          });
        }
      }

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de dados indisponível" });

      // Verificar duplicata (mesmo número + UF para o mesmo utilizador)
      const existente = await db
        .select({ id: oabsAdvogado.id })
        .from(oabsAdvogado)
        .where(
          and(
            eq(oabsAdvogado.userId, targetUserId),
            eq(oabsAdvogado.numero, numeroLimpo),
            eq(oabsAdvogado.uf, ufUpper)
          )
        )
        .limit(1);

      if (existente.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `OAB ${numeroLimpo}/${ufUpper} já está cadastrada.`,
        });
      }

      const [inserted] = await db.insert(oabsAdvogado).values({
        userId: targetUserId,
        numero: numeroLimpo,
        uf: ufUpper,
        tipo: input.tipo,
        nomeTitular: input.nomeTitular.trim(),
        cadastradaPorAdmin: isAdmin && input.targetUserId ? true : false,
      });

      return {
        id: inserted.insertId,
        numero: numeroLimpo,
        uf: ufUpper,
        nomeTitular: input.nomeTitular.trim(),
      };
    }),

  /**
   * Remover uma OAB.
   * SEGURANÇA: verifica que a OAB pertence ao ctx.user.id
   */
  remover: protectedProcedure
    .input(z.object({ oabId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de dados indisponível" });

      // Verificar propriedade
      const oab = await db
        .select({ id: oabsAdvogado.id, userId: oabsAdvogado.userId })
        .from(oabsAdvogado)
        .where(
          and(
            eq(oabsAdvogado.id, input.oabId),
            eq(oabsAdvogado.userId, ctx.user.id)
          )
        )
        .limit(1);

      if (oab.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "OAB não encontrada.",
        });
      }

      await db
        .delete(oabsAdvogado)
        .where(
          and(
            eq(oabsAdvogado.id, input.oabId),
            eq(oabsAdvogado.userId, ctx.user.id)
          )
        );

      return { success: true };
    }),

  /**
   * Alterar status de uma OAB.
   * SEGURANÇA: verifica que a OAB pertence ao ctx.user.id
   */
  alterarStatus: protectedProcedure
    .input(
      z.object({
        oabId: z.number(),
        status: z.enum(["ativa", "suspensa", "cancelada"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de dados indisponível" });

      const oab = await db
        .select({ id: oabsAdvogado.id, userId: oabsAdvogado.userId })
        .from(oabsAdvogado)
        .where(
          and(
            eq(oabsAdvogado.id, input.oabId),
            eq(oabsAdvogado.userId, ctx.user.id)
          )
        )
        .limit(1);

      if (oab.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "OAB não encontrada.",
        });
      }

      await db
        .update(oabsAdvogado)
        .set({ status: input.status })
        .where(
          and(
            eq(oabsAdvogado.id, input.oabId),
            eq(oabsAdvogado.userId, ctx.user.id)
          )
        );

      return { success: true };
    }),
});

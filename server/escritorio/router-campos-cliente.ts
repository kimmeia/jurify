/**
 * Router de campos personalizados do cliente — CRUD do catálogo de
 * campos extras que cada escritório define no cadastro do cliente.
 *
 * Os valores de cada campo ficam em `contatos.camposPersonalizados`
 * (JSON `{chave: valor}`). Quando um campo é excluído aqui, removemos
 * os valores correspondentes em todos os contatos do escritório
 * (cascade — análogo ao que fazemos com tags).
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getEscritorioPorUsuario } from "./db-escritorio";
import { getDb } from "../db";
import { camposPersonalizadosCliente, contatos } from "../../drizzle/schema";
import { eq, and, asc, isNotNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

const TIPOS_VALIDOS = ["texto", "numero", "data", "textarea", "select", "boolean"] as const;

const inputCriar = z.object({
  chave: z
    .string()
    .min(1)
    .max(48)
    .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "Chave deve começar com letra e conter apenas letras, números e _"),
  label: z.string().min(1).max(64),
  tipo: z.enum(TIPOS_VALIDOS),
  opcoes: z.array(z.string().min(1).max(64)).max(50).optional(),
  ajuda: z.string().max(200).optional(),
  obrigatorio: z.boolean().default(false),
  mostrarCadastro: z.boolean().default(true),
  ordem: z.number().int().min(0).default(0),
});

const inputEditar = z.object({
  id: z.number(),
  chave: z
    .string()
    .min(1)
    .max(48)
    .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/)
    .optional(),
  label: z.string().min(1).max(64).optional(),
  tipo: z.enum(TIPOS_VALIDOS).optional(),
  opcoes: z.array(z.string().min(1).max(64)).max(50).nullable().optional(),
  ajuda: z.string().max(200).nullable().optional(),
  obrigatorio: z.boolean().optional(),
  mostrarCadastro: z.boolean().optional(),
  ordem: z.number().int().min(0).optional(),
});

export const camposClienteRouter = router({
  listar: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return [];
    const db = await getDb();
    if (!db) return [];
    const rows = await db
      .select()
      .from(camposPersonalizadosCliente)
      .where(eq(camposPersonalizadosCliente.escritorioId, esc.escritorio.id))
      .orderBy(asc(camposPersonalizadosCliente.ordem), asc(camposPersonalizadosCliente.id));
    // Parse opcoes (JSON string → array)
    return rows.map((r) => ({
      ...r,
      opcoes: r.opcoes ? (JSON.parse(r.opcoes) as string[]) : null,
    }));
  }),

  criar: protectedProcedure.input(inputCriar).mutation(async ({ ctx, input }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) throw new TRPCError({ code: "FORBIDDEN" });
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    // Conflito de chave (índice único, mas verificamos antes pra dar erro amigável)
    const existentes = await db
      .select({ id: camposPersonalizadosCliente.id, chave: camposPersonalizadosCliente.chave })
      .from(camposPersonalizadosCliente)
      .where(eq(camposPersonalizadosCliente.escritorioId, esc.escritorio.id));
    if (existentes.some((r) => r.chave.toLowerCase() === input.chave.toLowerCase())) {
      throw new TRPCError({ code: "CONFLICT", message: `Já existe um campo com a chave "${input.chave}"` });
    }

    if (input.tipo === "select" && (!input.opcoes || input.opcoes.length === 0)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Campos do tipo Lista precisam de pelo menos uma opção" });
    }

    const [r] = await db.insert(camposPersonalizadosCliente).values({
      escritorioId: esc.escritorio.id,
      chave: input.chave,
      label: input.label,
      tipo: input.tipo,
      opcoes: input.opcoes ? JSON.stringify(input.opcoes) : null,
      ajuda: input.ajuda || null,
      // Campo invisível no cadastro não pode ser obrigatório (operadora não
      // teria como preencher). Trava defensiva — front também desabilita o
      // switch quando mostrarCadastro=false.
      obrigatorio: input.mostrarCadastro === false ? false : input.obrigatorio,
      mostrarCadastro: input.mostrarCadastro,
      ordem: input.ordem,
    });
    return { id: (r as { insertId: number }).insertId };
  }),

  editar: protectedProcedure.input(inputEditar).mutation(async ({ ctx, input }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) throw new TRPCError({ code: "FORBIDDEN" });
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    const [campo] = await db
      .select()
      .from(camposPersonalizadosCliente)
      .where(
        and(
          eq(camposPersonalizadosCliente.id, input.id),
          eq(camposPersonalizadosCliente.escritorioId, esc.escritorio.id),
        ),
      )
      .limit(1);
    if (!campo) throw new TRPCError({ code: "NOT_FOUND" });

    const chaveAntiga = campo.chave;
    const chaveNova = input.chave?.trim();

    // Conflito de nome
    if (chaveNova && chaveNova.toLowerCase() !== chaveAntiga.toLowerCase()) {
      const outros = await db
        .select({ id: camposPersonalizadosCliente.id, chave: camposPersonalizadosCliente.chave })
        .from(camposPersonalizadosCliente)
        .where(eq(camposPersonalizadosCliente.escritorioId, esc.escritorio.id));
      if (outros.some((r) => r.id !== campo.id && r.chave.toLowerCase() === chaveNova.toLowerCase())) {
        throw new TRPCError({ code: "CONFLICT", message: `Já existe um campo com a chave "${chaveNova}"` });
      }
    }

    const tipoFinal = input.tipo || campo.tipo;
    const opcoesFinal = input.opcoes !== undefined ? input.opcoes : null;

    if (tipoFinal === "select") {
      // Verifica se ficará com pelo menos 1 opção (vinda do input ou já existente)
      const opcoesEffective = input.opcoes ?? (campo.opcoes ? (JSON.parse(campo.opcoes) as string[]) : []);
      if (!opcoesEffective || opcoesEffective.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Campos do tipo Lista precisam de pelo menos uma opção" });
      }
    }

    const upd: any = {};
    if (input.chave !== undefined) upd.chave = input.chave;
    if (input.label !== undefined) upd.label = input.label;
    if (input.tipo !== undefined) upd.tipo = input.tipo;
    if (input.opcoes !== undefined) {
      upd.opcoes = input.opcoes ? JSON.stringify(input.opcoes) : null;
    }
    if (input.ajuda !== undefined) upd.ajuda = input.ajuda;
    if (input.obrigatorio !== undefined) upd.obrigatorio = input.obrigatorio;
    if (input.mostrarCadastro !== undefined) upd.mostrarCadastro = input.mostrarCadastro;
    if (input.ordem !== undefined) upd.ordem = input.ordem;

    // Trava defensiva: campo invisível no cadastro não pode ser
    // obrigatório. Considera o estado final pós-update.
    const mostrarFinal = input.mostrarCadastro ?? campo.mostrarCadastro;
    if (mostrarFinal === false) {
      upd.obrigatorio = false;
    }

    if (Object.keys(upd).length > 0) {
      await db
        .update(camposPersonalizadosCliente)
        .set(upd)
        .where(eq(camposPersonalizadosCliente.id, campo.id));
    }

    // Se a chave mudou, propaga rename nos JSONs de contatos
    if (chaveNova && chaveNova !== chaveAntiga) {
      const candidatos = await db
        .select({ id: contatos.id, camposPersonalizados: contatos.camposPersonalizados })
        .from(contatos)
        .where(
          and(
            eq(contatos.escritorioId, esc.escritorio.id),
            isNotNull(contatos.camposPersonalizados),
          ),
        );
      for (const r of candidatos) {
        if (!r.camposPersonalizados) continue;
        let json: Record<string, unknown> | null = null;
        try {
          json = JSON.parse(r.camposPersonalizados);
        } catch {
          continue;
        }
        if (!json || typeof json !== "object") continue;
        if (!(chaveAntiga in json)) continue;
        json[chaveNova] = json[chaveAntiga];
        delete json[chaveAntiga];
        await db
          .update(contatos)
          .set({ camposPersonalizados: JSON.stringify(json) })
          .where(eq(contatos.id, r.id));
      }
    }

    return { success: true };
  }),

  /** Exclui o campo + remove o valor correspondente do JSON de todos contatos. */
  excluir: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) throw new TRPCError({ code: "FORBIDDEN" });
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    const [campo] = await db
      .select()
      .from(camposPersonalizadosCliente)
      .where(
        and(
          eq(camposPersonalizadosCliente.id, input.id),
          eq(camposPersonalizadosCliente.escritorioId, esc.escritorio.id),
        ),
      )
      .limit(1);
    if (!campo) return { success: true, removidos: 0 };

    const chave = campo.chave;
    const candidatos = await db
      .select({ id: contatos.id, camposPersonalizados: contatos.camposPersonalizados })
      .from(contatos)
      .where(
        and(
          eq(contatos.escritorioId, esc.escritorio.id),
          isNotNull(contatos.camposPersonalizados),
        ),
      );
    let removidos = 0;
    for (const r of candidatos) {
      if (!r.camposPersonalizados) continue;
      let json: Record<string, unknown> | null = null;
      try {
        json = JSON.parse(r.camposPersonalizados);
      } catch {
        continue;
      }
      if (!json || typeof json !== "object") continue;
      if (!(chave in json)) continue;
      delete json[chave];
      const novo = Object.keys(json).length > 0 ? JSON.stringify(json) : null;
      await db.update(contatos).set({ camposPersonalizados: novo }).where(eq(contatos.id, r.id));
      removidos += 1;
    }

    await db
      .delete(camposPersonalizadosCliente)
      .where(eq(camposPersonalizadosCliente.id, campo.id));

    return { success: true, removidos };
  }),

  /** Reordena bulk (lista de ids na nova ordem). */
  reordenar: protectedProcedure
    .input(z.object({ ids: z.array(z.number()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      for (let i = 0; i < input.ids.length; i++) {
        await db
          .update(camposPersonalizadosCliente)
          .set({ ordem: i })
          .where(
            and(
              eq(camposPersonalizadosCliente.id, input.ids[i]),
              eq(camposPersonalizadosCliente.escritorioId, esc.escritorio.id),
            ),
          );
      }
      return { success: true };
    }),
});

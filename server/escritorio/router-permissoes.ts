/**
 * Router tRPC — Permissões Customizáveis
 * 
 * O dono do escritório pode:
 * - Criar cargos personalizados (ex: "Recepcionista", "Advogado Sênior")
 * - Definir permissões granulares por módulo para cada cargo
 * - Atribuir cargos personalizados aos colaboradores
 * 
 * Cargos padrão (Dono, Gestor, Atendente, Estagiário) são criados
 * automaticamente ao criar o escritório.
 * 
 * Módulos controlados:
 * calculos, clientes, processos, atendimento, pipeline, agendamento,
 * relatorios, configuracoes, equipe
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getEscritorioPorUsuario } from "./db-escritorio";
import { getDb } from "../db";
import { cargosPersonalizados, permissoesCargo, colaboradores } from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";

// Módulos disponíveis no sistema
const MODULOS = [
  "calculos",
  "clientes",
  "processos",
  "atendimento",
  "pipeline",
  "agendamento",
  "relatorios",
  "configuracoes",
  "equipe",
] as const;

// Permissões padrão para cada cargo default
const PERMISSOES_PADRAO: Record<string, Record<string, { verTodos: boolean; verProprios: boolean; criar: boolean; editar: boolean; excluir: boolean }>> = {
  "Dono": {
    calculos: { verTodos: true, verProprios: true, criar: true, editar: true, excluir: true },
    clientes: { verTodos: true, verProprios: true, criar: true, editar: true, excluir: true },
    processos: { verTodos: true, verProprios: true, criar: true, editar: true, excluir: true },
    atendimento: { verTodos: true, verProprios: true, criar: true, editar: true, excluir: true },
    pipeline: { verTodos: true, verProprios: true, criar: true, editar: true, excluir: true },
    agendamento: { verTodos: true, verProprios: true, criar: true, editar: true, excluir: true },
    relatorios: { verTodos: true, verProprios: true, criar: true, editar: true, excluir: true },
    configuracoes: { verTodos: true, verProprios: true, criar: true, editar: true, excluir: true },
    equipe: { verTodos: true, verProprios: true, criar: true, editar: true, excluir: true },
  },
  "Gestor": {
    calculos: { verTodos: true, verProprios: true, criar: true, editar: true, excluir: true },
    clientes: { verTodos: true, verProprios: true, criar: true, editar: true, excluir: false },
    processos: { verTodos: true, verProprios: true, criar: true, editar: true, excluir: false },
    atendimento: { verTodos: true, verProprios: true, criar: true, editar: true, excluir: false },
    pipeline: { verTodos: true, verProprios: true, criar: true, editar: true, excluir: false },
    agendamento: { verTodos: true, verProprios: true, criar: true, editar: true, excluir: false },
    relatorios: { verTodos: true, verProprios: true, criar: false, editar: false, excluir: false },
    configuracoes: { verTodos: false, verProprios: false, criar: false, editar: false, excluir: false },
    equipe: { verTodos: true, verProprios: true, criar: false, editar: false, excluir: false },
  },
  "Atendente": {
    calculos: { verTodos: true, verProprios: true, criar: true, editar: true, excluir: false },
    clientes: { verTodos: false, verProprios: true, criar: true, editar: true, excluir: false },
    processos: { verTodos: false, verProprios: true, criar: true, editar: true, excluir: false },
    atendimento: { verTodos: false, verProprios: true, criar: true, editar: true, excluir: false },
    pipeline: { verTodos: false, verProprios: true, criar: true, editar: true, excluir: false },
    agendamento: { verTodos: false, verProprios: true, criar: true, editar: true, excluir: false },
    relatorios: { verTodos: false, verProprios: false, criar: false, editar: false, excluir: false },
    configuracoes: { verTodos: false, verProprios: false, criar: false, editar: false, excluir: false },
    equipe: { verTodos: false, verProprios: true, criar: false, editar: false, excluir: false },
  },
  "Estagiário": {
    calculos: { verTodos: true, verProprios: true, criar: false, editar: false, excluir: false },
    clientes: { verTodos: false, verProprios: false, criar: false, editar: false, excluir: false },
    processos: { verTodos: false, verProprios: true, criar: false, editar: false, excluir: false },
    atendimento: { verTodos: false, verProprios: false, criar: false, editar: false, excluir: false },
    pipeline: { verTodos: false, verProprios: false, criar: false, editar: false, excluir: false },
    agendamento: { verTodos: false, verProprios: true, criar: false, editar: false, excluir: false },
    relatorios: { verTodos: false, verProprios: false, criar: false, editar: false, excluir: false },
    configuracoes: { verTodos: false, verProprios: false, criar: false, editar: false, excluir: false },
    equipe: { verTodos: false, verProprios: true, criar: false, editar: false, excluir: false },
  },
};

/** Cria cargos padrão para um escritório (chamado ao criar escritório) */
export async function criarCargosDefault(escritorioId: number) {
  const db = await getDb();
  if (!db) return;

  for (const [nome, perms] of Object.entries(PERMISSOES_PADRAO)) {
    // Verificar se já existe
    const [existente] = await db.select().from(cargosPersonalizados)
      .where(and(eq(cargosPersonalizados.escritorioId, escritorioId), eq(cargosPersonalizados.nome, nome)))
      .limit(1);

    if (existente) continue;

    const cores: Record<string, string> = { "Dono": "#dc2626", "Gestor": "#2563eb", "Atendente": "#16a34a", "Estagiário": "#f59e0b" };

    const [result] = await db.insert(cargosPersonalizados).values({
      escritorioId,
      nome,
      descricao: `Cargo padrão: ${nome}`,
      cor: cores[nome] || "#6366f1",
      isDefault: true,
    });

    const cargoId = (result as any).insertId;

    // Criar permissões para cada módulo
    for (const [modulo, perm] of Object.entries(perms)) {
      await db.insert(permissoesCargo).values({
        cargoId,
        modulo,
        verTodos: perm.verTodos,
        verProprios: perm.verProprios,
        criar: perm.criar,
        editar: perm.editar,
        excluir: perm.excluir,
      });
    }
  }
}

export const permissoesRouter = router({
  /** Lista cargos do escritório */
  listarCargos: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return [];
    const db = await getDb();
    if (!db) return [];

    const cargos = await db.select().from(cargosPersonalizados)
      .where(eq(cargosPersonalizados.escritorioId, esc.escritorio.id))
      .orderBy(cargosPersonalizados.isDefault, desc(cargosPersonalizados.createdAt));

    // Buscar permissões de cada cargo
    const result = [];
    for (const cargo of cargos) {
      const perms = await db.select().from(permissoesCargo)
        .where(eq(permissoesCargo.cargoId, cargo.id));

      const permMap: Record<string, any> = {};
      for (const p of perms) {
        permMap[p.modulo] = {
          verTodos: p.verTodos,
          verProprios: p.verProprios,
          criar: p.criar,
          editar: p.editar,
          excluir: p.excluir,
        };
      }

      // Contar colaboradores com este cargo
      const colabs = await db.select().from(colaboradores)
        .where(and(eq(colaboradores.escritorioId, esc.escritorio.id), eq(colaboradores.cargoPersonalizadoId, cargo.id)));

      result.push({
        id: cargo.id,
        nome: cargo.nome,
        descricao: cargo.descricao || "",
        cor: cargo.cor || "#6366f1",
        isDefault: cargo.isDefault,
        totalColaboradores: colabs.length,
        permissoes: permMap,
      });
    }

    return result;
  }),

  /** Cria novo cargo */
  criarCargo: protectedProcedure
    .input(z.object({
      nome: z.string().min(2).max(64),
      descricao: z.string().max(255).optional(),
      cor: z.string().max(20).optional(),
      permissoes: z.record(z.object({
        verTodos: z.boolean(),
        verProprios: z.boolean(),
        criar: z.boolean(),
        editar: z.boolean(),
        excluir: z.boolean(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      if (esc.colaborador.cargo !== "dono") throw new Error("Apenas o dono pode criar cargos.");
      const db = await getDb();
      if (!db) throw new Error("Database indisponível");

      const [result] = await db.insert(cargosPersonalizados).values({
        escritorioId: esc.escritorio.id,
        nome: input.nome,
        descricao: input.descricao || null,
        cor: input.cor || "#6366f1",
        isDefault: false,
      });

      const cargoId = (result as any).insertId;

      // Criar permissões
      for (const [modulo, perm] of Object.entries(input.permissoes)) {
        await db.insert(permissoesCargo).values({
          cargoId,
          modulo,
          verTodos: perm.verTodos,
          verProprios: perm.verProprios,
          criar: perm.criar,
          editar: perm.editar,
          excluir: perm.excluir,
        });
      }

      return { id: cargoId };
    }),

  /** Atualiza permissões de um cargo */
  atualizarCargo: protectedProcedure
    .input(z.object({
      id: z.number(),
      nome: z.string().min(2).max(64).optional(),
      descricao: z.string().max(255).optional(),
      cor: z.string().max(20).optional(),
      permissoes: z.record(z.object({
        verTodos: z.boolean(),
        verProprios: z.boolean(),
        criar: z.boolean(),
        editar: z.boolean(),
        excluir: z.boolean(),
      })).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      if (esc.colaborador.cargo !== "dono") throw new Error("Apenas o dono pode editar cargos.");
      const db = await getDb();
      if (!db) throw new Error("Database indisponível");

      // Atualizar dados do cargo
      const updateData: any = {};
      if (input.nome) updateData.nome = input.nome;
      if (input.descricao !== undefined) updateData.descricao = input.descricao;
      if (input.cor) updateData.cor = input.cor;

      if (Object.keys(updateData).length > 0) {
        await db.update(cargosPersonalizados).set(updateData)
          .where(and(eq(cargosPersonalizados.id, input.id), eq(cargosPersonalizados.escritorioId, esc.escritorio.id)));
      }

      // Atualizar permissões
      if (input.permissoes) {
        for (const [modulo, perm] of Object.entries(input.permissoes)) {
          // Upsert: delete + insert
          await db.delete(permissoesCargo)
            .where(and(eq(permissoesCargo.cargoId, input.id), eq(permissoesCargo.modulo, modulo)));

          await db.insert(permissoesCargo).values({
            cargoId: input.id,
            modulo,
            verTodos: perm.verTodos,
            verProprios: perm.verProprios,
            criar: perm.criar,
            editar: perm.editar,
            excluir: perm.excluir,
          });
        }
      }

      return { success: true };
    }),

  /** Exclui cargo (não pode excluir padrão nem com colaboradores vinculados) */
  excluirCargo: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      if (esc.colaborador.cargo !== "dono") throw new Error("Apenas o dono pode excluir cargos.");
      const db = await getDb();
      if (!db) throw new Error("Database indisponível");

      // Verificar se é padrão
      const [cargo] = await db.select().from(cargosPersonalizados)
        .where(and(eq(cargosPersonalizados.id, input.id), eq(cargosPersonalizados.escritorioId, esc.escritorio.id)))
        .limit(1);

      if (!cargo) throw new Error("Cargo não encontrado.");
      if (cargo.isDefault) throw new Error("Não é possível excluir cargos padrão.");

      // Verificar se tem colaboradores
      const colabs = await db.select().from(colaboradores)
        .where(eq(colaboradores.cargoPersonalizadoId, input.id));
      if (colabs.length > 0) throw new Error(`Este cargo tem ${colabs.length} colaborador(es). Reatribua antes de excluir.`);

      // Excluir permissões e cargo
      await db.delete(permissoesCargo).where(eq(permissoesCargo.cargoId, input.id));
      await db.delete(cargosPersonalizados)
        .where(and(eq(cargosPersonalizados.id, input.id), eq(cargosPersonalizados.escritorioId, esc.escritorio.id)));

      return { success: true };
    }),

  /** Atribui cargo personalizado a um colaborador */
  atribuirCargo: protectedProcedure
    .input(z.object({
      colaboradorId: z.number(),
      cargoId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      if (esc.colaborador.cargo !== "dono" && esc.colaborador.cargo !== "gestor") {
        throw new Error("Sem permissão.");
      }
      const db = await getDb();
      if (!db) throw new Error("Database indisponível");

      await db.update(colaboradores)
        .set({ cargoPersonalizadoId: input.cargoId })
        .where(and(eq(colaboradores.id, input.colaboradorId), eq(colaboradores.escritorioId, esc.escritorio.id)));

      return { success: true };
    }),

  /** Inicializa cargos padrão (chamado uma vez) */
  inicializarPadrao: protectedProcedure.mutation(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) throw new Error("Escritório não encontrado.");
    await criarCargosDefault(esc.escritorio.id);
    return { success: true };
  }),

  /** Obtém permissões do usuário logado */
  minhasPermissoes: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return null;
    const db = await getDb();
    if (!db) return null;

    // Se é dono, tem tudo
    if (esc.colaborador.cargo === "dono") {
      const all: Record<string, any> = {};
      for (const m of MODULOS) {
        all[m] = { verTodos: true, verProprios: true, criar: true, editar: true, excluir: true };
      }
      return { cargo: "Dono", cor: "#dc2626", permissoes: all };
    }

    // Buscar cargo personalizado
    const cargoId = (esc.colaborador as any).cargoPersonalizadoId;
    if (!cargoId) {
      // Fallback: usar cargo legado
      const legado = esc.colaborador.cargo; // gestor, atendente, estagiario
      const nomeMap: Record<string, string> = { gestor: "Gestor", atendente: "Atendente", estagiario: "Estagiário" };
      const perms = PERMISSOES_PADRAO[nomeMap[legado] || "Atendente"];
      return { cargo: nomeMap[legado] || legado, cor: "#6366f1", permissoes: perms || {} };
    }

    const [cargo] = await db.select().from(cargosPersonalizados)
      .where(eq(cargosPersonalizados.id, cargoId)).limit(1);

    if (!cargo) return null;

    const perms = await db.select().from(permissoesCargo)
      .where(eq(permissoesCargo.cargoId, cargoId));

    const permMap: Record<string, any> = {};
    for (const p of perms) {
      permMap[p.modulo] = {
        verTodos: p.verTodos,
        verProprios: p.verProprios,
        criar: p.criar,
        editar: p.editar,
        excluir: p.excluir,
      };
    }

    return { cargo: cargo.nome, cor: cargo.cor || "#6366f1", permissoes: permMap };
  }),
});

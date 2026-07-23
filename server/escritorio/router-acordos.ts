/**
 * Router — Acordos (tratativas extrajudiciais de negociação).
 *
 * Visão GLOBAL do escritório: `listar` NÃO exige contatoId (ao contrário de
 * clienteProcessos), justamente pra resolver a dor de abrir cliente por
 * cliente. Gate reusa a permissão de "clientes" (acordo é vinculado a
 * cliente); `verProprios` filtra pelos acordos onde o colaborador é
 * responsável. Valores trafegam em CENTAVOS (int).
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  acordos,
  acordoTratativas,
  contatos,
  clienteProcessos,
  colaboradores,
  users,
} from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { checkPermission } from "./check-permission";
import { toIsoString } from "../_core/dates";

const STATUS = ["negociando", "proposta_enviada", "fechado", "cancelado"] as const;

/** Resolve o colaboradorId do responsável a partir de um userId (opcional). */
async function colaboradorDoUser(
  db: any,
  escritorioId: number,
  responsavelUserId: number | null | undefined,
): Promise<number | null> {
  if (!responsavelUserId) return null;
  const [c] = await db
    .select({ id: colaboradores.id })
    .from(colaboradores)
    .where(and(eq(colaboradores.escritorioId, escritorioId), eq(colaboradores.userId, responsavelUserId)))
    .limit(1);
  return c?.id ?? null;
}

export const acordosRouter = router({
  /**
   * Lista global de acordos do escritório, com o nome do cliente, do
   * responsável e o processo vinculado já resolvidos. Sem verTodos, só os
   * acordos onde o colaborador é responsável.
   */
  listar: protectedProcedure
    .input(z.object({ status: z.enum(STATUS).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "clientes", "ver");
      if (!perm.allowed) return [];
      const db = await getDb();
      if (!db) return [];

      const conds = [eq(acordos.escritorioId, perm.escritorioId)];
      if (input?.status) conds.push(eq(acordos.status, input.status));
      if (!perm.verTodos) conds.push(eq(acordos.responsavelId, perm.colaboradorId));

      const rows = await db
        .select({
          id: acordos.id,
          contatoId: acordos.contatoId,
          clienteNome: contatos.nome,
          processoId: acordos.processoId,
          processoApelido: clienteProcessos.apelido,
          processoNumeroCnj: clienteProcessos.numeroCnj,
          parteContraria: acordos.parteContraria,
          contatoContrarioNome: acordos.contatoContrarioNome,
          contatoContrarioTelefone: acordos.contatoContrarioTelefone,
          responsavelId: acordos.responsavelId,
          responsavelNome: users.name,
          valorProposta: acordos.valorProposta,
          valorInicial: acordos.valorInicial,
          valorPretendido: acordos.valorPretendido,
          valorDisponivel: acordos.valorDisponivel,
          valorFechado: acordos.valorFechado,
          status: acordos.status,
          motivoCancelamento: acordos.motivoCancelamento,
          createdAt: acordos.createdAt,
          updatedAt: acordos.updatedAt,
        })
        .from(acordos)
        .innerJoin(contatos, eq(contatos.id, acordos.contatoId))
        .leftJoin(clienteProcessos, eq(clienteProcessos.id, acordos.processoId))
        .leftJoin(colaboradores, eq(colaboradores.id, acordos.responsavelId))
        .leftJoin(users, eq(users.id, colaboradores.userId))
        .where(and(...conds))
        .orderBy(desc(acordos.updatedAt));

      return rows.map((r) => ({
        ...r,
        responsavelNome: r.responsavelNome ?? null,
        createdAt: toIsoString(r.createdAt) ?? "",
        updatedAt: toIsoString(r.updatedAt) ?? "",
      }));
    }),

  /** KPIs do topo: em negociação (qtd + valor), fechados no mês, taxa. */
  resumo: protectedProcedure.query(async ({ ctx }) => {
    const perm = await checkPermission(ctx.user.id, "clientes", "ver");
    if (!perm.allowed) return { emNegociacao: 0, valorEmNegociacao: 0, fechadosMes: 0, valorFechadoMes: 0, taxaFechamento: 0 };
    const db = await getDb();
    if (!db) return { emNegociacao: 0, valorEmNegociacao: 0, fechadosMes: 0, valorFechadoMes: 0, taxaFechamento: 0 };

    const base = [eq(acordos.escritorioId, perm.escritorioId)];
    if (!perm.verTodos) base.push(eq(acordos.responsavelId, perm.colaboradorId));

    const rows = await db
      .select({ status: acordos.status, valorProposta: acordos.valorProposta, valorFechado: acordos.valorFechado, updatedAt: acordos.updatedAt })
      .from(acordos)
      .where(and(...base));

    const agora = new Date();
    const ini = new Date(agora.getFullYear(), agora.getMonth(), 1).getTime();
    let emNegociacao = 0, valorEmNegociacao = 0, fechadosMes = 0, valorFechadoMes = 0, fechados = 0, cancelados = 0;
    for (const r of rows) {
      if (r.status === "negociando" || r.status === "proposta_enviada") {
        emNegociacao++;
        valorEmNegociacao += Number(r.valorProposta || 0);
      }
      if (r.status === "fechado") {
        fechados++;
        const at = r.updatedAt instanceof Date ? r.updatedAt.getTime() : new Date(r.updatedAt as any).getTime();
        if (at >= ini) { fechadosMes++; valorFechadoMes += Number(r.valorFechado || r.valorProposta || 0); }
      }
      if (r.status === "cancelado") cancelados++;
    }
    const encerrados = fechados + cancelados;
    const taxaFechamento = encerrados > 0 ? Math.round((fechados / encerrados) * 100) : 0;
    return { emNegociacao, valorEmNegociacao, fechadosMes, valorFechadoMes, taxaFechamento };
  }),

  /** Detalhe do acordo + histórico de tratativas. */
  obter: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "clientes", "ver");
      if (!perm.allowed) return null;
      const db = await getDb();
      if (!db) return null;

      const [a] = await db
        .select({
          id: acordos.id,
          contatoId: acordos.contatoId,
          clienteNome: contatos.nome,
          processoId: acordos.processoId,
          processoApelido: clienteProcessos.apelido,
          processoNumeroCnj: clienteProcessos.numeroCnj,
          parteContraria: acordos.parteContraria,
          contatoContrarioNome: acordos.contatoContrarioNome,
          contatoContrarioTelefone: acordos.contatoContrarioTelefone,
          responsavelId: acordos.responsavelId,
          responsavelNome: users.name,
          valorProposta: acordos.valorProposta,
          valorInicial: acordos.valorInicial,
          valorPretendido: acordos.valorPretendido,
          valorDisponivel: acordos.valorDisponivel,
          valorFechado: acordos.valorFechado,
          status: acordos.status,
          motivoCancelamento: acordos.motivoCancelamento,
          createdAt: acordos.createdAt,
          updatedAt: acordos.updatedAt,
        })
        .from(acordos)
        .innerJoin(contatos, eq(contatos.id, acordos.contatoId))
        .leftJoin(clienteProcessos, eq(clienteProcessos.id, acordos.processoId))
        .leftJoin(colaboradores, eq(colaboradores.id, acordos.responsavelId))
        .leftJoin(users, eq(users.id, colaboradores.userId))
        .where(and(eq(acordos.id, input.id), eq(acordos.escritorioId, perm.escritorioId)))
        .limit(1);
      if (!a) return null;
      if (!perm.verTodos && a.responsavelId !== perm.colaboradorId) return null;

      const trats = await db
        .select({
          id: acordoTratativas.id,
          tipo: acordoTratativas.tipo,
          valor: acordoTratativas.valor,
          conteudo: acordoTratativas.conteudo,
          createdAt: acordoTratativas.createdAt,
          autorLabel: acordoTratativas.autorLabel,
          autorNome: users.name,
        })
        .from(acordoTratativas)
        .leftJoin(users, eq(users.id, acordoTratativas.autorUserId))
        .where(eq(acordoTratativas.acordoId, input.id))
        .orderBy(desc(acordoTratativas.createdAt));

      return {
        ...a,
        createdAt: toIsoString(a.createdAt) ?? "",
        updatedAt: toIsoString(a.updatedAt) ?? "",
        tratativas: trats.map((t) => ({
          ...t,
          autor: t.autorNome ?? t.autorLabel ?? "—",
          createdAt: toIsoString(t.createdAt) ?? "",
        })),
      };
    }),

  /** Cria um acordo (registra a proposta inicial como 1ª tratativa). */
  criar: protectedProcedure
    .input(z.object({
      contatoId: z.number(),
      processoId: z.number().optional(),
      parteContraria: z.string().min(1).max(255),
      contatoContrarioNome: z.string().max(255).optional(),
      contatoContrarioTelefone: z.string().max(20).optional(),
      responsavelUserId: z.number().optional(),
      /** Marcos da negociação (centavos) — a proposta atual nasce do inicial. */
      valorInicial: z.number().int().min(0),
      valorPretendido: z.number().int().min(0),
      valorDisponivel: z.number().int().min(0),
    }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "clientes", "criar");
      if (!perm.criar) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para criar acordos." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Cliente precisa ser do escritório.
      const [cli] = await db
        .select({ id: contatos.id })
        .from(contatos)
        .where(and(eq(contatos.id, input.contatoId), eq(contatos.escritorioId, perm.escritorioId)))
        .limit(1);
      if (!cli) throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado." });

      // Processo (se informado) precisa ser do mesmo cliente/escritório.
      if (input.processoId) {
        const [p] = await db
          .select({ id: clienteProcessos.id })
          .from(clienteProcessos)
          .where(and(
            eq(clienteProcessos.id, input.processoId),
            eq(clienteProcessos.escritorioId, perm.escritorioId),
            eq(clienteProcessos.contatoId, input.contatoId),
          ))
          .limit(1);
        if (!p) throw new TRPCError({ code: "BAD_REQUEST", message: "Processo inválido para este cliente." });
      }

      // Responsável: default = o próprio criador (como colaborador).
      const responsavelId =
        (await colaboradorDoUser(db, perm.escritorioId, input.responsavelUserId)) ?? perm.colaboradorId;

      const [res] = await db.insert(acordos).values({
        escritorioId: perm.escritorioId,
        contatoId: input.contatoId,
        processoId: input.processoId ?? null,
        parteContraria: input.parteContraria,
        contatoContrarioNome: input.contatoContrarioNome ?? null,
        contatoContrarioTelefone: input.contatoContrarioTelefone ?? null,
        responsavelId,
        valorProposta: input.valorInicial,
        valorInicial: input.valorInicial,
        valorPretendido: input.valorPretendido,
        valorDisponivel: input.valorDisponivel,
        status: "negociando",
        criadoPor: ctx.user.id,
      });
      const id = (res as { insertId: number }).insertId;

      await db.insert(acordoTratativas).values({
        acordoId: id,
        autorUserId: ctx.user.id,
        tipo: "proposta",
        valor: input.valorInicial,
        conteudo: `Proposta inicial registrada`,
      });
      return { id };
    }),

  /**
   * Edita partes/contato/responsável/processo e os três marcos de valor de um
   * acordo em aberto. O cliente vinculado é imutável (definido na criação).
   * Não altera a proposta atual (essa só muda ao registrar tratativa/fechar).
   */
  editar: protectedProcedure
    .input(z.object({
      id: z.number(),
      parteContraria: z.string().min(1).max(255),
      contatoContrarioNome: z.string().max(255).optional(),
      contatoContrarioTelefone: z.string().max(20).optional(),
      responsavelUserId: z.number().nullable().optional(),
      processoId: z.number().nullable().optional(),
      valorInicial: z.number().int().min(0),
      valorPretendido: z.number().int().min(0),
      valorDisponivel: z.number().int().min(0),
    }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "clientes", "editar");
      if (!perm.editar) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para editar acordos." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [a] = await db
        .select()
        .from(acordos)
        .where(and(eq(acordos.id, input.id), eq(acordos.escritorioId, perm.escritorioId)))
        .limit(1);
      if (!a) throw new TRPCError({ code: "NOT_FOUND" });
      if (!perm.verTodos && a.responsavelId !== perm.colaboradorId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Acordo de outro responsável." });
      }
      if (a.status === "fechado" || a.status === "cancelado") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Acordo encerrado — não é mais editável." });
      }

      // Processo (se informado) precisa ser do mesmo cliente/escritório.
      if (input.processoId != null) {
        const [p] = await db
          .select({ id: clienteProcessos.id })
          .from(clienteProcessos)
          .where(and(
            eq(clienteProcessos.id, input.processoId),
            eq(clienteProcessos.escritorioId, perm.escritorioId),
            eq(clienteProcessos.contatoId, a.contatoId),
          ))
          .limit(1);
        if (!p) throw new TRPCError({ code: "BAD_REQUEST", message: "Processo inválido para este cliente." });
      }

      // Responsável só muda se o campo veio no payload; senão preserva o atual.
      const responsavelId =
        input.responsavelUserId !== undefined
          ? (await colaboradorDoUser(db, perm.escritorioId, input.responsavelUserId)) ?? a.responsavelId
          : a.responsavelId;

      await db.update(acordos)
        .set({
          parteContraria: input.parteContraria,
          contatoContrarioNome: input.contatoContrarioNome ?? null,
          contatoContrarioTelefone: input.contatoContrarioTelefone ?? null,
          responsavelId,
          processoId: input.processoId ?? null,
          valorInicial: input.valorInicial,
          valorPretendido: input.valorPretendido,
          valorDisponivel: input.valorDisponivel,
        })
        .where(eq(acordos.id, input.id));
      return { ok: true };
    }),

  /**
   * Registra uma tratativa (proposta/contraproposta/nota). Atualiza o valor
   * corrente do acordo quando a tratativa traz valor, e move o status para
   * "proposta_enviada" numa proposta nossa (se ainda negociando).
   */
  registrarTratativa: protectedProcedure
    .input(z.object({
      acordoId: z.number(),
      tipo: z.enum(["proposta", "contraproposta", "nota"]),
      valor: z.number().int().min(0).optional(),
      conteudo: z.string().min(1).max(2000),
      /** true = tratativa veio da parte contrária (autor livre, não conta como nosso). */
      daParteContraria: z.boolean().optional(),
      autorLabel: z.string().max(255).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "clientes", "editar");
      if (!perm.editar) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [a] = await db
        .select()
        .from(acordos)
        .where(and(eq(acordos.id, input.acordoId), eq(acordos.escritorioId, perm.escritorioId)))
        .limit(1);
      if (!a) throw new TRPCError({ code: "NOT_FOUND" });
      if (!perm.verTodos && a.responsavelId !== perm.colaboradorId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Acordo de outro responsável." });
      }
      if (a.status === "fechado" || a.status === "cancelado") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Acordo encerrado — não aceita novas tratativas." });
      }

      await db.insert(acordoTratativas).values({
        acordoId: input.acordoId,
        autorUserId: input.daParteContraria ? null : ctx.user.id,
        autorLabel: input.daParteContraria ? (input.autorLabel || a.contatoContrarioNome || "Parte contrária") : null,
        tipo: input.tipo,
        valor: input.valor ?? null,
        conteudo: input.conteudo,
      });

      // Atualiza valor corrente + status (proposta nossa move p/ "proposta_enviada").
      const set: Record<string, unknown> = {};
      if (input.valor != null) set.valorProposta = input.valor;
      if (input.tipo === "proposta" && !input.daParteContraria && a.status === "negociando") {
        set.status = "proposta_enviada";
      }
      if (Object.keys(set).length > 0) {
        await db.update(acordos).set(set).where(eq(acordos.id, input.acordoId));
      }
      return { ok: true };
    }),

  /** Marca o acordo como FECHADO com o valor final acordado. */
  fechar: protectedProcedure
    .input(z.object({ acordoId: z.number(), valorFechado: z.number().int().min(0) }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "clientes", "editar");
      if (!perm.editar) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [a] = await db
        .select()
        .from(acordos)
        .where(and(eq(acordos.id, input.acordoId), eq(acordos.escritorioId, perm.escritorioId)))
        .limit(1);
      if (!a) throw new TRPCError({ code: "NOT_FOUND" });
      if (!perm.verTodos && a.responsavelId !== perm.colaboradorId) throw new TRPCError({ code: "FORBIDDEN" });
      if (a.status === "fechado" || a.status === "cancelado") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Acordo já encerrado." });
      }

      await db.update(acordos)
        .set({ status: "fechado", valorFechado: input.valorFechado })
        .where(eq(acordos.id, input.acordoId));
      await db.insert(acordoTratativas).values({
        acordoId: input.acordoId,
        autorUserId: ctx.user.id,
        tipo: "fechamento",
        valor: input.valorFechado,
        conteudo: "Acordo fechado",
      });
      return { ok: true };
    }),

  /** Cancela o acordo COM motivo (o "porquê" fica no registro e na lista). */
  cancelar: protectedProcedure
    .input(z.object({ acordoId: z.number(), motivo: z.string().min(1).max(512), observacao: z.string().max(1000).optional() }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "clientes", "editar");
      if (!perm.editar) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [a] = await db
        .select()
        .from(acordos)
        .where(and(eq(acordos.id, input.acordoId), eq(acordos.escritorioId, perm.escritorioId)))
        .limit(1);
      if (!a) throw new TRPCError({ code: "NOT_FOUND" });
      if (!perm.verTodos && a.responsavelId !== perm.colaboradorId) throw new TRPCError({ code: "FORBIDDEN" });
      if (a.status === "fechado" || a.status === "cancelado") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Acordo já encerrado." });
      }

      await db.update(acordos)
        .set({ status: "cancelado", motivoCancelamento: input.motivo })
        .where(eq(acordos.id, input.acordoId));
      await db.insert(acordoTratativas).values({
        acordoId: input.acordoId,
        autorUserId: ctx.user.id,
        tipo: "cancelamento",
        conteudo: input.observacao ? `${input.motivo} — ${input.observacao}` : input.motivo,
      });
      return { ok: true };
    }),
});

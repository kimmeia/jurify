/**
 * Router tRPC — Agenda Unificada
 *
 * Lê de ambas as tabelas (agendamentos + tarefas) e retorna uma lista
 * unificada de eventos. Cada evento tem um `fonte` ("compromisso" ou "tarefa")
 * para diferenciar a origem.
 *
 * Os routers antigos (agendamentoRouter, tarefasRouter) continuam funcionando
 * para não quebrar nada. Este router é a view unificada.
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { getEscritorioPorUsuario } from "./db-escritorio";
import { agendamentos, agendamentoLembretes, tarefas, contatos, users, colaboradores } from "../../drizzle/schema";
import { eq, and, desc, gte, lte, or, like, asc, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { criarNotificacao } from "../processos/router-notificacoes";
import { checkPermission } from "./check-permission";

/** Helper: IDs dos contatos cujo responsavelId é o colaborador.
 *  Usado pra filtro verProprios em agendamentos/tarefas — assim quando
 *  um cliente é agendado, o atendente "dono" do cliente vê o evento. */
async function contatoIdsDoColaborador(
  db: any,
  escritorioId: number,
  colaboradorId: number,
): Promise<number[]> {
  const rows = await db
    .select({ id: contatos.id })
    .from(contatos)
    .where(and(
      eq(contatos.escritorioId, escritorioId),
      eq(contatos.responsavelId, colaboradorId),
    ));
  return rows.map((r: any) => r.id);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface EventoUnificado {
  id: number;
  fonte: "compromisso" | "tarefa";
  titulo: string;
  descricao?: string | null;
  dataInicio: string;
  dataFim?: string | null;
  dataVencimento?: string | null;
  diaInteiro: boolean;
  local?: string | null;
  tipo: string;
  status: string;
  prioridade: string;
  responsavelId?: number | null;
  responsavelNome?: string;
  contatoId?: number | null;
  contatoNome?: string;
  processoId?: number | null;
  cor: string;
  createdAt: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

async function requireEscritorio(userId: number) {
  const result = await getEscritorioPorUsuario(userId);
  if (!result) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Escritório não encontrado." });
  return result;
}

const CORES_TIPO: Record<string, string> = {
  prazo_processual: "#ef4444",
  audiencia: "#8b5cf6",
  reuniao_comercial: "#3b82f6",
  tarefa: "#f59e0b",
  follow_up: "#10b981",
  outro: "#6b7280",
};

const CORES_PRIORIDADE_TAREFA: Record<string, string> = {
  urgente: "#ef4444",
  alta: "#f97316",
  normal: "#3b82f6",
  baixa: "#9ca3af",
};

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTER
// ═══════════════════════════════════════════════════════════════════════════════

export const agendaRouter = router({
  /**
   * Lista unificada de eventos (compromissos + tarefas).
   * Retorna tudo ordenado por data.
   */
  listar: protectedProcedure
    .input(z.object({
      dataInicio: z.string().optional(),
      dataFim: z.string().optional(),
      fonte: z.enum(["todos", "compromisso", "tarefa"]).default("todos"),
      status: z.string().optional(),
      busca: z.string().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      // Permissão: módulo "agenda" — verTodos permite ver do escritório
      // inteiro; verProprios restringe a eventos onde o colaborador é o
      // responsável ou criador.
      const perm = await checkPermission(ctx.user.id, "agenda", "ver");
      if (!perm.allowed) return [];

      const db = await getDb();
      if (!db) return [];

      const escritorioId = perm.escritorioId;
      const filtrarProprios = !perm.verTodos && perm.verProprios;
      const eventos: EventoUnificado[] = [];

      // Mapa de nomes de colaboradores
      const colabs = await db.select({ id: colaboradores.id, userId: colaboradores.userId })
        .from(colaboradores).where(eq(colaboradores.escritorioId, escritorioId));
      const userIds = colabs.map(c => c.userId);
      const usersData = userIds.length > 0
        ? await db.select({ id: users.id, name: users.name }).from(users)
        : [];
      const colabUserMap: Record<number, number> = {};
      colabs.forEach(c => { colabUserMap[c.id] = c.userId; });
      const userNameMap: Record<number, string> = {};
      usersData.forEach(u => { userNameMap[u.id] = u.name || "Sem nome"; });

      const getColabName = (colabId: number | null | undefined) => {
        if (!colabId) return undefined;
        const userId = colabUserMap[colabId];
        return userId ? userNameMap[userId] : undefined;
      };

      // Pré-calcula clientes do colaborador (uma vez só)
      const clientesDoColab = filtrarProprios
        ? await contatoIdsDoColaborador(db, escritorioId, perm.colaboradorId)
        : [];

      // ─── COMPROMISSOS (agendamentos) ────────────────────────────────────
      if (input?.fonte !== "tarefa") {
        const agConditions: any[] = [eq(agendamentos.escritorioId, escritorioId)];

        // Permissão verProprios: ver próprios = (responsável OR criador
        // OR cliente vinculado é meu)
        if (filtrarProprios) {
          const ors: any[] = [
            eq(agendamentos.responsavelId, perm.colaboradorId),
            eq(agendamentos.criadoPorId, perm.colaboradorId),
          ];
          if (clientesDoColab.length > 0) {
            ors.push(inArray(agendamentos.contatoId, clientesDoColab));
          }
          agConditions.push(or(...ors));
        }

        if (input?.dataInicio) agConditions.push(gte(agendamentos.dataInicio, new Date(input.dataInicio)));
        if (input?.dataFim) agConditions.push(lte(agendamentos.dataInicio, new Date(input.dataFim)));
        if (input?.status) agConditions.push(eq(agendamentos.status, input.status as any));
        if (input?.busca) {
          const b = `%${input.busca}%`;
          agConditions.push(or(like(agendamentos.titulo, b), like(agendamentos.descricao, b)));
        }

        const ags = await db.select().from(agendamentos)
          .where(and(...agConditions))
          .orderBy(asc(agendamentos.dataInicio))
          .limit(200);

        for (const ag of ags) {
          eventos.push({
            id: ag.id,
            fonte: "compromisso",
            titulo: ag.titulo,
            descricao: ag.descricao,
            dataInicio: (ag.dataInicio as Date).toISOString(),
            dataFim: ag.dataFim ? (ag.dataFim as Date).toISOString() : null,
            dataVencimento: null,
            diaInteiro: ag.diaInteiro,
            local: ag.local,
            tipo: ag.tipo,
            status: ag.status,
            prioridade: ag.prioridade,
            responsavelId: ag.responsavelId,
            responsavelNome: getColabName(ag.responsavelId),
            contatoId: null,
            processoId: ag.processoId,
            cor: ag.corHex || CORES_TIPO[ag.tipo] || "#3b82f6",
            createdAt: (ag.createdAt as Date).toISOString(),
          });
        }
      }

      // ─── TAREFAS ────────────────────────────────────────────────────────
      if (input?.fonte !== "compromisso") {
        const tConditions: any[] = [eq(tarefas.escritorioId, escritorioId)];

        if (filtrarProprios) {
          const ors: any[] = [
            eq(tarefas.responsavelId, perm.colaboradorId),
            eq(tarefas.criadoPor, perm.colaboradorId),
          ];
          if (clientesDoColab.length > 0) {
            ors.push(inArray(tarefas.contatoId, clientesDoColab));
          }
          tConditions.push(or(...ors));
        }

        if (input?.dataInicio && input?.dataFim) {
          tConditions.push(gte(tarefas.dataVencimento, new Date(input.dataInicio)));
          tConditions.push(lte(tarefas.dataVencimento, new Date(input.dataFim)));
        }
        if (input?.status) {
          // Mapear status unificado para status de tarefa
          const statusMap: Record<string, string> = {
            pendente: "pendente",
            em_andamento: "em_andamento",
            concluido: "concluida",
            cancelado: "cancelada",
          };
          tConditions.push(eq(tarefas.status, (statusMap[input.status] || input.status) as any));
        }
        if (input?.busca) {
          const b = `%${input.busca}%`;
          tConditions.push(or(like(tarefas.titulo, b), like(tarefas.descricao, b)));
        }

        const trs = await db.select().from(tarefas)
          .where(and(...tConditions))
          .orderBy(asc(tarefas.dataVencimento))
          .limit(200);

        // Buscar nomes dos contatos vinculados
        const contatoIds = [...new Set(trs.filter(t => t.contatoId).map(t => t.contatoId!))];
        const contatosMap: Record<number, string> = {};
        if (contatoIds.length > 0) {
          for (const cid of contatoIds) {
            const [c] = await db.select({ nome: contatos.nome }).from(contatos).where(eq(contatos.id, cid)).limit(1);
            if (c) contatosMap[cid] = c.nome;
          }
        }

        for (const t of trs) {
          const venc = t.dataVencimento ? (t.dataVencimento as Date).toISOString() : new Date().toISOString();
          eventos.push({
            id: t.id,
            fonte: "tarefa",
            titulo: t.titulo,
            descricao: t.descricao,
            dataInicio: venc,
            dataFim: null,
            dataVencimento: venc,
            diaInteiro: true,
            local: null,
            tipo: "tarefa",
            status: t.status === "concluida" ? "concluido" : t.status === "cancelada" ? "cancelado" : t.status,
            prioridade: t.prioridade === "urgente" ? "critica" : t.prioridade,
            responsavelId: t.responsavelId,
            responsavelNome: getColabName(t.responsavelId),
            contatoId: t.contatoId,
            contatoNome: t.contatoId ? contatosMap[t.contatoId] : undefined,
            processoId: t.processoId,
            cor: CORES_PRIORIDADE_TAREFA[t.prioridade] || "#f59e0b",
            createdAt: (t.createdAt as Date).toISOString(),
          });
        }
      }

      // Ordenar tudo por dataInicio
      eventos.sort((a, b) => new Date(a.dataInicio).getTime() - new Date(b.dataInicio).getTime());

      return eventos;
    }),

  /**
   * Eventos de hoje e amanhã (para a view "Hoje" e notificações).
   * Respeita verProprios igual ao listar.
   */
  hoje: protectedProcedure.query(async ({ ctx }) => {
    const perm = await checkPermission(ctx.user.id, "agenda", "ver");
    if (!perm.allowed) return { hoje: [], amanha: [], atrasados: [] };

    const db = await getDb();
    if (!db) return { hoje: [], amanha: [], atrasados: [] };

    const escritorioId = perm.escritorioId;
    const filtrarProprios = !perm.verTodos && perm.verProprios;
    const clientesDoColab = filtrarProprios
      ? await contatoIdsDoColaborador(db, escritorioId, perm.colaboradorId)
      : [];

    // Helpers de filtro reutilizados (compromissos x tarefas)
    const agOwn = filtrarProprios
      ? [or(
          eq(agendamentos.responsavelId, perm.colaboradorId),
          eq(agendamentos.criadoPorId, perm.colaboradorId),
          ...(clientesDoColab.length > 0 ? [inArray(agendamentos.contatoId, clientesDoColab)] : []),
        )!]
      : [];
    const tOwn = filtrarProprios
      ? [or(
          eq(tarefas.responsavelId, perm.colaboradorId),
          eq(tarefas.criadoPor, perm.colaboradorId),
          ...(clientesDoColab.length > 0 ? [inArray(tarefas.contatoId, clientesDoColab)] : []),
        )!]
      : [];

    const now = new Date();
    const hojeInicio = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const hojeFim = new Date(hojeInicio.getTime() + 86400000);
    const amanhaFim = new Date(hojeInicio.getTime() + 172800000);

    const compromissosHoje = await db.select().from(agendamentos)
      .where(and(
        eq(agendamentos.escritorioId, escritorioId),
        gte(agendamentos.dataInicio, hojeInicio),
        lte(agendamentos.dataInicio, hojeFim),
        or(eq(agendamentos.status, "pendente"), eq(agendamentos.status, "em_andamento")),
        ...agOwn,
      )).orderBy(asc(agendamentos.dataInicio));

    const compromissosAmanha = await db.select().from(agendamentos)
      .where(and(
        eq(agendamentos.escritorioId, escritorioId),
        gte(agendamentos.dataInicio, hojeFim),
        lte(agendamentos.dataInicio, amanhaFim),
        or(eq(agendamentos.status, "pendente"), eq(agendamentos.status, "em_andamento")),
        ...agOwn,
      )).orderBy(asc(agendamentos.dataInicio));

    const tarefasHoje = await db.select().from(tarefas)
      .where(and(
        eq(tarefas.escritorioId, escritorioId),
        gte(tarefas.dataVencimento, hojeInicio),
        lte(tarefas.dataVencimento, hojeFim),
        or(eq(tarefas.status, "pendente"), eq(tarefas.status, "em_andamento")),
        ...tOwn,
      ));

    const tarefasAmanha = await db.select().from(tarefas)
      .where(and(
        eq(tarefas.escritorioId, escritorioId),
        gte(tarefas.dataVencimento, hojeFim),
        lte(tarefas.dataVencimento, amanhaFim),
        or(eq(tarefas.status, "pendente"), eq(tarefas.status, "em_andamento")),
        ...tOwn,
      ));

    const compromissosAtrasados = await db.select().from(agendamentos)
      .where(and(
        eq(agendamentos.escritorioId, escritorioId),
        lte(agendamentos.dataInicio, hojeInicio),
        or(eq(agendamentos.status, "pendente"), eq(agendamentos.status, "em_andamento")),
        ...agOwn,
      )).orderBy(asc(agendamentos.dataInicio));

    const tarefasAtrasadas = await db.select().from(tarefas)
      .where(and(
        eq(tarefas.escritorioId, escritorioId),
        lte(tarefas.dataVencimento, hojeInicio),
        or(eq(tarefas.status, "pendente"), eq(tarefas.status, "em_andamento")),
        ...tOwn,
      ));

    const format = (item: any, fonte: "compromisso" | "tarefa") => ({
      id: item.id,
      fonte,
      titulo: item.titulo || item.tituloTarefa,
      tipo: fonte === "compromisso" ? item.tipo : "tarefa",
      status: item.status,
      prioridade: item.prioridade || item.prioridadeTarefa || "normal",
      dataInicio: fonte === "compromisso"
        ? (item.dataInicio as Date).toISOString()
        : item.dataVencimento ? (item.dataVencimento as Date).toISOString() : "",
      cor: fonte === "compromisso" ? (item.corHex || CORES_TIPO[item.tipo] || "#3b82f6") : CORES_PRIORIDADE_TAREFA[item.prioridade] || "#f59e0b",
    });

    return {
      hoje: [
        ...compromissosHoje.map(c => format(c, "compromisso")),
        ...tarefasHoje.map(t => format(t, "tarefa")),
      ],
      amanha: [
        ...compromissosAmanha.map(c => format(c, "compromisso")),
        ...tarefasAmanha.map(t => format(t, "tarefa")),
      ],
      atrasados: [
        ...compromissosAtrasados.map(c => format(c, "compromisso")),
        ...tarefasAtrasadas.map(t => format(t, "tarefa")),
      ],
    };
  }),

  /**
   * Contadores unificados para badge no sidebar.
   * Respeita verProprios.
   */
  contadores: protectedProcedure.query(async ({ ctx }) => {
    const perm = await checkPermission(ctx.user.id, "agenda", "ver");
    if (!perm.allowed) return { hojeCount: 0, atrasadosCount: 0, pendentesCount: 0 };

    const db = await getDb();
    if (!db) return { hojeCount: 0, atrasadosCount: 0, pendentesCount: 0 };

    const escritorioId = perm.escritorioId;
    const filtrarProprios = !perm.verTodos && perm.verProprios;
    const clientesDoColab = filtrarProprios
      ? await contatoIdsDoColaborador(db, escritorioId, perm.colaboradorId)
      : [];

    const agOwn = filtrarProprios
      ? [or(
          eq(agendamentos.responsavelId, perm.colaboradorId),
          eq(agendamentos.criadoPorId, perm.colaboradorId),
          ...(clientesDoColab.length > 0 ? [inArray(agendamentos.contatoId, clientesDoColab)] : []),
        )!]
      : [];
    const tOwn = filtrarProprios
      ? [or(
          eq(tarefas.responsavelId, perm.colaboradorId),
          eq(tarefas.criadoPor, perm.colaboradorId),
          ...(clientesDoColab.length > 0 ? [inArray(tarefas.contatoId, clientesDoColab)] : []),
        )!]
      : [];

    const now = new Date();
    const hojeInicio = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const hojeFim = new Date(hojeInicio.getTime() + 86400000);

    const agHoje = await db.select({ id: agendamentos.id }).from(agendamentos)
      .where(and(
        eq(agendamentos.escritorioId, escritorioId),
        gte(agendamentos.dataInicio, hojeInicio),
        lte(agendamentos.dataInicio, hojeFim),
        or(eq(agendamentos.status, "pendente"), eq(agendamentos.status, "em_andamento")),
        ...agOwn,
      ));

    const tHoje = await db.select({ id: tarefas.id }).from(tarefas)
      .where(and(
        eq(tarefas.escritorioId, escritorioId),
        gte(tarefas.dataVencimento, hojeInicio),
        lte(tarefas.dataVencimento, hojeFim),
        or(eq(tarefas.status, "pendente"), eq(tarefas.status, "em_andamento")),
        ...tOwn,
      ));

    const agAtrasados = await db.select({ id: agendamentos.id }).from(agendamentos)
      .where(and(
        eq(agendamentos.escritorioId, escritorioId),
        lte(agendamentos.dataInicio, hojeInicio),
        or(eq(agendamentos.status, "pendente"), eq(agendamentos.status, "em_andamento")),
        ...agOwn,
      ));

    const tAtrasados = await db.select({ id: tarefas.id }).from(tarefas)
      .where(and(
        eq(tarefas.escritorioId, escritorioId),
        lte(tarefas.dataVencimento, hojeInicio),
        or(eq(tarefas.status, "pendente"), eq(tarefas.status, "em_andamento")),
        ...tOwn,
      ));

    const agPendentes = await db.select({ id: agendamentos.id }).from(agendamentos)
      .where(and(
        eq(agendamentos.escritorioId, escritorioId),
        or(eq(agendamentos.status, "pendente"), eq(agendamentos.status, "em_andamento")),
        ...agOwn,
      ));

    const tPendentes = await db.select({ id: tarefas.id }).from(tarefas)
      .where(and(
        eq(tarefas.escritorioId, escritorioId),
        or(eq(tarefas.status, "pendente"), eq(tarefas.status, "em_andamento")),
        ...tOwn,
      ));

    return {
      hojeCount: agHoje.length + tHoje.length,
      atrasadosCount: agAtrasados.length + tAtrasados.length,
      pendentesCount: agPendentes.length + tPendentes.length,
    };
  }),

  /**
   * Criar compromisso (usa o agendamento router existente internamente).
   */
  criarCompromisso: protectedProcedure
    .input(z.object({
      tipo: z.enum(["prazo_processual", "audiencia", "reuniao_comercial", "follow_up", "outro"]),
      titulo: z.string().min(1).max(255),
      descricao: z.string().max(2000).optional(),
      dataInicio: z.string(),
      dataFim: z.string().optional(),
      diaInteiro: z.boolean().optional(),
      local: z.string().max(512).optional(),
      prioridade: z.enum(["baixa", "normal", "alta", "critica"]).optional(),
      responsavelId: z.number().optional(),
      contatoId: z.number().optional(),
      processoId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "agenda", "criar");
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para criar compromissos." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Se o compromisso é vinculado a um cliente, e o usuário não definiu
      // explicitamente um responsável, atribui automaticamente ao
      // responsável do próprio cliente — assim o agendamento "pertence"
      // a ele desde o início e não some quando outra pessoa cria.
      let responsavelId = input.responsavelId;
      if (!responsavelId && input.contatoId) {
        const [c] = await db.select({ responsavelId: contatos.responsavelId })
          .from(contatos)
          .where(and(eq(contatos.id, input.contatoId), eq(contatos.escritorioId, perm.escritorioId)))
          .limit(1);
        if (c?.responsavelId) responsavelId = c.responsavelId;
      }

      const [result] = await db.insert(agendamentos).values({
        escritorioId: perm.escritorioId,
        criadoPorId: perm.colaboradorId,
        responsavelId: responsavelId ?? perm.colaboradorId,
        tipo: input.tipo,
        titulo: input.titulo,
        descricao: input.descricao,
        dataInicio: new Date(input.dataInicio),
        dataFim: input.dataFim ? new Date(input.dataFim) : null,
        diaInteiro: input.diaInteiro ?? false,
        local: input.local,
        prioridade: input.prioridade ?? "normal",
        contatoId: input.contatoId,
        processoId: input.processoId,
        corHex: CORES_TIPO[input.tipo] || "#3b82f6",
      }).$returningId();

      return { id: result.id, fonte: "compromisso" };
    }),

  /**
   * Criar tarefa.
   */
  criarTarefa: protectedProcedure
    .input(z.object({
      titulo: z.string().min(1).max(255),
      descricao: z.string().max(2000).optional(),
      dataVencimento: z.string().optional(),
      prioridade: z.enum(["baixa", "normal", "alta", "urgente"]).optional(),
      responsavelId: z.number().optional(),
      contatoId: z.number().optional(),
      processoId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "agenda", "criar");
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para criar tarefas." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Se vinculada a cliente e sem responsável explícito, herda do cliente
      let responsavelId = input.responsavelId;
      if (!responsavelId && input.contatoId) {
        const [c] = await db.select({ responsavelId: contatos.responsavelId })
          .from(contatos)
          .where(and(eq(contatos.id, input.contatoId), eq(contatos.escritorioId, perm.escritorioId)))
          .limit(1);
        if (c?.responsavelId) responsavelId = c.responsavelId;
      }

      const [result] = await db.insert(tarefas).values({
        escritorioId: perm.escritorioId,
        criadoPor: perm.colaboradorId,
        responsavelId: responsavelId ?? null,
        titulo: input.titulo,
        descricao: input.descricao,
        dataVencimento: input.dataVencimento ? new Date(input.dataVencimento) : null,
        prioridade: input.prioridade ?? "normal",
        contatoId: input.contatoId,
        processoId: input.processoId,
      }).$returningId();

      return { id: result.id, fonte: "tarefa" };
    }),

  /**
   * Atualiza status de um evento (compromisso ou tarefa).
   */
  atualizarStatus: protectedProcedure
    .input(z.object({
      id: z.number(),
      fonte: z.enum(["compromisso", "tarefa"]),
      status: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "agenda", "editar");
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para editar." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Se só pode editar próprios, verifica ownership antes de escrever
      if (!perm.verTodos && perm.verProprios) {
        if (input.fonte === "compromisso") {
          const [ag] = await db.select({ responsavelId: agendamentos.responsavelId, criadoPorId: agendamentos.criadoPorId })
            .from(agendamentos)
            .where(and(eq(agendamentos.id, input.id), eq(agendamentos.escritorioId, perm.escritorioId)))
            .limit(1);
          if (!ag) throw new TRPCError({ code: "NOT_FOUND", message: "Compromisso não encontrado." });
          if (ag.responsavelId !== perm.colaboradorId && ag.criadoPorId !== perm.colaboradorId) {
            throw new TRPCError({ code: "FORBIDDEN", message: "Você só pode editar seus próprios compromissos." });
          }
        } else {
          const [t] = await db.select({ responsavelId: tarefas.responsavelId, criadoPor: tarefas.criadoPor })
            .from(tarefas)
            .where(and(eq(tarefas.id, input.id), eq(tarefas.escritorioId, perm.escritorioId)))
            .limit(1);
          if (!t) throw new TRPCError({ code: "NOT_FOUND", message: "Tarefa não encontrada." });
          if (t.responsavelId !== perm.colaboradorId && t.criadoPor !== perm.colaboradorId) {
            throw new TRPCError({ code: "FORBIDDEN", message: "Você só pode editar suas próprias tarefas." });
          }
        }
      }

      if (input.fonte === "compromisso") {
        await db.update(agendamentos)
          .set({ status: input.status as any })
          .where(and(eq(agendamentos.id, input.id), eq(agendamentos.escritorioId, perm.escritorioId)));
      } else {
        const statusMap: Record<string, string> = {
          concluido: "concluida",
          cancelado: "cancelada",
          pendente: "pendente",
          em_andamento: "em_andamento",
        };
        await db.update(tarefas)
          .set({
            status: (statusMap[input.status] || input.status) as any,
            concluidaAt: input.status === "concluido" ? new Date() : null,
          })
          .where(and(eq(tarefas.id, input.id), eq(tarefas.escritorioId, perm.escritorioId)));
      }

      return { success: true };
    }),

  /**
   * Exclui um evento.
   */
  excluir: protectedProcedure
    .input(z.object({
      id: z.number(),
      fonte: z.enum(["compromisso", "tarefa"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "agenda", "excluir");
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para excluir." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Se só pode mexer nos próprios, verifica ownership
      if (!perm.verTodos && perm.verProprios) {
        if (input.fonte === "compromisso") {
          const [ag] = await db.select({ responsavelId: agendamentos.responsavelId, criadoPorId: agendamentos.criadoPorId })
            .from(agendamentos)
            .where(and(eq(agendamentos.id, input.id), eq(agendamentos.escritorioId, perm.escritorioId)))
            .limit(1);
          if (!ag) throw new TRPCError({ code: "NOT_FOUND" });
          if (ag.responsavelId !== perm.colaboradorId && ag.criadoPorId !== perm.colaboradorId) {
            throw new TRPCError({ code: "FORBIDDEN", message: "Você só pode excluir seus próprios compromissos." });
          }
        } else {
          const [t] = await db.select({ responsavelId: tarefas.responsavelId, criadoPor: tarefas.criadoPor })
            .from(tarefas)
            .where(and(eq(tarefas.id, input.id), eq(tarefas.escritorioId, perm.escritorioId)))
            .limit(1);
          if (!t) throw new TRPCError({ code: "NOT_FOUND" });
          if (t.responsavelId !== perm.colaboradorId && t.criadoPor !== perm.colaboradorId) {
            throw new TRPCError({ code: "FORBIDDEN", message: "Você só pode excluir suas próprias tarefas." });
          }
        }
      }

      if (input.fonte === "compromisso") {
        await db.delete(agendamentos).where(and(eq(agendamentos.id, input.id), eq(agendamentos.escritorioId, perm.escritorioId)));
      } else {
        await db.delete(tarefas).where(and(eq(tarefas.id, input.id), eq(tarefas.escritorioId, perm.escritorioId)));
      }

      return { success: true };
    }),
});

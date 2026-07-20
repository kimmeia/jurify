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
import { escapeLikePattern } from "../_core/sql-helpers";
import { getDb } from "../db";
import { toIsoString } from "../_core/dates";
import { getEscritorioPorUsuario } from "./db-escritorio";
import { agendamentos, agendamentoLembretes, agendamentoAnexos, tarefas, contatos, users, colaboradores, escritorios } from "../../drizzle/schema";
import { eq, and, desc, gte, lte, or, like, asc, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { criarNotificacao } from "../processos/router-notificacoes";
import { checkPermission } from "./check-permission";
import {
  listarBloqueios,
  criarBloqueio,
  excluirBloqueio,
  importarFeriadosNacionais,
} from "./db-agenda-bloqueios";
import {
  FUSO_HORARIO_PADRAO,
  inicioDoDiaNoFuso,
  fimDoDiaNoFuso,
  dataHojeBR,
} from "../../shared/escritorio-types";

/**
 * Lê o `fusoHorario` do escritório (configurado pelo dono em
 * Configurações → Escritório). Default `FUSO_HORARIO_PADRAO` se não
 * encontrar — preserva comportamento histórico em escritórios antigos
 * que ainda não migraram a coluna.
 */
async function obterFusoHorarioEscritorio(
  db: any,
  escritorioId: number,
): Promise<string> {
  const [row] = await db
    .select({ fusoHorario: escritorios.fusoHorario })
    .from(escritorios)
    .where(eq(escritorios.id, escritorioId))
    .limit(1);
  return row?.fusoHorario || FUSO_HORARIO_PADRAO;
}

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
  contatoTelefone?: string | null;
  processoId?: number | null;
  cor: string;
  createdAt: string;
  comparecimento?: string | null;
  observacaoAtendimento?: string | null;
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

      // Fuso horário do escritório — base dos filtros `dataInicio/dataFim`
      // pra que "filtrar pelo dia 17/05" inclua TUDO entre 00h e 23h59
      // no fuso BR do operador (não no UTC do server Railway).
      const fusoHorario = await obterFusoHorarioEscritorio(db, escritorioId);

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

      // Teto de eventos: com intervalo de datas (calendário/Período) o resultado
      // já é limitado pelo período, então usa um teto alto pra não cortar dias
      // de meses cheios (>200 eventos sumia do dia 22 em diante). Sem intervalo
      // (lista aberta) mantém 200 como proteção contra acervo gigante.
      const limiteEventos = input?.dataInicio && input?.dataFim ? 3000 : 200;

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

        // `inicioDoDiaNoFuso` / `fimDoDiaNoFuso` interpretam o YYYY-MM-DD
        // como dia local NO FUSO DO ESCRITÓRIO, convertendo pra instante
        // UTC pra bater com as colunas DATETIME (MySQL armazena em UTC).
        // Sem isso, `new Date("2026-05-17")` virava `2026-05-17T00:00:00Z`,
        // que em SP é 16/05 às 21h — perdendo eventos do dia 17 todo.
        if (input?.dataInicio) {
          agConditions.push(
            gte(agendamentos.dataInicio, inicioDoDiaNoFuso(input.dataInicio, fusoHorario)),
          );
        }
        if (input?.dataFim) {
          agConditions.push(
            lte(agendamentos.dataInicio, fimDoDiaNoFuso(input.dataFim, fusoHorario)),
          );
        }
        if (input?.status) agConditions.push(eq(agendamentos.status, input.status as any));
        if (input?.busca) {
          const b = `%${escapeLikePattern(input.busca)}%`;
          agConditions.push(or(like(agendamentos.titulo, b), like(agendamentos.descricao, b)));
        }

        const ags = await db.select().from(agendamentos)
          .where(and(...agConditions))
          .orderBy(asc(agendamentos.dataInicio))
          .limit(limiteEventos);

        for (const ag of ags) {
          eventos.push({
            id: ag.id,
            fonte: "compromisso",
            titulo: ag.titulo,
            descricao: ag.descricao,
            dataInicio: toIsoString(ag.dataInicio) ?? "",
            dataFim: toIsoString(ag.dataFim),
            dataVencimento: null,
            diaInteiro: ag.diaInteiro,
            local: ag.local,
            tipo: ag.tipo,
            status: ag.status,
            prioridade: ag.prioridade,
            responsavelId: ag.responsavelId,
            responsavelNome: getColabName(ag.responsavelId),
            contatoId: ag.contatoId,
            contatoTelefone: ag.contatoTelefone,
            processoId: ag.processoId,
            cor: ag.corHex || CORES_TIPO[ag.tipo] || "#3b82f6",
            createdAt: toIsoString(ag.createdAt) ?? "",
            comparecimento: ag.comparecimento,
            observacaoAtendimento: ag.observacaoAtendimento,
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
          tConditions.push(
            gte(tarefas.dataVencimento, inicioDoDiaNoFuso(input.dataInicio, fusoHorario)),
          );
          tConditions.push(
            lte(tarefas.dataVencimento, fimDoDiaNoFuso(input.dataFim, fusoHorario)),
          );
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
          const b = `%${escapeLikePattern(input.busca)}%`;
          tConditions.push(or(like(tarefas.titulo, b), like(tarefas.descricao, b)));
        }

        const trs = await db.select().from(tarefas)
          .where(and(...tConditions))
          .orderBy(asc(tarefas.dataVencimento))
          .limit(limiteEventos);

        // Buscar nomes dos contatos vinculados
        const contatoIds = [...new Set(trs.filter(t => t.contatoId).map(t => t.contatoId!))];
        const contatosMap: Record<number, string> = {};
        if (contatoIds.length > 0) {
          for (const cid of contatoIds) {
            const [c] = await db.select({ nome: contatos.nome }).from(contatos).where(eq(contatos.id, cid)).limit(1);
            if (c) contatosMap[cid] = c.nome;
          }
        }

        // Fallback de tarefa sem `dataVencimento`: usa início do dia
        // ATUAL no fuso do escritório (não no UTC do server). Antes, em
        // SP às 22h BRT, o `new Date().toISOString()` retornava o
        // instante UTC já no dia seguinte — a tarefa aparecia no agrupador
        // "amanhã" do calendário em vez de hoje. Em Manaus piora 1h.
        const fallbackVenc = inicioDoDiaNoFuso(dataHojeBR(fusoHorario), fusoHorario).toISOString();

        for (const t of trs) {
          const venc = toIsoString(t.dataVencimento) ?? fallbackVenc;
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
            createdAt: toIsoString(t.createdAt) ?? "",
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

    // "Hoje" e "amanhã" no FUSO do escritório, não no UTC do server.
    // Server Railway/AWS roda em UTC — pra um operador em SP às 22h BRT,
    // `now.getDate()` retornava o dia seguinte (UTC já passou meia-noite),
    // e o painel "Hoje" mostrava os compromissos de amanhã. Pior em
    // Manaus (UTC-4): a falha começava às 20h local.
    const fusoHorario = await obterFusoHorarioEscritorio(db, escritorioId);
    const hojeYmd = dataHojeBR(fusoHorario);
    const hojeInicio = inicioDoDiaNoFuso(hojeYmd, fusoHorario);
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
        ? (toIsoString(item.dataInicio) ?? "")
        : (toIsoString(item.dataVencimento) ?? ""),
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

    // "Hoje" precisa ser calculado no fuso do escritório — servidor Railway
    // roda em UTC, então `new Date(now.getFullYear(), ...)` produzia o dia
    // ERRADO após 21h BRT (já era dia+1 em UTC). Usuários paulistas viam
    // badge "Hoje: 0" às 22h enquanto tinham 5 compromissos pra amanhã ainda.
    const [esc] = await db
      .select({ fusoHorario: escritorios.fusoHorario })
      .from(escritorios)
      .where(eq(escritorios.id, escritorioId))
      .limit(1);
    const fuso = esc?.fusoHorario || FUSO_HORARIO_PADRAO;
    const hojeStr = dataHojeBR(fuso);
    const hojeInicio = inicioDoDiaNoFuso(hojeStr, fuso);
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
      contatoTelefone: z.string().max(64).optional(),
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
        contatoTelefone: input.contatoTelefone,
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
      // Resultado do atendimento (só compromisso). Gravados junto ao concluir.
      comparecimento: z.enum(["compareceu", "nao_compareceu", "remarcado"]).nullable().optional(),
      observacaoAtendimento: z.string().max(2000).nullable().optional(),
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
        const set: Record<string, unknown> = { status: input.status as any };
        if (input.comparecimento !== undefined) set.comparecimento = input.comparecimento;
        if (input.observacaoAtendimento !== undefined) set.observacaoAtendimento = input.observacaoAtendimento;
        await db.update(agendamentos)
          .set(set)
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
   * Atualiza um evento existente (título, data, tipo, local, descrição,
   * prioridade, cliente, processo). Compatível com compromissos E tarefas
   * — campos não suportados pela tarefa são ignorados.
   */
  atualizar: protectedProcedure
    .input(z.object({
      id: z.number(),
      fonte: z.enum(["compromisso", "tarefa"]),
      titulo: z.string().min(1).max(255).optional(),
      descricao: z.string().max(2000).nullable().optional(),
      dataInicio: z.string().optional(),
      dataFim: z.string().nullable().optional(),
      diaInteiro: z.boolean().optional(),
      tipo: z.enum(["prazo_processual", "audiencia", "reuniao_comercial", "follow_up", "outro"]).optional(),
      local: z.string().max(512).nullable().optional(),
      prioridade: z.enum(["baixa", "normal", "alta", "critica", "urgente"]).optional(),
      contatoId: z.number().nullable().optional(),
      contatoTelefone: z.string().max(64).nullable().optional(),
      processoId: z.number().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "agenda", "editar");
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para editar." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Ownership check pra quem só pode editar próprios
      if (!perm.verTodos) {
        if (input.fonte === "compromisso") {
          const [r] = await db.select({ responsavelId: agendamentos.responsavelId })
            .from(agendamentos).where(and(eq(agendamentos.id, input.id), eq(agendamentos.escritorioId, perm.escritorioId))).limit(1);
          if (!r || r.responsavelId !== perm.colaboradorId) {
            throw new TRPCError({ code: "FORBIDDEN", message: "Você só pode editar seus próprios compromissos." });
          }
        } else {
          const [r] = await db.select({ responsavelId: tarefas.responsavelId })
            .from(tarefas).where(and(eq(tarefas.id, input.id), eq(tarefas.escritorioId, perm.escritorioId))).limit(1);
          if (!r || r.responsavelId !== perm.colaboradorId) {
            throw new TRPCError({ code: "FORBIDDEN", message: "Você só pode editar suas próprias tarefas." });
          }
        }
      }

      if (input.fonte === "compromisso") {
        const updates: Record<string, unknown> = {};
        if (input.titulo !== undefined) updates.titulo = input.titulo;
        if (input.descricao !== undefined) updates.descricao = input.descricao;
        if (input.dataInicio !== undefined) updates.dataInicio = new Date(input.dataInicio);
        if (input.dataFim !== undefined) updates.dataFim = input.dataFim ? new Date(input.dataFim) : null;
        if (input.diaInteiro !== undefined) updates.diaInteiro = input.diaInteiro;
        if (input.tipo !== undefined) {
          updates.tipo = input.tipo;
          updates.corHex = CORES_TIPO[input.tipo] || "#3b82f6";
        }
        if (input.local !== undefined) updates.local = input.local;
        if (input.prioridade !== undefined && input.prioridade !== "urgente") updates.prioridade = input.prioridade;
        if (input.contatoId !== undefined) updates.contatoId = input.contatoId;
        if (input.contatoTelefone !== undefined) updates.contatoTelefone = input.contatoTelefone;
        if (input.processoId !== undefined) updates.processoId = input.processoId;
        if (Object.keys(updates).length > 0) {
          await db.update(agendamentos).set(updates).where(and(eq(agendamentos.id, input.id), eq(agendamentos.escritorioId, perm.escritorioId)));
        }
      } else {
        const updates: Record<string, unknown> = {};
        if (input.titulo !== undefined) updates.titulo = input.titulo;
        if (input.descricao !== undefined) updates.descricao = input.descricao;
        if (input.dataInicio !== undefined) updates.dataVencimento = new Date(input.dataInicio);
        if (input.prioridade !== undefined && input.prioridade !== "critica") updates.prioridade = input.prioridade;
        if (input.contatoId !== undefined) updates.contatoId = input.contatoId;
        if (input.processoId !== undefined) updates.processoId = input.processoId;
        if (Object.keys(updates).length > 0) {
          await db.update(tarefas).set(updates).where(and(eq(tarefas.id, input.id), eq(tarefas.escritorioId, perm.escritorioId)));
        }
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

  // ───────────────────────────────────────────────────────────────────────
  // LEMBRETES — gerenciados separadamente do agendamento principal
  // ───────────────────────────────────────────────────────────────────────

  /** Lista os lembretes de um agendamento (não suportado pra tarefas hoje). */
  listarLembretes: protectedProcedure
    .input(z.object({ agendamentoId: z.number() }))
    .query(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "agenda", "ver");
      if (!perm.allowed) return [];
      const db = await getDb();
      if (!db) return [];

      const rows = await db
        .select()
        .from(agendamentoLembretes)
        .where(eq(agendamentoLembretes.agendamentoId, input.agendamentoId))
        .orderBy(asc(agendamentoLembretes.minutosAntes));

      return rows;
    }),

  /** Salva os lembretes de um agendamento — substitui tudo (deleta antigos + insere novos).
   *  Pra UX simplificada: usuário escolhe presets de minutos + destinatários + canais. */
  salvarLembretes: protectedProcedure
    .input(z.object({
      agendamentoId: z.number(),
      lembretes: z.array(z.object({
        minutosAntes: z.number().int().positive().max(60 * 24 * 30), // 30 dias antes max
        destinatarioIds: z.array(z.number().int().positive()).min(1),
        canais: z.array(z.enum(["notificacao_app", "email", "whatsapp"])).min(1),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "agenda", "editar");
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Busca dataInicio do agendamento pra calcular dispararEm de cada lembrete
      const [ag] = await db.select({ dataInicio: agendamentos.dataInicio, escritorioId: agendamentos.escritorioId })
        .from(agendamentos)
        .where(eq(agendamentos.id, input.agendamentoId))
        .limit(1);
      if (!ag || ag.escritorioId !== perm.escritorioId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Agendamento não encontrado." });
      }

      // Apaga lembretes existentes e insere novos. Mais simples que diff.
      await db.delete(agendamentoLembretes).where(eq(agendamentoLembretes.agendamentoId, input.agendamentoId));

      if (input.lembretes.length === 0) return { ok: true, criados: 0 };

      const inicio = new Date(ag.dataInicio).getTime();
      const inserts = input.lembretes.map((l) => ({
        agendamentoId: input.agendamentoId,
        // `tipo` permanece pelo legado — usa o 1º canal
        tipo: l.canais[0] as "notificacao_app" | "email" | "whatsapp",
        minutosAntes: l.minutosAntes,
        destinatarioIds: l.destinatarioIds,
        canais: l.canais,
        dispararEm: new Date(inicio - l.minutosAntes * 60_000),
        enviado: false,
      }));

      await db.insert(agendamentoLembretes).values(inserts);

      return { ok: true, criados: inserts.length };
    }),

  /** Remove um lembrete específico. */
  removerLembrete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "agenda", "editar");
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // `agendamento_lembretes` não tem escritorioId — a tenancy vem do
      // agendamento pai (mesmo padrão de salvarLembretes acima). Sem o join,
      // qualquer usuário com agenda.editar apagava lembrete de outro
      // escritório por id.
      const [lem] = await db
        .select({ id: agendamentoLembretes.id })
        .from(agendamentoLembretes)
        .innerJoin(agendamentos, eq(agendamentoLembretes.agendamentoId, agendamentos.id))
        .where(and(eq(agendamentoLembretes.id, input.id), eq(agendamentos.escritorioId, perm.escritorioId)))
        .limit(1);
      if (!lem) throw new TRPCError({ code: "NOT_FOUND", message: "Lembrete não encontrado." });

      await db.delete(agendamentoLembretes).where(eq(agendamentoLembretes.id, input.id));
      return { ok: true };
    }),

  // ───────────────────────────────────────────────────────────────────────
  // ANEXOS — arquivos vinculados ao agendamento (PDFs/imagens/docs)
  // Reusam o uploadRouter pra storage; aqui só guardamos metadata.
  // ───────────────────────────────────────────────────────────────────────

  /** Lista anexos de um agendamento. */
  listarAnexos: protectedProcedure
    .input(z.object({ agendamentoId: z.number() }))
    .query(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "agenda", "ver");
      if (!perm.allowed) return [];
      const db = await getDb();
      if (!db) return [];

      const rows = await db
        .select()
        .from(agendamentoAnexos)
        .where(and(eq(agendamentoAnexos.agendamentoId, input.agendamentoId), eq(agendamentoAnexos.escritorioId, perm.escritorioId)))
        .orderBy(desc(agendamentoAnexos.createdAt));
      return rows;
    }),

  /** Adiciona anexo. URL deve ter sido obtida via uploadRouter.enviar. */
  adicionarAnexo: protectedProcedure
    .input(z.object({
      agendamentoId: z.number(),
      url: z.string().min(1).max(512),
      nome: z.string().min(1).max(255),
      mimeType: z.string().min(1).max(128),
      tamanho: z.number().int().min(0),
    }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "agenda", "editar");
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Valida que o agendamento pertence ao escritório
      const [ag] = await db.select({ id: agendamentos.id })
        .from(agendamentos)
        .where(and(eq(agendamentos.id, input.agendamentoId), eq(agendamentos.escritorioId, perm.escritorioId)))
        .limit(1);
      if (!ag) throw new TRPCError({ code: "NOT_FOUND", message: "Agendamento não encontrado." });

      const [r] = await db.insert(agendamentoAnexos).values({
        agendamentoId: input.agendamentoId,
        escritorioId: perm.escritorioId,
        url: input.url,
        nome: input.nome,
        mimeType: input.mimeType,
        tamanho: input.tamanho,
        uploadedById: perm.colaboradorId,
      }).$returningId();

      return { id: r.id };
    }),

  /** Remove anexo. */
  removerAnexo: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "agenda", "editar");
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await db.delete(agendamentoAnexos)
        .where(and(eq(agendamentoAnexos.id, input.id), eq(agendamentoAnexos.escritorioId, perm.escritorioId)));
      return { ok: true };
    }),

  /** Lista colaboradores do escritório com cargo (pra o picker de destinatários). */
  listarColaboradores: protectedProcedure.query(async ({ ctx }) => {
    const perm = await checkPermission(ctx.user.id, "agenda", "ver");
    if (!perm.allowed) return [];
    const db = await getDb();
    if (!db) return [];

    const rows = await db
      .select({
        id: colaboradores.id,
        nome: users.name,
        email: users.email,
        cargo: colaboradores.cargo,
      })
      .from(colaboradores)
      .leftJoin(users, eq(users.id, colaboradores.userId))
      .where(and(eq(colaboradores.escritorioId, perm.escritorioId), eq(colaboradores.ativo, true)))
      .orderBy(asc(users.name));

    return rows.map((r) => ({
      id: r.id,
      nome: r.nome || r.email || `Colaborador #${r.id}`,
      cargo: r.cargo || null,
    }));
  }),

  // ─── Bloqueios da agenda (feriados + indisponibilidades) ──────────────
  // O gerador de slots livres da IA (smartflow) consulta esses bloqueios
  // pra não oferecer dias/horários indisponíveis ao cliente.

  bloqueiosListar: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return [];
    return listarBloqueios(esc.escritorio.id);
  }),

  bloqueioCriar: protectedProcedure
    .input(z.object({
      data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve ser YYYY-MM-DD"),
      horaInicio: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
      horaFim: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
      motivo: z.string().max(200).optional().nullable(),
      recorrenteAnual: z.boolean().optional(),
    }).refine(
      (d) => (!d.horaInicio && !d.horaFim) || (!!d.horaInicio && !!d.horaFim),
      { message: "Informe horaInicio E horaFim juntos, ou nenhum (= dia inteiro)" },
    ).refine(
      (d) => !d.horaInicio || !d.horaFim || d.horaInicio < d.horaFim,
      { message: "horaFim deve ser maior que horaInicio" },
    ))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "NOT_FOUND", message: "Escritório não encontrado" });
      const id = await criarBloqueio({
        escritorioId: esc.escritorio.id,
        data: input.data,
        horaInicio: input.horaInicio ?? null,
        horaFim: input.horaFim ?? null,
        motivo: input.motivo ?? null,
        recorrenteAnual: input.recorrenteAnual ?? false,
        criadoPorId: esc.colaborador.id,
      });
      return { id };
    }),

  bloqueioExcluir: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "NOT_FOUND", message: "Escritório não encontrado" });
      await excluirBloqueio(esc.escritorio.id, input.id);
      return { ok: true };
    }),

  bloqueioImportarFeriadosNacionais: protectedProcedure
    .input(z.object({ ano: z.number().int().min(2020).max(2100) }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "NOT_FOUND", message: "Escritório não encontrado" });
      return importarFeriadosNacionais({
        escritorioId: esc.escritorio.id,
        ano: input.ano,
        criadoPorId: esc.colaborador.id,
      });
    }),
});

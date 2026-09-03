/**
 * Router Kanban — Funis, colunas e cards de processos.
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getEscritorioPorUsuario } from "./db-escritorio";
import { getDb } from "../db";
import { kanbanFunis, kanbanColunas, kanbanCards, kanbanMovimentacoes, kanbanComentarios, kanbanResponsavelLog, kanbanTags, contatos, colaboradores, clienteProcessos, users, escritorios } from "../../drizzle/schema";
import { eq, and, desc, asc, like, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { checkPermission } from "./check-permission";
import { casaBusca, casaTag, colunaVizinha, condicoesCards, prazoCardParaGravar, recortarColunas, rotuloColunas } from "./kanban-filtros";
import { prazoCalendarioVencido } from "../_core/dates";
import { FUSO_HORARIO_PADRAO } from "../../shared/escritorio-types";
import { unirTags } from "../../shared/kanban-tags";

/** Verifica se o colaborador pode mexer nesse card quando a permissão é
 *  "verProprios" only. Considera owner = responsavelId. */
async function podeMexerNoCard(
  db: any,
  cardId: number,
  escritorioId: number,
  colaboradorId: number,
): Promise<boolean> {
  const [c] = await db.select({ responsavelId: kanbanCards.responsavelId, escritorioId: kanbanCards.escritorioId })
    .from(kanbanCards)
    .where(and(eq(kanbanCards.id, cardId), eq(kanbanCards.escritorioId, escritorioId)))
    .limit(1);
  if (!c) return false;
  return c.responsavelId === colaboradorId;
}

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

async function fusoDoEscritorio(db: Db, escritorioId: number): Promise<string> {
  const [e] = await db
    .select({ fusoHorario: escritorios.fusoHorario })
    .from(escritorios)
    .where(eq(escritorios.id, escritorioId))
    .limit(1);
  return e?.fusoHorario || FUSO_HORARIO_PADRAO;
}

/** Card em coluna de conclusão nunca está atrasado; fora dela, decide o dia civil do prazo. */
async function cardVenceAtrasado(db: Db, cardId: number, escritorioId: number, prazo: Date): Promise<boolean> {
  const [linha] = await db
    .select({ tipo: kanbanColunas.tipo })
    .from(kanbanCards)
    .innerJoin(kanbanColunas, eq(kanbanCards.colunaId, kanbanColunas.id))
    .where(and(eq(kanbanCards.id, cardId), eq(kanbanCards.escritorioId, escritorioId)))
    .limit(1);
  if (linha?.tipo === "conclusao") return false;
  return prazoCalendarioVencido(prazo, new Date(), await fusoDoEscritorio(db, escritorioId));
}

// `clienteId`/`responsavelId` chegam do client como número solto. Sem conferir
// o escritório, o card exibia contato alheio e a notificação de atribuição ia
// pro colaborador de outro escritório.
async function contatoDoEscritorio(db: Db, escritorioId: number, contatoId: number): Promise<boolean> {
  const [c] = await db
    .select({ id: contatos.id })
    .from(contatos)
    .where(and(eq(contatos.id, contatoId), eq(contatos.escritorioId, escritorioId)))
    .limit(1);
  return !!c;
}

async function colaboradorDoEscritorio(db: Db, escritorioId: number, colaboradorId: number): Promise<boolean> {
  const [c] = await db
    .select({ id: colaboradores.id })
    .from(colaboradores)
    .where(and(eq(colaboradores.id, colaboradorId), eq(colaboradores.escritorioId, escritorioId)))
    .limit(1);
  return !!c;
}

export const kanbanRouter = router({
  // ─── FUNIS ────────────────────────────────────────────────────────────────

  /**
   * Lista funis do escritório com estatísticas agregadas para a tela
   * seletora: emProducao, concluidos, atrasados, totalColunas. Tudo
   * em 1 query JOIN+GROUP BY (não dispara N+1 mesmo com 50 funis).
   *
   * Card arquivado NÃO conta em nenhuma estatística.
   */
  listarFunis: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return [];
    const db = await getDb();
    if (!db) return [];

    const rows = await db
      .select({
        id: kanbanFunis.id,
        nome: kanbanFunis.nome,
        descricao: kanbanFunis.descricao,
        cor: kanbanFunis.cor,
        prazoPadraoDias: kanbanFunis.prazoPadraoDias,
        createdAt: kanbanFunis.createdAt,
        updatedAt: kanbanFunis.updatedAt,
        criadoPor: kanbanFunis.criadoPor,
        // Stats — todas filtram arquivado=false
        totalColunas: sql<number>`COUNT(DISTINCT ${kanbanColunas.id})`,
        emProducao: sql<number>`COUNT(DISTINCT CASE
          WHEN ${kanbanCards.arquivado} = FALSE
            AND ${kanbanColunas.tipo} != 'conclusao'
          THEN ${kanbanCards.id} END)`,
        concluidos: sql<number>`COUNT(DISTINCT CASE
          WHEN ${kanbanCards.arquivado} = FALSE
            AND ${kanbanColunas.tipo} = 'conclusao'
          THEN ${kanbanCards.id} END)`,
        atrasados: sql<number>`COUNT(DISTINCT CASE
          WHEN ${kanbanCards.arquivado} = FALSE
            AND ${kanbanCards.atrasado} = TRUE
          THEN ${kanbanCards.id} END)`,
      })
      .from(kanbanFunis)
      .leftJoin(kanbanColunas, eq(kanbanColunas.funilId, kanbanFunis.id))
      .leftJoin(kanbanCards, eq(kanbanCards.colunaId, kanbanColunas.id))
      .where(eq(kanbanFunis.escritorioId, esc.escritorio.id))
      .groupBy(kanbanFunis.id)
      .orderBy(asc(kanbanFunis.createdAt));

    return rows.map((r) => ({
      ...r,
      totalColunas: Number(r.totalColunas ?? 0),
      emProducao: Number(r.emProducao ?? 0),
      concluidos: Number(r.concluidos ?? 0),
      atrasados: Number(r.atrasados ?? 0),
      totalCards: Number(r.emProducao ?? 0) + Number(r.concluidos ?? 0),
    }));
  }),

  criarFunil: protectedProcedure
    .input(z.object({
      nome: z.string().min(2).max(128),
      descricao: z.string().max(512).optional(),
      cor: z.string().max(16).optional(),
      /** Se true, cria colunas padrão */
      comColunasPadrao: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [result] = await db.insert(kanbanFunis).values({
        escritorioId: esc.escritorio.id,
        nome: input.nome,
        descricao: input.descricao || null,
        cor: input.cor || null,
        criadoPor: ctx.user.id,
      });
      const funilId = (result as { insertId: number }).insertId;

      if (input.comColunasPadrao !== false) {
        const colunas = [
          { nome: "Entrada", cor: "#6b7280", ordem: 1 },
          { nome: "Análise", cor: "#3b82f6", ordem: 2 },
          { nome: "Em andamento", cor: "#f59e0b", ordem: 3 },
          { nome: "Aguardando", cor: "#8b5cf6", ordem: 4 },
          { nome: "Concluído", cor: "#22c55e", ordem: 5 },
        ];
        for (const c of colunas) {
          await db.insert(kanbanColunas).values({ funilId, nome: c.nome, cor: c.cor, ordem: c.ordem });
        }
      }

      return { id: funilId };
    }),

  editarFunil: protectedProcedure
    .input(z.object({ id: z.number(), nome: z.string().min(2).max(128).optional(), descricao: z.string().max(512).optional(), cor: z.string().max(16).optional() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const update: any = {};
      if (input.nome) update.nome = input.nome;
      if (input.descricao !== undefined) update.descricao = input.descricao;
      if (input.cor !== undefined) update.cor = input.cor;
      await db.update(kanbanFunis).set(update)
        .where(and(eq(kanbanFunis.id, input.id), eq(kanbanFunis.escritorioId, esc.escritorio.id)));
      return { success: true };
    }),

  deletarFunil: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      // Confirma o dono do funil ANTES de tocar em qualquer coisa: só o delete
      // do funil era escopado — colunas e cards saíam por funilId puro, então
      // um id alheio deixava o funil de OUTRO escritório vazio e ainda de pé.
      const [funil] = await db
        .select({ id: kanbanFunis.id })
        .from(kanbanFunis)
        .where(and(eq(kanbanFunis.id, input.id), eq(kanbanFunis.escritorioId, esc.escritorio.id)))
        .limit(1);
      if (!funil) throw new TRPCError({ code: "NOT_FOUND", message: "Funil não encontrado." });

      // Busca colunas pra deletar cards
      const cols = await db.select({ id: kanbanColunas.id }).from(kanbanColunas).where(eq(kanbanColunas.funilId, input.id));
      const idsColunas = cols.map((c) => c.id);
      const alvos = idsColunas.length
        ? await db
            .select({ id: kanbanCards.id })
            .from(kanbanCards)
            .where(and(inArray(kanbanCards.colunaId, idsColunas), eq(kanbanCards.escritorioId, esc.escritorio.id)))
        : [];
      const ids = alvos.map((c) => c.id);

      if (ids.length) {
        await db.delete(kanbanMovimentacoes).where(inArray(kanbanMovimentacoes.cardId, ids));
        await db.delete(kanbanResponsavelLog).where(inArray(kanbanResponsavelLog.cardId, ids));
        await db.delete(kanbanComentarios).where(inArray(kanbanComentarios.cardId, ids));
        await db.delete(kanbanCards).where(inArray(kanbanCards.id, ids));
      }
      await db.delete(kanbanColunas).where(eq(kanbanColunas.funilId, input.id));
      await db.delete(kanbanFunis).where(and(eq(kanbanFunis.id, input.id), eq(kanbanFunis.escritorioId, esc.escritorio.id)));
      return { success: true, cardsExcluidos: ids.length };
    }),

  // ─── COLUNAS ──────────────────────────────────────────────────────────────
  // `kanban_colunas` não tem escritorioId próprio — a tenancy vem do funil.
  // Sem o join, qualquer logado editava/deletava coluna (e todos os cards
  // dela) de OUTRO escritório por id sequencial (IDOR destrutivo).

  criarColuna: protectedProcedure
    .input(z.object({ funilId: z.number(), nome: z.string().min(1).max(64), cor: z.string().max(16).optional() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [funil] = await db
        .select({ id: kanbanFunis.id })
        .from(kanbanFunis)
        .where(and(eq(kanbanFunis.id, input.funilId), eq(kanbanFunis.escritorioId, esc.escritorio.id)))
        .limit(1);
      if (!funil) throw new TRPCError({ code: "NOT_FOUND", message: "Funil não encontrado." });
      // Pegar próxima ordem
      const existentes = await db.select({ ordem: kanbanColunas.ordem }).from(kanbanColunas)
        .where(eq(kanbanColunas.funilId, input.funilId)).orderBy(desc(kanbanColunas.ordem)).limit(1);
      const ordem = (existentes[0]?.ordem || 0) + 1;
      const [r] = await db.insert(kanbanColunas).values({ funilId: input.funilId, nome: input.nome, cor: input.cor || null, ordem });
      return { id: (r as { insertId: number }).insertId };
    }),

  editarColuna: protectedProcedure
    .input(z.object({
      id: z.number(),
      nome: z.string().max(64).optional(),
      cor: z.string().max(16).optional(),
      tipo: z.enum(["normal", "conclusao"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [col] = await db
        .select({ id: kanbanColunas.id })
        .from(kanbanColunas)
        .innerJoin(kanbanFunis, eq(kanbanColunas.funilId, kanbanFunis.id))
        .where(and(eq(kanbanColunas.id, input.id), eq(kanbanFunis.escritorioId, esc.escritorio.id)))
        .limit(1);
      if (!col) throw new TRPCError({ code: "NOT_FOUND", message: "Coluna não encontrada." });
      const update: any = {};
      if (input.nome) update.nome = input.nome;
      if (input.cor !== undefined) update.cor = input.cor;
      if (input.tipo !== undefined) update.tipo = input.tipo;
      await db.update(kanbanColunas).set(update).where(eq(kanbanColunas.id, input.id));
      return { success: true };
    }),

  /**
   * Apaga a coluna E todos os cards dela.
   *
   * É a operação mais destrutiva do módulo: leva junto um número arbitrário de
   * cards, sem arquivar e sem desfazer. Já custou 82 cards de uma vez, quase
   * todos de uma única coluna.
   *
   * Por isso o gate é `verTodos` (dono/gestor) e não a permissão de editar:
   * quem pode mexer nos próprios cards não pode decidir pelos cards de todo
   * mundo. E os satélites são limpos junto — o `deletarCard` ao lado sempre
   * fez isso; aqui não fazia, e o histórico órfão que sobrava era a única
   * pista de que os cards existiram (é o que a regra KAN-02 do auditor acusa).
   */
  deletarColuna: protectedProcedure
    .input(z.object({
      id: z.number(),
      // "arquivar": os cards não são apagados — ficam arquivados na coluna
      // vizinha (a coluna some, os cards continuam consultáveis).
      modo: z.enum(["excluir", "arquivar"]).default("excluir"),
    }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "kanban", "excluir");
      if (!perm.allowed || !perm.verTodos) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Só dono ou gestor pode excluir uma coluna inteira.",
        });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [col] = await db
        .select({ id: kanbanColunas.id, nome: kanbanColunas.nome, funilId: kanbanColunas.funilId })
        .from(kanbanColunas)
        .innerJoin(kanbanFunis, eq(kanbanColunas.funilId, kanbanFunis.id))
        .where(and(eq(kanbanColunas.id, input.id), eq(kanbanFunis.escritorioId, perm.escritorioId)))
        .limit(1);
      if (!col) throw new TRPCError({ code: "NOT_FOUND", message: "Coluna não encontrada." });

      const alvos = await db
        .select({ id: kanbanCards.id })
        .from(kanbanCards)
        .where(and(eq(kanbanCards.colunaId, input.id), eq(kanbanCards.escritorioId, perm.escritorioId)));
      const ids = alvos.map((c) => c.id);

      if (input.modo === "arquivar" && ids.length) {
        const irmas = await db
          .select({ id: kanbanColunas.id, nome: kanbanColunas.nome, ordem: kanbanColunas.ordem })
          .from(kanbanColunas)
          .where(eq(kanbanColunas.funilId, col.funilId));
        const destino = colunaVizinha(irmas, col.id);
        if (!destino) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Não há outra coluna neste funil para guardar os cards arquivados.",
          });
        }
        await db.update(kanbanCards)
          .set({ arquivado: true, arquivadoEm: new Date() })
          .where(and(inArray(kanbanCards.id, ids), eq(kanbanCards.arquivado, false)));
        await db.update(kanbanCards)
          .set({ colunaId: destino.id })
          .where(inArray(kanbanCards.id, ids));
        await db.delete(kanbanColunas).where(eq(kanbanColunas.id, input.id));
        return {
          success: true,
          cardsExcluidos: 0,
          cardsArquivados: ids.length,
          movidosPara: destino.nome,
          coluna: col.nome,
        };
      }

      if (ids.length) {
        await db.delete(kanbanMovimentacoes).where(inArray(kanbanMovimentacoes.cardId, ids));
        await db.delete(kanbanResponsavelLog).where(inArray(kanbanResponsavelLog.cardId, ids));
        await db.delete(kanbanComentarios).where(inArray(kanbanComentarios.cardId, ids));
        await db.delete(kanbanCards).where(inArray(kanbanCards.id, ids));
      }
      await db.delete(kanbanColunas).where(eq(kanbanColunas.id, input.id));
      return { success: true, cardsExcluidos: ids.length, cardsArquivados: 0, movidosPara: null, coluna: col.nome };
    }),

  /**
   * O que a exclusão da coluna vai levar — contado no servidor, sem o filtro
   * do quadro. A tela contava a lista já filtrada e prometia "nenhum card
   * será afetado" com cards arquivados (ou escondidos pelo filtro) na coluna.
   */
  previaExcluirColuna: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "kanban", "ver");
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [col] = await db
        .select({ id: kanbanColunas.id, funilId: kanbanColunas.funilId })
        .from(kanbanColunas)
        .innerJoin(kanbanFunis, eq(kanbanColunas.funilId, kanbanFunis.id))
        .where(and(eq(kanbanColunas.id, input.id), eq(kanbanFunis.escritorioId, perm.escritorioId)))
        .limit(1);
      if (!col) throw new TRPCError({ code: "NOT_FOUND", message: "Coluna não encontrada." });

      const cards = await db
        .select({ id: kanbanCards.id, arquivado: kanbanCards.arquivado })
        .from(kanbanCards)
        .where(and(eq(kanbanCards.colunaId, col.id), eq(kanbanCards.escritorioId, perm.escritorioId)));
      const irmas = await db
        .select({ id: kanbanColunas.id, nome: kanbanColunas.nome, ordem: kanbanColunas.ordem })
        .from(kanbanColunas)
        .where(eq(kanbanColunas.funilId, col.funilId));
      const destino = colunaVizinha(irmas, col.id);
      const arquivados = cards.filter((c) => c.arquivado).length;
      return {
        total: cards.length,
        noQuadro: cards.length - arquivados,
        arquivados,
        destino: destino ? { id: destino.id, nome: destino.nome } : null,
      };
    }),

  // ─── CARDS ────────────────────────────────────────────────────────────────

  /** Busca todas as colunas + cards de um funil */
  obterFunil: protectedProcedure
    .input(z.object({
      funilId: z.number(),
      // ─── Filtros opcionais — todos AND ─────────────────────────────────
      responsavelId: z.number().int().positive().optional(),
      prioridade: z.enum(["baixa", "media", "alta"]).optional(),
      tag: z.string().max(64).optional(),
      // Filtros de prazo: "vencidos" / "hoje" / "7dias" / "sem_prazo"
      prazoFiltro: z.enum(["vencidos", "hoje", "7dias", "sem_prazo"]).optional(),
      // Filtros de data de criação (range YYYY-MM-DD)
      dataInicio: z.string().optional(),
      dataFim: z.string().optional(),
      // Cards arquivados ficam OCULTOS por default (default false).
      mostrarArquivados: z.boolean().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "kanban", "ver");
      if (!perm.allowed) return { funil: null, colunas: [] };
      const db = await getDb();
      if (!db) return { funil: null, colunas: [] };

      const [funil] = await db.select().from(kanbanFunis)
        .where(and(eq(kanbanFunis.id, input.funilId), eq(kanbanFunis.escritorioId, perm.escritorioId)))
        .limit(1);
      if (!funil) return { funil: null, colunas: [] };

      const colunas = await db.select().from(kanbanColunas)
        .where(eq(kanbanColunas.funilId, input.funilId))
        .orderBy(asc(kanbanColunas.ordem));

      const filtrarProprios = !perm.verTodos && perm.verProprios;

      // Filtros que valem pra TODOS os cards (independente da coluna) — usados
      // numa única query bulk em vez de loop por coluna (N+1 → 1). As
      // condições vêm de `kanban-filtros` porque o export em PDF precisa
      // filtrar exatamente igual.
      const colunasIds = colunas.map((c) => c.id);
      if (colunasIds.length === 0) {
        return { funil, colunas: [] };
      }

      const cardCondsGlobal = condicoesCards({
        escritorioId: perm.escritorioId,
        colunasIds,
        filtros: input,
        travarNoColaborador: filtrarProprios ? perm.colaboradorId : null,
        fusoHorario: await fusoDoEscritorio(db, perm.escritorioId),
      });

      const todosCards = await db
        .select()
        .from(kanbanCards)
        .where(and(...cardCondsGlobal))
        .orderBy(asc(kanbanCards.colunaId), asc(kanbanCards.ordem));

      // Bulk-load das informações relacionadas (contato, colaborador, processo)
      // em 3 queries totais — não mais N×3. Antes 1043 cards = ~3000 queries.
      const clienteIdsSet = new Set<number>();
      const responsavelIdsSet = new Set<number>();
      const processoIdsSet = new Set<number>();
      for (const c of todosCards) {
        if (c.clienteId) clienteIdsSet.add(c.clienteId);
        if (c.responsavelId) responsavelIdsSet.add(c.responsavelId);
        if (c.processoId) processoIdsSet.add(c.processoId);
      }
      const clienteIds = [...clienteIdsSet];
      const responsavelIds = [...responsavelIdsSet];
      const processoIds = [...processoIdsSet];

      const contatosRows = clienteIds.length > 0
        ? await db
            .select({ id: contatos.id, nome: contatos.nome, tags: contatos.tags })
            .from(contatos)
            .where(inArray(contatos.id, clienteIds))
        : [];
      const respRows = responsavelIds.length > 0
        ? await db
            .select({
              colaboradorId: colaboradores.id,
              nome: users.name,
              email: users.email,
            })
            .from(colaboradores)
            .innerJoin(users, eq(colaboradores.userId, users.id))
            .where(inArray(colaboradores.id, responsavelIds))
        : [];
      const procRows = processoIds.length > 0
        ? await db
            .select({
              id: clienteProcessos.id,
              apelido: clienteProcessos.apelido,
              numeroCnj: clienteProcessos.numeroCnj,
            })
            .from(clienteProcessos)
            .where(inArray(clienteProcessos.id, processoIds))
        : [];

      const mapContato = new Map<number, { nome: string | null; tags: string | null }>();
      for (const c of contatosRows) mapContato.set(c.id, { nome: c.nome, tags: c.tags });
      const mapResp = new Map<number, string | null>();
      for (const r of respRows) mapResp.set(r.colaboradorId, r.nome ?? r.email ?? null);
      const mapProc = new Map<number, string | null>();
      for (const p of procRows) mapProc.set(p.id, p.apelido || p.numeroCnj || null);

      // Agrupa cards por coluna (lookup local, O(N)).
      const cardsPorColuna = new Map<number, any[]>();
      for (const card of todosCards) {
        const ctt = card.clienteId ? mapContato.get(card.clienteId) : null;
        const clienteNome = ctt?.nome ?? null;
        // Tags single-source: cliente vence card próprio quando há cliente.
        const tagsResolvidas = card.clienteId ? (ctt?.tags ?? null) : card.tags;
        const responsavelNome = card.responsavelId ? mapResp.get(card.responsavelId) ?? null : null;
        const acaoApelido = card.processoId ? mapProc.get(card.processoId) ?? null : null;
        const enriquecido = {
          ...card,
          tags: tagsResolvidas,
          clienteNome,
          responsavelNome,
          acaoApelido,
        };
        const arr = cardsPorColuna.get(card.colunaId) ?? [];
        arr.push(enriquecido);
        cardsPorColuna.set(card.colunaId, arr);
      }

      // Filtro por tag (aqui e não em SQL: depende do enriquecimento, porque
      // quando há cliente as tags dele vencem as do card).
      const result = colunas.map((col) => ({
        ...col,
        cards: (cardsPorColuna.get(col.id) ?? []).filter((c) => casaTag(c, input.tag)),
      }));

      return { funil, colunas: result };
    }),

  criarCard: protectedProcedure
    .input(z.object({
      colunaId: z.number(),
      titulo: z.string().min(1).max(255),
      descricao: z.string().max(5000).optional(),
      cnj: z.string().max(30).optional(),
      clienteId: z.number().optional(),
      responsavelId: z.number().optional(),
      prioridade: z.enum(["alta", "media", "baixa"]).optional(),
      prazo: z.string().optional(),
      tags: z.string().max(255).optional(),
      valorEstimado: z.number().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "kanban", "criar");
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para criar cards." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [colunaAlvo] = await db
        .select({ id: kanbanColunas.id })
        .from(kanbanColunas)
        .innerJoin(kanbanFunis, eq(kanbanColunas.funilId, kanbanFunis.id))
        .where(and(eq(kanbanColunas.id, input.colunaId), eq(kanbanFunis.escritorioId, perm.escritorioId)))
        .limit(1);
      if (!colunaAlvo) throw new TRPCError({ code: "NOT_FOUND", message: "Coluna não encontrada." });
      if (input.clienteId && !(await contatoDoEscritorio(db, perm.escritorioId, input.clienteId))) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado." });
      }
      if (input.responsavelId && !(await colaboradorDoEscritorio(db, perm.escritorioId, input.responsavelId))) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Responsável não encontrado neste escritório." });
      }

      // Próxima ordem
      const existentes = await db.select({ ordem: kanbanCards.ordem }).from(kanbanCards)
        .where(eq(kanbanCards.colunaId, input.colunaId)).orderBy(desc(kanbanCards.ordem)).limit(1);
      const ordem = (existentes[0]?.ordem || 0) + 1;

      // Se não informou prazo, aplica prazo padrão do funil
      let prazo: Date | null = null;
      if (input.prazo) {
        prazo = prazoCardParaGravar(input.prazo);
      } else {
        // Buscar funil da coluna pra pegar prazoPadraoDias
        const [col] = await db.select({ funilId: kanbanColunas.funilId }).from(kanbanColunas)
          .where(eq(kanbanColunas.id, input.colunaId)).limit(1);
        if (col) {
          const [funil] = await db.select({ prazoPadraoDias: kanbanFunis.prazoPadraoDias }).from(kanbanFunis)
            .where(eq(kanbanFunis.id, col.funilId)).limit(1);
          const dias = funil?.prazoPadraoDias || 15;
          prazo = new Date(Date.now() + dias * 24 * 60 * 60 * 1000);
        }
      }

      const responsavelFinal = input.responsavelId || perm.colaboradorId;

      // Tags single-source: se card tem cliente vinculado, persiste em
      // contatos.tags (cliente é fonte da verdade — outros cards do mesmo
      // cliente refletem). Sem cliente, mantém em kanbanCards.tags próprio.
      let tagsCard: string | null = input.tags || null;
      if (input.clienteId && input.tags !== undefined) {
        // Soma às do cadastro: o form do card novo não mostra as tags que o
        // cliente já tem, e gravar por cima apagava "Trabalhista, VIP" de
        // todos os cards dele ao marcar só "Urgente".
        const [atual] = await db
          .select({ tags: contatos.tags })
          .from(contatos)
          .where(and(eq(contatos.id, input.clienteId), eq(contatos.escritorioId, perm.escritorioId)))
          .limit(1);
        await db.update(contatos)
          .set({ tags: unirTags(atual?.tags, input.tags) })
          .where(and(eq(contatos.id, input.clienteId), eq(contatos.escritorioId, perm.escritorioId)));
        tagsCard = null; // não armazena no card
      }

      const [r] = await db.insert(kanbanCards).values({
        escritorioId: perm.escritorioId,
        colunaId: input.colunaId,
        titulo: input.titulo,
        descricao: input.descricao || null,
        cnj: input.cnj || null,
        clienteId: input.clienteId || null,
        // Se não informado, atribui ao próprio criador (sobretudo importante
        // pra usuários com permissão verProprios — senão não enxergariam
        // o card que acabaram de criar).
        responsavelId: responsavelFinal,
        prioridade: (input.prioridade as any) || "media",
        prazo,
        tags: tagsCard,
        valorEstimado: input.valorEstimado != null ? input.valorEstimado.toFixed(2) : null,
        ordem,
      });
      const cardId = (r as { insertId: number }).insertId;

      const { notificarCardAtribuido } = await import("./notificar-card-kanban");
      await notificarCardAtribuido({
        cardId,
        responsavelColaboradorId: responsavelFinal,
        atribuidorUserId: ctx.user.id,
        acao: "criado",
        tituloCard: input.titulo,
      });

      return { id: cardId };
    }),

  editarCard: protectedProcedure
    .input(z.object({
      id: z.number(),
      titulo: z.string().max(255).optional(),
      descricao: z.string().max(5000).optional(),
      cnj: z.string().max(30).optional(),
      clienteId: z.number().optional(),
      // null = remove o responsável (card fica "sem responsável")
      responsavelId: z.number().nullable().optional(),
      prioridade: z.enum(["alta", "media", "baixa"]).optional(),
      // null (ou "") = tira o prazo
      prazo: z.string().nullable().optional(),
      tags: z.string().max(255).optional(),
      valorEstimado: z.number().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "kanban", "editar");
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para editar cards." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      if (!perm.verTodos && perm.verProprios) {
        const ok = await podeMexerNoCard(db, input.id, perm.escritorioId, perm.colaboradorId);
        if (!ok) throw new TRPCError({ code: "FORBIDDEN", message: "Você só pode editar seus próprios cards." });
      }

      const { id, ...update } = input;
      if (typeof update.clienteId === "number" && !(await contatoDoEscritorio(db, perm.escritorioId, update.clienteId))) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado." });
      }
      if (typeof update.responsavelId === "number" && !(await colaboradorDoEscritorio(db, perm.escritorioId, update.responsavelId))) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Responsável não encontrado neste escritório." });
      }

      const setData: any = {};
      if (update.titulo) setData.titulo = update.titulo;
      // Campo esvaziado na tela chega como "" e é gravado como vazio — antes
      // o client mandava undefined, nada mudava e o toast dizia "atualizado".
      if (update.descricao !== undefined) setData.descricao = update.descricao || null;
      if (update.cnj !== undefined) setData.cnj = update.cnj || null;
      if (update.prioridade) setData.prioridade = update.prioridade;
      if (update.prazo !== undefined) {
        const novoPrazo = update.prazo ? prazoCardParaGravar(update.prazo) : null;
        setData.prazo = novoPrazo;
        // O cron só LIGA a flag; quem muda o prazo decide o atraso na hora.
        setData.atrasado = novoPrazo
          ? await cardVenceAtrasado(db, id, perm.escritorioId, novoPrazo)
          : false;
      }

      // Tags single-source: descobre o clienteId atual do card (vindo do
      // input ou já armazenado). Se tem cliente, escreve em contatos.tags
      // (fonte da verdade). Se não tem, escreve no próprio card.
      if (update.tags !== undefined) {
        let clienteIdAlvo: number | null | undefined = update.clienteId;
        if (clienteIdAlvo === undefined) {
          const [atual] = await db
            .select({ clienteId: kanbanCards.clienteId })
            .from(kanbanCards)
            .where(and(eq(kanbanCards.id, id), eq(kanbanCards.escritorioId, perm.escritorioId)))
            .limit(1);
          clienteIdAlvo = atual?.clienteId ?? null;
        }
        if (clienteIdAlvo) {
          await db.update(contatos)
            .set({ tags: update.tags || null })
            .where(and(eq(contatos.id, clienteIdAlvo), eq(contatos.escritorioId, perm.escritorioId)));
          setData.tags = null; // limpa cópia local pra evitar drift
        } else {
          setData.tags = update.tags || null;
        }
      }
      if (update.clienteId !== undefined) setData.clienteId = update.clienteId;
      if (update.responsavelId !== undefined) setData.responsavelId = update.responsavelId;
      if (update.valorEstimado !== undefined) {
        setData.valorEstimado = update.valorEstimado != null ? update.valorEstimado.toFixed(2) : null;
      }

      // Detecta mudança de responsável ANTES do update, para notificar o novo
      // responsável depois. Só faz a query extra se a mutação está alterando
      // esse campo.
      let novoResponsavelParaNotificar: number | null = null;
      let tituloAtual = update.titulo || "";
      // Captura responsável anterior pra log de mudança (timeline).
      let responsavelAnterior: number | null = null;
      let responsavelMudou = false;
      if (update.responsavelId !== undefined) {
        const [antes] = await db
          .select({ atual: kanbanCards.responsavelId, titulo: kanbanCards.titulo })
          .from(kanbanCards)
          .where(and(eq(kanbanCards.id, id), eq(kanbanCards.escritorioId, perm.escritorioId)))
          .limit(1);
        if (antes && antes.atual !== update.responsavelId) {
          responsavelAnterior = antes.atual ?? null;
          responsavelMudou = true;
          if (update.responsavelId !== null) {
            novoResponsavelParaNotificar = update.responsavelId;
            tituloAtual = update.titulo || antes.titulo;
          }
        }
      }

      // Garantir o filtro escritorioId no UPDATE — antes só filtrava por id (vazamento entre escritórios)
      await db.update(kanbanCards).set(setData)
        .where(and(eq(kanbanCards.id, id), eq(kanbanCards.escritorioId, perm.escritorioId)));

      // Log de mudança de responsável (timeline). Só insere quando o campo
      // realmente mudou — não polui o log com "edição de descrição" que não
      // tocou no responsável.
      if (responsavelMudou) {
        await db.insert(kanbanResponsavelLog).values({
          cardId: id,
          responsavelAnteriorId: responsavelAnterior,
          responsavelNovoId: update.responsavelId ?? null,
          mudadoPorId: perm.colaboradorId,
        });
      }

      if (novoResponsavelParaNotificar !== null) {
        const { notificarCardAtribuido } = await import("./notificar-card-kanban");
        await notificarCardAtribuido({
          cardId: id,
          responsavelColaboradorId: novoResponsavelParaNotificar,
          atribuidorUserId: ctx.user.id,
          acao: "atribuido",
          tituloCard: tituloAtual,
        });
      }

      return { success: true };
    }),

  deletarCard: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "kanban", "excluir");
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para excluir cards." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      if (!perm.verTodos && perm.verProprios) {
        const ok = await podeMexerNoCard(db, input.id, perm.escritorioId, perm.colaboradorId);
        if (!ok) throw new TRPCError({ code: "FORBIDDEN", message: "Você só pode excluir seus próprios cards." });
      }

      // Confirma que o card é DESTE escritório antes de tocar em qualquer coisa
      // (evita apagar satélites de um card fora do tenant).
      const [alvo] = await db
        .select({ id: kanbanCards.id })
        .from(kanbanCards)
        .where(and(eq(kanbanCards.id, input.id), eq(kanbanCards.escritorioId, perm.escritorioId)))
        .limit(1);
      if (!alvo) throw new TRPCError({ code: "NOT_FOUND", message: "Card não encontrado." });

      // Exclusão é a MESMA row usada pelo quadro e pelo cadastro do cliente
      // (kanban_cards.clienteId), então apagar aqui remove nos dois lugares.
      // Limpa os satélites antes (sem FK no schema → evita órfãos).
      await db.delete(kanbanMovimentacoes).where(eq(kanbanMovimentacoes.cardId, input.id));
      await db.delete(kanbanResponsavelLog).where(eq(kanbanResponsavelLog.cardId, input.id));
      await db.delete(kanbanComentarios).where(eq(kanbanComentarios.cardId, input.id));
      await db.delete(kanbanCards)
        .where(and(eq(kanbanCards.id, input.id), eq(kanbanCards.escritorioId, perm.escritorioId)));
      return { success: true };
    }),

  /** Move card pra outra coluna (e/ou reordena) — registra movimentação */
  moverCard: protectedProcedure
    .input(z.object({ cardId: z.number(), colunaDestinoId: z.number(), ordem: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "kanban", "editar");
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para mover cards." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      if (!perm.verTodos && perm.verProprios) {
        const ok = await podeMexerNoCard(db, input.cardId, perm.escritorioId, perm.colaboradorId);
        if (!ok) throw new TRPCError({ code: "FORBIDDEN", message: "Você só pode mover seus próprios cards." });
      }

      // Buscar coluna origem antes de mover (com filtro por escritório)
      const [card] = await db.select({ colunaId: kanbanCards.colunaId, prazo: kanbanCards.prazo }).from(kanbanCards)
        .where(and(eq(kanbanCards.id, input.cardId), eq(kanbanCards.escritorioId, perm.escritorioId))).limit(1);
      if (!card) throw new TRPCError({ code: "NOT_FOUND", message: "Card não encontrado." });

      const [destino] = await db
        .select({ id: kanbanColunas.id, tipo: kanbanColunas.tipo })
        .from(kanbanColunas)
        .innerJoin(kanbanFunis, eq(kanbanColunas.funilId, kanbanFunis.id))
        .where(and(eq(kanbanColunas.id, input.colunaDestinoId), eq(kanbanFunis.escritorioId, perm.escritorioId)))
        .limit(1);
      if (!destino) throw new TRPCError({ code: "NOT_FOUND", message: "Coluna não encontrada." });

      // Concluir limpa o atraso; voltar pra uma coluna normal recalcula pelo
      // prazo. Sem isso o "⚠ Atrasado" ficava pra sempre no card concluído.
      const atrasado = destino.tipo === "conclusao"
        ? false
        : card.prazo
          ? prazoCalendarioVencido(card.prazo, new Date(), await fusoDoEscritorio(db, perm.escritorioId))
          : false;

      // Quando o frontend não passa ordem (drop simples sobre a coluna,
      // sem definir posição), coloca no FIM da fila — calcula maior ordem
      // atual da coluna destino + 1. Antes ia pra 0 e aparecia no topo.
      let ordemFinal = input.ordem;
      if (ordemFinal == null) {
        const [maior] = await db
          .select({ ordem: kanbanCards.ordem })
          .from(kanbanCards)
          .where(eq(kanbanCards.colunaId, input.colunaDestinoId))
          .orderBy(desc(kanbanCards.ordem))
          .limit(1);
        ordemFinal = (maior?.ordem ?? 0) + 1;
      }

      await db.update(kanbanCards)
        .set({ colunaId: input.colunaDestinoId, ordem: ordemFinal, atrasado })
        .where(and(eq(kanbanCards.id, input.cardId), eq(kanbanCards.escritorioId, perm.escritorioId)));

      // Registrar movimentação (pra métricas de tempo por etapa)
      if (card.colunaId !== input.colunaDestinoId) {
        await db.insert(kanbanMovimentacoes).values({
          cardId: input.cardId,
          colunaOrigemId: card.colunaId,
          colunaDestinoId: input.colunaDestinoId,
          movidoPorId: perm.colaboradorId,
        });
      }

      return { success: true };
    }),

  /**
   * Vincula uma cobrança Asaas (ou paymentId manual) ao card.
   * Usado pelo modal pós-Ganho: quando o user lança cobrança a partir do
   * card, o paymentId resultante é gravado aqui pra evitar que o modal
   * apareça de novo numa próxima movimentação.
   */
  vincularCobranca: protectedProcedure
    .input(z.object({
      cardId: z.number(),
      asaasPaymentId: z.string().min(1).max(64),
      valorEstimado: z.number().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "kanban", "editar");
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para editar cards." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      if (!perm.verTodos && perm.verProprios) {
        const ok = await podeMexerNoCard(db, input.cardId, perm.escritorioId, perm.colaboradorId);
        if (!ok) throw new TRPCError({ code: "FORBIDDEN", message: "Você só pode editar seus próprios cards." });
      }

      const setData: { asaasPaymentId: string; valorEstimado?: string | null } = {
        asaasPaymentId: input.asaasPaymentId,
      };
      if (input.valorEstimado !== undefined) {
        setData.valorEstimado = input.valorEstimado != null ? input.valorEstimado.toFixed(2) : null;
      }

      await db.update(kanbanCards)
        .set(setData)
        .where(and(eq(kanbanCards.id, input.cardId), eq(kanbanCards.escritorioId, perm.escritorioId)));

      return { success: true };
    }),

  // ─── TAGS ─────────────────────────────────────────────────────────────────
  //
  // Tags são single-source: a tabela `kanban_tags` é o catálogo do escritório
  // (id + nome + cor). Os usos vivem como string vírgula-separada em
  // `contatos.tags` (autoridade pro cliente) e `kanban_cards.tags` (apenas
  // pra cards sem `clienteId`). Quando renomeamos ou excluímos uma tag aqui,
  // varremos as duas tabelas e fazemos replace/remove em cada string —
  // mantendo consistência entre o catálogo e os usos.

  listarTags: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return [];
    const db = await getDb();
    if (!db) return [];
    return db
      .select()
      .from(kanbanTags)
      .where(eq(kanbanTags.escritorioId, esc.escritorio.id))
      .orderBy(asc(kanbanTags.nome));
  }),

  /** Conta em quantos contatos e cards a tag está em uso. Útil pro UI
   *  exibir "X em uso" antes da exclusão. Comparação é case-insensitive
   *  no nome (mas o uso preserva case do que estiver salvo). */
  usoTag: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return { contatos: 0, cards: 0, nome: "" };
      const db = await getDb();
      if (!db) return { contatos: 0, cards: 0, nome: "" };
      const [tag] = await db
        .select()
        .from(kanbanTags)
        .where(and(eq(kanbanTags.id, input.id), eq(kanbanTags.escritorioId, esc.escritorio.id)))
        .limit(1);
      if (!tag) return { contatos: 0, cards: 0, nome: "" };

      const nomeAlvo = tag.nome.toLowerCase();
      // Fetch só dos rows que têm a string — filter exato em JS pra evitar
      // matches parciais (ex: "VIP" não casa com "VIPER")
      const candidatosContatos = await db
        .select({ tags: contatos.tags })
        .from(contatos)
        .where(
          and(
            eq(contatos.escritorioId, esc.escritorio.id),
            like(contatos.tags, `%${tag.nome}%`),
          ),
        );
      const candidatosCards = await db
        .select({ tags: kanbanCards.tags })
        .from(kanbanCards)
        .where(
          and(
            eq(kanbanCards.escritorioId, esc.escritorio.id),
            like(kanbanCards.tags, `%${tag.nome}%`),
          ),
        );

      const usaTag = (s: string | null | undefined): boolean => {
        if (!s) return false;
        return s
          .split(",")
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean)
          .includes(nomeAlvo);
      };

      const totalContatos = candidatosContatos.filter((r) => usaTag(r.tags)).length;
      const totalCards = candidatosCards.filter((r) => usaTag(r.tags)).length;

      return { contatos: totalContatos, cards: totalCards, nome: tag.nome };
    }),

  criarTag: protectedProcedure
    .input(z.object({ nome: z.string().min(1).max(32), cor: z.string().min(4).max(16) }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      // Evita duplicata por nome (case-insensitive) no mesmo escritório
      const existentes = await db
        .select({ id: kanbanTags.id, nome: kanbanTags.nome })
        .from(kanbanTags)
        .where(eq(kanbanTags.escritorioId, esc.escritorio.id));
      const dup = existentes.find((t) => t.nome.toLowerCase() === input.nome.toLowerCase());
      if (dup) {
        throw new TRPCError({ code: "CONFLICT", message: `Já existe uma tag chamada "${input.nome}"` });
      }
      const [r] = await db
        .insert(kanbanTags)
        .values({ escritorioId: esc.escritorio.id, nome: input.nome, cor: input.cor });
      return { id: (r as { insertId: number }).insertId };
    }),

  /** Edita uma tag (nome e/ou cor). Se o nome mudar, faz replace cascateado
   *  em `contatos.tags` e `kanban_cards.tags` — preservando ordem e outras
   *  tags. Match é case-insensitive (mas grava com o `nome` novo). */
  editarTag: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        nome: z.string().min(1).max(32).optional(),
        cor: z.string().min(4).max(16).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [tag] = await db
        .select()
        .from(kanbanTags)
        .where(and(eq(kanbanTags.id, input.id), eq(kanbanTags.escritorioId, esc.escritorio.id)))
        .limit(1);
      if (!tag) throw new TRPCError({ code: "NOT_FOUND" });

      const nomeAntigo = tag.nome;
      const nomeNovo = input.nome?.trim();
      const corNova = input.cor?.trim();

      // Conflito: nome novo já existe em outra tag
      if (nomeNovo && nomeNovo.toLowerCase() !== nomeAntigo.toLowerCase()) {
        const existentes = await db
          .select({ id: kanbanTags.id, nome: kanbanTags.nome })
          .from(kanbanTags)
          .where(eq(kanbanTags.escritorioId, esc.escritorio.id));
        const dup = existentes.find(
          (t) => t.id !== tag.id && t.nome.toLowerCase() === nomeNovo.toLowerCase(),
        );
        if (dup) {
          throw new TRPCError({ code: "CONFLICT", message: `Já existe uma tag chamada "${nomeNovo}"` });
        }
      }

      // Atualiza catálogo
      const upd: { nome?: string; cor?: string } = {};
      if (nomeNovo) upd.nome = nomeNovo;
      if (corNova) upd.cor = corNova;
      if (Object.keys(upd).length > 0) {
        await db.update(kanbanTags).set(upd).where(eq(kanbanTags.id, tag.id));
      }

      // Replace cascateado nas strings (só faz se nome mudou)
      if (nomeNovo && nomeNovo.toLowerCase() !== nomeAntigo.toLowerCase()) {
        const replaceNaString = (s: string | null | undefined): string | null => {
          if (!s) return s ?? null;
          const partes = s.split(",").map((t) => t.trim()).filter(Boolean);
          let mudou = false;
          const novas = partes.map((t) => {
            if (t.toLowerCase() === nomeAntigo.toLowerCase()) {
              mudou = true;
              return nomeNovo;
            }
            return t;
          });
          // Dedup case-insensitive (caso já existisse a tag-destino)
          const seen = new Set<string>();
          const dedup = novas.filter((t) => {
            const k = t.toLowerCase();
            if (seen.has(k)) {
              mudou = true;
              return false;
            }
            seen.add(k);
            return true;
          });
          return mudou ? dedup.join(", ") : s;
        };

        const candidatosContatos = await db
          .select({ id: contatos.id, tags: contatos.tags })
          .from(contatos)
          .where(
            and(
              eq(contatos.escritorioId, esc.escritorio.id),
              like(contatos.tags, `%${nomeAntigo}%`),
            ),
          );
        for (const r of candidatosContatos) {
          const novo = replaceNaString(r.tags);
          if (novo !== r.tags) {
            await db.update(contatos).set({ tags: novo }).where(eq(contatos.id, r.id));
          }
        }

        const candidatosCards = await db
          .select({ id: kanbanCards.id, tags: kanbanCards.tags })
          .from(kanbanCards)
          .where(
            and(
              eq(kanbanCards.escritorioId, esc.escritorio.id),
              like(kanbanCards.tags, `%${nomeAntigo}%`),
            ),
          );
        for (const r of candidatosCards) {
          const novo = replaceNaString(r.tags);
          if (novo !== r.tags) {
            await db.update(kanbanCards).set({ tags: novo }).where(eq(kanbanCards.id, r.id));
          }
        }
      }

      return { success: true };
    }),

  /** Remove a tag do catálogo + de todos contatos/cards (cascade). UI
   *  deve chamar `usoTag` antes pra confirmar com o usuário. */
  deletarTag: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [tag] = await db
        .select()
        .from(kanbanTags)
        .where(and(eq(kanbanTags.id, input.id), eq(kanbanTags.escritorioId, esc.escritorio.id)))
        .limit(1);
      if (!tag) return { success: true, removidos: { contatos: 0, cards: 0 } };

      const nomeAlvo = tag.nome.toLowerCase();
      const removerNaString = (s: string | null | undefined): { novo: string | null; mudou: boolean } => {
        if (!s) return { novo: s ?? null, mudou: false };
        const partes = s.split(",").map((t) => t.trim()).filter(Boolean);
        const filtradas = partes.filter((t) => t.toLowerCase() !== nomeAlvo);
        const mudou = filtradas.length !== partes.length;
        return { novo: filtradas.length > 0 ? filtradas.join(", ") : null, mudou };
      };

      const candidatosContatos = await db
        .select({ id: contatos.id, tags: contatos.tags })
        .from(contatos)
        .where(
          and(
            eq(contatos.escritorioId, esc.escritorio.id),
            like(contatos.tags, `%${tag.nome}%`),
          ),
        );
      let contatosAfetados = 0;
      for (const r of candidatosContatos) {
        const { novo, mudou } = removerNaString(r.tags);
        if (mudou) {
          await db.update(contatos).set({ tags: novo }).where(eq(contatos.id, r.id));
          contatosAfetados += 1;
        }
      }

      const candidatosCards = await db
        .select({ id: kanbanCards.id, tags: kanbanCards.tags })
        .from(kanbanCards)
        .where(
          and(
            eq(kanbanCards.escritorioId, esc.escritorio.id),
            like(kanbanCards.tags, `%${tag.nome}%`),
          ),
        );
      let cardsAfetados = 0;
      for (const r of candidatosCards) {
        const { novo, mudou } = removerNaString(r.tags);
        if (mudou) {
          await db.update(kanbanCards).set({ tags: novo }).where(eq(kanbanCards.id, r.id));
          cardsAfetados += 1;
        }
      }

      await db
        .delete(kanbanTags)
        .where(and(eq(kanbanTags.id, input.id), eq(kanbanTags.escritorioId, esc.escritorio.id)));

      return { success: true, removidos: { contatos: contatosAfetados, cards: cardsAfetados } };
    }),

  /** Detalhe completo de um card */
  detalheCard: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return null;
      const db = await getDb();
      if (!db) return null;

      const [card] = await db.select().from(kanbanCards)
        .where(and(eq(kanbanCards.id, input.id), eq(kanbanCards.escritorioId, esc.escritorio.id)))
        .limit(1);
      if (!card) return null;

      // Enriquecer + resolver tags single-source (cliente é fonte da verdade)
      let clienteNome: string | null = null;
      let clienteCpfCnpj: string | null = null;
      let tagsResolvidas: string | null = card.tags;
      if (card.clienteId) {
        const [c] = await db.select({ nome: contatos.nome, cpfCnpj: contatos.cpfCnpj, tags: contatos.tags }).from(contatos)
          .where(eq(contatos.id, card.clienteId)).limit(1);
        clienteNome = c?.nome || null;
        clienteCpfCnpj = c?.cpfCnpj || null;
        tagsResolvidas = c?.tags || null;
      }
      // Substitui tags do card original pelas resolvidas (fonte da verdade)
      (card as any).tags = tagsResolvidas;

      // Histórico de movimentações + nomes de colunas + nome do user que moveu
      const movs = await db.select().from(kanbanMovimentacoes)
        .where(eq(kanbanMovimentacoes.cardId, input.id))
        .orderBy(desc(kanbanMovimentacoes.createdAt))
        .limit(50);

      const movsEnriquecidos = [];
      for (const m of movs) {
        const [orig] = await db.select({ nome: kanbanColunas.nome }).from(kanbanColunas).where(eq(kanbanColunas.id, m.colunaOrigemId)).limit(1);
        const [dest] = await db.select({ nome: kanbanColunas.nome }).from(kanbanColunas).where(eq(kanbanColunas.id, m.colunaDestinoId)).limit(1);
        let movidoPorNome: string | null = null;
        if (m.movidoPorId) {
          const [linha] = await db
            .select({ name: users.name, email: users.email })
            .from(colaboradores)
            .leftJoin(users, eq(users.id, colaboradores.userId))
            .where(eq(colaboradores.id, m.movidoPorId))
            .limit(1);
          movidoPorNome = linha?.name || linha?.email || null;
        }
        movsEnriquecidos.push({
          ...m,
          colunaOrigemNome: orig?.nome,
          colunaDestinoNome: dest?.nome,
          movidoPorNome,
        });
      }

      // Comentários do card + nome do autor (via users table)
      const comentariosRows = await db
        .select({
          id: kanbanComentarios.id,
          texto: kanbanComentarios.texto,
          createdAt: kanbanComentarios.createdAt,
          autorId: kanbanComentarios.autorId,
          autorNome: users.name,
          autorEmail: users.email,
        })
        .from(kanbanComentarios)
        .leftJoin(colaboradores, eq(colaboradores.id, kanbanComentarios.autorId))
        .leftJoin(users, eq(users.id, colaboradores.userId))
        .where(eq(kanbanComentarios.cardId, input.id))
        .orderBy(desc(kanbanComentarios.createdAt));

      return {
        ...card,
        clienteNome,
        clienteCpfCnpj,
        movimentacoes: movsEnriquecidos,
        comentarios: comentariosRows.map((c) => ({
          id: c.id,
          texto: c.texto,
          createdAt: c.createdAt,
          autorId: c.autorId,
          autorNome: c.autorNome || c.autorEmail || "Usuário",
        })),
      };
    }),

  /** Adiciona comentário no card. Autor = colaborador do user logado. */
  adicionarComentario: protectedProcedure
    .input(z.object({ cardId: z.number(), texto: z.string().min(1).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "kanban", "ver");
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      // Confirma que o card pertence ao escritório do user (evita comentar
      // em cards de outros escritórios via ID adivinhado).
      const [card] = await db.select({ id: kanbanCards.id }).from(kanbanCards)
        .where(and(eq(kanbanCards.id, input.cardId), eq(kanbanCards.escritorioId, perm.escritorioId)))
        .limit(1);
      if (!card) throw new TRPCError({ code: "NOT_FOUND", message: "Card não encontrado." });

      await db.insert(kanbanComentarios).values({
        cardId: input.cardId,
        autorId: perm.colaboradorId,
        texto: input.texto.trim(),
      });
      return { success: true };
    }),

  /** Remove comentário (só autor pode). */
  removerComentario: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "kanban", "ver");
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      // Join no card: `kanban_comentarios` não tem escritorioId — sem isso um
      // gestor (verTodos) apagava comentário de card de OUTRO escritório.
      const [com] = await db
        .select({ id: kanbanComentarios.id, autorId: kanbanComentarios.autorId })
        .from(kanbanComentarios)
        .innerJoin(kanbanCards, eq(kanbanComentarios.cardId, kanbanCards.id))
        .where(and(eq(kanbanComentarios.id, input.id), eq(kanbanCards.escritorioId, perm.escritorioId)))
        .limit(1);
      if (!com) throw new TRPCError({ code: "NOT_FOUND" });
      // Autor pode sempre apagar; gestor/dono também (verTodos).
      if (com.autorId !== perm.colaboradorId && !perm.verTodos) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Só o autor (ou gestor) pode apagar." });
      }
      await db.delete(kanbanComentarios).where(eq(kanbanComentarios.id, input.id));
      return { success: true };
    }),

  /**
   * Lista os cards do Kanban vinculados a um cliente específico. Usado pela
   * aba "Vínculo Kanban" no perfil do cliente — mostra de relance em quais
   * funis/colunas o cliente está sendo trabalhado.
   *
   * Permission: kanban.ver. Sem verTodos, mostra só cards do próprio
   * responsável (mesma lógica de obterFunil).
   */
  listarCardsPorCliente: protectedProcedure
    .input(z.object({ clienteId: z.number() }))
    .query(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "kanban", "ver");
      if (!perm.allowed) return { cards: [] };
      const db = await getDb();
      if (!db) return { cards: [] };

      const conditions: any[] = [
        eq(kanbanCards.escritorioId, perm.escritorioId),
        eq(kanbanCards.clienteId, input.clienteId),
        // Card arquivado no quadro NÃO deve aparecer no cadastro do cliente —
        // consistência com obterFunil (que também esconde arquivados).
        eq(kanbanCards.arquivado, false),
      ];
      if (!perm.verTodos && perm.verProprios) {
        conditions.push(eq(kanbanCards.responsavelId, perm.colaboradorId));
      }

      const rows = await db
        .select({
          id: kanbanCards.id,
          titulo: kanbanCards.titulo,
          prioridade: kanbanCards.prioridade,
          prazo: kanbanCards.prazo,
          atrasado: kanbanCards.atrasado,
          createdAt: kanbanCards.createdAt,
          colunaId: kanbanCards.colunaId,
          colunaNome: kanbanColunas.nome,
          colunaCor: kanbanColunas.cor,
          funilId: kanbanFunis.id,
          funilNome: kanbanFunis.nome,
        })
        .from(kanbanCards)
        .leftJoin(kanbanColunas, eq(kanbanColunas.id, kanbanCards.colunaId))
        .leftJoin(kanbanFunis, eq(kanbanFunis.id, kanbanColunas.funilId))
        .where(and(...conditions))
        .orderBy(desc(kanbanCards.createdAt));

      return { cards: rows };
    }),

  /** Reordena colunas via drag-and-drop. Recebe array de IDs na ordem nova. */
  /**
   * Reordena os cards de UMA coluna. Frontend passa a lista de IDs na
   * ordem nova (após o drag-and-drop). Backend faz UPDATE de cada ordem
   * em sequência. Idempotente — repetir o mesmo array é no-op.
   *
   * Permissão: editar do módulo kanban. verProprios não bloqueia
   * reordenação porque a operação é da coluna como um todo (visual).
   */
  reordenarCardsEmColuna: protectedProcedure
    .input(z.object({
      colunaId: z.number(),
      idsOrdenados: z.array(z.number().int().positive()).max(2000),
    }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "kanban", "editar");
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Valida que coluna pertence ao escritório (via JOIN com funis).
      const [colInfo] = await db
        .select({ id: kanbanColunas.id, funilId: kanbanColunas.funilId })
        .from(kanbanColunas)
        .innerJoin(kanbanFunis, eq(kanbanFunis.id, kanbanColunas.funilId))
        .where(and(
          eq(kanbanColunas.id, input.colunaId),
          eq(kanbanFunis.escritorioId, perm.escritorioId),
        ))
        .limit(1);
      if (!colInfo) throw new TRPCError({ code: "NOT_FOUND" });

      // Valida que todos os IDs pertencem ao escritório E estão nesta coluna.
      if (input.idsOrdenados.length === 0) return { atualizados: 0 };
      const cardsValidos = await db
        .select({ id: kanbanCards.id })
        .from(kanbanCards)
        .where(and(
          eq(kanbanCards.escritorioId, perm.escritorioId),
          eq(kanbanCards.colunaId, input.colunaId),
          inArray(kanbanCards.id, input.idsOrdenados),
        ));
      const idsValidos = new Set(cardsValidos.map((c) => c.id));

      let atualizados = 0;
      // Mantém ordem do array passado; ignora ids que não passaram na
      // validação acima (segurança/race).
      for (let i = 0; i < input.idsOrdenados.length; i++) {
        const id = input.idsOrdenados[i];
        if (!idsValidos.has(id)) continue;
        await db
          .update(kanbanCards)
          .set({ ordem: i + 1 })
          .where(and(
            eq(kanbanCards.id, id),
            eq(kanbanCards.escritorioId, perm.escritorioId),
          ));
        atualizados++;
      }
      return { atualizados };
    }),

  reordenarColunas: protectedProcedure
    .input(z.object({ funilId: z.number(), idsOrdenados: z.array(z.number()) }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "kanban", "editar");
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      // Valida que todas as colunas pertencem ao funil do escritório.
      const colunas = await db.select({ id: kanbanColunas.id, funilId: kanbanColunas.funilId })
        .from(kanbanColunas)
        .innerJoin(kanbanFunis, eq(kanbanFunis.id, kanbanColunas.funilId))
        .where(and(eq(kanbanFunis.id, input.funilId), eq(kanbanFunis.escritorioId, perm.escritorioId)));
      const idsValidos = new Set(colunas.map((c) => c.id));
      for (const id of input.idsOrdenados) {
        if (!idsValidos.has(id)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Coluna inválida." });
        }
      }
      // Atualiza ordem em sequência (1, 2, 3...).
      for (let i = 0; i < input.idsOrdenados.length; i++) {
        await db.update(kanbanColunas)
          .set({ ordem: i + 1 })
          .where(eq(kanbanColunas.id, input.idsOrdenados[i]));
      }
      return { success: true };
    }),

  /**
   * Arquiva o card: some do quadro (obterFunil filtra arquivado=false por
   * default), mas dados continuam intactos no DB. Reversível via desarquivar.
   * Comportamento: marca arquivado=true + grava timestamp em arquivadoEm.
   */
  arquivarCard: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "kanban", "editar");
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      if (!perm.verTodos && perm.verProprios) {
        const ok = await podeMexerNoCard(db, input.id, perm.escritorioId, perm.colaboradorId);
        if (!ok) throw new TRPCError({ code: "FORBIDDEN", message: "Você só pode arquivar seus próprios cards." });
      }

      await db
        .update(kanbanCards)
        .set({ arquivado: true, arquivadoEm: new Date() })
        .where(and(eq(kanbanCards.id, input.id), eq(kanbanCards.escritorioId, perm.escritorioId)));
      return { success: true };
    }),

  /**
   * Arquiva vários cards de uma vez. Usado pelo botão "Arquivar coluna"
   * (passa IDs de todos cards de uma coluna conclusão) e por futura UI
   * de seleção múltipla. Permissão verProprios trava nos cards do próprio
   * colaborador (filtro inline em vez de loop podeMexerNoCard).
   */
  arquivarCardsEmMassa: protectedProcedure
    .input(z.object({
      // Cap defensivo. Boards importados do Trello podem ter 1000+ cards na
      // mesma coluna — 2000 cobre o caso real com margem. Acima disso, UI
      // pode dividir em chunks.
      ids: z.array(z.number().int().positive()).min(1).max(2000),
    }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "kanban", "editar");
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const conds = [
        eq(kanbanCards.escritorioId, perm.escritorioId),
        inArray(kanbanCards.id, input.ids),
        eq(kanbanCards.arquivado, false),
      ];
      // verProprios: só arquiva cards onde sou o responsável.
      if (!perm.verTodos && perm.verProprios) {
        conds.push(eq(kanbanCards.responsavelId, perm.colaboradorId));
      }

      const alvos = await db
        .select({ id: kanbanCards.id })
        .from(kanbanCards)
        .where(and(...conds));

      if (alvos.length === 0) return { arquivados: 0 };

      const idsValidos = alvos.map((a) => a.id);
      await db
        .update(kanbanCards)
        .set({ arquivado: true, arquivadoEm: new Date() })
        .where(and(
          eq(kanbanCards.escritorioId, perm.escritorioId),
          inArray(kanbanCards.id, idsValidos),
        ));
      return { arquivados: idsValidos.length };
    }),

  /** Reverte arquivamento — card volta pro quadro. */
  desarquivarCard: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "kanban", "editar");
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await db
        .update(kanbanCards)
        .set({ arquivado: false, arquivadoEm: null })
        .where(and(eq(kanbanCards.id, input.id), eq(kanbanCards.escritorioId, perm.escritorioId)));
      return { success: true };
    }),

  // ─── HISTÓRICO DO CARD (timeline) ─────────────────────────────────────────

  /**
   * Retorna timeline cronológica do card: criação, movimentações entre
   * colunas, mudanças de responsável, comentários, conclusão.
   *
   * Agrega 4 fontes (kanban_movimentacoes, kanban_responsavel_log,
   * kanban_comentarios, kanban_cards.createdAt) e ordena por timestamp.
   * Frontend renderiza cada item com ícone/cor conforme tipo.
   *
   * Inclui dados pra mostrar "concluído em atraso" — quando o card foi
   * movido pra coluna com tipo='conclusao', compara createdAt da movimentação
   * com card.prazo.
   */
  historicoCard: protectedProcedure
    .input(z.object({ cardId: z.number() }))
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [card] = await db
        .select({
          id: kanbanCards.id,
          titulo: kanbanCards.titulo,
          colunaId: kanbanCards.colunaId,
          prazo: kanbanCards.prazo,
          createdAt: kanbanCards.createdAt,
          responsavelId: kanbanCards.responsavelId,
        })
        .from(kanbanCards)
        .where(and(
          eq(kanbanCards.id, input.cardId),
          eq(kanbanCards.escritorioId, esc.escritorio.id),
        ))
        .limit(1);
      if (!card) throw new TRPCError({ code: "NOT_FOUND" });

      // Map dos colaboradores → nome (uma query, depois lookup local).
      const colabsRows = await db
        .select({
          id: colaboradores.id,
          nome: users.name,
        })
        .from(colaboradores)
        .innerJoin(users, eq(colaboradores.userId, users.id))
        .where(eq(colaboradores.escritorioId, esc.escritorio.id));
      const nomeColab = new Map<number, string>();
      for (const c of colabsRows) {
        if (c.id != null) nomeColab.set(c.id, c.nome ?? `Colab #${c.id}`);
      }

      // Map colunas → {nome, tipo} (mesmo lookup local).
      const colunasRows = await db
        .select({
          id: kanbanColunas.id,
          nome: kanbanColunas.nome,
          tipo: kanbanColunas.tipo,
          funilId: kanbanColunas.funilId,
        })
        .from(kanbanColunas)
        .innerJoin(kanbanFunis, eq(kanbanColunas.funilId, kanbanFunis.id))
        .where(eq(kanbanFunis.escritorioId, esc.escritorio.id));
      const infoColuna = new Map<number, { nome: string; tipo: string }>();
      for (const c of colunasRows) {
        infoColuna.set(c.id, { nome: c.nome, tipo: c.tipo });
      }

      // Movimentações entre colunas
      const movs = await db
        .select()
        .from(kanbanMovimentacoes)
        .where(eq(kanbanMovimentacoes.cardId, input.cardId))
        .orderBy(asc(kanbanMovimentacoes.createdAt));

      // Comentários
      const coms = await db
        .select()
        .from(kanbanComentarios)
        .where(eq(kanbanComentarios.cardId, input.cardId))
        .orderBy(asc(kanbanComentarios.createdAt));

      // Mudanças de responsável
      const resps = await db
        .select()
        .from(kanbanResponsavelLog)
        .where(eq(kanbanResponsavelLog.cardId, input.cardId))
        .orderBy(asc(kanbanResponsavelLog.createdAt));

      type Evento =
        | { tipo: "criado"; createdAt: Date }
        | {
            tipo: "movimentacao";
            createdAt: Date;
            origemNome: string;
            destinoNome: string;
            destinoTipo: string;
            porNome: string | null;
            concluidoEmAtraso: boolean | null;
          }
        | {
            tipo: "responsavel";
            createdAt: Date;
            anteriorNome: string | null;
            novoNome: string | null;
            porNome: string | null;
          }
        | {
            tipo: "comentario";
            createdAt: Date;
            texto: string;
            autorNome: string | null;
          };

      const eventos: Evento[] = [];
      eventos.push({ tipo: "criado", createdAt: card.createdAt });

      // O prazo é data-calendário e o dia inteiro é do usuário: concluir às
      // 15h do dia do prazo não é atraso, embora 12:00Z já tenha passado.
      const fusoHistorico = esc.escritorio.fusoHorario || FUSO_HORARIO_PADRAO;

      for (const m of movs) {
        const destino = infoColuna.get(m.colunaDestinoId);
        const origem = infoColuna.get(m.colunaOrigemId);
        const ehConclusao = destino?.tipo === "conclusao";
        let concluidoEmAtraso: boolean | null = null;
        if (ehConclusao && card.prazo) {
          concluidoEmAtraso = prazoCalendarioVencido(card.prazo, m.createdAt, fusoHistorico);
        }
        eventos.push({
          tipo: "movimentacao",
          createdAt: m.createdAt,
          origemNome: origem?.nome ?? "(coluna removida)",
          destinoNome: destino?.nome ?? "(coluna removida)",
          destinoTipo: destino?.tipo ?? "normal",
          porNome: m.movidoPorId != null ? nomeColab.get(m.movidoPorId) ?? null : null,
          concluidoEmAtraso,
        });
      }

      for (const r of resps) {
        eventos.push({
          tipo: "responsavel",
          createdAt: r.createdAt,
          anteriorNome:
            r.responsavelAnteriorId != null
              ? nomeColab.get(r.responsavelAnteriorId) ?? null
              : null,
          novoNome:
            r.responsavelNovoId != null
              ? nomeColab.get(r.responsavelNovoId) ?? null
              : null,
          porNome: r.mudadoPorId != null ? nomeColab.get(r.mudadoPorId) ?? null : null,
        });
      }

      for (const c of coms) {
        eventos.push({
          tipo: "comentario",
          createdAt: c.createdAt,
          texto: c.texto,
          autorNome: nomeColab.get(c.autorId) ?? null,
        });
      }

      // Ordem cronológica decrescente (mais recente em cima).
      eventos.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      // Status agregado da conclusão atual (se está numa coluna concluido).
      const colunaAtual = infoColuna.get(card.colunaId);
      const concluido = colunaAtual?.tipo === "conclusao";
      let concluidoEmAtraso: boolean | null = null;
      if (concluido && card.prazo) {
        // Pega a movimentação mais recente pra coluna concluida.
        const ultimaMovConclusao = movs
          .filter((m) => infoColuna.get(m.colunaDestinoId)?.tipo === "conclusao")
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
        if (ultimaMovConclusao) {
          concluidoEmAtraso = prazoCalendarioVencido(card.prazo, ultimaMovConclusao.createdAt, fusoHistorico);
        }
      }

      return {
        cardId: card.id,
        titulo: card.titulo,
        concluido,
        concluidoEmAtraso,
        prazo: card.prazo,
        eventos,
      };
    }),

  // ─── IMPORT DO TRELLO ─────────────────────────────────────────────────────

  /** Prévia da importação — calcula totais sem efetuar. */
  preverImportTrello: protectedProcedure
    .input(z.object({
      json: z.string().min(2).max(20_000_000), // 20MB de margem (Trello grande)
      ignorarArchivados: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { preverImportTrello } = await import("./kanban-import-trello");
      try {
        return preverImportTrello(input.json, {
          ignorarArchivados: input.ignorarArchivados,
        });
      } catch (err: any) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err?.message ?? "Não consegui ler o JSON",
        });
      }
    }),

  /** Executa a importação: cria 1 funil + colunas + cards a partir do JSON. */
  importarDoTrello: protectedProcedure
    .input(z.object({
      json: z.string().min(2).max(20_000_000),
      ignorarArchivados: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "FORBIDDEN" });

      const { importarTrelloJson } = await import("./kanban-import-trello");
      try {
        return await importarTrelloJson(
          esc.escritorio.id,
          ctx.user.id,
          input.json,
          { ignorarArchivados: input.ignorarArchivados },
        );
      } catch (err: any) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err?.message ?? "Falha ao importar do Trello",
        });
      }
    }),

  /**
   * Exporta os cards em PDF — a listagem que o quadro mostra, em papel.
   *
   * Recebe os MESMOS filtros da tela (inclusive a busca textual, que é
   * client-side no quadro) porque um PDF que traz mais cards do que a tela
   * mostrava é pior que nenhum PDF. `funilId` ausente = todos os funis.
   */
  exportarCardsPdf: protectedProcedure
    .input(
      z.object({
        funilId: z.number().int().positive().optional(),
        /** Recorte de colunas. Ausente ou vazio = o funil inteiro. */
        colunasIds: z.array(z.number().int().positive()).max(200).optional(),
        responsavelId: z.number().int().positive().optional(),
        prioridade: z.enum(["baixa", "media", "alta"]).optional(),
        prazoFiltro: z.enum(["vencidos", "hoje", "7dias", "sem_prazo"]).optional(),
        dataInicio: z.string().optional(),
        dataFim: z.string().optional(),
        tag: z.string().max(64).optional(),
        busca: z.string().max(120).optional(),
        mostrarArquivados: z.boolean().optional(),
      }).optional(),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Escritório não encontrado." });
      }
      const perm = await checkPermission(ctx.user.id, "kanban", "ver");
      if (!perm.allowed) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para ver o Kanban." });
      }
      const db = await getDb();
      if (!db) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Banco indisponível." });
      }
      const filtros = input ?? {};

      // Colunas do escopo: um funil ou todos os do escritório.
      const colunasRows = await db
        .select({
          id: kanbanColunas.id,
          nome: kanbanColunas.nome,
          funilId: kanbanColunas.funilId,
          funilNome: kanbanFunis.nome,
        })
        .from(kanbanColunas)
        .innerJoin(kanbanFunis, eq(kanbanColunas.funilId, kanbanFunis.id))
        .where(
          and(
            eq(kanbanFunis.escritorioId, esc.escritorio.id),
            ...(filtros.funilId ? [eq(kanbanFunis.id, filtros.funilId)] : []),
          ),
        )
        // Ordem do quadro — é ela que define a ordem dos blocos no PDF.
        // Sem o nome do funil na frente, exportar todos os funis intercala
        // as colunas de funis diferentes que tenham a mesma `ordem`.
        .orderBy(kanbanFunis.nome, kanbanColunas.ordem, kanbanColunas.id);

      const escolhidas = recortarColunas(colunasRows, filtros.colunasIds);

      const filtrarProprios = !perm.verTodos && perm.verProprios;
      const cards = escolhidas.length === 0
        ? []
        : await db
          .select()
          .from(kanbanCards)
          .where(and(...condicoesCards({
            escritorioId: esc.escritorio.id,
            colunasIds: escolhidas.map((c) => c.id),
            filtros,
            travarNoColaborador: filtrarProprios ? perm.colaboradorId : null,
            fusoHorario: esc.escritorio.fusoHorario,
          })))
          // O pedido é sempre do cadastro mais recente pro mais antigo.
          .orderBy(desc(kanbanCards.createdAt), desc(kanbanCards.id));

      // Enriquecimento em lote — mesmo desenho de `obterFunil` (3 queries,
      // não 3 por card).
      const clienteIds = [...new Set(cards.map((c) => c.clienteId).filter(Boolean))] as number[];
      const respIds = [...new Set(cards.map((c) => c.responsavelId).filter(Boolean))] as number[];

      const contatosRows = clienteIds.length > 0
        ? await db.select({ id: contatos.id, nome: contatos.nome, tags: contatos.tags })
          .from(contatos).where(inArray(contatos.id, clienteIds))
        : [];
      const respRows = respIds.length > 0
        ? await db
          .select({ colaboradorId: colaboradores.id, nome: users.name, email: users.email })
          .from(colaboradores)
          .innerJoin(users, eq(colaboradores.userId, users.id))
          .where(inArray(colaboradores.id, respIds))
        : [];

      const mapContato = new Map(contatosRows.map((c) => [c.id, c]));
      const mapResp = new Map(respRows.map((r) => [r.colaboradorId, r.nome ?? r.email ?? null]));
      const mapColuna = new Map(colunasRows.map((c) => [c.id, c]));

      const enriquecidos = cards.map((card) => {
        const ctt = card.clienteId ? mapContato.get(card.clienteId) : null;
        const col = mapColuna.get(card.colunaId);
        return {
          // Tags single-source: cliente vence card próprio quando há cliente.
          tags: card.clienteId ? (ctt?.tags ?? null) : card.tags,
          clienteNome: ctt?.nome ?? null,
          titulo: card.titulo,
          funilNome: col?.funilNome ?? "—",
          colunaId: card.colunaId,
          colunaNome: col?.nome ?? "—",
          responsavelNome: card.responsavelId ? mapResp.get(card.responsavelId) ?? null : null,
          criadoEm: card.createdAt.toISOString(),
          prazo: card.prazo ? card.prazo.toISOString() : null,
          valorEstimado: card.valorEstimado != null ? Number(card.valorEstimado) : null,
          prioridade: card.prioridade,
          arquivado: card.arquivado,
        };
      })
        .filter((c) => casaTag(c, filtros.tag) && casaBusca(c, filtros.busca));

      const funilLabel = filtros.funilId
        ? (colunasRows[0]?.funilNome ?? `#${filtros.funilId}`)
        : "Todos";
      const colunasLabel = rotuloColunas(colunasRows, escolhidas);
      const responsavelLabel = filtrarProprios
        ? (esc.colaborador ? "Somente os meus" : "—")
        : filtros.responsavelId
          ? (mapResp.get(filtros.responsavelId) ?? `#${filtros.responsavelId}`)
          : "Todos";
      const br = (d?: string) => (d ? d.split("-").reverse().join("/") : null);
      const periodoLabel = filtros.dataInicio || filtros.dataFim
        ? [br(filtros.dataInicio) ?? "início", br(filtros.dataFim) ?? "hoje"].join(" a ")
        : "Todo o período";

      const { gerarKanbanCardsPdf } = await import("./kanban-cards-pdf");
      const buffer = await gerarKanbanCardsPdf({
        data: {
          cards: enriquecidos,
          grupos: escolhidas.map((c) => ({ id: c.id, nome: c.nome, funilNome: c.funilNome })),
          funilLabel,
          colunasLabel,
          responsavelLabel,
          periodoLabel,
        },
        nomeEscritorio: esc.escritorio.nome,
      });

      const hoje = new Date().toISOString().slice(0, 10);
      return {
        filename: `cards_kanban_${hoje}.pdf`,
        base64: buffer.toString("base64"),
        mimeType: "application/pdf",
        total: enriquecidos.length,
      };
    }),
});

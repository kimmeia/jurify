/**
 * Router Kanban — Funis, colunas e cards de processos.
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getEscritorioPorUsuario } from "./db-escritorio";
import { getDb } from "../db";
import { kanbanFunis, kanbanColunas, kanbanCards, kanbanMovimentacoes, kanbanComentarios, kanbanResponsavelLog, kanbanTags, contatos, colaboradores, clienteProcessos, users } from "../../drizzle/schema";
import { eq, and, desc, asc, or, like, gte, lte, lt, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { checkPermission } from "./check-permission";

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

export const kanbanRouter = router({
  // ─── FUNIS ────────────────────────────────────────────────────────────────

  listarFunis: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return [];
    const db = await getDb();
    if (!db) return [];
    return db.select().from(kanbanFunis)
      .where(eq(kanbanFunis.escritorioId, esc.escritorio.id))
      .orderBy(asc(kanbanFunis.createdAt));
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
      // Busca colunas pra deletar cards
      const cols = await db.select({ id: kanbanColunas.id }).from(kanbanColunas).where(eq(kanbanColunas.funilId, input.id));
      for (const c of cols) await db.delete(kanbanCards).where(eq(kanbanCards.colunaId, c.id));
      await db.delete(kanbanColunas).where(eq(kanbanColunas.funilId, input.id));
      await db.delete(kanbanFunis).where(and(eq(kanbanFunis.id, input.id), eq(kanbanFunis.escritorioId, esc.escritorio.id)));
      return { success: true };
    }),

  // ─── COLUNAS ──────────────────────────────────────────────────────────────

  criarColuna: protectedProcedure
    .input(z.object({ funilId: z.number(), nome: z.string().min(1).max(64), cor: z.string().max(16).optional() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
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
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const update: any = {};
      if (input.nome) update.nome = input.nome;
      if (input.cor !== undefined) update.cor = input.cor;
      if (input.tipo !== undefined) update.tipo = input.tipo;
      await db.update(kanbanColunas).set(update).where(eq(kanbanColunas.id, input.id));
      return { success: true };
    }),

  deletarColuna: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(kanbanCards).where(eq(kanbanCards.colunaId, input.id));
      await db.delete(kanbanColunas).where(eq(kanbanColunas.id, input.id));
      return { success: true };
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

      // Pré-calcula bounds de prazo (uma vez, não dentro do loop).
      const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
      const fimHoje = new Date(hoje); fimHoje.setHours(23, 59, 59, 999);
      const fim7 = new Date(hoje); fim7.setDate(fim7.getDate() + 7); fim7.setHours(23, 59, 59, 999);

      // Filtros que valem pra TODOS os cards (independente da coluna) — usados
      // numa única query bulk em vez de loop por coluna (N+1 → 1).
      const colunasIds = colunas.map((c) => c.id);
      if (colunasIds.length === 0) {
        return { funil, colunas: [] };
      }

      const cardCondsGlobal: any[] = [
        inArray(kanbanCards.colunaId, colunasIds),
        eq(kanbanCards.escritorioId, perm.escritorioId),
      ];
      if (!input.mostrarArquivados) {
        cardCondsGlobal.push(eq(kanbanCards.arquivado, false));
      }
      if (filtrarProprios) cardCondsGlobal.push(eq(kanbanCards.responsavelId, perm.colaboradorId));
      if (input.responsavelId) cardCondsGlobal.push(eq(kanbanCards.responsavelId, input.responsavelId));
      if (input.prioridade) cardCondsGlobal.push(eq(kanbanCards.prioridade, input.prioridade));
      if (input.dataInicio) cardCondsGlobal.push(gte(kanbanCards.createdAt, new Date(`${input.dataInicio}T00:00:00`)));
      if (input.dataFim) cardCondsGlobal.push(lte(kanbanCards.createdAt, new Date(`${input.dataFim}T23:59:59`)));
      if (input.prazoFiltro === "vencidos") cardCondsGlobal.push(and(sql`${kanbanCards.prazo} IS NOT NULL`, lt(kanbanCards.prazo, hoje)));
      else if (input.prazoFiltro === "hoje") cardCondsGlobal.push(and(gte(kanbanCards.prazo, hoje), lte(kanbanCards.prazo, fimHoje)));
      else if (input.prazoFiltro === "7dias") cardCondsGlobal.push(and(gte(kanbanCards.prazo, hoje), lte(kanbanCards.prazo, fim7)));
      else if (input.prazoFiltro === "sem_prazo") cardCondsGlobal.push(sql`${kanbanCards.prazo} IS NULL`);

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

      // Filtro por tag (client-side aqui pois depende do enriquecimento).
      const tagFiltro = input.tag?.toLowerCase();
      const result = colunas.map((col) => {
        let cardsCol = cardsPorColuna.get(col.id) ?? [];
        if (tagFiltro) {
          cardsCol = cardsCol.filter((c) => {
            const lista = (c.tags || "")
              .split(",")
              .map((s: string) => s.trim().toLowerCase())
              .filter(Boolean);
            return lista.includes(tagFiltro);
          });
        }
        return { ...col, cards: cardsCol };
      });

      return { funil, colunas: result };
    }),

  criarCard: protectedProcedure
    .input(z.object({
      colunaId: z.number(),
      titulo: z.string().min(1).max(255),
      descricao: z.string().optional(),
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
      // Próxima ordem
      const existentes = await db.select({ ordem: kanbanCards.ordem }).from(kanbanCards)
        .where(eq(kanbanCards.colunaId, input.colunaId)).orderBy(desc(kanbanCards.ordem)).limit(1);
      const ordem = (existentes[0]?.ordem || 0) + 1;

      // Se não informou prazo, aplica prazo padrão do funil
      let prazo: Date | null = null;
      if (input.prazo) {
        prazo = new Date(input.prazo);
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
        await db.update(contatos)
          .set({ tags: input.tags || null })
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
      descricao: z.string().optional(),
      cnj: z.string().max(30).optional(),
      clienteId: z.number().optional(),
      // null = remove o responsável (card fica "sem responsável")
      responsavelId: z.number().nullable().optional(),
      prioridade: z.enum(["alta", "media", "baixa"]).optional(),
      prazo: z.string().optional(),
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
      const setData: any = {};
      if (update.titulo) setData.titulo = update.titulo;
      if (update.descricao !== undefined) setData.descricao = update.descricao;
      if (update.cnj !== undefined) setData.cnj = update.cnj;
      if (update.prioridade) setData.prioridade = update.prioridade;
      if (update.prazo !== undefined) setData.prazo = update.prazo ? new Date(update.prazo) : null;

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
          setData.tags = update.tags;
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
      const [card] = await db.select({ colunaId: kanbanCards.colunaId }).from(kanbanCards)
        .where(and(eq(kanbanCards.id, input.cardId), eq(kanbanCards.escritorioId, perm.escritorioId))).limit(1);
      if (!card) throw new TRPCError({ code: "NOT_FOUND", message: "Card não encontrado." });

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
        .set({ colunaId: input.colunaDestinoId, ordem: ordemFinal })
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
      const [com] = await db.select().from(kanbanComentarios).where(eq(kanbanComentarios.id, input.id)).limit(1);
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

      for (const m of movs) {
        const destino = infoColuna.get(m.colunaDestinoId);
        const origem = infoColuna.get(m.colunaOrigemId);
        const ehConclusao = destino?.tipo === "conclusao";
        let concluidoEmAtraso: boolean | null = null;
        if (ehConclusao && card.prazo) {
          concluidoEmAtraso = m.createdAt.getTime() > card.prazo.getTime();
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
          concluidoEmAtraso =
            ultimaMovConclusao.createdAt.getTime() > card.prazo.getTime();
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
});

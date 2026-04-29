/**
 * Router Kanban — Funis, colunas e cards de processos.
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getEscritorioPorUsuario } from "./db-escritorio";
import { getDb } from "../db";
import { kanbanFunis, kanbanColunas, kanbanCards, kanbanMovimentacoes, kanbanTags, contatos, colaboradores } from "../../drizzle/schema";
import { eq, and, desc, asc, or, like } from "drizzle-orm";
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
    .input(z.object({ id: z.number(), nome: z.string().max(64).optional(), cor: z.string().max(16).optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const update: any = {};
      if (input.nome) update.nome = input.nome;
      if (input.cor !== undefined) update.cor = input.cor;
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
    .input(z.object({ funilId: z.number() }))
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
      const result = [];
      for (const col of colunas) {
        const cardConditions: any[] = [eq(kanbanCards.colunaId, col.id)];
        if (filtrarProprios) cardConditions.push(eq(kanbanCards.responsavelId, perm.colaboradorId));
        const cards = await db.select().from(kanbanCards)
          .where(and(...cardConditions))
          .orderBy(asc(kanbanCards.ordem));

        // Enriquecer cards com nome do cliente + tags resolvidas.
        // Tags single-source: se card tem clienteId, mostra contatos.tags;
        // senão usa kanbanCards.tags próprio (cards sem cliente vinculado).
        const cardsEnriquecidos = [];
        for (const card of cards) {
          let clienteNome: string | null = null;
          let tagsResolvidas: string | null = card.tags;
          if (card.clienteId) {
            const [c] = await db.select({ nome: contatos.nome, tags: contatos.tags }).from(contatos)
              .where(eq(contatos.id, card.clienteId)).limit(1);
            clienteNome = c?.nome || null;
            tagsResolvidas = c?.tags || null;
          }
          let responsavelNome: string | null = null;
          if (card.responsavelId) {
            const [r] = await db.select({ userId: colaboradores.userId }).from(colaboradores)
              .where(eq(colaboradores.id, card.responsavelId)).limit(1);
            responsavelNome = r ? `Colab #${card.responsavelId}` : null;
          }
          cardsEnriquecidos.push({ ...card, tags: tagsResolvidas, clienteNome, responsavelNome });
        }

        result.push({ ...col, cards: cardsEnriquecidos });
      }

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
      responsavelId: z.number().optional(),
      prioridade: z.enum(["alta", "media", "baixa"]).optional(),
      prazo: z.string().optional(),
      tags: z.string().max(255).optional(),
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

      // Detecta mudança de responsável ANTES do update, para notificar o novo
      // responsável depois. Só faz a query extra se a mutação está alterando
      // esse campo.
      let novoResponsavelParaNotificar: number | null = null;
      let tituloAtual = update.titulo || "";
      if (update.responsavelId !== undefined) {
        const [antes] = await db
          .select({ atual: kanbanCards.responsavelId, titulo: kanbanCards.titulo })
          .from(kanbanCards)
          .where(and(eq(kanbanCards.id, id), eq(kanbanCards.escritorioId, perm.escritorioId)))
          .limit(1);
        if (antes && antes.atual !== update.responsavelId) {
          novoResponsavelParaNotificar = update.responsavelId;
          tituloAtual = update.titulo || antes.titulo;
        }
      }

      // Garantir o filtro escritorioId no UPDATE — antes só filtrava por id (vazamento entre escritórios)
      await db.update(kanbanCards).set(setData)
        .where(and(eq(kanbanCards.id, id), eq(kanbanCards.escritorioId, perm.escritorioId)));

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

      await db.update(kanbanCards)
        .set({ colunaId: input.colunaDestinoId, ordem: input.ordem ?? 0 })
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

      // Histórico de movimentações
      const movs = await db.select().from(kanbanMovimentacoes)
        .where(eq(kanbanMovimentacoes.cardId, input.id))
        .orderBy(desc(kanbanMovimentacoes.createdAt))
        .limit(20);

      // Enriquecer movimentações com nomes de colunas
      const movsEnriquecidos = [];
      for (const m of movs) {
        const [orig] = await db.select({ nome: kanbanColunas.nome }).from(kanbanColunas).where(eq(kanbanColunas.id, m.colunaOrigemId)).limit(1);
        const [dest] = await db.select({ nome: kanbanColunas.nome }).from(kanbanColunas).where(eq(kanbanColunas.id, m.colunaDestinoId)).limit(1);
        movsEnriquecidos.push({ ...m, colunaOrigemNome: orig?.nome, colunaDestinoNome: dest?.nome });
      }

      return { ...card, clienteNome, clienteCpfCnpj, movimentacoes: movsEnriquecidos };
    }),
});

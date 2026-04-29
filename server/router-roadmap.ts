/**
 * Router tRPC — Roadmap público com moderação.
 *
 * Fluxo de moderação:
 *  - User comum cria sugestão → status `aguardando_aprovacao`
 *    (visível só pro próprio criador + admins do sistema)
 *  - Admin aprova movendo pra qualquer outro status (geralmente `novo`)
 *    → fica visível pra todos os usuários e pode receber votos
 *  - Admin pode `recusar` (status="recusado") — ainda invisível
 *    pra outros users; só o criador continua vendo
 *
 * Notificações:
 *  - Item criado → admins recebem `notificacoes` (sino)
 *  - Status sai de `aguardando_aprovacao` → criador é notificado
 *  - Status muda pra "lancado" → autor + todos que votaram são notificados
 */

import { z } from "zod";
import { eq, and, desc, like, or, sql, inArray, ne } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { adminProcedure, protectedProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import {
  roadmapItens,
  roadmapVotos,
  notificacoes,
  users,
} from "../drizzle/schema";
import { createLogger } from "./_core/logger";

const log = createLogger("router-roadmap");

const STATUS_VALORES = [
  "aguardando_aprovacao",
  "novo",
  "em_analise",
  "planejado",
  "em_desenvolvimento",
  "lancado",
  "recusado",
] as const;

const CATEGORIA_VALORES = ["feature", "bug", "melhoria"] as const;

async function notificarAdmins(titulo: string, mensagem: string) {
  try {
    const db = await getDb();
    if (!db) return;
    const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin"));
    if (admins.length === 0) return;
    await db.insert(notificacoes).values(
      admins.map((a) => ({ userId: a.id, titulo, mensagem, tipo: "sistema" as const })),
    );
  } catch (err: any) {
    log.warn({ err: err.message }, "Falha notificando admins");
  }
}

async function notificarUsers(userIds: number[], titulo: string, mensagem: string) {
  if (userIds.length === 0) return;
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(notificacoes).values(
      userIds.map((id) => ({ userId: id, titulo, mensagem, tipo: "sistema" as const })),
    );
  } catch (err: any) {
    log.warn({ err: err.message }, "Falha notificando usuários");
  }
}

export const roadmapRouter = router({
  /** Lista paginada com filtros e ordenação. Inclui `jaVotou` por item. */
  listar: protectedProcedure
    .input(z.object({
      status: z.enum(["todos", ...STATUS_VALORES]).default("todos"),
      categoria: z.enum(["todos", ...CATEGORIA_VALORES]).default("todos"),
      ordenacao: z.enum(["votos", "recente"]).default("votos"),
      busca: z.string().max(255).optional(),
      limite: z.number().int().min(1).max(50).default(20),
      pagina: z.number().int().min(1).default(1),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { itens: [], total: 0, pagina: 1, limite: input.limite, totalPaginas: 0 };

      const isAdmin = ctx.user.role === "admin";

      const conds: any[] = [];
      if (input.status !== "todos") conds.push(eq(roadmapItens.status, input.status));
      if (input.categoria !== "todos") conds.push(eq(roadmapItens.categoria, input.categoria));
      if (input.busca) {
        const b = `%${input.busca}%`;
        conds.push(or(like(roadmapItens.titulo, b), like(roadmapItens.descricao, b)));
      }

      // Moderação: usuário comum só vê itens públicos (status != aguardando_aprovacao)
      // OU os que ele mesmo criou (pra acompanhar o que sugeriu).
      // Admin vê tudo.
      if (!isAdmin) {
        conds.push(or(
          ne(roadmapItens.status, "aguardando_aprovacao"),
          eq(roadmapItens.criadoPor, ctx.user.id),
        ));
      }

      const where = conds.length > 0 ? and(...conds) : undefined;

      const orderBy = input.ordenacao === "votos"
        ? [desc(roadmapItens.contagemVotos), desc(roadmapItens.createdAt)]
        : [desc(roadmapItens.createdAt)];

      const offset = (input.pagina - 1) * input.limite;
      const linhas = await db
        .select({
          id: roadmapItens.id,
          titulo: roadmapItens.titulo,
          descricao: roadmapItens.descricao,
          categoria: roadmapItens.categoria,
          status: roadmapItens.status,
          criadoPor: roadmapItens.criadoPor,
          contagemVotos: roadmapItens.contagemVotos,
          createdAt: roadmapItens.createdAt,
          autorNome: users.name,
        })
        .from(roadmapItens)
        .leftJoin(users, eq(users.id, roadmapItens.criadoPor))
        .where(where as any)
        .orderBy(...orderBy)
        .limit(input.limite)
        .offset(offset);

      const [cnt] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(roadmapItens)
        .where(where as any);
      const total = Number(cnt?.count || 0);

      // Marca quais o usuário atual já votou (1 query só)
      const ids = linhas.map((l) => l.id);
      const meusVotos = ids.length === 0
        ? []
        : await db
            .select({ itemId: roadmapVotos.itemId })
            .from(roadmapVotos)
            .where(and(eq(roadmapVotos.userId, ctx.user.id), inArray(roadmapVotos.itemId, ids)));
      const setVotados = new Set(meusVotos.map((v) => v.itemId));

      return {
        itens: linhas.map((l) => ({
          ...l,
          autorNome: l.autorNome ?? "Usuário",
          createdAt: (l.createdAt as Date).toISOString(),
          jaVotou: setVotados.has(l.id),
        })),
        total,
        pagina: input.pagina,
        limite: input.limite,
        totalPaginas: Math.ceil(total / input.limite),
      };
    }),

  /** Cria item. Rate limit simples: 5/dia/user. */
  criar: protectedProcedure
    .input(z.object({
      titulo: z.string().min(3).max(255),
      descricao: z.string().min(10).max(2000),
      categoria: z.enum(CATEGORIA_VALORES),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Rate limit: 5 itens/dia/user.
      const desdeOntem = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [c] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(roadmapItens)
        .where(and(
          eq(roadmapItens.criadoPor, ctx.user.id),
          sql`${roadmapItens.createdAt} >= ${desdeOntem}`,
        ));
      if (Number(c?.count || 0) >= 5) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Limite de 5 sugestões por dia atingido. Volte amanhã!",
        });
      }

      const [r] = await db.insert(roadmapItens).values({
        titulo: input.titulo.trim(),
        descricao: input.descricao.trim(),
        categoria: input.categoria,
        criadoPor: ctx.user.id,
        status: "aguardando_aprovacao", // explícito (também é o default do banco)
      });
      const id = (r as { insertId: number }).insertId;

      void notificarAdmins(
        "Sugestão aguardando aprovação",
        `${ctx.user.name || "Um usuário"} sugeriu: "${input.titulo}". Aprove em /roadmap.`,
      );

      return { id };
    }),

  /**
   * Toggle de voto. Se já votou, remove. Se não votou, adiciona.
   * `contagemVotos` é atualizado na mesma query.
   */
  votar: protectedProcedure
    .input(z.object({ itemId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [item] = await db
        .select({ id: roadmapItens.id, status: roadmapItens.status })
        .from(roadmapItens)
        .where(eq(roadmapItens.id, input.itemId))
        .limit(1);
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });
      if (item.status === "aguardando_aprovacao") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Esta sugestão ainda não foi aprovada e não pode receber votos.",
        });
      }

      const [voto] = await db
        .select({ id: roadmapVotos.id })
        .from(roadmapVotos)
        .where(and(eq(roadmapVotos.itemId, input.itemId), eq(roadmapVotos.userId, ctx.user.id)))
        .limit(1);

      if (voto) {
        await db.delete(roadmapVotos).where(eq(roadmapVotos.id, voto.id));
        await db
          .update(roadmapItens)
          .set({ contagemVotos: sql`GREATEST(${roadmapItens.contagemVotos} - 1, 0)` })
          .where(eq(roadmapItens.id, input.itemId));
        return { votou: false };
      }

      await db.insert(roadmapVotos).values({
        itemId: input.itemId,
        userId: ctx.user.id,
      });
      await db
        .update(roadmapItens)
        .set({ contagemVotos: sql`${roadmapItens.contagemVotos} + 1` })
        .where(eq(roadmapItens.id, input.itemId));
      return { votou: true };
    }),

  /** Detalhe + últimos votantes (10) */
  obter: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const [item] = await db
        .select({
          id: roadmapItens.id,
          titulo: roadmapItens.titulo,
          descricao: roadmapItens.descricao,
          categoria: roadmapItens.categoria,
          status: roadmapItens.status,
          contagemVotos: roadmapItens.contagemVotos,
          criadoPor: roadmapItens.criadoPor,
          createdAt: roadmapItens.createdAt,
          autorNome: users.name,
        })
        .from(roadmapItens)
        .leftJoin(users, eq(users.id, roadmapItens.criadoPor))
        .where(eq(roadmapItens.id, input.id))
        .limit(1);
      if (!item) return null;

      const ultimosVotos = await db
        .select({ userName: users.name, createdAt: roadmapVotos.createdAt })
        .from(roadmapVotos)
        .leftJoin(users, eq(users.id, roadmapVotos.userId))
        .where(eq(roadmapVotos.itemId, input.id))
        .orderBy(desc(roadmapVotos.createdAt))
        .limit(10);

      return {
        ...item,
        autorNome: item.autorNome ?? "Usuário",
        createdAt: (item.createdAt as Date).toISOString(),
        ultimosVotos: ultimosVotos.map((v) => ({
          userName: v.userName ?? "Usuário",
          createdAt: (v.createdAt as Date).toISOString(),
        })),
      };
    }),

  /**
   * Admin atualiza o status do item. Se mudou pra "lancado", notifica o
   * autor + todos os votantes (gostam de saber que a ideia entrou em
   * produção).
   */
  atualizarStatus: adminProcedure
    .input(z.object({
      id: z.number().int(),
      status: z.enum(STATUS_VALORES),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [antes] = await db
        .select({
          status: roadmapItens.status,
          titulo: roadmapItens.titulo,
          criadoPor: roadmapItens.criadoPor,
        })
        .from(roadmapItens)
        .where(eq(roadmapItens.id, input.id))
        .limit(1);
      if (!antes) throw new TRPCError({ code: "NOT_FOUND" });

      await db
        .update(roadmapItens)
        .set({ status: input.status })
        .where(eq(roadmapItens.id, input.id));

      // Aprovação: status sai de "aguardando_aprovacao" → notifica criador.
      // Item agora fica visível pra todos os usuários e pode receber votos.
      if (antes.status === "aguardando_aprovacao" && input.status !== "aguardando_aprovacao") {
        if (input.status === "recusado") {
          void notificarUsers(
            [antes.criadoPor],
            "Sua sugestão foi avaliada",
            `Após análise, "${antes.titulo}" não entrou no roadmap dessa vez.`,
          );
        } else {
          void notificarUsers(
            [antes.criadoPor],
            "Sua sugestão foi aprovada!",
            `"${antes.titulo}" agora está pública no roadmap. Outros usuários podem votar.`,
          );
        }
      }

      // Lançamento: notifica autor + votantes.
      if (input.status === "lancado" && antes.status !== "lancado") {
        const votantes = await db
          .select({ userId: roadmapVotos.userId })
          .from(roadmapVotos)
          .where(eq(roadmapVotos.itemId, input.id));
        const ids = new Set<number>([antes.criadoPor, ...votantes.map((v) => v.userId)]);
        void notificarUsers(
          [...ids],
          "Sua sugestão foi lançada!",
          `"${antes.titulo}" agora está disponível no Jurify.`,
        );
      }

      return { success: true };
    }),
});

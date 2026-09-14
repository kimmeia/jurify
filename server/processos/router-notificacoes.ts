/**
 * Router de Notificações In-App.
 *
 * SEGURANÇA:
 * - Todas as queries filtram por ctx.user.id (isolamento por utilizador)
 * - Nunca expor notificações de outros utilizadores
 *
 * Tipos de notificação:
 * - movimentacao: nova movimentação num processo monitorado
 * - nova_acao: nova ação contra cliente monitorado por CPF/CNPJ
 *              (separado de movimentacao pra não inflar contador do
 *              dashboard que conta só movs reais)
 * - sistema: avisos do sistema (manutenção, novidades)
 * - plano: alterações no plano (upgrade, downgrade, créditos)
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { notificacoes, eventosProcesso, motorMonitoramentos, prazosSugeridos, notificacaoPreferencias } from "../../drizzle/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { createLogger } from "../_core/logger";
const log = createLogger("processos-router-notificacoes");

// ============================================================
// Helper para criar notificações (usado por outros módulos)
// ============================================================

/**
 * Cria uma notificação in-app para um utilizador.
 * Pode ser chamado de qualquer módulo do backend.
 */
export async function criarNotificacao(params: {
  userId: number;
  titulo: string;
  mensagem: string;
  tipo: "movimentacao" | "sistema" | "plano" | "nova_acao";
  processoId?: number;
}): Promise<void> {
  const db = await getDb();
  if (!db) {
    log.warn("[Notificações] Base de dados indisponível, notificação não criada");
    return;
  }

  await db.insert(notificacoes).values({
    userId: params.userId,
    titulo: params.titulo,
    mensagem: params.mensagem,
    tipo: params.tipo,
    processoId: params.processoId ?? null,
  });
}

// ============================================================
// Router
// ============================================================

export const notificacoesRouter = router({
  /**
   * O que esta pessoa recebe no celular, e o que ela já escolheu.
   *
   * A lista sai do catálogo, não do banco: o banco guarda só as divergências.
   * Quem vê cada grupo é filtrado aqui — Dinheiro só com acesso ao Financeiro,
   * Saúde do sistema só pro dono — porque oferecer a chave de um aviso que a
   * pessoa nunca vai receber é prometer o que não acontece.
   */
  preferencias: protectedProcedure.query(async ({ ctx }) => {
    const { AVISOS, GRUPOS, AJUSTE_SILENCIO, AJUSTE_ALCANCE, padraoDaChave } = await import(
      "@shared/notificacoes-avisos"
    );
    const db = await getDb();

    const escolhas = new Map<string, boolean>();
    if (db) {
      const linhas = await db
        .select({
          chave: notificacaoPreferencias.chave,
          ligado: notificacaoPreferencias.ligado,
        })
        .from(notificacaoPreferencias)
        .where(eq(notificacaoPreferencias.userId, ctx.user.id));
      for (const l of linhas) escolhas.set(l.chave, Boolean(l.ligado));
    }

    const { getEscritorioPorUsuario } = await import("../escritorio/db-escritorio");
    const vinculo = await getEscritorioPorUsuario(ctx.user.id);
    const ehDono = vinculo?.colaborador?.cargo === "dono";

    const { checkPermission } = await import("../escritorio/check-permission");
    let veFinanceiro = false;
    try {
      veFinanceiro = (await checkPermission(ctx.user.id, "financeiro", "ver")).allowed;
    } catch {
      /* sem permissão resolvida, o grupo não aparece — é o lado seguro */
    }

    const podeVer = (quem: string) =>
      quem === "todos" || (quem === "dono" && ehDono) || (quem === "financeiro" && veFinanceiro);

    const resolver = (chave: string) => escolhas.get(chave) ?? padraoDaChave(chave);

    return {
      grupos: GRUPOS.filter((g) => podeVer(g.quemVe)).map((g) => ({
        ...g,
        avisos: AVISOS.filter((a) => a.grupo === g.id && podeVer(a.quemVe)).map((a) => ({
          id: a.id,
          titulo: a.titulo,
          explica: a.explica,
          padrao: a.padrao,
          ligado: resolver(a.id),
        })),
      })),
      ajustes: {
        silencioNoturno: resolver(AJUSTE_SILENCIO),
        tudoDoEscritorio: resolver(AJUSTE_ALCANCE),
      },
      ehDono,
    };
  }),

  /**
   * Liga ou desliga um aviso. Grava SÓ o que diverge do padrão: quem volta
   * pro padrão tem a linha APAGADA, e assim herda mudanças futuras de fábrica.
   */
  salvarPreferencia: protectedProcedure
    .input(z.object({ chave: z.string().min(3).max(60), ligado: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const { chaveConhecida, padraoDaChave } = await import("@shared/notificacoes-avisos");
      if (!chaveConhecida(input.chave)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Aviso desconhecido." });
      }

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de dados indisponível" });

      if (input.ligado === padraoDaChave(input.chave)) {
        await db
          .delete(notificacaoPreferencias)
          .where(
            and(
              eq(notificacaoPreferencias.userId, ctx.user.id),
              eq(notificacaoPreferencias.chave, input.chave),
            ),
          );
      } else {
        await db
          .insert(notificacaoPreferencias)
          .values({ userId: ctx.user.id, chave: input.chave, ligado: input.ligado })
          .onDuplicateKeyUpdate({ set: { ligado: input.ligado } });
      }

      const { esquecerPreferencias } = await import("../_core/preferencias-notificacao");
      esquecerPreferencias(ctx.user.id);
      return { ok: true };
    }),

  /**
   * Listar notificações do utilizador (mais recentes primeiro).
   * SEGURANÇA: filtra por ctx.user.id
   */
  listar: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        apenasNaoLidas: z.boolean().default(false),
        // Filtro opcional por tipo. Permite ao popover mostrar abas
        // (Processos / Sistema) sem precisar carregar tudo e filtrar
        // client-side — útil quando o usuário tem centenas de notifs
        // e as raras de um tipo ficam soterradas.
        tipos: z
          .array(z.enum(["movimentacao", "sistema", "plano", "nova_acao"]))
          .optional(),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de dados indisponível" });

      const limit = input?.limit ?? 50;
      const apenasNaoLidas = input?.apenasNaoLidas ?? false;
      const tipos = input?.tipos;

      const conditions = [eq(notificacoes.userId, ctx.user.id)];
      if (apenasNaoLidas) {
        conditions.push(eq(notificacoes.lida, false));
      }
      if (tipos && tipos.length > 0) {
        conditions.push(inArray(notificacoes.tipo, tipos));
      }

      const items = await db
        .select()
        .from(notificacoes)
        .where(and(...conditions))
        .orderBy(desc(notificacoes.createdAt))
        .limit(limit);

      return items;
    }),

  /**
   * Contar notificações não lidas.
   * SEGURANÇA: filtra por ctx.user.id
   */
  contarNaoLidas: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de dados indisponível" });

    const [result] = await db
      .select({ count: sql<number>`count(*)` })
      .from(notificacoes)
      .where(
        and(
          eq(notificacoes.userId, ctx.user.id),
          eq(notificacoes.lida, false)
        )
      );

    return { count: result?.count ?? 0 };
  }),

  /**
   * Marcar uma notificação como lida.
   * SEGURANÇA: verifica que a notificação pertence ao ctx.user.id
   */
  marcarLida: protectedProcedure
    .input(z.object({ notificacaoId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de dados indisponível" });

      const result = await db
        .update(notificacoes)
        .set({ lida: true })
        .where(
          and(
            eq(notificacoes.id, input.notificacaoId),
            eq(notificacoes.userId, ctx.user.id)
          )
        );

      return { success: true };
    }),

  /**
   * Marcar todas as notificações como lidas.
   * SEGURANÇA: filtra por ctx.user.id
   */
  marcarTodasLidas: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de dados indisponível" });

    await db
      .update(notificacoes)
      .set({ lida: true })
      .where(
        and(
          eq(notificacoes.userId, ctx.user.id),
          eq(notificacoes.lida, false)
        )
      );

    return { success: true };
  }),

  /**
   * Apagar uma notificação.
   * SEGURANÇA: verifica que a notificação pertence ao ctx.user.id
   */
  apagar: protectedProcedure
    .input(z.object({ notificacaoId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de dados indisponível" });

      await db
        .delete(notificacoes)
        .where(
          and(
            eq(notificacoes.id, input.notificacaoId),
            eq(notificacoes.userId, ctx.user.id)
          )
        );

      return { success: true };
    }),

  /**
   * Apagar todas as notificações lidas.
   * SEGURANÇA: filtra por ctx.user.id
   */
  limparLidas: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de dados indisponível" });

    await db
      .delete(notificacoes)
      .where(
        and(
          eq(notificacoes.userId, ctx.user.id),
          eq(notificacoes.lida, true)
        )
      );

    return { success: true };
  }),

  /**
   * Detalhe de uma movimentação a partir do eventoId vinculado a uma
   * notificação. Permite ao popover abrir um drawer com texto completo
   * + dados do monitoramento (CNJ, apelido, tribunal) sem que o usuário
   * precise navegar até /processos e procurar a movimentação.
   *
   * SEGURANÇA: filtra por escritório do user — protege contra deep-link
   * forjado com eventoId de outro escritório.
   */
  detalheEvento: protectedProcedure
    .input(z.object({ eventoId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Base de dados indisponível" });

      // JOIN com motor_monitoramentos pra trazer apelido/searchKey/tribunal.
      // Sem o JOIN, evento bruto não tem o nome amigável do cliente.
      const [row] = await db
        .select({
          id: eventosProcesso.id,
          tipo: eventosProcesso.tipo,
          dataEvento: eventosProcesso.dataEvento,
          conteudo: eventosProcesso.conteudo,
          conteudoJson: eventosProcesso.conteudoJson,
          resumoIa: eventosProcesso.resumoIa,
          desfecho: eventosProcesso.desfecho,
          relevancia: eventosProcesso.relevancia,
          cnjAfetado: eventosProcesso.cnjAfetado,
          fonte: eventosProcesso.fonte,
          lido: eventosProcesso.lido,
          createdAt: eventosProcesso.createdAt,
          escritorioId: eventosProcesso.escritorioId,
          monitoramentoId: eventosProcesso.monitoramentoId,
          apelido: motorMonitoramentos.apelido,
          searchKey: motorMonitoramentos.searchKey,
          searchType: motorMonitoramentos.searchType,
          tribunal: motorMonitoramentos.tribunal,
        })
        .from(eventosProcesso)
        .leftJoin(
          motorMonitoramentos,
          eq(motorMonitoramentos.id, eventosProcesso.monitoramentoId),
        )
        .where(eq(eventosProcesso.id, input.eventoId))
        .limit(1);

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Evento não encontrado" });
      }

      // Resolve escritório do user — comparar com escritorioId do
      // evento. Sem isso, qualquer user logado lê eventos de qualquer
      // escritório passando o ID.
      const { getEscritorioPorUsuario } = await import("../escritorio/db-escritorio");
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc || esc.escritorio.id !== row.escritorioId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Evento não encontrado" });
      }

      // Prazo sugerido PENDENTE deste evento (pro selo "⏰ requer prazo" +
      // botão de aprovar direto no drawer). UNIQUE em evento_id → no máx. 1.
      const [prazo] = await db
        .select({
          id: prazosSugeridos.id,
          tipo: prazosSugeridos.tipo,
          titulo: prazosSugeridos.titulo,
          dataSugerida: prazosSugeridos.dataSugerida,
          prazoDias: prazosSugeridos.prazoDias,
          prazoUteis: prazosSugeridos.prazoUteis,
        })
        .from(prazosSugeridos)
        .where(and(
          eq(prazosSugeridos.eventoId, input.eventoId),
          eq(prazosSugeridos.escritorioId, row.escritorioId),
          eq(prazosSugeridos.status, "pendente"),
        ))
        .limit(1);

      return { ...row, prazoSugerido: prazo ?? null };
    }),
});

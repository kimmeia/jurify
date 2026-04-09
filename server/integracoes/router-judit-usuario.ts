/**
 * Router tRPC — Judit.IO para Usuários
 *
 * Permite que clientes com plano ativo consultem e monitorem processos via Judit.IO.
 * A API key é do admin (armazenada em admin_integracoes) — o usuário nunca a vê.
 *
 * Segurança:
 * - protectedProcedure (requer login)
 * - Todas as queries filtram por ctx.user.id
 * - Verificação de plano antes de criar monitoramento
 * - Consome créditos por consulta
 *
 * Limites por plano (em plan-limits.ts):
 * - free: 0 monitoramentos (sem acesso)
 * - basic: 5 monitoramentos
 * - professional: 50 monitoramentos
 * - enterprise: ilimitado
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb, getActiveSubscription, consumirCredito } from "../db";
import { juditMonitoramentos, juditRespostas } from "../../drizzle/schema";
import { eq, and, desc, or, like } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getJuditClient } from "./judit-webhook";
import { getLimites } from "../billing/plan-limits";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

async function requireJuditDisponivel() {
  const client = await getJuditClient();
  if (!client) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Serviço de monitoramento processual indisponível no momento.",
    });
  }
  return client;
}

async function verificarPlanoJudit(userId: number) {
  const sub = await getActiveSubscription(userId);
  const planId = sub?.planId || "free";
  const limites = getLimites(planId);

  if (!limites.modulosPermitidos.includes("monitoramento_judit")) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Seu plano não inclui monitoramento processual. Faça upgrade para ter acesso.",
    });
  }

  return { planId, limites, sub };
}

async function contarMonitoramentosAtivos(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const ativos = await db
    .select({ id: juditMonitoramentos.id })
    .from(juditMonitoramentos)
    .where(
      and(
        eq(juditMonitoramentos.clienteUserId, userId),
        or(
          eq(juditMonitoramentos.statusJudit, "created"),
          eq(juditMonitoramentos.statusJudit, "updating"),
          eq(juditMonitoramentos.statusJudit, "updated")
        )
      )
    );

  return ativos.length;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTER
// ═══════════════════════════════════════════════════════════════════════════════

export const juditUsuarioRouter = router({
  /**
   * Verifica se o serviço Judit está disponível e se o plano do usuário dá acesso.
   * Não expõe nenhum dado da API key.
   */
  status: protectedProcedure.query(async ({ ctx }) => {
    const client = await getJuditClient();
    const juditConectado = !!client;

    const sub = await getActiveSubscription(ctx.user.id);
    const planId = sub?.planId || "free";
    const limites = getLimites(planId);
    const planoPermite = limites.modulosPermitidos.includes("monitoramento_judit");

    let monitoramentosAtivos = 0;
    if (juditConectado && planoPermite) {
      monitoramentosAtivos = await contarMonitoramentosAtivos(ctx.user.id);
    }

    return {
      disponivel: juditConectado && planoPermite,
      juditConectado,
      planoPermite,
      planId,
      monitoramentosAtivos,
      maxMonitoramentos: limites.maxMonitoramentosJudit,
    };
  }),

  /**
   * Consulta um processo por CNJ. Consome 1 crédito.
   * Retorna dados completos do processo direto dos tribunais.
   */
  consultarProcesso: protectedProcedure
    .input(z.object({
      numeroCnj: z.string().min(20).max(25),
    }))
    .mutation(async ({ ctx, input }) => {
      await verificarPlanoJudit(ctx.user.id);
      const client = await requireJuditDisponivel();

      // Consumir crédito
      const creditoOk = await consumirCredito(ctx.user.id);
      if (!creditoOk) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Créditos insuficientes. Adquira mais créditos ou faça upgrade do plano.",
        });
      }

      // Criar consulta na Judit
      const request = await client.criarRequest({
        search: {
          search_type: "lawsuit_cnj",
          search_key: input.numeroCnj,
        },
        with_attachments: false,
      });

      // Polling (max 30s)
      const startTime = Date.now();
      let responses = null;

      while (Date.now() - startTime < 30000) {
        await new Promise((r) => setTimeout(r, 2000));
        const reqStatus = await client.consultarRequest(request.request_id);
        if (reqStatus.status === "completed") {
          responses = await client.buscarRespostas(request.request_id, 1, 10);
          break;
        }
      }

      if (!responses || responses.page_data.length === 0) {
        return {
          encontrado: false,
          mensagem: "Consulta em andamento. Tente novamente em alguns segundos.",
        };
      }

      const lawsuits = responses.page_data.filter((r) => r.response_type === "lawsuit");
      if (lawsuits.length === 0) {
        const erros = responses.page_data.filter((r) => r.response_type === "application_error");
        return {
          encontrado: false,
          mensagem: erros.length > 0 ? ((erros[0].response_data as { message?: string })?.message || "Processo não encontrado") : "Nenhum resultado encontrado",
        };
      }

      return {
        encontrado: true,
        processo: lawsuits[0].response_data,
        totalInstancias: lawsuits.length,
      };
    }),

  /**
   * Cria um monitoramento processual por CNJ.
   * Verificações: plano, limite de monitoramentos, duplicata.
   */
  /**
   * Cria monitoramento de MOVIMENTAÇÕES em um processo específico (CNJ).
   * Recebe atualizações (despachos, sentenças, audiências) via webhook.
   */
  /**
   * Cria monitoramento de MOVIMENTAÇÕES em um processo específico (CNJ).
   *
   * SEGURANÇA (LGPD): Requer credencial OAB válida do cofre. Apenas
   * advogados habilitados podem acessar dados processuais. A credencial
   * garante que existe legitimidade para o acesso.
   */
  criarMonitoramento: protectedProcedure
    .input(z.object({
      numeroCnj: z.string().min(20).max(25),
      apelido: z.string().max(255).optional(),
      /** ID de credencial do cofre — OBRIGATÓRIO para LGPD */
      credencialId: z.number({
        required_error: "Credencial OAB obrigatória. Cadastre uma no Cofre de Credenciais.",
      }),
    }))
    .mutation(async ({ ctx, input }) => {
      const { limites } = await verificarPlanoJudit(ctx.user.id);
      const client = await requireJuditDisponivel();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // ─── SEGURANÇA: Validar credencial OAB ───────────────────────────
      const { juditCredenciais } = await import("../../drizzle/schema");
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "FORBIDDEN", message: "Escritório não encontrado." });

      const [cred] = await db
        .select()
        .from(juditCredenciais)
        .where(
          and(
            eq(juditCredenciais.id, input.credencialId),
            eq(juditCredenciais.escritorioId, esc.escritorio.id),
          ),
        )
        .limit(1);

      if (!cred) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Credencial não encontrada ou não pertence ao seu escritório.",
        });
      }
      if (cred.status !== "ativa" && cred.status !== "validando") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Credencial "${cred.customerKey}" não pode ser usada (status: ${cred.status}). Verifique no Cofre.`,
        });
      }

      const juditCredentialId = cred.juditCredentialId;

      // Verificar limite de monitoramentos
      const ativos = await contarMonitoramentosAtivos(ctx.user.id);
      if (ativos >= limites.maxMonitoramentosJudit) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Limite de ${limites.maxMonitoramentosJudit} monitoramentos atingido. Faça upgrade para monitorar mais processos.`,
        });
      }

      // Verificar duplicata
      const existente = await db
        .select()
        .from(juditMonitoramentos)
        .where(
          and(
            eq(juditMonitoramentos.searchKey, input.numeroCnj),
            eq(juditMonitoramentos.clienteUserId, ctx.user.id),
            or(
              eq(juditMonitoramentos.statusJudit, "created"),
              eq(juditMonitoramentos.statusJudit, "updating"),
              eq(juditMonitoramentos.statusJudit, "updated")
            )
          )
        )
        .limit(1);

      if (existente.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Você já está monitorando este processo.",
        });
      }

      // Criar na Judit (recorrência diária)
      const tracking = await client.criarMonitoramento({
        recurrence: 1,
        search: {
          search_type: "lawsuit_cnj",
          search_key: input.numeroCnj,
        },
        with_attachments: false,
        ...(juditCredentialId ? { credential_id: juditCredentialId } : {}),
      });

      // Salvar localmente vinculado ao usuário
      await db.insert(juditMonitoramentos).values({
        trackingId: tracking.tracking_id,
        searchType: "lawsuit_cnj",
        searchKey: input.numeroCnj,
        tipoMonitoramento: "movimentacoes",
        credencialId: input.credencialId || null,
        recurrence: 1,
        statusJudit: tracking.status as any,
        apelido: input.apelido || null,
        clienteUserId: ctx.user.id,
        withAttachments: false,
      });

      return {
        success: true,
        trackingId: tracking.tracking_id,
        mensagem: "Monitoramento criado. Você receberá atualizações diárias.",
      };
    }),

  /**
   * Cria monitoramento de NOVAS AÇÕES contra uma pessoa/empresa.
   *
   * SEGURANÇA (LGPD): Para CPF/CNPJ, exige que exista um cliente
   * cadastrado no escritório com esse documento. Isso garante que
   * existe relação jurídica legítima para o monitoramento processual.
   *
   * Quando uma nova ação for distribuída no futuro contra o CPF/CNPJ
   * monitorado, recebemos um webhook event_type="new_lawsuit" e
   * registramos em `judit_novas_acoes`.
   */
  criarMonitoramentoNovasAcoes: protectedProcedure
    .input(z.object({
      tipo: z.enum(["cpf", "cnpj"]),
      valor: z.string().min(3).max(128),
      apelido: z.string().max(255).optional(),
      credencialId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { limites } = await verificarPlanoJudit(ctx.user.id);
      const client = await requireJuditDisponivel();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // ─── SEGURANÇA: Validar que CPF/CNPJ pertence a um cliente cadastrado ──
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "FORBIDDEN", message: "Escritório não encontrado." });

      const searchKeyNorm = input.valor.replace(/\D/g, "");
      const { contatos } = await import("../../drizzle/schema");
      const { sql } = await import("drizzle-orm");

      // Compara CPF/CNPJ removendo formatação (pontos/traços/barras) de ambos os lados,
      // porque o campo contatos.cpfCnpj pode estar armazenado com formato (ex: 605.167.503-56)
      const clientesCadastrados = await db
        .select({ id: contatos.id, nome: contatos.nome, cpfCnpj: contatos.cpfCnpj })
        .from(contatos)
        .where(
          and(
            eq(contatos.escritorioId, esc.escritorio.id),
            sql`REPLACE(REPLACE(REPLACE(${contatos.cpfCnpj}, '.', ''), '-', ''), '/', '') = ${searchKeyNorm}`,
          ),
        )
        .limit(1);

      if (clientesCadastrados.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Este CPF/CNPJ não pertence a nenhum cliente cadastrado no seu escritório. " +
            "Cadastre o cliente primeiro em Clientes para poder monitorá-lo (LGPD).",
        });
      }

      const ativos = await contarMonitoramentosAtivos(ctx.user.id);
      if (ativos >= limites.maxMonitoramentosJudit) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Limite de ${limites.maxMonitoramentosJudit} monitoramentos atingido.`,
        });
      }

      // Normaliza o valor pra CPF/CNPJ (remove formatação)
      const searchKey = input.valor.replace(/\D/g, "");

      // Duplicata
      const existente = await db
        .select()
        .from(juditMonitoramentos)
        .where(
          and(
            eq(juditMonitoramentos.searchKey, searchKey),
            eq(juditMonitoramentos.clienteUserId, ctx.user.id),
            eq(juditMonitoramentos.tipoMonitoramento, "novas_acoes"),
          ),
        )
        .limit(1);
      if (existente.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Você já monitora novas ações para este CPF/CNPJ/OAB.",
        });
      }

      // Resolve credencial se informada
      let juditCredentialId: string | undefined;
      if (input.credencialId) {
        const { juditCredenciais } = await import("../../drizzle/schema");
        const [cred] = await db
          .select()
          .from(juditCredenciais)
          .where(eq(juditCredenciais.id, input.credencialId))
          .limit(1);
        if (cred?.juditCredentialId) juditCredentialId = cred.juditCredentialId;
      }

      // Cria na Judit com flag only_new_lawsuits
      const tracking = await client.criarMonitoramento({
        recurrence: 1,
        search: {
          search_type: input.tipo,
          search_key: searchKey,
        },
        only_new_lawsuits: true,
        with_attachments: false,
        ...(juditCredentialId ? { credential_id: juditCredentialId } : {}),
      });

      // Salva localmente
      await db.insert(juditMonitoramentos).values({
        trackingId: tracking.tracking_id,
        searchType: input.tipo,
        searchKey,
        tipoMonitoramento: "novas_acoes",
        credencialId: input.credencialId || null,
        recurrence: 1,
        statusJudit: tracking.status as any,
        apelido: input.apelido || null,
        clienteUserId: ctx.user.id,
        withAttachments: false,
      });

      return {
        success: true,
        trackingId: tracking.tracking_id,
        mensagem: "Monitoramento de novas ações criado. Você será avisado quando alguém processar esta pessoa/empresa.",
      };
    }),

  /**
   * Lista as novas ações detectadas (paginado) para o usuário.
   * Se `apenasNaoLidas=true`, retorna só as que ainda não foram abertas.
   */
  listarNovasAcoes: protectedProcedure
    .input(z.object({
      apenasNaoLidas: z.boolean().optional(),
      monitoramentoId: z.number().optional(),
      limite: z.number().min(1).max(100).default(50),
    }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { acoes: [], totalNaoLidas: 0 };

      const { juditNovasAcoes } = await import("../../drizzle/schema");
      const params = input || { limite: 50 };

      // Primeiro pega os monitoramentos COMPLETOS do usuário (pra ter o
      // apelido, searchKey, searchType — usado pra mostrar contexto
      // do cliente na lista de novas ações)
      const mons = await db
        .select()
        .from(juditMonitoramentos)
        .where(
          and(
            eq(juditMonitoramentos.clienteUserId, ctx.user.id),
            eq(juditMonitoramentos.tipoMonitoramento, "novas_acoes"),
          ),
        );
      const monIds = mons.map((m) => m.id);
      if (monIds.length === 0) return { acoes: [], totalNaoLidas: 0 };

      // Mapa id → monitoramento pra fazer join local
      const monMap = new Map(mons.map((m) => [m.id, m]));

      const { inArray } = await import("drizzle-orm");
      const conditions: any[] = [inArray(juditNovasAcoes.monitoramentoId, monIds)];
      if (params.apenasNaoLidas) {
        conditions.push(eq(juditNovasAcoes.lido, false));
      }
      if (params.monitoramentoId) {
        conditions.push(eq(juditNovasAcoes.monitoramentoId, params.monitoramentoId));
      }

      const acoes = await db
        .select()
        .from(juditNovasAcoes)
        .where(and(...conditions))
        .orderBy(desc(juditNovasAcoes.createdAt))
        .limit(params.limite);

      // Conta não-lidas (independente de filtros)
      const naoLidasRows = await db
        .select({ id: juditNovasAcoes.id })
        .from(juditNovasAcoes)
        .where(
          and(
            inArray(juditNovasAcoes.monitoramentoId, monIds),
            eq(juditNovasAcoes.lido, false),
          ),
        );

      return {
        acoes: acoes.map((a) => {
          const mon = monMap.get(a.monitoramentoId);
          return {
            ...a,
            poloAtivo: a.poloAtivo ? JSON.parse(a.poloAtivo) : [],
            poloPassivo: a.poloPassivo ? JSON.parse(a.poloPassivo) : [],
            // Contexto do monitoramento (apelido/cliente monitorado)
            clienteApelido: mon?.apelido || null,
            clienteSearchKey: mon?.searchKey || null,
            clienteSearchType: mon?.searchType || null,
          };
        }),
        totalNaoLidas: naoLidasRows.length,
        /**
         * Retorna também a lista de monitoramentos ativos pra a UI
         * poder mostrar cards resumo do que está sendo monitorado.
         */
        monitoramentos: mons.map((m) => ({
          id: m.id,
          apelido: m.apelido,
          searchKey: m.searchKey,
          searchType: m.searchType,
          totalNovasAcoes: m.totalNovasAcoes,
          statusJudit: m.statusJudit,
        })),
      };
    }),

  /** Marca uma nova ação como lida */
  marcarNovaAcaoLida: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { juditNovasAcoes } = await import("../../drizzle/schema");

      // Segurança: só marca se for de um monitoramento do user
      const [acao] = await db
        .select()
        .from(juditNovasAcoes)
        .where(eq(juditNovasAcoes.id, input.id))
        .limit(1);
      if (!acao) throw new TRPCError({ code: "NOT_FOUND" });

      const [mon] = await db
        .select()
        .from(juditMonitoramentos)
        .where(eq(juditMonitoramentos.id, acao.monitoramentoId))
        .limit(1);
      if (!mon || mon.clienteUserId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      await db
        .update(juditNovasAcoes)
        .set({ lido: true })
        .where(eq(juditNovasAcoes.id, input.id));
      return { success: true };
    }),

  /**
   * Lista monitoramentos do usuário logado.
   */
  meusMonitoramentos: protectedProcedure
    .input(z.object({
      busca: z.string().optional(),
      tipoMonitoramento: z.enum(["movimentacoes", "novas_acoes"]).optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];

      const conditions: any[] = [
        eq(juditMonitoramentos.clienteUserId, ctx.user.id),
        or(
          eq(juditMonitoramentos.statusJudit, "created"),
          eq(juditMonitoramentos.statusJudit, "updating"),
          eq(juditMonitoramentos.statusJudit, "updated"),
          eq(juditMonitoramentos.statusJudit, "paused")
        ),
      ];

      if (input?.tipoMonitoramento) {
        conditions.push(eq(juditMonitoramentos.tipoMonitoramento, input.tipoMonitoramento));
      }

      if (input?.busca) {
        const b = `%${input.busca}%`;
        conditions.push(
          or(
            like(juditMonitoramentos.searchKey, b),
            like(juditMonitoramentos.apelido, b),
            like(juditMonitoramentos.nomePartes, b)
          )
        );
      }

      return db
        .select()
        .from(juditMonitoramentos)
        .where(and(...conditions))
        .orderBy(desc(juditMonitoramentos.updatedAt));
    }),

  /**
   * Pausa um monitoramento (somente o próprio).
   */
  pausar: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const client = await requireJuditDisponivel();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [mon] = await db.select().from(juditMonitoramentos)
        .where(and(eq(juditMonitoramentos.id, input.id), eq(juditMonitoramentos.clienteUserId, ctx.user.id)))
        .limit(1);

      if (!mon) throw new TRPCError({ code: "NOT_FOUND", message: "Monitoramento não encontrado" });

      await client.pausarMonitoramento(mon.trackingId);
      await db.update(juditMonitoramentos).set({ statusJudit: "paused" }).where(eq(juditMonitoramentos.id, input.id));

      return { success: true };
    }),

  /**
   * Reativa um monitoramento pausado (somente o próprio).
   */
  reativar: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const client = await requireJuditDisponivel();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [mon] = await db.select().from(juditMonitoramentos)
        .where(and(eq(juditMonitoramentos.id, input.id), eq(juditMonitoramentos.clienteUserId, ctx.user.id)))
        .limit(1);

      if (!mon) throw new TRPCError({ code: "NOT_FOUND" });

      await client.reativarMonitoramento(mon.trackingId);
      await db.update(juditMonitoramentos).set({ statusJudit: "updated" }).where(eq(juditMonitoramentos.id, input.id));

      return { success: true };
    }),

  /**
   * Remove um monitoramento (somente o próprio).
   */
  deletar: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const client = await requireJuditDisponivel();
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [mon] = await db.select().from(juditMonitoramentos)
        .where(and(eq(juditMonitoramentos.id, input.id), eq(juditMonitoramentos.clienteUserId, ctx.user.id)))
        .limit(1);

      if (!mon) throw new TRPCError({ code: "NOT_FOUND" });

      await client.deletarMonitoramento(mon.trackingId);
      await db.update(juditMonitoramentos).set({ statusJudit: "deleted" }).where(eq(juditMonitoramentos.id, input.id));

      return { success: true };
    }),

  /**
   * Histórico de atualizações de um monitoramento (somente o próprio).
   */
  historico: protectedProcedure
    .input(z.object({
      monitoramentoId: z.number(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(50).default(20),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0 };

      // Verificar que o monitoramento pertence ao usuário
      const [mon] = await db.select().from(juditMonitoramentos)
        .where(and(eq(juditMonitoramentos.id, input.monitoramentoId), eq(juditMonitoramentos.clienteUserId, ctx.user.id)))
        .limit(1);

      if (!mon) throw new TRPCError({ code: "NOT_FOUND" });

      const items = await db
        .select()
        .from(juditRespostas)
        .where(eq(juditRespostas.monitoramentoId, input.monitoramentoId))
        .orderBy(desc(juditRespostas.createdAt))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);

      const all = await db
        .select({ id: juditRespostas.id })
        .from(juditRespostas)
        .where(eq(juditRespostas.monitoramentoId, input.monitoramentoId));

      return { items, total: all.length };
    }),
});

/**
 * Router SmartFlow — CRUD de cenários + execução.
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { checkPermission } from "../escritorio/check-permission";
import { getDb } from "../db";
import { smartflowCenarios, smartflowPassos, smartflowExecucoes } from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { executarManual } from "./dispatcher";
import { createLogger } from "../_core/logger";

const log = createLogger("smartflow");

const GATILHOS = [
  "whatsapp_mensagem",
  "mensagem_canal",
  "novo_lead",
  "agendamento_criado",
  "agendamento_cancelado",
  "agendamento_remarcado",
  "pagamento_recebido",
  "pagamento_vencido",
  "pagamento_proximo_vencimento",
  "manual",
] as const;
const TIPOS_PASSO = [
  "ia_classificar",
  "ia_responder",
  "calcom_horarios",
  "calcom_agendar",
  "calcom_listar",
  "calcom_cancelar",
  "calcom_remarcar",
  "whatsapp_enviar",
  "transferir",
  "condicional",
  "esperar",
  "webhook",
  "kanban_criar_card",
] as const;

const passoInputSchema = z.object({
  tipo: z.enum(TIPOS_PASSO),
  config: z.record(z.any()).optional(),
  /** UUID estável do passo — referencia alvos em `proximoSe` de outros passos. */
  clienteId: z.string().max(36).optional(),
  /**
   * Mapa ramo → clienteId do passo alvo. Chaves: "default", "fallback",
   * `cond_<id>`. Omitir = comportamento linear por `ordem`.
   */
  proximoSe: z.record(z.string()).optional(),
});

async function garantirOwnership(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  cenarioId: number,
  escritorioId: number,
  userId: number,
  verTodos: boolean,
  verProprios: boolean,
) {
  if (verTodos) {
    const [c] = await db
      .select({ criadoPor: smartflowCenarios.criadoPor })
      .from(smartflowCenarios)
      .where(and(eq(smartflowCenarios.id, cenarioId), eq(smartflowCenarios.escritorioId, escritorioId)))
      .limit(1);
    if (!c) throw new TRPCError({ code: "NOT_FOUND" });
    return;
  }
  if (verProprios) {
    const [c] = await db
      .select({ criadoPor: smartflowCenarios.criadoPor })
      .from(smartflowCenarios)
      .where(and(eq(smartflowCenarios.id, cenarioId), eq(smartflowCenarios.escritorioId, escritorioId)))
      .limit(1);
    if (!c) throw new TRPCError({ code: "NOT_FOUND" });
    if (c.criadoPor !== userId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Você só pode alterar seus próprios cenários." });
    }
  }
}

export const smartflowRouter = router({
  /** Lista cenários do escritório */
  listar: protectedProcedure.query(async ({ ctx }) => {
    const perm = await checkPermission(ctx.user.id, "smartflow", "ver");
    if (!perm.allowed) return [];
    const db = await getDb();
    if (!db) return [];

    const conds: any[] = [eq(smartflowCenarios.escritorioId, perm.escritorioId)];
    if (!perm.verTodos && perm.verProprios) {
      conds.push(eq(smartflowCenarios.criadoPor, ctx.user.id));
    }

    const cenarios = await db
      .select()
      .from(smartflowCenarios)
      .where(and(...conds))
      .orderBy(desc(smartflowCenarios.updatedAt));

    const result = [];
    for (const c of cenarios) {
      const passos = await db
        .select()
        .from(smartflowPassos)
        .where(eq(smartflowPassos.cenarioId, c.id))
        .orderBy(smartflowPassos.ordem);
      result.push({ ...c, passos });
    }
    return result;
  }),

  /** Cenário individual (com passos) — usado pelo editor */
  detalhe: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "smartflow", "ver");
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [cenario] = await db
        .select()
        .from(smartflowCenarios)
        .where(and(eq(smartflowCenarios.id, input.id), eq(smartflowCenarios.escritorioId, perm.escritorioId)))
        .limit(1);
      if (!cenario) throw new TRPCError({ code: "NOT_FOUND" });

      if (!perm.verTodos && perm.verProprios && cenario.criadoPor !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const passos = await db
        .select()
        .from(smartflowPassos)
        .where(eq(smartflowPassos.cenarioId, cenario.id))
        .orderBy(smartflowPassos.ordem);

      let configGatilhoParsed: Record<string, unknown> | null = null;
      try {
        configGatilhoParsed = cenario.configGatilho ? JSON.parse(cenario.configGatilho) : null;
      } catch {
        configGatilhoParsed = null;
      }

      // Parse `proximoSe` por passo — o editor precisa do objeto já
      // estruturado pra reconstruir as edges do ReactFlow.
      const passosComEdges = passos.map((p) => {
        let proxSe: Record<string, string> | null = null;
        if (p.proximoSe) {
          try {
            const obj = JSON.parse(p.proximoSe);
            if (obj && typeof obj === "object") proxSe = obj as Record<string, string>;
          } catch { /* ignore */ }
        }
        return { ...p, proximoSe: proxSe };
      });

      return { ...cenario, configGatilho: configGatilhoParsed, passos: passosComEdges };
    }),

  /** Cria cenário com passos */
  criar: protectedProcedure
    .input(z.object({
      nome: z.string().min(2).max(128),
      descricao: z.string().max(512).optional(),
      gatilho: z.enum(GATILHOS),
      configGatilho: z.record(z.any()).optional(),
      passos: z.array(passoInputSchema),
    }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "smartflow", "criar");
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para criar cenários SmartFlow." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [result] = await db.insert(smartflowCenarios).values({
        escritorioId: perm.escritorioId,
        nome: input.nome,
        descricao: input.descricao || null,
        gatilho: input.gatilho,
        configGatilho: input.configGatilho ? JSON.stringify(input.configGatilho) : null,
        criadoPor: ctx.user.id,
      });
      const cenarioId = (result as { insertId: number }).insertId;

      for (let i = 0; i < input.passos.length; i++) {
        const p = input.passos[i];
        await db.insert(smartflowPassos).values({
          cenarioId,
          ordem: i + 1,
          tipo: p.tipo,
          config: p.config ? JSON.stringify(p.config) : null,
          clienteId: p.clienteId || null,
          proximoSe: p.proximoSe && Object.keys(p.proximoSe).length > 0
            ? JSON.stringify(p.proximoSe)
            : null,
        });
      }

      return { id: cenarioId };
    }),

  /**
   * Atualiza cenário existente — substitui nome, descrição, gatilho e o
   * conjunto inteiro de passos. Simplificado: delete + insert dos passos
   * (execuções históricas referenciam cenarioId, não passoId).
   */
  atualizar: protectedProcedure
    .input(z.object({
      id: z.number(),
      nome: z.string().min(2).max(128),
      descricao: z.string().max(512).optional(),
      gatilho: z.enum(GATILHOS),
      configGatilho: z.record(z.any()).optional(),
      passos: z.array(passoInputSchema),
    }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "smartflow", "editar");
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para editar cenários." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await garantirOwnership(db, input.id, perm.escritorioId, ctx.user.id, perm.verTodos, perm.verProprios);

      await db
        .update(smartflowCenarios)
        .set({
          nome: input.nome,
          descricao: input.descricao || null,
          gatilho: input.gatilho,
          configGatilho: input.configGatilho ? JSON.stringify(input.configGatilho) : null,
        })
        .where(and(eq(smartflowCenarios.id, input.id), eq(smartflowCenarios.escritorioId, perm.escritorioId)));

      // Substitui os passos atomicamente (delete + insert). Os IDs do DB
      // mudam, mas `clienteId` (UUID estável gerado pelo editor) sobrevive,
      // então as edges no `proximoSe` continuam apontando pros passos certos.
      await db.delete(smartflowPassos).where(eq(smartflowPassos.cenarioId, input.id));
      for (let i = 0; i < input.passos.length; i++) {
        const p = input.passos[i];
        await db.insert(smartflowPassos).values({
          cenarioId: input.id,
          ordem: i + 1,
          tipo: p.tipo,
          config: p.config ? JSON.stringify(p.config) : null,
          clienteId: p.clienteId || null,
          proximoSe: p.proximoSe && Object.keys(p.proximoSe).length > 0
            ? JSON.stringify(p.proximoSe)
            : null,
        });
      }

      return { success: true };
    }),

  /** Toggle ativo/inativo */
  toggleAtivo: protectedProcedure
    .input(z.object({ id: z.number(), ativo: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "smartflow", "editar");
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para editar cenários." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await garantirOwnership(db, input.id, perm.escritorioId, ctx.user.id, perm.verTodos, perm.verProprios);

      await db.update(smartflowCenarios)
        .set({ ativo: input.ativo })
        .where(and(eq(smartflowCenarios.id, input.id), eq(smartflowCenarios.escritorioId, perm.escritorioId)));

      return { success: true };
    }),

  /** Deleta cenário + passos */
  deletar: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "smartflow", "excluir");
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para excluir cenários." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await garantirOwnership(db, input.id, perm.escritorioId, ctx.user.id, perm.verTodos, perm.verProprios);

      await db.delete(smartflowPassos).where(eq(smartflowPassos.cenarioId, input.id));
      await db.delete(smartflowCenarios)
        .where(and(eq(smartflowCenarios.id, input.id), eq(smartflowCenarios.escritorioId, perm.escritorioId)));

      return { success: true };
    }),

  /**
   * Executa cenário manualmente (botão "Executar agora" no frontend).
   * Aceita um contexto inicial opcional pra testes.
   */
  executar: protectedProcedure
    .input(z.object({
      cenarioId: z.number(),
      contextoInicial: z.record(z.any()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "smartflow", "editar");
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para executar cenários." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await garantirOwnership(db, input.cenarioId, perm.escritorioId, ctx.user.id, perm.verTodos, perm.verProprios);

      const r = await executarManual(perm.escritorioId, input.cenarioId, (input.contextoInicial as any) || {});
      if (!r.executou && r.erro) {
        log.warn({ cenarioId: input.cenarioId, erro: r.erro }, "Execução manual falhou");
      }
      return { success: r.executou, execId: r.execId, erro: r.erro, respostas: r.respostas };
    }),

  /** Cria cenário template "Atendimento + Agendamento" */
  criarTemplateAtendimento: protectedProcedure.mutation(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) throw new TRPCError({ code: "FORBIDDEN" });
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    const [result] = await db.insert(smartflowCenarios).values({
      escritorioId: esc.escritorio.id,
      nome: "Atendimento + Agendamento",
      descricao: "Atende cliente via WhatsApp, tira dúvidas iniciais e agenda reunião automaticamente pelo Cal.com.",
      gatilho: "whatsapp_mensagem",
      criadoPor: ctx.user.id,
    });
    const cenarioId = (result as { insertId: number }).insertId;

    const passos = [
      { ordem: 1, tipo: "ia_classificar", config: { categorias: ["agendar", "duvida", "emergencia", "outro"] } },
      { ordem: 2, tipo: "ia_responder", config: { prompt: "Você é recepcionista de um escritório de advocacia. Se o cliente quer agendar, diga que vai verificar os horários. Se tem dúvida, responda de forma educada. Se é emergência, diga que vai transferir." } },
      { ordem: 3, tipo: "calcom_horarios", config: { duracao: 30 } },
    ];

    for (const p of passos) {
      await db.insert(smartflowPassos).values({
        cenarioId,
        ordem: p.ordem,
        tipo: p.tipo as any,
        config: JSON.stringify(p.config),
      });
    }

    return { id: cenarioId, nome: "Atendimento + Agendamento" };
  }),

  /** Cria cenário template "Pagamento → Kanban" */
  criarTemplatePagamentoKanban: protectedProcedure.mutation(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) throw new TRPCError({ code: "FORBIDDEN" });
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

    const [result] = await db.insert(smartflowCenarios).values({
      escritorioId: esc.escritorio.id,
      nome: "Pagamento → Kanban",
      descricao: "Quando cliente paga a primeira cobrança (não assinatura), cria card automático no Kanban na coluna 'Dar entrada'.",
      gatilho: "pagamento_recebido",
      criadoPor: ctx.user.id,
    });
    const cenarioId = (result as { insertId: number }).insertId;

    const passos = [
      { ordem: 1, tipo: "condicional", config: { campo: "assinaturaId", operador: "nao_existe" } },
      { ordem: 2, tipo: "condicional", config: { campo: "primeiraCobranca", operador: "verdadeiro" } },
      { ordem: 3, tipo: "kanban_criar_card", config: { prioridade: "media" } },
    ];

    for (const p of passos) {
      await db.insert(smartflowPassos).values({
        cenarioId, ordem: p.ordem, tipo: p.tipo as any,
        config: JSON.stringify(p.config),
      });
    }

    return { id: cenarioId, nome: "Pagamento → Kanban" };
  }),

  /** Execuções recentes (lista) */
  execucoes: protectedProcedure
    .input(z.object({ cenarioId: z.number().optional(), limite: z.number().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return [];
      const db = await getDb();
      if (!db) return [];

      const conditions: any[] = [eq(smartflowExecucoes.escritorioId, esc.escritorio.id)];
      if (input?.cenarioId) conditions.push(eq(smartflowExecucoes.cenarioId, input.cenarioId));

      return db
        .select()
        .from(smartflowExecucoes)
        .where(and(...conditions))
        .orderBy(desc(smartflowExecucoes.createdAt))
        .limit(input?.limite || 20);
    }),

  /**
   * Detalhe de uma execução — contexto parseado + nome do cenário.
   * Usado no drill-down do frontend.
   */
  execucaoDetalhe: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [exec] = await db
        .select()
        .from(smartflowExecucoes)
        .where(and(
          eq(smartflowExecucoes.id, input.id),
          eq(smartflowExecucoes.escritorioId, esc.escritorio.id),
        ))
        .limit(1);
      if (!exec) throw new TRPCError({ code: "NOT_FOUND" });

      const [cenario] = await db
        .select({ id: smartflowCenarios.id, nome: smartflowCenarios.nome, gatilho: smartflowCenarios.gatilho })
        .from(smartflowCenarios)
        .where(eq(smartflowCenarios.id, exec.cenarioId))
        .limit(1);

      let contexto: Record<string, unknown> | null = null;
      try {
        contexto = exec.contexto ? JSON.parse(exec.contexto) : null;
      } catch {
        contexto = { _erroParse: exec.contexto };
      }

      return {
        ...exec,
        contexto,
        cenario: cenario || null,
      };
    }),
});

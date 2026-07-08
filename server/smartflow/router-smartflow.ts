/**
 * Router SmartFlow — CRUD de cenários + execução.
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { requireModulo } from "../_core/trpc-gates";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { checkPermission } from "../escritorio/check-permission";
import { getDb } from "../db";
import { smartflowCenarios, smartflowPassos, smartflowExecucoes, smartflowTemplates } from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { executarManual } from "./dispatcher";
import { createLogger } from "../_core/logger";
import { GATILHO_META, TIPO_PASSO_META, type GatilhoSmartflow, type TipoPasso } from "../../shared/smartflow-types";

const log = createLogger("smartflow");

// Enums de validação derivados da FONTE ÚNICA no shared (GATILHO_META /
// TIPO_PASSO_META). Antes eram arrays manuais que dessincronizavam — o
// `TIPOS_PASSO` ficou sem kanban_mover_card/asaas_*/definir_* e o save de
// cenários com esses passos falhava. Derivar garante que tudo que o editor
// oferece é aceito no save.
const GATILHOS = GATILHO_META.map((g) => g.id) as [GatilhoSmartflow, ...GatilhoSmartflow[]];
const TIPOS_PASSO = TIPO_PASSO_META.map((t) => t.id) as [TipoPasso, ...TipoPasso[]];

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

// Recusa salvar cenário com passos semanticamente inválidos. zod cobre forma,
// isso cobre conteúdo. Sem essa rede, um passo distribuir_atendimento sem
// setorId persiste no banco e dispara erro em TODA execução que cai nele —
// silenciosamente travando o fluxo (engine.ts:1678).
function validarPassosSemanticamente(passos: z.infer<typeof passoInputSchema>[]): void {
  const erros: string[] = [];
  passos.forEach((p, i) => {
    const ordem = i + 1;
    if (p.tipo === "distribuir_atendimento") {
      const cfg = (p.config || {}) as { modo?: string; setorId?: number; atendenteId?: number };
      const modo = cfg.modo === "atendente_fixo" ? "atendente_fixo" : "setor";
      if (modo === "setor") {
        const setorId = Number(cfg.setorId);
        if (!Number.isInteger(setorId) || setorId <= 0) {
          erros.push(`Passo ${ordem} (Distribuir atendimento): escolha um setor.`);
        }
      } else {
        const aId = Number(cfg.atendenteId);
        if (!Number.isInteger(aId) || aId <= 0) {
          erros.push(`Passo ${ordem} (Distribuir atendimento): escolha o atendente.`);
        }
      }
    }
  });
  if (erros.length > 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: erros.join(" ") });
  }
}

/**
 * Layout do editor — posições x/y dos nós, keyed por `clienteId` (passos) e
 * "__gatilho__" (gatilho). Só visual; o engine ignora. Persistido pra que o
 * canvas reabra exatamente como o usuário deixou.
 */
const layoutSchema = z.record(z.object({ x: z.number(), y: z.number() })).optional();

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
  /**
   * Catálogo de variáveis disponíveis pro autocomplete `{{...}}` do
   * editor. Lista filtrada pelo tipo de gatilho do cenário (ex: gatilho
   * "pagamento_recebido" expõe variáveis de pagamento + cliente; gatilho
   * "mensagem_recebida" expõe variáveis de mensagem).
   */
  catalogoVariaveis: protectedProcedure.query(async ({ ctx }) => {
    const { CATALOGO_VARIAVEIS } = await import("./interpolar");
    // Enriquece com os campos personalizados do escritório — ficam
    // disponíveis pra todos os gatilhos que tenham `contatoId` no contexto.
    let camposExtras: { path: string; label: string; exemplo: string; categoria: string }[] = [];
    try {
      const { getEscritorioPorUsuario } = await import("../escritorio/db-escritorio");
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (esc) {
        const { getDb } = await import("../db");
        const db = await getDb();
        if (db) {
          const { camposPersonalizadosCliente } = await import("../../drizzle/schema");
          const { eq, asc } = await import("drizzle-orm");
          const rows = await db
            .select()
            .from(camposPersonalizadosCliente)
            .where(eq(camposPersonalizadosCliente.escritorioId, esc.escritorio.id))
            .orderBy(asc(camposPersonalizadosCliente.ordem));
          camposExtras = rows.map((r) => ({
            path: `cliente.campos.${r.chave}`,
            label: r.label,
            exemplo: r.tipo === "data" ? "2025-04-01" : r.tipo === "numero" ? "123" : r.label.toLowerCase(),
            categoria: "campos_personalizados",
          }));
        }
      }
    } catch {
      // Se falhar, devolve catálogo padrão sem extras — fluxo segue
    }

    if (camposExtras.length === 0) return CATALOGO_VARIAVEIS;

    // Adiciona em todos os gatilhos que têm contatoId
    return CATALOGO_VARIAVEIS.map((g) => {
      const temContato = g.variaveis.some((v) => v.path === "contatoId" || v.path === "telefoneCliente");
      return temContato ? { ...g, variaveis: [...g.variaveis, ...camposExtras] } : g;
    });
  }),

  /**
   * Lista os templates (HSM) aprovados do canal WhatsApp oficial (API Meta)
   * do escritório — usado pelo editor pra montar o bloco "Enviar mensagem"
   * no modo template. Degrada com mensagem clara quando não há canal oficial
   * conectado ou a Meta recusa a consulta (em vez de quebrar a UI).
   */
  listarTemplatesWhatsapp: protectedProcedure.query(async ({ ctx }) => {
    const perm = await checkPermission(ctx.user.id, "smartflow", "ver");
    if (!perm.allowed) {
      return { disponivel: false, motivo: "Sem permissão para ver SmartFlow.", templates: [] as any[] };
    }
    const { getCanalCloudApi } = await import("../integracoes/canal-envio");
    const cred = await getCanalCloudApi(perm.escritorioId);
    if (!cred) {
      return {
        disponivel: false,
        motivo: "Nenhum canal WhatsApp oficial (API Meta) conectado. Templates só funcionam com a API oficial — conecte-a em Configurações › Canais.",
        templates: [] as any[],
      };
    }
    if (!cred.wabaId) {
      return {
        disponivel: false,
        motivo: "O canal oficial está sem o WABA ID — não dá pra listar os templates. Reconecte o canal pela API oficial.",
        templates: [] as any[],
      };
    }
    try {
      const { WhatsAppCloudClient } = await import("../integracoes/whatsapp-cloud");
      const client = new WhatsAppCloudClient({ accessToken: cred.accessToken, phoneNumberId: cred.phoneNumberId });
      const todos = await client.listarTemplates(cred.wabaId);
      const aprovados = todos.filter((t) => String(t.status).toUpperCase() === "APPROVED");
      return { disponivel: true, motivo: null as string | null, templates: aprovados };
    } catch (e: any) {
      const apiMsg = e?.response?.data?.error?.message;
      log.warn({ err: apiMsg || e?.message }, "Falha ao listar templates WhatsApp");
      return {
        disponivel: false,
        motivo: apiMsg || e?.message || "Falha ao consultar os templates na Meta.",
        templates: [] as any[],
      };
    }
  }),

  /**
   * Galeria: modelos publicados pelo admin (disponíveis para clonar).
   * Retorna no formato `TemplateSmartflow` (id "db:<n>") pra alimentar a
   * mesma galeria/wizard usada pelos templates internos.
   */
  listarTemplatesDisponiveis: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const rows = await db
      .select()
      .from(smartflowTemplates)
      .where(eq(smartflowTemplates.disponivelParaClientes, true))
      .orderBy(desc(smartflowTemplates.updatedAt));
    return rows.map((r) => {
      let passos: any[] = [];
      let configGatilho: Record<string, unknown> | undefined;
      try { passos = JSON.parse(r.passos); } catch { passos = []; }
      try { configGatilho = r.configGatilho ? JSON.parse(r.configGatilho) : undefined; } catch { configGatilho = undefined; }
      return {
        id: `db:${r.id}`,
        nome: r.nome,
        descricao: r.descricao,
        icone: r.icone,
        gradiente: r.gradiente,
        gatilho: r.gatilho,
        configGatilho,
        passos,
        categoria: r.categoria || undefined,
        badge: r.badge || undefined,
        dica: r.dica || undefined,
      };
    });
  }),

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

      // Layout do editor (posições dos nós) — devolve o objeto parseado pra
      // que o canvas reabra exatamente como foi salvo.
      let layoutParsed: Record<string, { x: number; y: number }> | null = null;
      try {
        const obj = cenario.layout ? JSON.parse(cenario.layout) : null;
        if (obj && typeof obj === "object") layoutParsed = obj as Record<string, { x: number; y: number }>;
      } catch {
        layoutParsed = null;
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

      return { ...cenario, configGatilho: configGatilhoParsed, layout: layoutParsed, passos: passosComEdges };
    }),

  /** Cria cenário com passos */
  criar: requireModulo("smartflow")
    .input(z.object({
      nome: z.string().min(2).max(128),
      descricao: z.string().max(512).optional(),
      gatilho: z.enum(GATILHOS),
      configGatilho: z.record(z.any()).optional(),
      layout: layoutSchema,
      passos: z.array(passoInputSchema),
      limitePorContato: z.enum(["sempre", "dia", "semana", "mes", "vida"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "smartflow", "criar");
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para criar cenários SmartFlow." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      validarPassosSemanticamente(input.passos);

      const [result] = await db.insert(smartflowCenarios).values({
        escritorioId: perm.escritorioId,
        nome: input.nome,
        descricao: input.descricao || null,
        gatilho: input.gatilho,
        configGatilho: input.configGatilho ? JSON.stringify(input.configGatilho) : null,
        layout: input.layout && Object.keys(input.layout).length > 0 ? JSON.stringify(input.layout) : null,
        limitePorContato: input.limitePorContato ?? "sempre",
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
      layout: layoutSchema,
      passos: z.array(passoInputSchema),
      limitePorContato: z.enum(["sempre", "dia", "semana", "mes", "vida"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "smartflow", "editar");
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para editar cenários." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await garantirOwnership(db, input.id, perm.escritorioId, ctx.user.id, perm.verTodos, perm.verProprios);

      validarPassosSemanticamente(input.passos);

      await db
        .update(smartflowCenarios)
        .set({
          nome: input.nome,
          descricao: input.descricao || null,
          gatilho: input.gatilho,
          configGatilho: input.configGatilho ? JSON.stringify(input.configGatilho) : null,
          layout: input.layout && Object.keys(input.layout).length > 0 ? JSON.stringify(input.layout) : null,
          limitePorContato: input.limitePorContato ?? "sempre",
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

  /**
   * Cria um cenário a partir de um template da galeria (shared/smartflow-templates).
   * Materializa gatilho + configGatilho + passos prontos. Aceita customizações
   * do wizard (nome, configGatilho, config por passo) que sobrescrevem o
   * template antes de gravar — assim o cenário já sai pronto pra usar.
   * Retorna o id pra navegar pro editor.
   */
  criarDeTemplate: requireModulo("smartflow")
    .input(z.object({
      templateId: z.string().max(64),
      /** Sobrescreve o nome do template. */
      nome: z.string().min(2).max(128).optional(),
      /** Merge sobre o configGatilho do template (ex: diasAtraso ajustado). */
      configGatilho: z.record(z.any()).optional(),
      /** Map clienteId do passo → patch de config (merge). Ex: editar mensagem. */
      passosConfig: z.record(z.record(z.any())).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "smartflow", "criar");
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para criar cenários SmartFlow." });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      // Resolve o template: modelos do banco (admin) usam id "db:<n>";
      // os internos (hardcoded) usam o id textual de TEMPLATES_SMARTFLOW.
      let tpl: import("../../shared/smartflow-templates").TemplateSmartflow | null = null;
      let origemTemplateId: number | null = null;
      if (input.templateId.startsWith("db:")) {
        const tplId = Number(input.templateId.slice(3));
        const [row] = await db
          .select()
          .from(smartflowTemplates)
          .where(and(eq(smartflowTemplates.id, tplId), eq(smartflowTemplates.disponivelParaClientes, true)))
          .limit(1);
        if (row) {
          let passos: any[] = [];
          let configGatilho: Record<string, unknown> | undefined;
          try { passos = JSON.parse(row.passos); } catch { passos = []; }
          try { configGatilho = row.configGatilho ? JSON.parse(row.configGatilho) : undefined; } catch { configGatilho = undefined; }
          tpl = {
            id: input.templateId,
            nome: row.nome,
            descricao: row.descricao,
            icone: row.icone,
            gradiente: row.gradiente,
            gatilho: row.gatilho as GatilhoSmartflow,
            configGatilho,
            passos,
            badge: (row.badge as "popular" | "novo") || undefined,
            dica: row.dica || undefined,
          };
          origemTemplateId = tplId;
        }
      } else {
        const { getTemplate } = await import("../../shared/smartflow-templates");
        tpl = getTemplate(input.templateId);
      }
      if (!tpl) throw new TRPCError({ code: "NOT_FOUND", message: "Template não encontrado." });

      const nomeFinal = input.nome?.trim() || tpl.nome;
      const configGatilhoFinal = {
        ...(tpl.configGatilho || {}),
        ...(input.configGatilho || {}),
      };
      const temConfigGatilho = Object.keys(configGatilhoFinal).length > 0;

      const [result] = await db.insert(smartflowCenarios).values({
        escritorioId: perm.escritorioId,
        nome: nomeFinal,
        descricao: tpl.descricao,
        gatilho: tpl.gatilho,
        configGatilho: temConfigGatilho ? JSON.stringify(configGatilhoFinal) : null,
        criadoPor: ctx.user.id,
        origemTemplateId,
        // Templates nascem inativos — usuário revisa e ativa quando estiver pronto.
        ativo: false,
      });
      const cenarioId = (result as { insertId: number }).insertId;

      for (let i = 0; i < tpl.passos.length; i++) {
        const p = tpl.passos[i];
        // Aplica patch de config do wizard (merge raso sobre a config do template).
        const patch = input.passosConfig?.[p.clienteId];
        const configFinal = patch ? { ...p.config, ...patch } : p.config;
        await db.insert(smartflowPassos).values({
          cenarioId,
          ordem: i + 1,
          tipo: p.tipo as any,
          config: JSON.stringify(configFinal),
          clienteId: p.clienteId || null,
          proximoSe: p.proximoSe && Object.keys(p.proximoSe).length > 0
            ? JSON.stringify(p.proximoSe)
            : null,
        });
      }

      return { id: cenarioId, nome: nomeFinal };
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

  /**
   * KPIs do hero da listagem — métricas agregadas do escritório.
   * Sempre retorna shape consistente (zeros quando vazio) pra evitar
   * undefined no front durante o loading.
   */
  metricasResumo: protectedProcedure.query(async ({ ctx }) => {
    const vazio = {
      cenariosAtivos: 0,
      execucoes30d: 0,
      taxaSucessoPct: 0,
      tempoMedioSeg: 0,
    };
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return vazio;
    const db = await getDb();
    if (!db) return vazio;

    const { sql, gte } = await import("drizzle-orm");

    const desde = new Date();
    desde.setDate(desde.getDate() - 30);

    const [ativosRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(smartflowCenarios)
      .where(
        and(
          eq(smartflowCenarios.escritorioId, esc.escritorio.id),
          eq(smartflowCenarios.ativo, true),
        ),
      );

    const [statsRow] = await db
      .select({
        total: sql<number>`count(*)`,
        concluidos: sql<number>`sum(case when ${smartflowExecucoes.status} = 'concluido' then 1 else 0 end)`,
        // Tempo médio em segundos para execuções concluídas (createdAt → updatedAt).
        // Filtro pra não puxar 'rodando' (delay artificial) nem 'erro' (anormal).
        tempoMedioSeg: sql<number>`coalesce(
          avg(
            case when ${smartflowExecucoes.status} = 'concluido'
              then timestampdiff(second, ${smartflowExecucoes.createdAt}, ${smartflowExecucoes.updatedAt})
              else null
            end
          ), 0
        )`,
      })
      .from(smartflowExecucoes)
      .where(
        and(
          eq(smartflowExecucoes.escritorioId, esc.escritorio.id),
          gte(smartflowExecucoes.createdAt, desde),
        ),
      );

    const total = Number(statsRow?.total || 0);
    const concluidos = Number(statsRow?.concluidos || 0);
    const taxaSucessoPct = total > 0 ? Math.round((concluidos / total) * 100) : 0;

    return {
      cenariosAtivos: Number(ativosRow?.count || 0),
      execucoes30d: total,
      taxaSucessoPct,
      tempoMedioSeg: Math.round(Number(statsRow?.tempoMedioSeg || 0)),
    };
  }),
});

import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc";
import { financiamentoRouter } from "./calculos/router-financiamento";
import { trabalhistaRouter } from "./calculos/router-trabalhista";
import { imobiliarioRouter } from "./calculos/router-imobiliario";
import { previdenciarioRouter } from "./calculos/router-previdenciario";
import { calculosDiversosRouter } from "./calculos/router-calculos-diversos";
import { processosRouter } from "./processos/router-processos";
import { oabRouter } from "./processos/router-oab";
import { notificacoesRouter } from "./processos/router-notificacoes";
import { configuracoesRouter } from "./escritorio/router-configuracoes";
import { agendamentoRouter } from "./escritorio/router-agendamento";
import { crmRouter } from "./escritorio/router-crm";
import { calcomRouter } from "./integracoes/router-calcom";
import { whatsappRouter } from "./integracoes/router-whatsapp";
import { twilioRouter } from "./integracoes/router-twilio";
import { agentesIaRouter } from "./integracoes/router-agentes-ia";
import { adminIntegracoesRouter } from "./integracoes/router-admin-integracoes";
import { juditOperacoesRouter } from "./integracoes/router-judit-operacoes";
import { juditUsuarioRouter } from "./integracoes/router-judit-usuario";
import { asaasRouter } from "./integracoes/router-asaas";
import { clientesRouter } from "./escritorio/router-clientes";
import { relatoriosRouter } from "./escritorio/router-relatorios";
import { permissoesRouter } from "./escritorio/router-permissoes";
import { assinaturasRouter } from "./escritorio/router-assinaturas";
import { uploadRouter } from "./upload/upload-route";
import { tarefasRouter } from "./escritorio/router-tarefas";
import { agendaRouter } from "./escritorio/router-agenda";
import { templatesRouter } from "./escritorio/router-templates";
import {
  getActiveSubscription,
  getUserSubscriptions,
  getAllUsers,
  getAllUsersWithSubscription,
  getRecentUsers,
  getRecentSubscriptions,
  getAllSubscriptionsWithUsers,
  getAdminStats,
  getDb,
  getCalculosRecentes,
  getEstatisticasUso,
  getUserCreditsInfo,
  addCreditsToUser,
} from "./db";
import { getStripe } from "./stripe/index";
import { PLANS } from "./stripe/products";
import { z } from "zod";
import { users, subscriptions as subscriptionsTable, calculosHistorico, userCredits, escritorios, colaboradores, canaisIntegrados, conversas, leads, contatos, agentesIa, agendamentos, tarefas, asaasCobrancas, processosMonitorados, movimentacoesProcesso, notificacoes, juditCreditos, juditTransacoes, adminIntegracoes } from "../drizzle/schema";
import { eq, desc, sql, gte, and, lte, lt, or, asc } from "drizzle-orm";
import { getEscritorioPorUsuario } from "./escritorio/db-escritorio";

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  subscription: router({
    /** Get current user's active subscription */
    current: protectedProcedure.query(async ({ ctx }) => {
      const sub = await getActiveSubscription(ctx.user.id);
      return sub;
    }),

    /** Get all subscriptions for current user */
    list: protectedProcedure.query(async ({ ctx }) => {
      return getUserSubscriptions(ctx.user.id);
    }),

    /** Get available plans */
    plans: publicProcedure.query(() => {
      return PLANS.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        features: p.features,
        priceMonthly: p.priceMonthly,
        priceYearly: p.priceYearly,
        currency: p.currency,
        popular: p.popular ?? false,
        isOneTime: p.isOneTime ?? false,
        creditsPerMonth: p.creditsPerMonth,
      }));
    }),

    /** Create Stripe Checkout Session */
    createCheckout: protectedProcedure
      .input(
        z.object({
          planId: z.string(),
          interval: z.enum(["monthly", "yearly"]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const stripe = getStripe();
        const plan = PLANS.find((p) => p.id === input.planId);
        if (!plan) {
          throw new Error("Plano não encontrado");
        }

        const origin = ctx.req.headers.origin || ctx.req.headers.referer || "";

        // Avulso = one-time payment
        if (plan.isOneTime) {
          const session = await stripe.checkout.sessions.create({
            mode: "payment",
            payment_method_types: ["card"],
            customer_email: ctx.user.email ?? undefined,
            client_reference_id: ctx.user.id.toString(),
            metadata: {
              user_id: ctx.user.id.toString(),
              plan_id: input.planId,
              credits_to_add: "1",
            },
            line_items: [
              {
                price_data: {
                  currency: plan.currency,
                  product_data: {
                    name: `${plan.name} - Cálculo Avulso`,
                    description: plan.description,
                  },
                  unit_amount: plan.priceMonthly,
                },
                quantity: 1,
              },
            ],
            success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${origin}/plans`,
          });
          return { url: session.url };
        }

        // Subscription plans
        const price = input.interval === "monthly" ? plan.priceMonthly : plan.priceYearly;

        const session = await stripe.checkout.sessions.create({
          mode: "subscription",
          payment_method_types: ["card"],
          customer_email: ctx.user.email ?? undefined,
          client_reference_id: ctx.user.id.toString(),
          metadata: {
            user_id: ctx.user.id.toString(),
            customer_email: ctx.user.email ?? "",
            customer_name: ctx.user.name ?? "",
            plan_id: input.planId,
          },
          line_items: [
            {
              price_data: {
                currency: plan.currency,
                product_data: {
                  name: `${plan.name} - SaaS de Cálculos`,
                  description: plan.description,
                },
                unit_amount: price,
                recurring: {
                  interval: input.interval === "monthly" ? "month" : "year",
                },
              },
              quantity: 1,
            },
          ],
          allow_promotion_codes: true,
          success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${origin}/plans`,
        });

        return { url: session.url };
      }),

    /** Cancel subscription at period end */
    cancel: protectedProcedure.mutation(async ({ ctx }) => {
      const sub = await getActiveSubscription(ctx.user.id);
      if (!sub) throw new Error("Nenhuma assinatura ativa encontrada.");

      const stripe = getStripe();
      await stripe.subscriptions.update(sub.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });

      const db = await getDb();
      if (db) {
        await db
          .update(subscriptionsTable)
          .set({ cancelAtPeriodEnd: true })
          .where(eq(subscriptionsTable.id, sub.id));
      }

      return { success: true };
    }),

    /** Reactivate canceled subscription */
    reactivate: protectedProcedure.mutation(async ({ ctx }) => {
      const sub = await getActiveSubscription(ctx.user.id);
      if (!sub) throw new Error("Nenhuma assinatura encontrada.");

      const stripe = getStripe();
      await stripe.subscriptions.update(sub.stripeSubscriptionId, {
        cancel_at_period_end: false,
      });

      const db = await getDb();
      if (db) {
        await db
          .update(subscriptionsTable)
          .set({ cancelAtPeriodEnd: false })
          .where(eq(subscriptionsTable.id, sub.id));
      }

      return { success: true };
    }),

    /** Change plan (upgrade/downgrade) */
    changePlan: protectedProcedure
      .input(
        z.object({
          newPlanId: z.string(),
          interval: z.enum(["monthly", "yearly"]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const stripe = getStripe();
        const newPlan = PLANS.find((p) => p.id === input.newPlanId);
        if (!newPlan) throw new Error("Plano não encontrado");
        if (newPlan.isOneTime) throw new Error("Use a opção de compra avulsa.");

        const currentSub = await getActiveSubscription(ctx.user.id);
        const origin = ctx.req.headers.origin || ctx.req.headers.referer || "";
        const price = input.interval === "monthly" ? newPlan.priceMonthly : newPlan.priceYearly;

        const metadata: Record<string, string> = {
          user_id: ctx.user.id.toString(),
          plan_id: input.newPlanId,
        };
        if (currentSub) {
          metadata.cancel_old_subscription = currentSub.stripeSubscriptionId;
        }

        const session = await stripe.checkout.sessions.create({
          mode: "subscription",
          payment_method_types: ["card"],
          customer_email: ctx.user.email ?? undefined,
          client_reference_id: ctx.user.id.toString(),
          metadata,
          line_items: [
            {
              price_data: {
                currency: newPlan.currency,
                product_data: {
                  name: `${newPlan.name} - SaaS de Cálculos`,
                  description: newPlan.description,
                },
                unit_amount: price,
                recurring: {
                  interval: input.interval === "monthly" ? "month" : "year",
                },
              },
              quantity: 1,
            },
          ],
          success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${origin}/plans`,
        });

        return { url: session.url };
      }),
  }),

  // Motor de Cálculos
  financiamento: financiamentoRouter,
  trabalhista: trabalhistaRouter,
  imobiliario: imobiliarioRouter,
  previdenciario: previdenciarioRouter,
  calculosDiversos: calculosDiversosRouter,

  // Processos e OAB
  processos: processosRouter,
  oab: oabRouter,
  notificacoes: notificacoesRouter,

  // Escritório e Configurações
  configuracoes: configuracoesRouter,
  agendamento: agendamentoRouter,
  crm: crmRouter,
  calcom: calcomRouter,
  whatsapp: whatsappRouter,
  twilio: twilioRouter,
  agentesIa: agentesIaRouter,
  clientes: clientesRouter,
  relatorios: relatoriosRouter,
  permissoes: permissoesRouter,
  assinaturas: assinaturasRouter,
  upload: uploadRouter,
  tarefas: tarefasRouter,
  agenda: agendaRouter,
  templates: templatesRouter,
  // ─── WhatsApp CoEx (Embedded Signup) ──────────────────────────────────────
  whatsappCoex: router({
    /** Retorna App ID e Config ID (não-sensíveis) para o frontend carregar o Facebook SDK */
    getConfig: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return null;
      try {
        const [row] = await db.select().from(adminIntegracoes).where(eq(adminIntegracoes.provedor, "whatsapp_cloud")).limit(1);
        if (!row?.apiKeyEncrypted || !row?.apiKeyIv || !row?.apiKeyTag) return null;
        const { decrypt } = await import("./escritorio/crypto-utils");
        const raw = decrypt(row.apiKeyEncrypted, row.apiKeyIv, row.apiKeyTag);
        const config = JSON.parse(raw);
        return { appId: config.appId || "", configId: config.configId || "" };
      } catch { return null; }
    }),

    /** Recebe o code do Facebook Embedded Signup, troca por access token, salva canal */
    exchangeCode: protectedProcedure.input(z.object({
      code: z.string().min(10),
      wabaId: z.string().optional(),
      phoneNumberId: z.string().optional(),
    })).mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritorio nao encontrado.");

      const db = await getDb();
      if (!db) throw new Error("DB indisponivel");

      // 1. Buscar App ID e App Secret do admin
      const [adminRow] = await db.select().from(adminIntegracoes).where(eq(adminIntegracoes.provedor, "whatsapp_cloud")).limit(1);
      if (!adminRow?.apiKeyEncrypted || !adminRow?.apiKeyIv || !adminRow?.apiKeyTag) throw new Error("WhatsApp Cloud API nao configurada pelo administrador.");
      const { decrypt, encryptConfig } = await import("./escritorio/crypto-utils");
      const adminConfig = JSON.parse(decrypt(adminRow.apiKeyEncrypted, adminRow.apiKeyIv, adminRow.apiKeyTag));
      const appId = adminConfig.appId;
      const appSecret = adminConfig.appSecret;
      if (!appId || !appSecret) throw new Error("App ID ou App Secret nao configurados.");

      // 2. Trocar code por access token
      const axios = (await import("axios")).default;
      const tokenRes = await axios.get("https://graph.facebook.com/v21.0/oauth/access_token", {
        params: { client_id: appId, client_secret: appSecret, code: input.code },
        timeout: 15000,
      });
      const accessToken = tokenRes.data?.access_token;
      if (!accessToken) throw new Error("Falha ao obter access token do Facebook.");

      // 3. Buscar info do telefone se phoneNumberId fornecido
      let telefone = "";
      let nomeVerificado = "";
      const phoneNumberId = input.phoneNumberId || "";
      if (phoneNumberId) {
        try {
          const phoneRes = await axios.get(`https://graph.facebook.com/v21.0/${phoneNumberId}`, {
            params: { fields: "display_phone_number,verified_name" },
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout: 10000,
          });
          telefone = phoneRes.data?.display_phone_number || "";
          nomeVerificado = phoneRes.data?.verified_name || "";
        } catch {}
      }

      // 4. Salvar canal
      const config = { accessToken, phoneNumberId, wabaId: input.wabaId || "", coexMode: "true" };
      const { encrypted, iv, tag } = encryptConfig(config);

      // Verificar se já existe canal CoEx para este escritório
      const [existente] = await db.select().from(canaisIntegrados)
        .where(and(eq(canaisIntegrados.escritorioId, esc.escritorio.id), eq(canaisIntegrados.tipo, "whatsapp_api")))
        .limit(1);

      if (existente) {
        await db.update(canaisIntegrados).set({
          configEncrypted: encrypted, configIv: iv, configTag: tag,
          status: "conectado", telefone: telefone || existente.telefone,
          nome: nomeVerificado ? `WhatsApp CoEx (${nomeVerificado})` : existente.nome,
        }).where(eq(canaisIntegrados.id, existente.id));
      } else {
        await db.insert(canaisIntegrados).values({
          escritorioId: esc.escritorio.id,
          tipo: "whatsapp_api",
          nome: nomeVerificado ? `WhatsApp CoEx (${nomeVerificado})` : "WhatsApp CoEx",
          status: "conectado",
          configEncrypted: encrypted, configIv: iv, configTag: tag,
          telefone,
        });
      }

      return { success: true, telefone, nome: nomeVerificado };
    }),
  }),

  juditProcessos: router({
    saldo: protectedProcedure.query(async ({ ctx }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return { saldo: 0, totalComprado: 0, totalConsumido: 0, pacotes: [{ id: "pack_50", nome: "50 creditos", creditos: 50, preco: 49.90, popular: false },{ id: "pack_200", nome: "200 creditos", creditos: 200, preco: 149.90, popular: true },{ id: "pack_500", nome: "500 creditos", creditos: 500, preco: 299.90, popular: false },{ id: "pack_1000", nome: "1000 creditos", creditos: 1000, preco: 499.90, popular: false }], custos: { consulta_cnj: 1, consulta_historica: 5, consulta_sintetica: 2, monitorar_processo: 5, monitorar_pessoa: 50, resumo_ia: 1, anexos: 10 } };
      const db = await getDb();
      if (!db) return { saldo: 0, totalComprado: 0, totalConsumido: 0, pacotes: [], custos: {} };
      try {
        const [row] = await db.select().from(juditCreditos).where(eq(juditCreditos.escritorioId, esc.escritorio.id)).limit(1);
        return { saldo: row?.saldo ?? 0, totalComprado: row?.totalComprado ?? 0, totalConsumido: row?.totalConsumido ?? 0, pacotes: [{ id: "pack_50", nome: "50 creditos", creditos: 50, preco: 49.90, popular: false },{ id: "pack_200", nome: "200 creditos", creditos: 200, preco: 149.90, popular: true },{ id: "pack_500", nome: "500 creditos", creditos: 500, preco: 299.90, popular: false },{ id: "pack_1000", nome: "1000 creditos", creditos: 1000, preco: 499.90, popular: false }], custos: { consulta_cnj: 1, consulta_historica: 5, consulta_sintetica: 2, monitorar_processo: 5, monitorar_pessoa: 50, resumo_ia: 1, anexos: 10 } };
      } catch { return { saldo: 0, totalComprado: 0, totalConsumido: 0, pacotes: [], custos: {} }; }
    }),

    transacoes: protectedProcedure.input(z.object({ limit: z.number().min(1).max(100).optional() }).optional()).query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return [];
      const db = await getDb();
      if (!db) return [];
      try { return await db.select().from(juditTransacoes).where(eq(juditTransacoes.escritorioId, esc.escritorio.id)).orderBy(desc(juditTransacoes.createdAt)).limit(input?.limit ?? 50); } catch { return []; }
    }),

    adicionarCreditos: protectedProcedure.input(z.object({ pacoteId: z.string().optional(), quantidade: z.number().optional() })).mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritorio nao encontrado.");
      const db = await getDb();
      if (!db) throw new Error("DB indisponivel");
      const pacotes: Record<string, number> = { pack_50: 50, pack_200: 200, pack_500: 500, pack_1000: 1000 };
      const qty = input.pacoteId ? (pacotes[input.pacoteId] || 0) : (input.quantidade || 0);
      if (qty <= 0) throw new Error("Quantidade invalida");
      const [row] = await db.select().from(juditCreditos).where(eq(juditCreditos.escritorioId, esc.escritorio.id)).limit(1);
      const saldoAtual = row?.saldo ?? 0;
      const novoSaldo = saldoAtual + qty;
      if (row) { await db.update(juditCreditos).set({ saldo: novoSaldo, totalComprado: (row.totalComprado || 0) + qty }).where(eq(juditCreditos.escritorioId, esc.escritorio.id)); }
      else { await db.insert(juditCreditos).values({ escritorioId: esc.escritorio.id, saldo: qty, totalComprado: qty, totalConsumido: 0 }); }
      await db.insert(juditTransacoes).values({ escritorioId: esc.escritorio.id, tipo: "compra", quantidade: qty, saldoAnterior: saldoAtual, saldoDepois: novoSaldo, operacao: input.pacoteId || "manual", detalhes: `+${qty} creditos`, userId: ctx.user.id });
      return { novoSaldo, adicionados: qty };
    }),

    consultarCNJ: protectedProcedure.input(z.object({ cnj: z.string().min(15).max(30) })).mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritorio nao encontrado.");
      const { getJuditClient } = await import("./integracoes/judit-webhook");
      const client = await getJuditClient();
      if (!client) throw new Error("Judit nao configurada. Peca ao administrador.");
      const db = await getDb();
      if (!db) throw new Error("DB indisponivel");
      const [cr] = await db.select().from(juditCreditos).where(eq(juditCreditos.escritorioId, esc.escritorio.id)).limit(1);
      const saldo = cr?.saldo ?? 0;
      if (saldo < 1) throw new Error(`Creditos insuficientes. Necessario: 1, disponivel: ${saldo}.`);
      await db.update(juditCreditos).set({ saldo: saldo - 1, totalConsumido: (cr?.totalConsumido || 0) + 1 }).where(eq(juditCreditos.escritorioId, esc.escritorio.id));
      await db.insert(juditTransacoes).values({ escritorioId: esc.escritorio.id, tipo: "consumo", quantidade: 1, saldoAnterior: saldo, saldoDepois: saldo - 1, operacao: "consulta_cnj", detalhes: `CNJ: ${input.cnj}`, userId: ctx.user.id });
      const request = await client.criarRequest({ search: { search_type: "lawsuit_cnj", search_key: input.cnj.replace(/[^\d.-]/g, "") } });
      return { requestId: request.request_id, status: request.status };
    }),

    consultarDocumento: protectedProcedure.input(z.object({ tipo: z.enum(["cpf", "cnpj", "oab", "name"]), valor: z.string().min(3).max(100) })).mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritorio nao encontrado.");
      const { getJuditClient } = await import("./integracoes/judit-webhook");
      const client = await getJuditClient();
      if (!client) throw new Error("Judit nao configurada.");
      const db = await getDb();
      if (!db) throw new Error("DB indisponivel");
      const [cr] = await db.select().from(juditCreditos).where(eq(juditCreditos.escritorioId, esc.escritorio.id)).limit(1);
      const saldo = cr?.saldo ?? 0;
      if (saldo < 5) throw new Error(`Creditos insuficientes. Necessario: 5, disponivel: ${saldo}.`);
      await db.update(juditCreditos).set({ saldo: saldo - 5, totalConsumido: (cr?.totalConsumido || 0) + 5 }).where(eq(juditCreditos.escritorioId, esc.escritorio.id));
      await db.insert(juditTransacoes).values({ escritorioId: esc.escritorio.id, tipo: "consumo", quantidade: 5, saldoAnterior: saldo, saldoDepois: saldo - 5, operacao: "consulta_historica", detalhes: `${input.tipo.toUpperCase()}: ${input.valor}`, userId: ctx.user.id });
      const searchKey = input.tipo === "cpf" || input.tipo === "cnpj" ? input.valor.replace(/\D/g, "") : input.valor;
      const request = await client.criarRequest({ search: { search_type: input.tipo, search_key: searchKey } });
      return { requestId: request.request_id, status: request.status };
    }),

    statusConsulta: protectedProcedure.input(z.object({ requestId: z.string() })).query(async ({ ctx, input }) => {
      const { getJuditClient } = await import("./integracoes/judit-webhook");
      const client = await getJuditClient();
      if (!client) throw new Error("Judit nao configurada.");
      const status = await client.consultarRequest(input.requestId);
      return { status: status.status, requestId: status.request_id, updatedAt: status.updated_at };
    }),

    resultados: protectedProcedure.input(z.object({ requestId: z.string(), page: z.number().optional() })).query(async ({ ctx, input }) => {
      const { getJuditClient } = await import("./integracoes/judit-webhook");
      const client = await getJuditClient();
      if (!client) throw new Error("Judit nao configurada.");
      return await client.buscarRespostas(input.requestId, input.page ?? 1, 20);
    }),

    monitorarProcesso: protectedProcedure.input(z.object({ cnj: z.string().min(15).max(30) })).mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritorio nao encontrado.");
      const { getJuditClient } = await import("./integracoes/judit-webhook");
      const client = await getJuditClient();
      if (!client) throw new Error("Judit nao configurada.");
      const db = await getDb();
      if (!db) throw new Error("DB indisponivel");
      const [cr] = await db.select().from(juditCreditos).where(eq(juditCreditos.escritorioId, esc.escritorio.id)).limit(1);
      const saldo = cr?.saldo ?? 0;
      if (saldo < 5) throw new Error(`Creditos insuficientes. Necessario: 5, disponivel: ${saldo}.`);
      await db.update(juditCreditos).set({ saldo: saldo - 5, totalConsumido: (cr?.totalConsumido || 0) + 5 }).where(eq(juditCreditos.escritorioId, esc.escritorio.id));
      await db.insert(juditTransacoes).values({ escritorioId: esc.escritorio.id, tipo: "consumo", quantidade: 5, saldoAnterior: saldo, saldoDepois: saldo - 5, operacao: "monitorar_processo", detalhes: `Monitorar CNJ: ${input.cnj}`, userId: ctx.user.id });
      const tracking = await client.criarMonitoramento({ recurrence: 1, search: { search_type: "lawsuit_cnj", search_key: input.cnj.replace(/[^\d.-]/g, "") } });
      return { trackingId: tracking.tracking_id, status: tracking.status };
    }),

    monitorarPessoa: protectedProcedure.input(z.object({ tipo: z.enum(["cpf", "cnpj", "oab", "name"]), valor: z.string().min(3).max(100) })).mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritorio nao encontrado.");
      const { getJuditClient } = await import("./integracoes/judit-webhook");
      const client = await getJuditClient();
      if (!client) throw new Error("Judit nao configurada.");
      const db = await getDb();
      if (!db) throw new Error("DB indisponivel");
      const [cr] = await db.select().from(juditCreditos).where(eq(juditCreditos.escritorioId, esc.escritorio.id)).limit(1);
      const saldo = cr?.saldo ?? 0;
      if (saldo < 50) throw new Error(`Creditos insuficientes. Necessario: 50, disponivel: ${saldo}.`);
      await db.update(juditCreditos).set({ saldo: saldo - 50, totalConsumido: (cr?.totalConsumido || 0) + 50 }).where(eq(juditCreditos.escritorioId, esc.escritorio.id));
      await db.insert(juditTransacoes).values({ escritorioId: esc.escritorio.id, tipo: "consumo", quantidade: 50, saldoAnterior: saldo, saldoDepois: saldo - 50, operacao: "monitorar_pessoa", detalhes: `Monitorar ${input.tipo.toUpperCase()}: ${input.valor}`, userId: ctx.user.id });
      const searchKey = input.tipo === "cpf" || input.tipo === "cnpj" ? input.valor.replace(/\D/g, "") : input.valor;
      const tracking = await client.criarMonitoramento({ recurrence: 1, search: { search_type: input.tipo, search_key: searchKey } });
      return { trackingId: tracking.tracking_id, status: tracking.status };
    }),

    listarMonitoramentos: protectedProcedure.input(z.object({ page: z.number().optional(), tipo: z.string().optional() }).optional()).query(async ({ ctx, input }) => {
      try {
        const { getJuditClient } = await import("./integracoes/judit-webhook");
        const client = await getJuditClient();
        if (!client) return { monitoramentos: [], total: 0 };
        const res = await client.listarMonitoramentos(input?.page ?? 1, 20, undefined, input?.tipo);
        return { monitoramentos: res.page_data, total: res.all_count, pages: res.all_pages_count };
      } catch { return { monitoramentos: [], total: 0 }; }
    }),

    pausarMonitoramento: protectedProcedure.input(z.object({ trackingId: z.string() })).mutation(async ({ ctx, input }) => {
      const { getJuditClient } = await import("./integracoes/judit-webhook");
      const client = await getJuditClient();
      if (!client) throw new Error("Judit nao configurada.");
      await client.pausarMonitoramento(input.trackingId);
      return { success: true };
    }),

    reativarMonitoramento: protectedProcedure.input(z.object({ trackingId: z.string() })).mutation(async ({ ctx, input }) => {
      const { getJuditClient } = await import("./integracoes/judit-webhook");
      const client = await getJuditClient();
      if (!client) throw new Error("Judit nao configurada.");
      await client.reativarMonitoramento(input.trackingId);
      return { success: true };
    }),

    deletarMonitoramento: protectedProcedure.input(z.object({ trackingId: z.string() })).mutation(async ({ ctx, input }) => {
      const { getJuditClient } = await import("./integracoes/judit-webhook");
      const client = await getJuditClient();
      if (!client) throw new Error("Judit nao configurada.");
      await client.deletarMonitoramento(input.trackingId);
      return { success: true };
    }),

    historicoMonitoramento: protectedProcedure.input(z.object({ trackingId: z.string(), page: z.number().optional() })).query(async ({ ctx, input }) => {
      try {
        const { getJuditClient } = await import("./integracoes/judit-webhook");
        const client = await getJuditClient();
        if (!client) return null;
        return await client.buscarRespostasTracking(input.trackingId, input.page ?? 1, 20);
      } catch { return null; }
    }),
  }),
  adminIntegracoes: adminIntegracoesRouter,
  juditOperacoes: juditOperacoesRouter,
  juditUsuario: juditUsuarioRouter,
  asaas: asaasRouter,

  // Dashboard do utilizador
  dashboard: router({
    /** Estatísticas de uso do utilizador */
    stats: protectedProcedure.query(async ({ ctx }) => {
      return getEstatisticasUso(ctx.user.id);
    }),

    /** Histórico de cálculos recentes */
    historico: protectedProcedure.query(async ({ ctx }) => {
      return getCalculosRecentes(ctx.user.id, 5);
    }),

    /** Informações de créditos */
    credits: protectedProcedure.query(async ({ ctx }) => {
      return getUserCreditsInfo(ctx.user.id);
    }),

    /** Resumo do escritório para dashboard inteligente */
    resumoEscritorio: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return null;

      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return null;

      const escritorioId = esc.escritorio.id;
      const now = new Date();
      const hojeInicio = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const hojeFim = new Date(hojeInicio.getTime() + 86400000);

      try {
        // ─── Agenda ─────────────────────────────────────────────
        const compromissosHoje = await db.select({ id: agendamentos.id, titulo: agendamentos.titulo, dataInicio: agendamentos.dataInicio, tipo: agendamentos.tipo, corHex: agendamentos.corHex })
          .from(agendamentos)
          .where(and(eq(agendamentos.escritorioId, escritorioId), gte(agendamentos.dataInicio, hojeInicio), lte(agendamentos.dataInicio, hojeFim), or(eq(agendamentos.status, "pendente"), eq(agendamentos.status, "em_andamento"))))
          .orderBy(asc(agendamentos.dataInicio)).limit(5);

        const tarefasHoje = await db.select({ id: tarefas.id, titulo: tarefas.titulo, dataVencimento: tarefas.dataVencimento, prioridade: tarefas.prioridade })
          .from(tarefas)
          .where(and(eq(tarefas.escritorioId, escritorioId), gte(tarefas.dataVencimento, hojeInicio), lte(tarefas.dataVencimento, hojeFim), or(eq(tarefas.status, "pendente"), eq(tarefas.status, "em_andamento"))))
          .limit(5);

        const tarefasAtrasadas = await db.select({ id: tarefas.id })
          .from(tarefas)
          .where(and(eq(tarefas.escritorioId, escritorioId), lt(tarefas.dataVencimento, hojeInicio), or(eq(tarefas.status, "pendente"), eq(tarefas.status, "em_andamento"))));

        const compromissosAtrasados = await db.select({ id: agendamentos.id })
          .from(agendamentos)
          .where(and(eq(agendamentos.escritorioId, escritorioId), lt(agendamentos.dataInicio, hojeInicio), or(eq(agendamentos.status, "pendente"), eq(agendamentos.status, "em_andamento"))));

        // ─── CRM / Conversas ────────────────────────────────────
        const conversasAguardando = await db.select({ id: conversas.id })
          .from(conversas)
          .where(and(eq(conversas.escritorioId, escritorioId), eq(conversas.status, "aguardando")));

        const conversasAbertas = await db.select({ id: conversas.id })
          .from(conversas)
          .where(and(eq(conversas.escritorioId, escritorioId), eq(conversas.status, "em_atendimento")));

        const totalContatos = await db.select({ id: contatos.id })
          .from(contatos)
          .where(eq(contatos.escritorioId, escritorioId));

        // ─── Pipeline / Leads ───────────────────────────────────
        const leadsAbertos = await db.select({ id: leads.id, valorEstimado: leads.valorEstimado })
          .from(leads)
          .where(and(eq(leads.escritorioId, escritorioId), or(eq(leads.etapaFunil, "novo"), eq(leads.etapaFunil, "qualificado"), eq(leads.etapaFunil, "proposta"), eq(leads.etapaFunil, "negociacao"))));

        let valorPipeline = 0;
        for (const l of leadsAbertos) { valorPipeline += parseFloat(l.valorEstimado as any || "0") || 0; }

        // ─── Financeiro ─────────────────────────────────────────
        let finRecebido = 0, finPendente = 0, finVencido = 0, finTotal = 0;
        try {
          const cobrancasLocal = await db.select().from(asaasCobrancas)
            .where(eq(asaasCobrancas.escritorioId, escritorioId));
          finTotal = cobrancasLocal.length;
          for (const c of cobrancasLocal) {
            const val = parseFloat(c.valor) || 0;
            if (["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(c.status)) finRecebido += val;
            else if (c.status === "PENDING") finPendente += val;
            else if (c.status === "OVERDUE") finVencido += val;
          }
        } catch {}

        // ─── Processos ──────────────────────────────────────────
        const processosAtivos = await db.select({ id: processosMonitorados.id })
          .from(processosMonitorados)
          .where(and(eq(processosMonitorados.userId, ctx.user.id), eq(processosMonitorados.status, "ativo")));

        const totalProcessos = processosAtivos.length;
        const processosIds = processosAtivos.map(p => p.id);

        // Movimentações não lidas
        let movimentacoesNaoLidas = 0;
        const movimentacoesRecentes: Array<{ id: number; nome: string; numeroCnj: string; dataHora: string }> = [];

        if (processosIds.length > 0) {
          for (const pid of processosIds.slice(0, 50)) {
            const naoLidas = await db.select({ id: movimentacoesProcesso.id })
              .from(movimentacoesProcesso)
              .where(and(eq(movimentacoesProcesso.processoId, pid), eq(movimentacoesProcesso.lida, false)));
            movimentacoesNaoLidas += naoLidas.length;
          }

          // Últimas 5 movimentações
          for (const pid of processosIds.slice(0, 20)) {
            const movs = await db.select({ id: movimentacoesProcesso.id, nome: movimentacoesProcesso.nome, dataHora: movimentacoesProcesso.dataHora, processoId: movimentacoesProcesso.processoId })
              .from(movimentacoesProcesso)
              .where(eq(movimentacoesProcesso.processoId, pid))
              .orderBy(desc(movimentacoesProcesso.dataHora))
              .limit(2);
            for (const m of movs) {
              const [proc] = await db.select({ numeroCnj: processosMonitorados.numeroCnj }).from(processosMonitorados).where(eq(processosMonitorados.id, m.processoId)).limit(1);
              movimentacoesRecentes.push({ id: m.id, nome: m.nome, numeroCnj: proc?.numeroCnj || "", dataHora: m.dataHora });
            }
          }
          movimentacoesRecentes.sort((a, b) => (b.dataHora || "").localeCompare(a.dataHora || ""));
        }

        // Notificações não lidas
        const notifsNaoLidas = await db.select({ id: notificacoes.id })
          .from(notificacoes)
          .where(and(eq(notificacoes.userId, ctx.user.id), eq(notificacoes.lida, false)));

        return {
          agenda: {
            compromissosHoje: compromissosHoje.map(c => ({ id: c.id, titulo: c.titulo, hora: (c.dataInicio as Date).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }), tipo: c.tipo, cor: c.corHex })),
            tarefasHoje: tarefasHoje.map(t => ({ id: t.id, titulo: t.titulo, prioridade: t.prioridade })),
            atrasados: tarefasAtrasadas.length + compromissosAtrasados.length,
          },
          crm: {
            conversasAguardando: conversasAguardando.length,
            conversasAbertas: conversasAbertas.length,
            totalContatos: totalContatos.length,
          },
          pipeline: {
            leadsAbertos: leadsAbertos.length,
            valorPipeline,
          },
          financeiro: {
            recebido: finRecebido,
            pendente: finPendente,
            vencido: finVencido,
            totalCobrancas: finTotal,
          },
          processos: {
            ativos: totalProcessos,
            movimentacoesNaoLidas,
            movimentacoesRecentes: movimentacoesRecentes.slice(0, 5),
          },
          notificacoesNaoLidas: notifsNaoLidas.length,
        };
      } catch (err: any) {
        console.error("[Dashboard] Erro ao montar resumo:", err.message);
        return null;
      }
    }),
  }),

  admin: router({
    /** Get comprehensive admin dashboard stats */
    stats: adminProcedure.query(async () => {
      return getAdminStats();
    }),

    /** Get all users (legacy) */
    users: adminProcedure.query(async () => {
      return getAllUsers();
    }),

    /** Get all users with subscription status */
    allUsers: adminProcedure.query(async () => {
      return getAllUsersWithSubscription();
    }),

    /** Get recent users (last 10) */
    recentUsers: adminProcedure.query(async () => {
      return getRecentUsers(10);
    }),

    /** Get recent subscriptions with user info */
    recentSubscriptions: adminProcedure.query(async () => {
      return getRecentSubscriptions(10);
    }),

    /** Get all subscriptions with user info */
    allSubscriptions: adminProcedure.query(async () => {
      return getAllSubscriptionsWithUsers();
    }),

    /** Update user role */
    updateUserRole: adminProcedure
      .input(
        z.object({
          userId: z.number(),
          role: z.enum(["user", "admin"]),
        })
      )
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        await db
          .update(users)
          .set({ role: input.role })
          .where(eq(users.id, input.userId));

        return { success: true };
      }),

    // ═══════════════════════════════════════════════════════════════════════
    // RELATÓRIOS
    // ═══════════════════════════════════════════════════════════════════════

    /** Crescimento de usuários por mês (últimos 12 meses) */
    crescimentoUsuarios: adminProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];

      const allUsers = await db.select({ createdAt: users.createdAt }).from(users).where(eq(users.role, "user"));
      const meses: Record<string, number> = {};

      // Últimos 12 meses
      for (let i = 11; i >= 0; i--) {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        meses[key] = 0;
      }

      for (const u of allUsers) {
        const d = new Date(u.createdAt);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        if (key in meses) meses[key]++;
      }

      return Object.entries(meses).map(([mes, total]) => ({ mes, total }));
    }),

    /** Receita mensal (MRR) por mês - baseado nas assinaturas ativas */
    receitaMensal: adminProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];

      const allSubs = await db.select().from(subscriptionsTable);
      const meses: Record<string, number> = {};

      for (let i = 11; i >= 0; i--) {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        meses[key] = 0;
      }

      for (const sub of allSubs) {
        if (sub.status !== "active" && sub.status !== "trialing") continue;
        const d = new Date(sub.createdAt);
        const plan = PLANS.find((p) => p.id === sub.planId);
        const valor = plan ? plan.priceMonthly : 0;

        // Considerar a sub ativa em todos os meses desde criação
        for (const mesKey of Object.keys(meses)) {
          const [y, m] = mesKey.split("-").map(Number);
          const mesDate = new Date(y, m - 1, 1);
          if (d <= mesDate) {
            meses[mesKey] += valor;
          }
        }
      }

      return Object.entries(meses).map(([mes, valor]) => ({ mes, valor: valor / 100 }));
    }),

    /** Cálculos por módulo (total geral) */
    calculosPorModulo: adminProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];

      const todos = await db.select({ tipo: calculosHistorico.tipo }).from(calculosHistorico);
      const contagem: Record<string, number> = {};

      for (const c of todos) {
        contagem[c.tipo] = (contagem[c.tipo] || 0) + 1;
      }

      const nomes: Record<string, string> = {
        bancario: "Bancário",
        trabalhista: "Trabalhista",
        imobiliario: "Imobiliário",
        tributario: "Tributário",
        previdenciario: "Previdenciário",
        atualizacao_monetaria: "Cálculos Diversos",
      };

      return Object.entries(contagem)
        .map(([tipo, total]) => ({ tipo, nome: nomes[tipo] || tipo, total }))
        .sort((a, b) => b.total - a.total);
    }),

    /** Cálculos por mês (últimos 12 meses) */
    calculosPorMes: adminProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];

      const todos = await db.select({ createdAt: calculosHistorico.createdAt }).from(calculosHistorico);
      const meses: Record<string, number> = {};

      for (let i = 11; i >= 0; i--) {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        meses[key] = 0;
      }

      for (const c of todos) {
        const d = new Date(c.createdAt);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        if (key in meses) meses[key]++;
      }

      return Object.entries(meses).map(([mes, total]) => ({ mes, total }));
    }),

    // ═══════════════════════════════════════════════════════════════════════
    // GESTÃO AVANÇADA DE CLIENTES
    // ═══════════════════════════════════════════════════════════════════════

    /** Detalhes completos de um cliente (créditos, cálculos, assinatura) */
    clienteDetalhes: adminProcedure
      .input(z.object({ userId: z.number() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("Database not available");

        const user = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
        if (user.length === 0) throw new Error("Utilizador não encontrado");

        const credits = await getUserCreditsInfo(input.userId);
        const subscription = await getActiveSubscription(input.userId);
        const calculos = await getCalculosRecentes(input.userId, 10);
        const stats = await getEstatisticasUso(input.userId);

        return {
          user: user[0],
          credits,
          subscription,
          calculos,
          stats,
        };
      }),

    /** Conceder créditos manualmente a um cliente */
    concederCreditos: adminProcedure
      .input(z.object({
        userId: z.number(),
        quantidade: z.number().min(1).max(10000),
        motivo: z.string().max(255).optional(),
      }))
      .mutation(async ({ input }) => {
        await addCreditsToUser(input.userId, input.quantidade);
        return { success: true, mensagem: `${input.quantidade} créditos adicionados` };
      }),

    // ═══════════════════════════════════════════════════════════════════════
    // MONITORAMENTO OPERACIONAL
    // ═══════════════════════════════════════════════════════════════════════

    /** Visão operacional: escritórios, canais, conversas, leads, agentes IA */
    operacional: adminProcedure.query(async () => {
      const db = await getDb();
      if (!db) return { escritorios: 0, colaboradores: 0, canais: [], conversas: { total: 0, aguardando: 0, em_atendimento: 0 }, leads: { total: 0, porEtapa: {} }, agentesIa: 0, contatos: 0 };

      const allEsc = await db.select({ id: escritorios.id }).from(escritorios);
      const allColab = await db.select({ id: colaboradores.id, ativo: colaboradores.ativo }).from(colaboradores);
      const allCanais = await db.select().from(canaisIntegrados);
      const allConversas = await db.select({ status: conversas.status }).from(conversas);
      const allLeads = await db.select({ etapaFunil: leads.etapaFunil }).from(leads);
      const allAgentes = await db.select({ id: agentesIa.id }).from(agentesIa);
      const allContatos = await db.select({ id: contatos.id }).from(contatos);

      // Canais com detalhes
      const canaisResumo = allCanais.map((c) => ({
        id: c.id,
        tipo: c.tipo,
        nome: c.nome,
        status: c.status,
        telefone: c.telefone,
      }));

      // Conversas por status
      const conversasAgua = allConversas.filter((c) => c.status === "aguardando").length;
      const conversasAtend = allConversas.filter((c) => c.status === "em_atendimento").length;

      // Leads por etapa
      const leadsPorEtapa: Record<string, number> = {};
      for (const l of allLeads) {
        leadsPorEtapa[l.etapaFunil] = (leadsPorEtapa[l.etapaFunil] || 0) + 1;
      }

      return {
        escritorios: allEsc.length,
        colaboradores: allColab.filter((c) => c.ativo).length,
        canais: canaisResumo,
        conversas: { total: allConversas.length, aguardando: conversasAgua, em_atendimento: conversasAtend },
        leads: { total: allLeads.length, porEtapa: leadsPorEtapa },
        agentesIa: allAgentes.length,
        contatos: allContatos.length,
      };
    }),

    // ═══════════════════════════════════════════════════════════════════════
    // CONFIGURAÇÕES DO SISTEMA
    // ═══════════════════════════════════════════════════════════════════════

    /** Retorna os planos atuais do sistema (somente leitura) */
    planosAtuais: adminProcedure.query(() => {
      return PLANS.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        priceMonthly: p.priceMonthly,
        priceYearly: p.priceYearly,
        creditsPerMonth: p.creditsPerMonth,
        features: p.features,
      }));
    }),

    /** Saúde do sistema: verifica DB, Stripe, variáveis essenciais */
    systemHealth: adminProcedure.query(async () => {
      const checks: Array<{ nome: string; status: "ok" | "erro" | "aviso"; detalhe: string }> = [];

      // Database
      const db = await getDb();
      checks.push({
        nome: "Banco de dados",
        status: db ? "ok" : "erro",
        detalhe: db ? "Conectado" : "Indisponível",
      });

      // Stripe
      const stripeKey = process.env.STRIPE_SECRET_KEY;
      checks.push({
        nome: "Stripe",
        status: stripeKey ? "ok" : "aviso",
        detalhe: stripeKey ? `Key: ${stripeKey.slice(0, 7)}...${stripeKey.slice(-4)}` : "STRIPE_SECRET_KEY não definida",
      });

      // Stripe Webhook
      const stripeWh = process.env.STRIPE_WEBHOOK_SECRET;
      checks.push({
        nome: "Stripe Webhook",
        status: stripeWh ? "ok" : "aviso",
        detalhe: stripeWh ? "Configurado" : "STRIPE_WEBHOOK_SECRET não definida",
      });

      // Encryption
      const encKey = process.env.ENCRYPTION_KEY;
      checks.push({
        nome: "Criptografia",
        status: encKey && encKey.length === 64 ? "ok" : "aviso",
        detalhe: encKey && encKey.length === 64 ? "ENCRYPTION_KEY (64 chars)" : "Usando chave derivada (menos seguro)",
      });

      // Environment
      checks.push({
        nome: "Ambiente",
        status: "ok",
        detalhe: process.env.NODE_ENV || "development",
      });

      return {
        checks,
        uptime: Math.floor(process.uptime()),
        nodeVersion: process.version,
        memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        plansCount: PLANS.length,
      };
    }),
  }),
});

export type AppRouter = typeof appRouter;

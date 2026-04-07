/**
 * Composição do app router tRPC.
 *
 * Cada subdomínio mora em seu próprio arquivo (./routers/*.ts e
 * ./escritorio/*, ./calculos/*, etc). Este arquivo apenas importa
 * e compõe o `appRouter` final.
 */

import { COOKIE_NAME, SESSION_DURATION_MS } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { sdk } from "./_core/sdk";
import { upsertUser, getUserByOpenId, getDb } from "./db";
import { users } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

// Cálculos
import { financiamentoRouter } from "./calculos/router-financiamento";
import { trabalhistaRouter } from "./calculos/router-trabalhista";
import { imobiliarioRouter } from "./calculos/router-imobiliario";
import { previdenciarioRouter } from "./calculos/router-previdenciario";
import { calculosDiversosRouter } from "./calculos/router-calculos-diversos";

// Processos e OAB
import { processosRouter } from "./processos/router-processos";
import { oabRouter } from "./processos/router-oab";
import { notificacoesRouter } from "./processos/router-notificacoes";

// Escritório
import { configuracoesRouter } from "./escritorio/router-configuracoes";
import { agendamentoRouter } from "./escritorio/router-agendamento";
import { crmRouter } from "./escritorio/router-crm";
import { clientesRouter } from "./escritorio/router-clientes";
import { relatoriosRouter } from "./escritorio/router-relatorios";
import { permissoesRouter } from "./escritorio/router-permissoes";
import { assinaturasRouter } from "./escritorio/router-assinaturas";
import { tarefasRouter } from "./escritorio/router-tarefas";
import { agendaRouter } from "./escritorio/router-agenda";
import { templatesRouter } from "./escritorio/router-templates";

// Integrações
import { calcomRouter } from "./integracoes/router-calcom";
import { whatsappRouter } from "./integracoes/router-whatsapp";
import { twilioRouter } from "./integracoes/router-twilio";
import { agentesIaRouter } from "./integracoes/router-agentes-ia";
import { adminIntegracoesRouter } from "./integracoes/router-admin-integracoes";
import { juditOperacoesRouter } from "./integracoes/router-judit-operacoes";
import { juditUsuarioRouter } from "./integracoes/router-judit-usuario";
import { asaasRouter } from "./integracoes/router-asaas";

// Outros
import { uploadRouter } from "./upload/upload-route";

// Sub-routers extraídos
import { subscriptionRouter } from "./routers/subscription";
import { whatsappCoexRouter } from "./routers/whatsapp-coex";
import { metaChannelsRouter } from "./routers/meta-channels";
import { customer360Router } from "./routers/customer360";
import { juditProcessosRouter } from "./routers/judit-processos";
import { dashboardRouter } from "./routers/dashboard";
import { adminRouter } from "./routers/admin";

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),

    /**
     * Login de demonstração — só funciona se ALLOW_DEV_LOGIN=true.
     *
     * Cria/encontra um usuário "demo@jurify.dev" com role admin, gera o
     * session token JWT e seta o cookie. Permite testar o sistema completo
     * sem precisar configurar um provedor OAuth real.
     *
     * NUNCA habilite isso em produção real (com clientes reais), pois
     * qualquer pessoa que conheça a URL pode logar como admin.
     */
    devLoginEnabled: publicProcedure.query(() => {
      return process.env.ALLOW_DEV_LOGIN === "true";
    }),

    devLogin: publicProcedure
      .input(
        z.object({
          role: z.enum(["user", "admin"]).default("admin"),
        }).optional(),
      )
      .mutation(async ({ ctx, input }) => {
        if (process.env.ALLOW_DEV_LOGIN !== "true") {
          throw new Error("Login de demonstração desabilitado.");
        }

        const role = input?.role ?? "admin";
        const openId = role === "admin" ? "demo-admin-jurify" : "demo-user-jurify";
        const email = role === "admin" ? "demo-admin@jurify.dev" : "demo-user@jurify.dev";
        const name = role === "admin" ? "Admin Demonstração" : "Usuário Demonstração";

        // Cria/atualiza o usuário demo
        await upsertUser({
          openId,
          name,
          email,
          loginMethod: "demo",
          lastSignedIn: new Date(),
        });

        // Garante que tem o role correto (upsert não atualiza role)
        const db = await getDb();
        if (db) {
          await db
            .update(users)
            .set({ role })
            .where(eq(users.openId, openId));
        }

        // Gera o session token
        const sessionToken = await sdk.createSessionToken(openId, {
          name,
          expiresInMs: SESSION_DURATION_MS,
        });

        // Seta o cookie
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, sessionToken, {
          ...cookieOptions,
          maxAge: SESSION_DURATION_MS,
        });

        return { success: true, role, name } as const;
      }),
  }),

  // Assinaturas e Stripe
  subscription: subscriptionRouter,

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

  // Integrações específicas
  whatsappCoex: whatsappCoexRouter, // legado — mantido para retrocompatibilidade
  metaChannels: metaChannelsRouter, // unificado: WhatsApp + Instagram + Messenger
  customer360: customer360Router, // perfil 360° do cliente para Atendimento
  juditProcessos: juditProcessosRouter,
  adminIntegracoes: adminIntegracoesRouter,
  juditOperacoes: juditOperacoesRouter,
  juditUsuario: juditUsuarioRouter,
  asaas: asaasRouter,

  // Dashboard do utilizador
  dashboard: dashboardRouter,

  // Administração do sistema (admin only)
  admin: adminRouter,
});

export type AppRouter = typeof appRouter;

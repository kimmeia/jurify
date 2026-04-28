/**
 * Composição do app router tRPC.
 *
 * Cada subdomínio mora em seu próprio arquivo (./routers/*.ts e
 * ./escritorio/*, ./calculos/*, etc). Este arquivo apenas importa
 * e compõe o `appRouter` final.
 */

import { router } from "./_core/trpc";

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
import { clienteProcessosRouter } from "./escritorio/router-cliente-processos";
import { relatoriosRouter } from "./escritorio/router-relatorios";
import { permissoesRouter } from "./escritorio/router-permissoes";
import { assinaturasRouter } from "./escritorio/router-assinaturas";
import { tarefasRouter } from "./escritorio/router-tarefas";
import { agendaRouter } from "./escritorio/router-agenda";
import { templatesRouter } from "./escritorio/router-templates";
import { financeiroRouter } from "./escritorio/router-financeiro";
import { comissoesRouter } from "./escritorio/router-comissoes";

// Integrações
import { calcomRouter } from "./integracoes/router-calcom";
import { whatsappRouter } from "./integracoes/router-whatsapp";
import { twilioRouter } from "./integracoes/router-twilio";
import { agentesIaRouter } from "./integracoes/router-agentes-ia";
import { agenteChatRouter } from "./integracoes/router-agente-chat";
import { adminIntegracoesRouter } from "./integracoes/router-admin-integracoes";
import { juditOperacoesRouter } from "./integracoes/router-judit-operacoes";
import { juditUsuarioRouter } from "./integracoes/router-judit-usuario";
import { juditCredenciaisRouter } from "./integracoes/router-judit-credenciais";
import { asaasRouter } from "./integracoes/router-asaas";

// Outros
import { uploadRouter } from "./upload/upload-route";

// Sub-routers extraídos
import { authRouter } from "./routers/auth";
import { subscriptionRouter } from "./routers/subscription";
import { whatsappCoexRouter } from "./routers/whatsapp-coex";
import { metaChannelsRouter } from "./routers/meta-channels";
import { customer360Router } from "./routers/customer360";
import { juditProcessosRouter } from "./routers/judit-processos";
import { dashboardRouter } from "./routers/dashboard";
import { adminRouter } from "./routers/admin";
import { adminFinanceiroRouter } from "./routers/admin-financeiro";
import { adminAgentesIaRouter } from "./routers/admin-agentes-ia";
import { adminJuditRouter } from "./routers/admin-judit";
import { smartflowRouter } from "./smartflow/router-smartflow";
import { kanbanRouter } from "./escritorio/router-kanban";

export const appRouter = router({
  // Autenticação própria — email/senha + Google Sign-In
  auth: authRouter,

  // Assinaturas SaaS (cobrança via Asaas)
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
  agenteChat: agenteChatRouter,
  clientes: clientesRouter,
  clienteProcessos: clienteProcessosRouter,
  relatorios: relatoriosRouter,
  permissoes: permissoesRouter,
  assinaturas: assinaturasRouter,
  upload: uploadRouter,
  tarefas: tarefasRouter,
  agenda: agendaRouter,
  templates: templatesRouter,
  financeiro: financeiroRouter,
  comissoes: comissoesRouter,

  // Integrações específicas
  whatsappCoex: whatsappCoexRouter, // legado — mantido para retrocompatibilidade
  metaChannels: metaChannelsRouter, // unificado: WhatsApp + Instagram + Messenger
  customer360: customer360Router, // perfil 360° do cliente para Atendimento
  juditProcessos: juditProcessosRouter,
  adminIntegracoes: adminIntegracoesRouter,
  juditOperacoes: juditOperacoesRouter,
  juditUsuario: juditUsuarioRouter,
  juditCredenciais: juditCredenciaisRouter,
  asaas: asaasRouter,

  // Dashboard do utilizador
  dashboard: dashboardRouter,

  // Administração do sistema (admin only)
  admin: adminRouter,
  adminFinanceiro: adminFinanceiroRouter,
  adminAgentesIa: adminAgentesIaRouter,
  adminJudit: adminJuditRouter,
  smartflow: smartflowRouter,
  kanban: kanbanRouter,
});

export type AppRouter = typeof appRouter;

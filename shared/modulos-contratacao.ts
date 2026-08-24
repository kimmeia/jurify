/**
 * O mapa que liga o sistema aos módulos CONTRATÁVEIS (shared/modulos-app.ts).
 *
 * Duas pontas consomem isto:
 *  - o servidor: cada namespace tRPC declara a qual módulo pertence, e o
 *    porteiro em `_core/trpc.ts` recusa chamadas de módulo não contratado;
 *  - o client: cada prefixo de rota declara os módulos que o liberam, e o
 *    ModuloGuard mostra a tela de "não faz parte do seu plano".
 *
 * `null` = infraestrutura/core — nunca é bloqueado por contratação. Os
 * namespaces admin* também são null porque o `adminProcedure` já barra quem
 * não é admin da plataforma; e jurisia/juridico são null porque o JurisIA
 * tem gate PRÓPRIO (add-on por escritório ∪ cota do plano) que é mais
 * esperto que uma lista de slugs — sobrepor os dois bloquearia quem comprou
 * o add-on.
 *
 * O teste `modulos-contratacao.test.ts` confere que TODO namespace do
 * appRouter aparece aqui — router novo sem se declarar quebra a suíte, de
 * propósito: é o que impede um módulo futuro de nascer sem porteiro.
 */

import type { ModuloAppId } from "./modulos-app";

export const MODULO_POR_NAMESPACE: Record<string, ModuloAppId | null> = {
  // core / plataforma — nunca bloqueia
  auth: null,
  subscription: null,
  notificacoes: null,
  push: null,
  configuracoes: null,
  permissoes: null,
  upload: null,
  roadmap: null,
  dashboard: null,

  // gate próprio (add-on JurisIA) — não sobrepor
  jurisia: null,
  juridico: null,

  // admin da plataforma — adminProcedure já cerca
  admin: null,
  adminFinanceiro: null,
  adminAgentesIa: null,
  adminSmartflow: null,
  adminIntegracoes: null,
  adminErros: null,
  adminBackup: null,
  adminManutencao: null,
  adminEmailLog: null,
  adminTribunais: null,
  adminRoboAuditor: null,
  adminJornada: null,

  // acompanhamento processual
  processos: "processos",
  movimentacoes: "processos",
  resumoDiario: "processos",
  prazosSugeridos: "processos",
  cofreCredenciais: "processos",
  clienteProcessos: "processos",
  importarProcessos: "processos",
  // Pacote Fase 2: versões enxutas de Clientes/Agenda + painel da variante
  // processual. São "processos" (não "clientes"/"agenda") de propósito —
  // é o que as libera num plano que só contratou o acompanhamento.
  clientesEssencial: "processos",
  prazos: "processos",
  painelProcessual: "processos",

  // cálculos
  financiamento: "calculos",
  trabalhista: "calculos",
  imobiliario: "calculos",
  previdenciario: "calculos",
  calculosDiversos: "calculos",

  // atendimento (canais Meta + inbox)
  crm: "atendimento",
  atendimentoIa: "atendimento",
  customer360: "atendimento",
  templates: "atendimento",
  twilio: "atendimento",
  metaChannels: "atendimento",
  whatsappCoex: "atendimento",
  whatsappCloud: "atendimento",
  whatsappCalling: "atendimento",

  // automações
  smartflow: "smartflow",
  agentesIa: "agentes_ia",
  agenteChat: "agentes_ia",

  // crm de clientes
  clientes: "clientes",
  origensLead: "clientes",
  camposCliente: "clientes",
  acordos: "clientes",

  // contratos e assinatura digital
  modelosContrato: "contratos",
  assinaturas: "contratos",

  // agenda e tarefas
  agenda: "agenda",
  agendamento: "agenda",
  tarefas: "agenda",

  // financeiro
  financeiro: "financeiro",
  asaas: "financeiro",
  despesas: "financeiro",
  comissoes: "comissoes",
  comissoesAgenda: "comissoes",

  // demais módulos
  relatorios: "relatorios",
  backup: "backups",
  kanban: "kanban",
  kanbanRestaurar: "kanban",
  rh: "ponto",
};

/** Módulo de contratação de um path tRPC ("asaas.listarCobrancas" → "financeiro").
 *  Namespace desconhecido → null (fail-open; o teste de completude impede
 *  que isso aconteça com router registrado). */
export function moduloDoPath(path: string): ModuloAppId | null {
  const ns = path.split(".")[0];
  return MODULO_POR_NAMESPACE[ns] ?? null;
}

/** Prefixos de rota do client → módulos que a liberam (basta UM contratado).
 *  Rota fora desta lista nunca é bloqueada. Ordem: prefixos mais específicos
 *  primeiro. JurisIA fica fora — a própria página trata o add-on. */
export const MODULOS_POR_ROTA: ReadonlyArray<{ prefixo: string; modulos: ModuloAppId[] }> = [
  { prefixo: "/modelos-contrato", modulos: ["contratos"] },
  { prefixo: "/agendamento", modulos: ["agenda"] },
  { prefixo: "/agenda", modulos: ["agenda"] },
  { prefixo: "/atendimento", modulos: ["atendimento"] },
  // "/clientes" também abre com só processos (Fase 2): a rota decide entre a
  // tela completa e a essencial olhando o contrato — o guard só barra quem
  // não tem nenhum dos dois.
  { prefixo: "/clientes", modulos: ["clientes", "processos"] },
  { prefixo: "/acordos", modulos: ["clientes"] },
  { prefixo: "/processos", modulos: ["processos"] },
  { prefixo: "/movimentacoes", modulos: ["processos"] },
  { prefixo: "/prazos", modulos: ["processos"] },
  { prefixo: "/kanban", modulos: ["kanban"] },
  { prefixo: "/ponto", modulos: ["ponto"] },
  { prefixo: "/calculos", modulos: ["calculos"] },
  { prefixo: "/automacoes", modulos: ["smartflow", "agentes_ia"] },
  { prefixo: "/smartflow", modulos: ["smartflow"] },
  { prefixo: "/agentes-ia", modulos: ["agentes_ia"] },
  { prefixo: "/financeiro", modulos: ["financeiro"] },
  { prefixo: "/relatorios", modulos: ["relatorios"] },
  { prefixo: "/metricas", modulos: ["relatorios"] },
];

export function modulosDaRota(pathname: string): ModuloAppId[] | null {
  const hit = MODULOS_POR_ROTA.find(
    (r) => pathname === r.prefixo || pathname.startsWith(r.prefixo + "/") || pathname.startsWith(r.prefixo + "?"),
  );
  return hit ? hit.modulos : null;
}

/**
 * A decisão do porteiro, pura e fail-open: só bloqueia quando a lista de
 * módulos do plano é CONHECIDA e NÃO-VAZIA e nenhum dos exigidos está nela.
 * `null`/vazia = indeterminado (sem plano resolvido, cortesia, JSON quebrado)
 * → deixa passar; quem cuida do "sem plano" é o guard de assinatura.
 */
export function contratoLibera(
  modulosDoPlano: readonly string[] | null,
  exigidos: readonly string[],
): boolean {
  if (!exigidos.length) return true;
  if (!modulosDoPlano || modulosDoPlano.length === 0) return true;
  return exigidos.some((m) => modulosDoPlano.includes(m));
}

/**
 * O contrato é o pacote Acompanhamento Processual "puro"? (processos sem a
 * suíte completa). É o que liga a variante processual do dashboard e as
 * versões enxutas de Clientes/Prazos. Contrato indeterminado (null/vazio) =
 * tudo liberado → NÃO é puro: quem tem tudo vê o app como sempre foi.
 */
const SUITE_COMPLETA: readonly string[] = ["atendimento", "financeiro", "kanban", "clientes", "agenda"];

export function pacoteProcessualPuro(modulosDoPlano: readonly string[] | null): boolean {
  if (!modulosDoPlano || modulosDoPlano.length === 0) return false;
  if (!modulosDoPlano.includes("processos")) return false;
  return !SUITE_COMPLETA.some((m) => modulosDoPlano.includes(m));
}

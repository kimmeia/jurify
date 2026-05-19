/**
 * Tipos compartilhados — Planos do JuridFlow SaaS.
 *
 * Fonte de verdade: tabela `planos` no banco. Esses tipos espelham o
 * schema e são usados em client e server.
 *
 * O admin edita planos em /admin/planos. Toda mudança reflete instantaneamente
 * na LP (juridflow.com.br), na página /plans do app e nas validações de
 * limite em runtime.
 */

import type { ModuloAppId } from "./modulos-app";

/**
 * Slug imutável do plano. Quando subscriptions já existem com um slug,
 * ele não pode mudar (FK lógica em `subscriptions.planId`). O `nome`
 * exibível pode mudar à vontade.
 */
export type PlanoSlug = string;

export interface PlanoLimites {
  /** Inclui o dono. 0 ou null = ilimitado. */
  maxUsuarios: number | null;
  maxArmazenamentoMB: number;
  /** null = ilimitado */
  maxClientes: number | null;
  maxConexoesWhatsapp: number;
  maxAgentesIa: number;
  /** null = ilimitado */
  maxMonitoramentosProcessos: number | null;
  creditosCalculosMes: number;
}

export interface Plano {
  id: number;
  slug: PlanoSlug;
  nome: string;
  descricao: string | null;
  publicoAlvo: string | null;
  precoMensalCentavos: number;
  precoAnualCentavos: number | null;
  trialDias: number;
  limites: PlanoLimites;
  modulosLiberados: ModuloAppId[];
  features: string[];
  popular: boolean;
  oculto: boolean;
  ordem: number;
  criadoEm: string;
  atualizadoEm: string;
}

/**
 * Helper: campo "ilimitado" se valor é null ou ≥ LIMITE_ILIMITADO.
 * Backend e UI usam pra renderizar "∞" e bypass de validação.
 */
export const LIMITE_ILIMITADO = 999999;

export function ehIlimitado(valor: number | null | undefined): boolean {
  return valor == null || valor >= LIMITE_ILIMITADO;
}

/**
 * Slugs dos planos default (criados na migration 0108).
 * Outros planos podem ser criados pelo admin via /admin/planos.
 */
export const PLANOS_PADRAO_SLUGS = ["free", "basico", "intermediario", "completo"] as const;
export type PlanoPadraoSlug = (typeof PLANOS_PADRAO_SLUGS)[number];

/**
 * Limites por Plano — Controle de uso e monetização
 * 
 * Define limites para cada plano e verifica se o escritório pode criar mais recursos.
 * 
 * Uso:
 *   const pode = await verificarLimite(escritorioId, userId, "clientes");
 *   if (!pode.permitido) throw new Error(pode.mensagem);
 */

import { getDb, getActiveSubscription } from "../db";
import { contatos, conversas, colaboradores, escritorios, users, clienteArquivos } from "../../drizzle/schema";
import { eq, and, or, sql } from "drizzle-orm";
import { getPlanoBySlug } from "./planos-repo";
import type { Plano } from "@shared/planos-types";

// ─── Definição de limites por plano ─────────────────────────────────────────

export interface LimitesPlano {
  maxClientes: number;
  maxColaboradores: number;
  maxConversasAtivas: number;
  maxArmazenamentoMB: number;
  maxLeads: number;
  maxAgentesIa: number;
  maxMonitoramentosJudit: number;
  maxCobrancasAsaas: number;
  modulosPermitidos: string[];
}

/**
 * Limites por plano.
 *
 * @deprecated Os limites canônicos agora estão na tabela `planos` (migration
 * 0108). Esta constante é mantida como fallback pra fluxo `verificarLimite`
 * enquanto refatoramos pra ler do DB (PR futuro). Os IDs (`basico`,
 * `intermediario`, `completo`) batem com os slugs da tabela.
 *
 * O plano "free" também existe na tabela; aqui é só fallback se a query
 * falhar.
 */
const LIMITES: Record<string, LimitesPlano> = {
  free: {
    maxClientes: 10,
    maxColaboradores: 1,
    maxConversasAtivas: 5,
    maxArmazenamentoMB: 100,
    maxLeads: 10,
    maxAgentesIa: 0,
    maxMonitoramentosJudit: 0,
    maxCobrancasAsaas: 0,
    modulosPermitidos: ["calculos", "clientes", "contratos"],
  },

  basico: {
    maxClientes: 100,
    maxColaboradores: 1,
    maxConversasAtivas: 20,
    maxArmazenamentoMB: 5000,
    maxLeads: 50,
    maxAgentesIa: 0,
    maxMonitoramentosJudit: 0,
    maxCobrancasAsaas: 50,
    modulosPermitidos: ["calculos", "clientes", "contratos", "financeiro"],
  },

  intermediario: {
    maxClientes: 999999,
    maxColaboradores: 5,
    maxConversasAtivas: 100,
    maxArmazenamentoMB: 20480,
    maxLeads: 500,
    maxAgentesIa: 0,
    maxMonitoramentosJudit: 0,
    maxCobrancasAsaas: 500,
    modulosPermitidos: ["calculos", "clientes", "contratos", "financeiro", "atendimento", "kanban", "agenda", "smartflow", "comissoes"],
  },

  completo: {
    maxClientes: 999999,
    maxColaboradores: 999999,
    maxConversasAtivas: 999999,
    maxArmazenamentoMB: 102400,
    maxLeads: 999999,
    maxAgentesIa: 5,
    maxMonitoramentosJudit: 999999,
    maxCobrancasAsaas: 999999,
    modulosPermitidos: ["calculos", "clientes", "contratos", "financeiro", "atendimento", "kanban", "agenda", "smartflow", "comissoes", "agentes_ia", "processos", "relatorios", "backups"],
  },
};

export function getLimites(planId: string): LimitesPlano {
  return LIMITES[planId] || LIMITES["free"];
}

const SEM_TETO = 999999;

/**
 * Limites a partir da linha da tabela `planos` — a fonte que o admin edita.
 * Os campos que a tabela não modela (conversas, leads, cobranças Asaas)
 * vêm do mapa legado quando o slug existe lá; plano novo não ganha teto
 * inventado. Foi o mapa hardcoded tratando plano desconhecido como "free"
 * que deixou o superlançamento com 1 usuário e 10 clientes.
 */
export function limitesDoPlano(plano: Plano, legado?: LimitesPlano): LimitesPlano {
  return {
    maxClientes: plano.limites.maxClientes ?? SEM_TETO,
    maxColaboradores:
      plano.limites.maxUsuarios != null && plano.limites.maxUsuarios > 0
        ? plano.limites.maxUsuarios
        : SEM_TETO,
    maxArmazenamentoMB: plano.limites.maxArmazenamentoMB > 0 ? plano.limites.maxArmazenamentoMB : SEM_TETO,
    maxAgentesIa: plano.limites.maxAgentesIa,
    maxConversasAtivas: legado?.maxConversasAtivas ?? SEM_TETO,
    maxLeads: legado?.maxLeads ?? SEM_TETO,
    maxMonitoramentosJudit: legado?.maxMonitoramentosJudit ?? SEM_TETO,
    maxCobrancasAsaas: legado?.maxCobrancasAsaas ?? SEM_TETO,
    modulosPermitidos: plano.modulosLiberados,
  };
}

/** Tabela `planos` primeiro; mapa hardcoded só como fallback de emergência. */
async function resolverLimites(planId: string): Promise<LimitesPlano> {
  try {
    const plano = await getPlanoBySlug(planId);
    if (plano) return limitesDoPlano(plano, LIMITES[planId]);
  } catch {
    // catálogo indisponível — cai no mapa legado abaixo
  }
  return getLimites(planId);
}

// ─── Verificação de limites ─────────────────────────────────────────────────

export interface ResultadoLimite {
  permitido: boolean;
  atual: number;
  maximo: number;
  mensagem: string;
  planId: string;
}

type RecursoVerificavel = "clientes" | "colaboradores" | "conversas" | "leads" | "agentes_ia" | "armazenamento";

/**
 * Verifica se o escritório pode criar mais um recurso.
 * Retorna { permitido, atual, maximo, mensagem }
 */
export async function verificarLimite(
  escritorioId: number,
  userId: number,
  recurso: RecursoVerificavel,
): Promise<ResultadoLimite> {
  const db = await getDb();
  if (!db) return { permitido: false, atual: 0, maximo: 0, mensagem: "Database indisponível", planId: "free" };

  // Buscar plano do usuário dono do escritório
  const [esc] = await db.select({ ownerId: escritorios.ownerId })
    .from(escritorios).where(eq(escritorios.id, escritorioId)).limit(1);

  if (!esc) return { permitido: false, atual: 0, maximo: 0, mensagem: "Escritório não encontrado", planId: "free" };

  // Sub com acesso ativo do dono via regra canônica (getActiveSubscription/
  // temAcessoAtivo): cortesia válida OU status='active' OU 'trialing' dentro
  // do prazo. A query local anterior só casava status='active'/cortesia —
  // trial caía nos limites do free (10 clientes, 0 agentes IA) mesmo com o
  // módulo liberado pelo requireModulo, que já usava a regra canônica.
  const sub = await getActiveSubscription(esc.ownerId);

  // CORTESIA: libera sem limite (alinha com painel admin que mostra
  // "Cortesia ativa"). Expiração já validada por getActiveSubscription.
  // Convenção: `maximo: -1` é "ilimitado" (Infinity vira null em JSON).
  if (sub?.cortesia) {
    return {
      permitido: true,
      atual: 0,
      maximo: -1,
      mensagem: "Cortesia ativa — sem limite",
      planId: sub.planId || "cortesia",
    };
  }

  const planId = sub?.planId || "free";
  const limites = await resolverLimites(planId);

  // Contar uso atual
  let atual = 0;
  let maximo = 0;
  let label = "";

  switch (recurso) {
    case "clientes": {
      const [r] = await db.select({ count: sql<number>`COUNT(*)` }).from(contatos).where(eq(contatos.escritorioId, escritorioId));
      atual = Number((r as { count: number } | undefined)?.count || 0);
      maximo = limites.maxClientes;
      label = "clientes";
      break;
    }
    case "colaboradores": {
      const [r] = await db.select({ count: sql<number>`COUNT(*)` }).from(colaboradores).where(and(eq(colaboradores.escritorioId, escritorioId), eq(colaboradores.ativo, true)));
      atual = Number((r as { count: number } | undefined)?.count || 0);
      maximo = limites.maxColaboradores;
      label = "colaboradores";
      break;
    }
    case "conversas": {
      const [r] = await db.select({ count: sql<number>`COUNT(*)` }).from(conversas).where(and(eq(conversas.escritorioId, escritorioId), or(eq(conversas.status, "aguardando"), eq(conversas.status, "em_atendimento"))));
      atual = Number((r as { count: number } | undefined)?.count || 0);
      maximo = limites.maxConversasAtivas;
      label = "conversas ativas";
      break;
    }
    case "leads": {
      const [r] = await db.select({ count: sql<number>`COUNT(*)` }).from(sql`leads`).where(sql`escritorioIdLead = ${escritorioId} AND etapaFunil NOT IN ('fechado_ganho','fechado_perdido')`);
      atual = Number((r as { count: number } | undefined)?.count || 0);
      maximo = limites.maxLeads;
      label = "leads ativos";
      break;
    }
    case "agentes_ia": {
      const [r] = await db.select({ count: sql<number>`COUNT(*)` }).from(sql`agentes_ia`).where(sql`escritorioId = ${escritorioId}`);
      atual = Number((r as { count: number } | undefined)?.count || 0);
      maximo = limites.maxAgentesIa;
      label = "agentes IA";
      break;
    }
    case "armazenamento": {
      const [r] = await db.select({ total: sql<number>`COALESCE(SUM(tamanho), 0)` }).from(clienteArquivos).where(eq(clienteArquivos.escritorioId, escritorioId));
      atual = Math.round(Number((r as any)?.total || 0) / (1024 * 1024)); // MB
      maximo = limites.maxArmazenamentoMB;
      label = "MB de armazenamento";
      break;
    }
  }

  const permitido = atual < maximo;
  const mensagem = permitido
    ? `${atual}/${maximo} ${label} utilizados`
    : `Limite de ${maximo} ${label} atingido. Faça upgrade do plano para continuar.`;

  return { permitido, atual, maximo, mensagem, planId };
}

/**
 * Verifica se um módulo está disponível no plano do escritório.
 */
export async function moduloDisponivel(escritorioId: number, modulo: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const [esc] = await db.select({ ownerId: escritorios.ownerId })
    .from(escritorios).where(eq(escritorios.id, escritorioId)).limit(1);

  if (!esc) return false;

  // Mesma regra canônica de verificarLimite (inclui trialing); cortesia
  // libera todos os módulos, alinhado com requireModulo.
  const sub = await getActiveSubscription(esc.ownerId);
  if (sub?.cortesia) return true;

  const planId = sub?.planId || "free";
  const limites = await resolverLimites(planId);

  return limites.modulosPermitidos.includes(modulo);
}

/**
 * Retorna o resumo de uso do escritório (para exibir no frontend)
 */
export async function obterResumoUso(escritorioId: number, userId: number) {
  const recursos: RecursoVerificavel[] = ["clientes", "colaboradores", "conversas", "leads", "agentes_ia", "armazenamento"];
  const uso: Record<string, { atual: number; maximo: number; percentual: number }> = {};

  let planId = "free";

  for (const recurso of recursos) {
    const r = await verificarLimite(escritorioId, userId, recurso);
    planId = r.planId;
    uso[recurso] = {
      atual: r.atual,
      maximo: r.maximo,
      percentual: r.maximo > 0 ? Math.round((r.atual / r.maximo) * 100) : 0,
    };
  }

  return { planId, uso };
}

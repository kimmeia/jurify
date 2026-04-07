/**
 * Limites por Plano — Controle de uso e monetização
 * 
 * Define limites para cada plano e verifica se o escritório pode criar mais recursos.
 * 
 * Uso:
 *   const pode = await verificarLimite(escritorioId, userId, "clientes");
 *   if (!pode.permitido) throw new Error(pode.mensagem);
 */

import { getDb } from "../db";
import { contatos, conversas, colaboradores, escritorios, subscriptions, users, clienteArquivos } from "../../drizzle/schema";
import { eq, and, or, sql } from "drizzle-orm";

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

const LIMITES: Record<string, LimitesPlano> = {
  // Sem plano (trial/free)
  free: {
    maxClientes: 10,
    maxColaboradores: 1,
    maxConversasAtivas: 5,
    maxArmazenamentoMB: 100,
    maxLeads: 10,
    maxAgentesIa: 0,
    maxMonitoramentosJudit: 0,
    maxCobrancasAsaas: 0,
    modulosPermitidos: ["calculos", "processos"],
  },

  basic: {
    maxClientes: 100,
    maxColaboradores: 2,
    maxConversasAtivas: 20,
    maxArmazenamentoMB: 500,
    maxLeads: 50,
    maxAgentesIa: 1,
    maxMonitoramentosJudit: 5,
    maxCobrancasAsaas: 50,
    modulosPermitidos: ["calculos", "processos", "clientes", "atendimento", "pipeline", "agendamento", "monitoramento_judit", "financeiro"],
  },

  professional: {
    maxClientes: 1000,
    maxColaboradores: 10,
    maxConversasAtivas: 100,
    maxArmazenamentoMB: 5000,
    maxLeads: 500,
    maxAgentesIa: 5,
    maxMonitoramentosJudit: 50,
    maxCobrancasAsaas: 500,
    modulosPermitidos: ["calculos", "processos", "clientes", "atendimento", "pipeline", "agendamento", "relatorios", "configuracoes", "equipe", "monitoramento_judit", "financeiro"],
  },

  enterprise: {
    maxClientes: 999999,
    maxColaboradores: 999999,
    maxConversasAtivas: 999999,
    maxArmazenamentoMB: 50000,
    maxLeads: 999999,
    maxAgentesIa: 999999,
    maxMonitoramentosJudit: 999999,
    maxCobrancasAsaas: 999999,
    modulosPermitidos: ["calculos", "processos", "clientes", "atendimento", "pipeline", "agendamento", "relatorios", "configuracoes", "equipe", "monitoramento_judit", "financeiro"],
  },
};

export function getLimites(planId: string): LimitesPlano {
  return LIMITES[planId] || LIMITES["free"];
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

  // Buscar subscription ativa do dono
  const [sub] = await db.select({ planId: subscriptions.planId, status: subscriptions.status })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, esc.ownerId), eq(subscriptions.status, "active")))
    .limit(1);

  const planId = sub?.planId || "free";
  const limites = getLimites(planId);

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

  const [sub] = await db.select({ planId: subscriptions.planId })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, esc.ownerId), eq(subscriptions.status, "active")))
    .limit(1);

  const planId = sub?.planId || "free";
  const limites = getLimites(planId);

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

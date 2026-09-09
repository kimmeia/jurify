/**
 * Limite de monitoramentos por PLANO, separado por serviço:
 *   - "movimentacoes": vigiar processo (CNJ) → planos.maxMonitoramentosProcessos
 *   - "novas_acoes":   vigiar CPF/CNPJ       → planos.maxMonitoramentosCpf
 *
 * A recusa é gancho de venda, não parede: a mensagem manda falar com a
 * gente pra aumentar. Fail-open consciente: limite NULL, cortesia, plano
 * não resolvido ou erro de consulta NUNCA barram — barrar cliente pagante
 * por bug nosso custa mais caro que deixar passar um monitoramento.
 */

import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { escritorios, motorMonitoramentos } from "../../drizzle/schema";

export type TipoMonitoramento = "movimentacoes" | "novas_acoes";

export interface AvaliacaoLimite {
  permitido: boolean;
  atual: number;
  /** null = sem limite. */
  maximo: number | null;
  mensagem: string | null;
}

/** Decisão pura — testável sem banco. */
export function avaliarLimiteMonitoramentos(args: {
  tipo: TipoMonitoramento;
  atual: number;
  maximo: number | null;
}): AvaliacaoLimite {
  if (args.maximo == null || args.maximo <= 0) {
    return { permitido: true, atual: args.atual, maximo: null, mensagem: null };
  }
  if (args.atual < args.maximo) {
    return { permitido: true, atual: args.atual, maximo: args.maximo, mensagem: null };
  }
  const rotulo = args.tipo === "movimentacoes" ? "processos vigiados" : "CPFs/CNPJs vigiados";
  return {
    permitido: false,
    atual: args.atual,
    maximo: args.maximo,
    mensagem:
      `Seu plano vigia até ${args.maximo} ${rotulo} e todos estão em uso. ` +
      `Fale com a gente pra aumentar — leva um minuto.`,
  };
}

export async function verificarLimiteMonitoramentos(
  escritorioId: number,
  tipo: TipoMonitoramento,
): Promise<AvaliacaoLimite> {
  const semLimite: AvaliacaoLimite = { permitido: true, atual: 0, maximo: null, mensagem: null };
  try {
    const db = await getDb();
    if (!db) return semLimite;

    const [esc] = await db
      .select({ ownerId: escritorios.ownerId })
      .from(escritorios)
      .where(eq(escritorios.id, escritorioId))
      .limit(1);
    if (!esc?.ownerId) return semLimite;

    const { getActiveSubscriptionComHeranca } = await import("../db");
    const sub = await getActiveSubscriptionComHeranca(esc.ownerId);
    if (!sub?.planId || sub.cortesia) return semLimite;

    const { getPlanoBySlug } = await import("../billing/planos-repo");
    const plano = await getPlanoBySlug(sub.planId);
    if (!plano) return semLimite;

    const maximo =
      tipo === "movimentacoes"
        ? plano.limites.maxMonitoramentosProcessos
        : plano.limites.maxMonitoramentosCpf;
    if (maximo == null) return semLimite;

    const [contagem] = await db
      .select({ total: sql<number>`count(*)` })
      .from(motorMonitoramentos)
      .where(and(
        eq(motorMonitoramentos.escritorioId, escritorioId),
        eq(motorMonitoramentos.tipoMonitoramento, tipo),
      ));

    return avaliarLimiteMonitoramentos({ tipo, atual: Number(contagem?.total ?? 0), maximo });
  } catch {
    return semLimite;
  }
}

/**
 * Plans resolver — fachada de compatibilidade.
 *
 * Internamente lê da tabela `planos` (fonte de verdade). Mantém a interface
 * legada `PlanDefinition` pra não quebrar callers existentes durante a
 * migração. Novos callers devem usar `planos-repo` diretamente.
 *
 * @deprecated Use `planos-repo.ts` em código novo. Esta camada existe
 * apenas pra retro-compatibilidade enquanto refatoramos os callers.
 */

import { PLANS as PLANS_FALLBACK, type PlanDefinition } from "./products";
import { getAllPlanos, getPlanoBySlug, getPlanosVisiveis } from "./planos-repo";
import type { Plano } from "@shared/planos-types";

function planoParaDefinition(p: Plano): PlanDefinition & { oculto?: boolean } {
  return {
    id: p.slug,
    name: p.nome,
    description: p.descricao ?? "",
    features: p.features,
    priceMonthly: p.precoMensalCentavos,
    priceYearly: p.precoAnualCentavos ?? p.precoMensalCentavos * 12,
    currency: "brl",
    popular: p.popular,
    creditsPerMonth: p.limites.creditosCalculosMes,
    oculto: p.oculto,
  };
}

/**
 * Retorna a lista de planos.
 *
 * @param incluirOcultos - se true, retorna planos marcados como oculto
 *                        (usado pelo admin / billing interno). Padrão false
 *                        (usado pela página /plans pública e LP).
 *
 * Fallback: se a tabela `planos` estiver vazia (DB caiu, migration não
 * rodou, stub de teste), retorna PLANS estático pra não quebrar a UI.
 */
export async function getPlansResolved(incluirOcultos = false): Promise<PlanDefinition[]> {
  const planos = incluirOcultos ? await getAllPlanos() : await getPlanosVisiveis();
  if (planos.length === 0) {
    return incluirOcultos ? PLANS_FALLBACK : PLANS_FALLBACK.filter((p) => p.id !== "free");
  }
  return planos.map(planoParaDefinition);
}

/**
 * Busca plano por slug (ID legado). Retorna shape antigo `PlanDefinition`
 * pra compat com callers existentes. Fallback estático se DB vazio.
 */
export async function getPlanByIdResolved(slug: string): Promise<PlanDefinition | undefined> {
  const plano = await getPlanoBySlug(slug);
  if (plano) return planoParaDefinition(plano);
  return PLANS_FALLBACK.find((p) => p.id === slug);
}

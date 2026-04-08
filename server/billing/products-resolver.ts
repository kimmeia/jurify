/**
 * Plans resolver — combina os planos hardcoded em `products.ts` com
 * eventuais overrides do banco (`planos_overrides`).
 *
 * Por que existe:
 *   - O hardcoded é a SOURCE OF TRUTH (deploy garante consistência).
 *   - Mas o admin precisa poder ajustar preço/feature sem deploy
 *     (campanha promocional, correção de erro, A/B test, etc).
 *   - Sem cache: o overhead é mínimo (3 planos, 1 query) e o admin
 *     espera ver mudanças aplicadas instantaneamente.
 */

import { getDb } from "../db";
import { planosOverrides } from "../../drizzle/schema";
import { PLANS as DEFAULT_PLANS, type PlanDefinition } from "./products";
import { createLogger } from "../_core/logger";

const log = createLogger("billing-products-resolver");

/**
 * Retorna a lista de planos com overrides aplicados.
 *
 * @param incluirOcultos - se true, retorna planos marcados como oculto
 *                        (usado pelo admin / billing interno). Padrão false
 *                        (usado pela página /plans pública).
 */
export async function getPlansResolved(incluirOcultos = false): Promise<PlanDefinition[]> {
  try {
    const db = await getDb();
    if (!db) return DEFAULT_PLANS;

    const overrides = await db.select().from(planosOverrides);
    if (overrides.length === 0) return DEFAULT_PLANS;

    const overrideMap = new Map(overrides.map((o) => [o.planId, o]));

    const merged = DEFAULT_PLANS.map((plan) => {
      const ov = overrideMap.get(plan.id);
      if (!ov) return plan;

      let features = plan.features;
      if (ov.features) {
        try {
          const parsed = JSON.parse(ov.features);
          if (Array.isArray(parsed)) features = parsed;
        } catch {
          log.warn({ planId: plan.id }, "features override JSON inválido");
        }
      }

      return {
        ...plan,
        name: ov.name ?? plan.name,
        description: ov.description ?? plan.description,
        priceMonthly: ov.priceMonthly ?? plan.priceMonthly,
        priceYearly: ov.priceYearly ?? plan.priceYearly,
        features,
        popular: ov.popular ?? plan.popular,
        oculto: ov.oculto ?? false,
      } as PlanDefinition & { oculto: boolean };
    });

    if (!incluirOcultos) {
      return merged.filter((p) => !(p as any).oculto);
    }
    return merged;
  } catch (err) {
    log.error({ err: String(err) }, "Falha ao carregar overrides — usando hardcoded");
    return DEFAULT_PLANS;
  }
}

/**
 * Versão de getPlanById que aplica overrides.
 */
export async function getPlanByIdResolved(id: string): Promise<PlanDefinition | undefined> {
  const plans = await getPlansResolved(true);
  return plans.find((p) => p.id === id);
}

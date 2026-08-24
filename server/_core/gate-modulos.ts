/**
 * O porteiro de módulos contratados — a peça que faz `planos.modulosLiberados`
 * valer de verdade (antes só 3 procedures conferiam; o resto saía de graça).
 *
 * Desenho FAIL-OPEN de propósito: a única situação que bloqueia é "o plano
 * foi resolvido, tem lista de módulos não-vazia, e o módulo pedido não está
 * nela". Sem assinatura, cortesia, plano não encontrado, JSON quebrado,
 * erro de banco — tudo deixa passar, porque cada um desses casos já tem
 * dono (SubscriptionGuard, gates das procedures) e o porteiro não pode
 * derrubar escritório pagante por um soluço de infraestrutura.
 *
 * A migration 0200 gravou a lista COMPLETA em todos os planos existentes:
 * no dia em que isto subiu, nenhum tenant perdeu nada. Restringir é decisão
 * do admin no painel — e a partir daí o porteiro obedece.
 */

import { TRPCError } from "@trpc/server";
import { contratoLibera, moduloDoPath } from "@shared/modulos-contratacao";
import { MODULOS_APP } from "@shared/modulos-app";
import { unirModulosContratados } from "@shared/fatura-modulos";

interface AcessoCacheado {
  expiraEm: number;
  /** Lista do plano, ou null = tudo liberado (cortesia/sem plano/indeterminado). */
  modulos: string[] | null;
}

// 30s de cache por usuário: o porteiro roda em toda chamada tRPC e não pode
// custar 2 queries cada. Trocar de plano demora até 30s pra refletir — ok.
const cache = new Map<number, AcessoCacheado>();
const TTL_MS = 30_000;

export function invalidarCacheGateModulos(): void {
  cache.clear();
}

/**
 * Módulos contratados pelo escritório do usuário, ou null quando "tudo
 * liberado" (cortesia, sem plano resolvido, indeterminado). Nunca lança.
 */
export async function modulosContratadosDoUsuario(userId: number): Promise<string[] | null> {
  const agora = Date.now();
  const hit = cache.get(userId);
  if (hit && hit.expiraEm > agora) return hit.modulos;

  let modulos: string[] | null = null;
  try {
    const { getActiveSubscriptionComHeranca } = await import("../db");
    const sub = await getActiveSubscriptionComHeranca(userId);
    if (sub && !sub.cortesia && sub.planId) {
      const { getPlanoBySlug } = await import("../billing/planos-repo");
      const plano = await getPlanoBySlug(sub.planId);
      if (plano && plano.modulosLiberados.length > 0) {
        modulos = plano.modulosLiberados;
        // Módulos avulsos do escritório somam à cesta do plano. Erro aqui
        // só perde o bônus — nunca restringe além do plano.
        try {
          const { getEscritorioPorUsuario } = await import("../escritorio/db-escritorio");
          const vinculo = await getEscritorioPorUsuario(userId);
          if (vinculo) {
            const { modulosAvulsosVigentes } = await import("../billing/modulos-cobranca");
            const avulsos = await modulosAvulsosVigentes(vinculo.escritorio.id);
            if (avulsos.length > 0) modulos = unirModulosContratados(modulos, avulsos);
          }
        } catch {
          // fica só com a lista do plano
        }
      }
    }
  } catch {
    modulos = null; // indeterminado → tudo liberado; o porteiro não derruba ninguém por erro nosso
  }

  // Cache até de null: a resposta "tudo liberado" também não pode custar
  // 2 queries por chamada.
  if (cache.size > 5_000) cache.clear();
  cache.set(userId, { expiraEm: agora + TTL_MS, modulos });
  return modulos;
}

/** Nome humano do módulo pra mensagem de erro. */
function nomeDoModulo(id: string): string {
  return MODULOS_APP.find((m) => m.id === id)?.nome ?? id;
}

/**
 * Corpo do middleware do `protectedProcedure` (recebe path + user já
 * autenticado). Separado do tRPC pra ser testável como função.
 */
export async function conferirModuloDoPath(args: {
  path: string;
  userId: number;
  role: string | null | undefined;
}): Promise<void> {
  const modulo = moduloDoPath(args.path);
  if (!modulo) return;
  if (args.role === "admin") return;

  const contratados = await modulosContratadosDoUsuario(args.userId);
  if (contratoLibera(contratados, [modulo])) return;

  throw new TRPCError({
    code: "FORBIDDEN",
    message: `O módulo "${nomeDoModulo(modulo)}" não faz parte do seu plano.`,
    cause: { motivo: "modulo_nao_liberado", modulo },
  });
}

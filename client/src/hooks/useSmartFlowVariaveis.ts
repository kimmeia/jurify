/**
 * Hook que retorna lista de variáveis disponíveis pro autocomplete
 * `{{...}}` do editor SmartFlow.
 *
 * Quando recebe `gatilhoTipo`, filtra pra variáveis daquele gatilho
 * específico. Sem gatilho, retorna lista achatada de TODAS as variáveis
 * (sem duplicatas) — útil quando ainda não decidiu o gatilho.
 *
 * O catálogo vem do backend via `trpc.smartflow.catalogoVariaveis` —
 * fonte da verdade está em `server/smartflow/interpolar.ts`.
 */

import { trpc } from "@/lib/trpc";
import type { Variavel } from "@/components/VariableInput";

export function useSmartFlowVariaveis(gatilhoTipo?: string): Variavel[] {
  const { data } = (trpc as any).smartflow.catalogoVariaveis.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity, // catálogo é estático — cache eterno
  });

  if (!data) return [];

  if (gatilhoTipo) {
    const cat = data.find((c: any) => c.gatilho === gatilhoTipo);
    return cat?.variaveis || [];
  }

  // Sem filtro: achata todas, removendo duplicatas por path.
  const todas = data.flatMap((c: any) => c.variaveis as Variavel[]);
  const vistos = new Set<string>();
  return todas.filter((v: Variavel) => {
    if (vistos.has(v.path)) return false;
    vistos.add(v.path);
    return true;
  });
}

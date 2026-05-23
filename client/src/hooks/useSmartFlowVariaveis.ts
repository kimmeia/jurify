/**
 * Hook que retorna lista de variáveis disponíveis pro autocomplete
 * `{{...}}` do editor SmartFlow.
 *
 * Duas fontes:
 *  1. Catálogo do backend (`trpc.smartflow.catalogoVariaveis`) — variáveis
 *     do gatilho + campos personalizados do escritório. Fonte da verdade
 *     em `server/smartflow/interpolar.ts`.
 *  2. Context `VariaveisFluxoContext` — quando o editor está montado, ele
 *     provê a lista COMPLETA já mesclada (gatilho + campos personalizados
 *     + variáveis publicadas pelos passos do fluxo). Tem prioridade: se o
 *     context tem itens, usamos ele. Fora do editor, cai no catálogo do
 *     backend (comportamento legado).
 */

import { createContext, useContext } from "react";
import { trpc } from "@/lib/trpc";
import type { Variavel } from "@/components/VariableInput";

/**
 * Variáveis do fluxo atual, providas pelo editor. `null` quando não há
 * editor montado (uso fora do canvas). Lista completa e já filtrada pelo
 * gatilho selecionado + passos adicionados.
 */
export const VariaveisFluxoContext = createContext<Variavel[] | null>(null);

export function useSmartFlowVariaveis(gatilhoTipo?: string): Variavel[] {
  // Prioridade: lista completa do editor (inclui variáveis de passos).
  const doContexto = useContext(VariaveisFluxoContext);

  const { data } = (trpc as any).smartflow.catalogoVariaveis.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity, // catálogo é estático — cache eterno
  });

  if (doContexto && doContexto.length > 0) return doContexto;

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

/**
 * Montagem da lista do Inbox.
 *
 * A conversa aberta fica presa no topo mesmo quando sai do filtro da ABA — ao
 * responder, "aguardando" vira "em atendimento" e ela sumiria da lista embaixo
 * do dedo de quem acabou de escrever.
 *
 * O que ela NÃO pode sobreviver é a troca dos filtros de servidor (atendente,
 * setor, canal, período): esses mudam o universo, não o recorte dele. Filtrar
 * por uma atendente e continuar vendo a conversa de outro atendente — com os
 * contadores zerados ao lado — foi exatamente o bug que originou este módulo.
 */

export type ConversaLista = { id: number; status: string };

export function montarListaInbox<T extends ConversaLista>(args: {
  /** O que o servidor devolveu para os filtros atuais. */
  todas: T[];
  selId: number | null;
  /** Aba de status ativa, ou "todos". */
  aba: string;
  mostrarArquivadas: boolean;
  /** Última versão conhecida da conversa aberta. */
  cache: T | null;
  /** Os filtros de servidor mudaram desde a montagem anterior. */
  filtrosMudaram: boolean;
}): { lista: T[]; cache: T | null } {
  const { todas, selId, aba, mostrarArquivadas, filtrosMudaram } = args;

  // Filtros novos = universo novo. O que estava guardado descreve o universo
  // antigo e não vale mais.
  let cache = filtrosMudaram ? null : args.cache;

  // Status já vem filtrado do servidor; o filtro local é cinto de segurança
  // pro intervalo entre trocar de aba e o refetch chegar.
  let lista =
    aba === "todos" || mostrarArquivadas ? todas : todas.filter((c) => c.status === aba);

  if (selId == null) return { lista, cache: null };

  const noServidor = todas.find((c) => c.id === selId) ?? null;
  if (noServidor) cache = noServidor;
  else if (cache?.id !== selId) cache = null;

  if (!lista.some((c) => c.id === selId)) {
    const aberta = noServidor ?? (cache?.id === selId ? cache : null);
    if (aberta) lista = [aberta, ...lista];
  }

  return { lista, cache };
}

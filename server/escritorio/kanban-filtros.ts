/**
 * Filtros dos cards do Kanban — compartilhados entre o quadro (`obterFunil`)
 * e o export em PDF.
 *
 * Moram aqui porque as duas telas precisam filtrar EXATAMENTE igual: se o
 * PDF aplicar uma regra a mais ou a menos, o usuário vê 22 cards na tela e
 * exporta 30, e aí não confia mais no arquivo.
 */

import { and, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { kanbanCards } from "../../drizzle/schema";

export interface FiltrosCards {
  responsavelId?: number;
  prioridade?: "baixa" | "media" | "alta";
  prazoFiltro?: "vencidos" | "hoje" | "7dias" | "sem_prazo";
  /** YYYY-MM-DD — data de criação do card. */
  dataInicio?: string;
  dataFim?: string;
  mostrarArquivados?: boolean;
}

/** Bordas de "hoje" e "próximos 7 dias" no fuso do servidor. */
export function boundsPrazo(agora = new Date()) {
  const hoje = new Date(agora);
  hoje.setHours(0, 0, 0, 0);
  const fimHoje = new Date(hoje);
  fimHoje.setHours(23, 59, 59, 999);
  const fim7 = new Date(hoje);
  fim7.setDate(fim7.getDate() + 7);
  fim7.setHours(23, 59, 59, 999);
  return { hoje, fimHoje, fim7 };
}

/**
 * Condições SQL dos filtros de card. `colunasIds` restringe ao funil; passar
 * `undefined` abre pra todos os funis do escritório (usado no export).
 */
export function condicoesCards(args: {
  escritorioId: number;
  colunasIds?: number[];
  filtros: FiltrosCards;
  /** Quando o usuário só enxerga os próprios, trava no colaborador dele. */
  travarNoColaborador?: number | null;
  agora?: Date;
}): any[] {
  const { escritorioId, colunasIds, filtros, travarNoColaborador, agora } = args;
  const { hoje, fimHoje, fim7 } = boundsPrazo(agora);

  const conds: any[] = [eq(kanbanCards.escritorioId, escritorioId)];
  if (colunasIds) conds.push(inArray(kanbanCards.colunaId, colunasIds));
  if (!filtros.mostrarArquivados) conds.push(eq(kanbanCards.arquivado, false));

  // verProprios sobrepõe o filtro escolhido — senão o usuário escaparia da
  // restrição só trocando o select de responsável.
  if (travarNoColaborador != null) {
    conds.push(eq(kanbanCards.responsavelId, travarNoColaborador));
  } else if (filtros.responsavelId) {
    conds.push(eq(kanbanCards.responsavelId, filtros.responsavelId));
  }

  if (filtros.prioridade) conds.push(eq(kanbanCards.prioridade, filtros.prioridade));
  if (filtros.dataInicio) {
    conds.push(gte(kanbanCards.createdAt, new Date(`${filtros.dataInicio}T00:00:00`)));
  }
  if (filtros.dataFim) {
    conds.push(lte(kanbanCards.createdAt, new Date(`${filtros.dataFim}T23:59:59`)));
  }

  if (filtros.prazoFiltro === "vencidos") {
    conds.push(and(sql`${kanbanCards.prazo} IS NOT NULL`, lt(kanbanCards.prazo, hoje)));
  } else if (filtros.prazoFiltro === "hoje") {
    conds.push(and(gte(kanbanCards.prazo, hoje), lte(kanbanCards.prazo, fimHoje)));
  } else if (filtros.prazoFiltro === "7dias") {
    conds.push(and(gte(kanbanCards.prazo, hoje), lte(kanbanCards.prazo, fim7)));
  } else if (filtros.prazoFiltro === "sem_prazo") {
    conds.push(sql`${kanbanCards.prazo} IS NULL`);
  }

  return conds;
}

/**
 * Busca textual do quadro — título, nome do cliente ou tags. Vive em JS (e
 * não em SQL) porque `clienteNome` e as tags resolvidas só existem depois do
 * enriquecimento; o quadro filtra assim e o PDF precisa filtrar igual.
 */
export function casaBusca(
  card: { titulo?: string | null; clienteNome?: string | null; tags?: string | null },
  busca: string | undefined,
): boolean {
  const q = (busca ?? "").trim().toLowerCase();
  if (!q) return true;
  return (
    (card.titulo || "").toLowerCase().includes(q)
    || (card.clienteNome || "").toLowerCase().includes(q)
    || (card.tags || "").toLowerCase().includes(q)
  );
}

/** Filtro por tag exata (a mesma regra do quadro: lista separada por vírgula). */
export function casaTag(card: { tags?: string | null }, tag: string | undefined): boolean {
  const alvo = tag?.trim().toLowerCase();
  if (!alvo) return true;
  return (card.tags || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(alvo);
}

/**
 * Recorte de colunas pedido pelo cliente, aplicado sobre a lista que a query
 * já provou pertencer ao escritório.
 *
 * Levar os ids direto pro WHERE deixaria qualquer um exportar coluna alheia
 * chutando número. Aqui, id de fora simplesmente não casa e some. Lista
 * ausente ou vazia = sem recorte, que é o comportamento de antes do seletor.
 */
export function recortarColunas<T extends { id: number }>(
  colunas: T[],
  ids: number[] | undefined,
): T[] {
  if (!ids?.length) return colunas;
  const alvo = new Set(ids);
  return colunas.filter((c) => alvo.has(c.id));
}

/**
 * Como o recorte aparece no cabeçalho do PDF. Sem essa linha, dois PDFs do
 * mesmo funil com recortes diferentes ficam indistinguíveis depois de
 * impressos — que é justamente o uso do recorte.
 */
export function rotuloColunas(
  colunas: Array<{ nome: string }>,
  escolhidas: Array<{ nome: string }>,
): string {
  if (escolhidas.length === 0) return "Nenhuma";
  if (escolhidas.length === colunas.length) return "Todas";
  return escolhidas.map((c) => c.nome).join(", ");
}

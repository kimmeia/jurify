/**
 * Desempenho de um colaborador no período.
 *
 * Este arquivo existe por uma razão só: o mesmo número aparece em dois lugares
 * — a tabela por atendente do relatório de Atendimento e a ficha da pessoa no
 * RH — e um escritório que lê "Reginaldo: 12 ganhos" num lugar e "10" no outro
 * para de confiar nos dois. As CONSULTAS são diferentes (uma varre o
 * escritório, a outra recorta uma competência), mas a REGRA de como as linhas
 * viram números mora aqui, e por isso não tem como divergir.
 *
 * As duas decisões que a regra carrega:
 *
 *  - a etapa do funil decide o balde. `fechado_ganho` e `fechado_perdido` são
 *    desfechos; todo o resto é negociação viva, e vai pra "em aberto" — não
 *    existe uma quarta gaveta;
 *  - a taxa de conversão é ganhos ÷ ATENDIMENTOS, não ganhos ÷ (ganhos +
 *    perdidos). O segundo ignora quem está em aberto e dá 100% pra quem fechou
 *    um caso e não perdeu nenhum. É a mesma base do KPI do relatório.
 */

export type EtapaFunil =
  | "novo"
  | "qualificado"
  | "proposta"
  | "negociacao"
  | "fechado_ganho"
  | "fechado_perdido";

export type BaldeFunil = "ganhos" | "perdidos" | "emAberto";

/** Em que balde a etapa cai. Etapa desconhecida conta como negociação viva —
 *  sumir com ela faria o total da tabela não bater com a soma das partes. */
export function baldeDaEtapa(etapa: string): BaldeFunil {
  if (etapa === "fechado_ganho") return "ganhos";
  if (etapa === "fechado_perdido") return "perdidos";
  return "emAberto";
}

/**
 * Ganhos ÷ atendimentos, em %.
 *
 * null quando não houve atendimento: 0% diria "atendeu e não fechou nada",
 * e o que aconteceu foi não ter atendido ninguém.
 */
export function taxaDeConversao(ganhos: number, atendimentos: number): number | null {
  return atendimentos > 0 ? Math.round((ganhos / atendimentos) * 100) : null;
}

export interface Desempenho {
  /** Conversas atendidas no período. */
  atendimentos: number;
  /** Oportunidades tocadas: criadas OU fechadas no período. */
  oportunidades: number;
  ganhos: number;
  perdidos: number;
  emAberto: number;
  valorFechado: number;
  /** ganhos ÷ atendimentos, em %. null sem atendimento. */
  taxaConversao: number | null;
  /** Compromissos de agenda sob responsabilidade da pessoa, no período. */
  agendamentos: number;
  /** Quantos deles foram concluídos. */
  agendamentosConcluidos: number;
  /** Mediana do tempo até a primeira resposta, em segundos. null sem dado. */
  segPrimeiraResposta: number | null;
}

export const DESEMPENHO_VAZIO: Desempenho = {
  atendimentos: 0,
  oportunidades: 0,
  ganhos: 0,
  perdidos: 0,
  emAberto: 0,
  valorFechado: 0,
  taxaConversao: null,
  agendamentos: 0,
  agendamentosConcluidos: 0,
  segPrimeiraResposta: null,
};

/** Uma linha do agrupamento por etapa, como o SQL devolve. */
export interface LinhaPorEtapa {
  etapa: string;
  total: number;
  valor: number;
}

/**
 * Dobra as linhas agrupadas por etapa num desempenho.
 *
 * `valorFechado` soma só o balde de ganhos: somar o valor ESTIMADO de quem
 * ainda não fechou daria um faturamento que não existe, e é o tipo de número
 * que vira meta.
 */
export function agregarDesempenho(
  linhas: LinhaPorEtapa[],
  extras: Partial<Omit<Desempenho, "oportunidades" | "ganhos" | "perdidos" | "emAberto" | "valorFechado" | "taxaConversao">> = {},
): Desempenho {
  const d: Desempenho = { ...DESEMPENHO_VAZIO, ...extras };

  for (const l of linhas) {
    const total = Number(l.total) || 0;
    const valor = Number(l.valor) || 0;
    d.oportunidades += total;
    const balde = baldeDaEtapa(l.etapa);
    d[balde] += total;
    if (balde === "ganhos") d.valorFechado += valor;
  }

  d.taxaConversao = taxaDeConversao(d.ganhos, d.atendimentos);
  return d;
}

/** "1h47", "24min". null vira travessão na tela. */
export function formatarEspera(segundos: number | null): string {
  if (segundos == null || !Number.isFinite(segundos) || segundos <= 0) return "—";
  const min = Math.round(segundos / 60);
  if (min < 60) return `${min}min`;
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;
}

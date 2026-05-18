/**
 * Helpers puros do Dashboard por setor.
 *
 * Funções sem dependência de DB — extraídas das procedures pra serem
 * testáveis em isolamento. Cobre cálculos de:
 *   - % progresso da meta comercial (proporcional ao range)
 *   - % inadimplência (por valor e por cliente)
 *   - Classificação de tarefa/agenda por prazo
 */

/**
 * Calcula a meta proporcional ao range de datas.
 *
 * Meta mensal cheia é considerada como referência. Se o range é apenas
 * parte do mês (ex: 1-15 de maio), retorna `meta * (15/31)` — assim o
 * percentual de progresso reflete o esperado pra essa parcela do mês.
 *
 * Usa `dataInicio.getMonth()` pra determinar quantos dias o mês tem.
 * Em ranges cross-mês (ex: 25 abr → 5 mai), usa o mês de `dataInicio`
 * como aproximação (mesma decisão de `metaProporcionalPeriodo` no
 * router-relatorios).
 */
export function proporcionalizarMeta(
  metaTotal: number | null,
  dataInicio: Date,
  dataFim: Date,
): number | null {
  if (metaTotal == null || metaTotal <= 0) return null;
  const diasNoMes = new Date(
    dataInicio.getFullYear(),
    dataInicio.getMonth() + 1,
    0,
  ).getDate();
  const diasNoRange = Math.max(
    1,
    Math.round((dataFim.getTime() - dataInicio.getTime()) / (1000 * 60 * 60 * 24)) + 1,
  );
  const fracao = Math.min(1, diasNoRange / diasNoMes);
  return +(metaTotal * fracao).toFixed(2);
}

/**
 * Calcula o % de progresso em relação à meta.
 *
 * Retorna null quando não há meta configurada (frontend mostra "sem meta"
 * em vez de "0%"). Mantém o sinal/valor mesmo se ultrapassou 100%
 * (estouro positivo é informação útil).
 */
export function calcularProgressoMeta(
  faturado: number,
  metaPeriodo: number | null,
): number | null {
  if (metaPeriodo == null || metaPeriodo <= 0) return null;
  return +((faturado / metaPeriodo) * 100).toFixed(1);
}

/**
 * % inadimplência por valor: vencido / total esperado no período.
 *
 * "Total esperado" = valor recebido COM vencimento no período + valor vencido.
 * Não inclui "pendente" (que tem venc futuro — ainda não é inadimplência).
 */
export function percentInadimplenciaPorValor(
  vencido: number,
  totalEsperadoNoPeriodo: number,
): number {
  if (totalEsperadoNoPeriodo <= 0) return 0;
  return +((vencido / totalEsperadoNoPeriodo) * 100).toFixed(1);
}

/**
 * % inadimplência por cliente: clientes com vencido / clientes com cobrança.
 */
export function percentInadimplenciaPorCliente(
  inadimplentes: number,
  comCobranca: number,
): number {
  if (comCobranca <= 0) return 0;
  return +((inadimplentes / comCobranca) * 100).toFixed(1);
}

export type StatusTarefa = "pendente" | "em_andamento" | "concluida" | "cancelada";
export type ClassificacaoPrazo = "no_prazo" | "atrasada" | "concluida_no_prazo" | "concluida_fora" | "cancelada";

/**
 * Classifica uma tarefa quanto ao prazo.
 *
 *  - pendente/em_andamento + venc >= agora => no_prazo
 *  - pendente/em_andamento + venc < agora  => atrasada
 *  - concluida + concluidaAt <= venc       => concluida_no_prazo
 *  - concluida + concluidaAt > venc        => concluida_fora
 *  - cancelada                              => cancelada
 *
 *  Sem `dataVencimento`, tarefas pendentes contam como no_prazo (não dá
 *  pra atrasar algo sem prazo).
 */
export function classificarTarefaPrazo(
  status: StatusTarefa,
  dataVencimento: Date | null,
  concluidaAt: Date | null,
  agora: Date,
): ClassificacaoPrazo {
  if (status === "cancelada") return "cancelada";
  if (status === "concluida") {
    if (!dataVencimento) return "concluida_no_prazo";
    if (!concluidaAt) return "concluida_no_prazo"; // sem registro, assume ok
    return concluidaAt.getTime() <= dataVencimento.getTime()
      ? "concluida_no_prazo"
      : "concluida_fora";
  }
  // pendente / em_andamento
  if (!dataVencimento) return "no_prazo";
  return dataVencimento.getTime() >= agora.getTime() ? "no_prazo" : "atrasada";
}

/**
 * Taxa de tarefas concluídas no prazo.
 *
 * Considera apenas tarefas concluídas (no_prazo ou fora). Retorna null
 * quando não há tarefa concluída no período (frontend mostra "—" em vez
 * de "100%" enganoso).
 */
export function taxaConclusaoNoPrazo(
  concluidasNoPrazo: number,
  concluidasFora: number,
): number | null {
  const total = concluidasNoPrazo + concluidasFora;
  if (total <= 0) return null;
  return +((concluidasNoPrazo / total) * 100).toFixed(1);
}

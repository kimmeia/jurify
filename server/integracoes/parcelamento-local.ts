/**
 * Helpers do parcelamento "local" (N cobranças avulsas em vez do
 * /installments do Asaas). Lógica isolada pra ficar testável sem
 * mockar DB ou cliente do Asaas.
 *
 * Decisão de design: o resíduo de divisão (centavos que sobram quando
 * o total não divide igualmente pelo nº de parcelas) cai SEMPRE na
 * última parcela, não é distribuído. Vantagem: parcela 1..N-1 ficam
 * com valor "redondo" (R$ 333.33, R$ 333.33...) e a última absorve
 * (R$ 333.34). Distribuir centavos espalhados confunde o cliente em
 * comprovantes.
 */

export interface ParcelaCalculada {
  parcelaAtual: number;
  parcelaTotal: number;
  valor: number;
  /** Vencimento em formato ISO YYYY-MM-DD */
  vencimento: string;
}

/**
 * Adiciona N meses a uma data YYYY-MM-DD, ajustando pro último dia do mês
 * quando o dia original não existe (31/01 + 1 mês = 28/02 ou 29/02).
 */
export function addMonthsIso(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const tM = (m - 1 + months) % 12;
  const tY = y + Math.floor((m - 1 + months) / 12);
  const lastDay = new Date(tY, tM + 1, 0).getDate();
  return `${tY}-${String(tM + 1).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}

/**
 * Calcula as N parcelas de um parcelamento local. Resíduo cai na última.
 */
export function calcularParcelas(
  valorTotal: number,
  parcelas: number,
  vencimentoBase: string,
): ParcelaCalculada[] {
  if (parcelas < 2 || parcelas > 24) {
    throw new Error(`Número de parcelas inválido: ${parcelas} (esperado 2-24)`);
  }
  if (valorTotal <= 0) {
    throw new Error(`Valor total inválido: ${valorTotal}`);
  }

  // Trabalha em centavos pra evitar erro de ponto flutuante.
  const totalCents = Math.round(valorTotal * 100);
  const baseCents = Math.floor(totalCents / parcelas);
  const residuoCents = totalCents - baseCents * parcelas;

  const result: ParcelaCalculada[] = [];
  for (let i = 0; i < parcelas; i++) {
    const parcelaAtual = i + 1;
    const ehUltima = parcelaAtual === parcelas;
    const valorCents = ehUltima ? baseCents + residuoCents : baseCents;
    result.push({
      parcelaAtual,
      parcelaTotal: parcelas,
      valor: valorCents / 100,
      vencimento: addMonthsIso(vencimentoBase, i),
    });
  }
  return result;
}

/**
 * Engine de Cálculo do FGTS
 *
 * Calcula o saldo do FGTS por período (mês a mês), aplicando:
 * - Depósito mensal: 8% sobre remuneração (salário + horas extras + adicionais)
 * - Correção pela TR (Taxa Referencial) — simplificado: 3% a.a. ≈ 0.2466% a.m.
 * - Juros de 3% a.a. sobre o saldo (creditados mensalmente)
 * - Multa rescisória: 40% (sem justa causa / rescisão indireta) ou 20% (acordo mútuo)
 *
 * Referência legal:
 * - Lei 8.036/1990 (Lei do FGTS)
 * - Art. 18 § 1º (multa de 40%)
 * - Art. 484-A CLT (acordo mútuo — multa 20%)
 */

const TAXA_JUROS_MENSAL = 0.002466; // 3% a.a. ÷ 12 (simplificado, sem TR variável)
const ALIQUOTA_DEPOSITO = 0.08;     // 8% sobre remuneração

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface PeriodoFGTS {
  mesAno: string;           // "YYYY-MM"
  salarioBase: number;      // Salário base do mês
  horasExtras?: number;     // Valor de horas extras pagas no mês (R$)
  adicionais?: number;      // Outros adicionais habituais (R$)
}

export type TipoMultaFGTS =
  | "sem_justa_causa"       // 40%
  | "rescisao_indireta"     // 40%
  | "acordo_mutuo"          // 20%
  | "sem_multa";            // Pedido de demissão, justa causa, término

export interface ParametrosFGTS {
  periodos: PeriodoFGTS[];
  tipoMulta: TipoMultaFGTS;
  saldoAnterior?: number;   // Saldo FGTS antes do primeiro período informado
}

export interface ResultadoPeriodoFGTS {
  mesAno: string;
  remuneracao: number;      // Base de cálculo do depósito
  deposito: number;         // 8% sobre remuneração
  juros: number;            // Juros do mês sobre saldo acumulado
  saldoFinal: number;       // Saldo ao final do mês
}

export interface ResultadoFGTS {
  periodos: ResultadoPeriodoFGTS[];
  saldoAnterior: number;
  totalDepositos: number;
  totalJuros: number;
  saldoTotal: number;
  multaPercentual: number;  // 0, 20 ou 40
  valorMulta: number;
  totalAReceber: number;    // Saldo + multa
  protocoloCalculo: string;
}

export function calcularFGTS(params: ParametrosFGTS): ResultadoFGTS {
  const { periodos, tipoMulta, saldoAnterior = 0 } = params;

  // Ordenar períodos cronologicamente
  const periodosOrdenados = [...periodos].sort((a, b) => a.mesAno.localeCompare(b.mesAno));

  let saldoAcumulado = saldoAnterior;
  let totalDepositos = 0;
  let totalJuros = 0;

  const resultadosPeriodos: ResultadoPeriodoFGTS[] = periodosOrdenados.map((p) => {
    const remuneracao = r2(
      p.salarioBase + (p.horasExtras ?? 0) + (p.adicionais ?? 0)
    );
    const deposito = r2(remuneracao * ALIQUOTA_DEPOSITO);

    // Juros sobre saldo anterior (antes do depósito do mês)
    const juros = r2(saldoAcumulado * TAXA_JUROS_MENSAL);

    saldoAcumulado = r2(saldoAcumulado + juros + deposito);
    totalDepositos = r2(totalDepositos + deposito);
    totalJuros = r2(totalJuros + juros);

    return {
      mesAno: p.mesAno,
      remuneracao,
      deposito,
      juros,
      saldoFinal: saldoAcumulado,
    };
  });

  // Multa rescisória
  let multaPercentual = 0;
  if (tipoMulta === "sem_justa_causa" || tipoMulta === "rescisao_indireta") {
    multaPercentual = 40;
  } else if (tipoMulta === "acordo_mutuo") {
    multaPercentual = 20;
  }

  const valorMulta = r2(saldoAcumulado * (multaPercentual / 100));
  const totalAReceber = r2(saldoAcumulado + valorMulta);

  // Protocolo único
  const protocolo = `FGTS-${Date.now().toString(36).toUpperCase()}`;

  return {
    periodos: resultadosPeriodos,
    saldoAnterior,
    totalDepositos,
    totalJuros,
    saldoTotal: saldoAcumulado,
    multaPercentual,
    valorMulta,
    totalAReceber,
    protocoloCalculo: protocolo,
  };
}

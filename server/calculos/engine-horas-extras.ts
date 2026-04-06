/**
 * Engine de Cálculo de Horas Extras v2
 *
 * Correções v2:
 * - DSR calculado por período com dias úteis e domingos reais do mês (OJ 394 SDI-1 TST)
 * - Reflexos em férias e 13º incidem sobre (HE + DSR), não apenas HE
 * - FGTS incide sobre (HE + DSR) conforme Súmula 63 TST
 * - Detalhamento inclui DSR por período
 *
 * Calcula horas extras com reflexos conforme CLT:
 * - Horas extras a 50% (dias úteis)
 * - Horas extras a 100% (domingos e feriados)
 * - Adicional noturno (20% sobre hora diurna, Art. 73 CLT)
 * - DSR sobre horas extras (Súmula 172 TST)
 * - Reflexos: férias + 1/3, 13º, FGTS
 */

import {
  type ParametrosHorasExtras,
  type ResultadoHorasExtras,
  type DetalhePeriodoHE,
  type ReflexoHorasExtras,
} from "../../shared/trabalhista-types";
import { randomBytes } from "crypto";

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Helpers de Calendário ────────────────────────────────────────────────────

/**
 * Retorna dias úteis e domingos de um mês (YYYY-MM).
 * Tribunais aceitam contagem sem feriados (não há base de feriados universal).
 */
function diasUteisMes(mesAno: string): { diasUteis: number; domingos: number } {
  const [year, month] = mesAno.split("-").map(Number);
  const diasNoMes = new Date(year, month, 0).getDate();
  let domingos = 0;
  for (let d = 1; d <= diasNoMes; d++) {
    if (new Date(year, month - 1, d).getDay() === 0) domingos++;
  }
  return { diasUteis: diasNoMes - domingos, domingos };
}

// ─── Engine Principal ─────────────────────────────────────────────────────────

export function calcularHorasExtras(params: ParametrosHorasExtras): ResultadoHorasExtras {
  const { salarioBruto, cargaHorariaMensal, periodos, incluirAdicionalNoturno } = params;

  // Valores de referência (baseados no salário informado no cabeçalho)
  const valorHoraNormal = r2(salarioBruto / cargaHorariaMensal);
  const valorHoraExtra50 = r2(valorHoraNormal * 1.5);
  const valorHoraExtra100 = r2(valorHoraNormal * 2.0);
  const valorHoraNoturna = r2(valorHoraNormal * 1.2);

  // Detalhamento por período
  const detalhamentoPeriodos: DetalhePeriodoHE[] = [];
  let totalHorasExtras50 = 0;
  let totalHorasExtras100 = 0;
  let totalHorasNoturnas = 0;
  let totalValorHorasExtras = 0;
  let totalAdicionalNoturno = 0;
  let totalDSR = 0;

  for (const periodo of periodos) {
    const salarioBase = periodo.salarioBase || salarioBruto;
    const vhn = r2(salarioBase / cargaHorariaMensal);
    const vhe50 = r2(vhn * 1.5);
    const vhe100 = r2(vhn * 2.0);

    const valorExtras50 = r2(periodo.horasExtras50 * vhe50);
    const valorExtras100 = r2(periodo.horasExtras100 * vhe100);
    const horasNoturnas = incluirAdicionalNoturno ? (periodo.horasNoturnas || 0) : 0;
    const valorAdicionalNoturno = r2(horasNoturnas * vhn * 0.2);

    // Total de HE + adicional noturno no período (sem DSR)
    const totalHEPeriodo = r2(valorExtras50 + valorExtras100 + valorAdicionalNoturno);

    // DSR por período: (valor HE do mês / dias úteis) × domingos
    // Conforme Súmula 172 TST e OJ 394 SDI-1 TST
    const { diasUteis, domingos } = diasUteisMes(periodo.mesAno);
    const dsrPeriodo = diasUteis > 0 ? r2(totalHEPeriodo / diasUteis * domingos) : 0;

    const totalPeriodo = r2(totalHEPeriodo + dsrPeriodo);

    detalhamentoPeriodos.push({
      mesAno: periodo.mesAno,
      salarioBase,
      valorHoraNormal: vhn,
      horasExtras50: periodo.horasExtras50,
      valorExtras50,
      horasExtras100: periodo.horasExtras100,
      valorExtras100,
      horasNoturnas,
      valorAdicionalNoturno,
      totalPeriodo,
    });

    totalHorasExtras50 += periodo.horasExtras50;
    totalHorasExtras100 += periodo.horasExtras100;
    totalHorasNoturnas += horasNoturnas;
    totalValorHorasExtras += valorExtras50 + valorExtras100;
    totalAdicionalNoturno += valorAdicionalNoturno;
    totalDSR += dsrPeriodo;
  }

  totalHorasExtras50 = r2(totalHorasExtras50);
  totalHorasExtras100 = r2(totalHorasExtras100);
  totalHorasNoturnas = r2(totalHorasNoturnas);
  totalValorHorasExtras = r2(totalValorHorasExtras);
  totalAdicionalNoturno = r2(totalAdicionalNoturno);
  totalDSR = r2(totalDSR);

  // Total sem reflexos (HE + adicional noturno — sem DSR)
  const totalGeral = r2(totalValorHorasExtras + totalAdicionalNoturno);

  // ─── Reflexos ─────────────────────────────────────────────────────────────
  // Base para reflexos = HE + DSR (Súmula 172 TST: DSR integra base de cálculo)
  const baseReflexos = r2(totalGeral + totalDSR);
  const numMeses = periodos.length || 1;

  // Média mensal com DSR
  const mediaMensal = r2(baseReflexos / numMeses);

  // Reflexo em Férias + 1/3 constitucional
  // férias proporcionais = média mensal × avos/12, avos = numMeses
  const feriasBase = r2(mediaMensal * numMeses / 12);
  const reflexoFerias = r2(feriasBase + r2(feriasBase / 3));

  // Reflexo em 13º: média mensal × avos/12
  const reflexo13Salario = r2(mediaMensal * numMeses / 12);

  // FGTS: 8% sobre (HE + DSR) — Súmula 63 TST
  const reflexoFGTS = r2(baseReflexos * 0.08);

  const totalReflexos = r2(reflexoFerias + reflexo13Salario + reflexoFGTS + totalDSR);

  const reflexos: ReflexoHorasExtras = {
    reflexoFerias,
    reflexo13Salario,
    reflexoFGTS,
    reflexoDSR: totalDSR,
    totalReflexos,
  };

  const totalComReflexos = r2(totalGeral + totalReflexos);

  const protocolo = `TRAB-HE-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${randomBytes(3).toString("hex").toUpperCase()}`;

  return {
    valorHoraNormal,
    valorHoraExtra50,
    valorHoraExtra100,
    valorHoraNoturna,
    detalhamentoPeriodos,
    totalHorasExtras50,
    totalHorasExtras100,
    totalHorasNoturnas,
    totalValorHorasExtras,
    totalAdicionalNoturno,
    totalGeral,
    reflexos,
    totalComReflexos,
    protocoloCalculo: protocolo,
  };
}

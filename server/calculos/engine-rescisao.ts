/**
 * Engine de Cálculo de Rescisão Trabalhista
 * 
 * Calcula todas as verbas rescisórias conforme CLT:
 * - Saldo de salário
 * - Aviso prévio (proporcional ao tempo de serviço)
 * - 13º salário proporcional
 * - Férias proporcionais + 1/3
 * - Férias vencidas + 1/3
 * - FGTS + multa 40% (ou 20% acordo mútuo)
 * - Descontos: INSS, IRRF, adiantamentos
 */

import {
  type ParametrosRescisao,
  type ResultadoRescisao,
  type VerbaRescisoria,
  TABELA_INSS_2025,
  TABELA_IR_2025,
  DEDUCAO_DEPENDENTE_IR,
} from "../../shared/trabalhista-types";
import { randomBytes } from "crypto";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function diffDays(start: string, end: string): number {
  const d1 = new Date(start + "T00:00:00");
  const d2 = new Date(end + "T00:00:00");
  return Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

function calcularTempoServico(dataAdmissao: string, dataDesligamento: string) {
  const adm = new Date(dataAdmissao + "T00:00:00");
  const desl = new Date(dataDesligamento + "T00:00:00");

  let anos = desl.getFullYear() - adm.getFullYear();
  let meses = desl.getMonth() - adm.getMonth();
  let dias = desl.getDate() - adm.getDate();

  if (dias < 0) {
    meses--;
    const lastMonth = new Date(desl.getFullYear(), desl.getMonth(), 0);
    dias += lastMonth.getDate();
  }
  if (meses < 0) {
    anos--;
    meses += 12;
  }

  const totalDias = diffDays(dataAdmissao, dataDesligamento);

  return { anos, meses, dias, totalDias };
}

// ─── Cálculo INSS Progressivo ─────────────────────────────────────────────────

export function calcularINSS(salarioBruto: number): number {
  let inss = 0;
  let anterior = 0;

  for (const faixa of TABELA_INSS_2025) {
    const base = Math.min(salarioBruto, faixa.ate) - anterior;
    if (base <= 0) break;
    inss += base * (faixa.aliquota / 100);
    anterior = faixa.ate;
  }

  // Teto INSS
  const tetoINSS = TABELA_INSS_2025.reduce((acc, f, i) => {
    const prev = i > 0 ? TABELA_INSS_2025[i - 1].ate : 0;
    return acc + (f.ate - prev) * (f.aliquota / 100);
  }, 0);

  return r2(Math.min(inss, tetoINSS));
}

// ─── Cálculo IRRF ─────────────────────────────────────────────────────────────

export function calcularIRRF(baseCalculo: number, dependentes: number = 0): number {
  const deducaoDependentes = dependentes * DEDUCAO_DEPENDENTE_IR;
  const base = baseCalculo - deducaoDependentes;

  if (base <= 0) return 0;

  for (const faixa of TABELA_IR_2025) {
    if (base <= faixa.ate) {
      const ir = base * (faixa.aliquota / 100) - faixa.deducao;
      return r2(Math.max(ir, 0));
    }
  }

  // Última faixa
  const ultima = TABELA_IR_2025[TABELA_IR_2025.length - 1];
  return r2(base * (ultima.aliquota / 100) - ultima.deducao);
}

// ─── Aviso Prévio Proporcional ────────────────────────────────────────────────

function calcularDiasAvisoPrevio(anosServico: number): number {
  // Art. 7º, XXI CF + Lei 12.506/2011
  // 30 dias + 3 dias por ano de serviço, máximo 90 dias
  const diasAdicionais = Math.min(anosServico * 3, 60);
  return 30 + diasAdicionais;
}

// ─── Remuneração Média ────────────────────────────────────────────────────────

function calcularRemuneracaoMedia(params: ParametrosRescisao): number {
  let media = params.salarioBruto;
  if (params.mediaHorasExtras) media += params.mediaHorasExtras;
  if (params.mediaComissoes) media += params.mediaComissoes;
  return media;
}

// ─── Motor Principal ──────────────────────────────────────────────────────────

export function calcularRescisao(params: ParametrosRescisao): ResultadoRescisao {
  const verbas: VerbaRescisoria[] = [];
  const tempoServico = calcularTempoServico(params.dataAdmissao, params.dataDesligamento);
  const remuneracaoMedia = calcularRemuneracaoMedia(params);
  const salarioDia = remuneracaoMedia / 30;

  // ─── 1. Saldo de Salário ────────────────────────────────────────────────────
  const dataDesl = new Date(params.dataDesligamento + "T00:00:00");
  const diasTrabalhados = dataDesl.getDate();
  const saldoSalario = r2(salarioDia * diasTrabalhados);

  verbas.push({
    descricao: `Saldo de Salário (${diasTrabalhados} dias)`,
    tipo: "provento",
    valor: saldoSalario,
    fundamentoLegal: "Art. 462, CLT",
    detalhes: `${diasTrabalhados}/30 avos do salário`,
  });

  // ─── 2. Aviso Prévio ───────────────────────────────────────────────────────
  let diasAvisoPrevio = 0;
  let valorAvisoPrevio = 0;

  const temDireitoAvisoPrevio = ["sem_justa_causa", "rescisao_indireta"].includes(params.tipoRescisao);
  const temDireitoAvisoPrevioParcial = params.tipoRescisao === "acordo_mutuo";

  if (temDireitoAvisoPrevio && params.avisoPrevioIndenizado) {
    diasAvisoPrevio = calcularDiasAvisoPrevio(tempoServico.anos);
    valorAvisoPrevio = r2(remuneracaoMedia * diasAvisoPrevio / 30);
    verbas.push({
      descricao: `Aviso Prévio Indenizado (${diasAvisoPrevio} dias)`,
      tipo: "provento",
      valor: valorAvisoPrevio,
      fundamentoLegal: "Art. 487, §1º CLT + Lei 12.506/2011",
      detalhes: `30 dias + ${diasAvisoPrevio - 30} dias proporcionais`,
    });
  } else if (temDireitoAvisoPrevioParcial && params.avisoPrevioIndenizado) {
    // Acordo mútuo: 50% do aviso prévio
    diasAvisoPrevio = calcularDiasAvisoPrevio(tempoServico.anos);
    valorAvisoPrevio = r2(remuneracaoMedia * diasAvisoPrevio / 30 * 0.5);
    verbas.push({
      descricao: `Aviso Prévio Indenizado — 50% (${diasAvisoPrevio} dias × 50%)`,
      tipo: "provento",
      valor: valorAvisoPrevio,
      fundamentoLegal: "Art. 484-A, I, 'a', CLT",
      detalhes: "Acordo mútuo: metade do aviso prévio indenizado",
    });
  }

  // Projeção do aviso prévio para cálculo de férias e 13º
  const dataProjetada = new Date(params.dataDesligamento + "T00:00:00");
  if (params.avisoPrevioIndenizado && diasAvisoPrevio > 0) {
    dataProjetada.setDate(dataProjetada.getDate() + diasAvisoPrevio);
  }

  // ─── 3. 13º Salário Proporcional ───────────────────────────────────────────
  const temDireito13 = params.tipoRescisao !== "justa_causa";
  if (temDireito13) {
    // Meses trabalhados no ano (>= 15 dias no mês conta como mês cheio)
    const mesProjetado = dataProjetada.getMonth(); // 0-indexed
    const diaProjetado = dataProjetada.getDate();
    let avos13 = mesProjetado; // Janeiro = 0 avos, etc.
    if (diaProjetado >= 15) avos13++;
    avos13 = Math.min(avos13, 12);

    if (avos13 > 0) {
      const valor13 = r2(remuneracaoMedia * avos13 / 12);
      verbas.push({
        descricao: `13º Salário Proporcional (${avos13}/12 avos)`,
        tipo: "provento",
        valor: valor13,
        fundamentoLegal: "Lei 4.090/1962 + Art. 7º, VIII, CF",
      });
    }
  }

  // ─── 4. Férias Proporcionais + 1/3 ─────────────────────────────────────────
  const temDireitoFeriasProporcionais = params.tipoRescisao !== "justa_causa";
  if (temDireitoFeriasProporcionais) {
    // Calcular meses desde último período aquisitivo
    const admissao = new Date(params.dataAdmissao + "T00:00:00");
    
    // Encontrar o último aniversário de admissão antes da data projetada
    let ultimoAniversario = new Date(admissao);
    while (true) {
      const proximo = new Date(ultimoAniversario);
      proximo.setFullYear(proximo.getFullYear() + 1);
      if (proximo > dataProjetada) break;
      ultimoAniversario = proximo;
    }

    // Meses proporcionais desde o último aniversário
    let mesesProporcionais = (dataProjetada.getFullYear() - ultimoAniversario.getFullYear()) * 12 +
      (dataProjetada.getMonth() - ultimoAniversario.getMonth());
    if (dataProjetada.getDate() >= 15 && dataProjetada.getDate() > ultimoAniversario.getDate()) {
      mesesProporcionais++;
    }
    mesesProporcionais = Math.min(Math.max(mesesProporcionais, 0), 12);

    if (mesesProporcionais > 0) {
      const feriasProporcionais = r2(remuneracaoMedia * mesesProporcionais / 12);
      const tercoFerias = r2(feriasProporcionais / 3);

      verbas.push({
        descricao: `Férias Proporcionais (${mesesProporcionais}/12 avos)`,
        tipo: "provento",
        valor: feriasProporcionais,
        fundamentoLegal: "Art. 146, parágrafo único, CLT",
      });
      verbas.push({
        descricao: "1/3 Constitucional sobre Férias Proporcionais",
        tipo: "provento",
        valor: tercoFerias,
        fundamentoLegal: "Art. 7º, XVII, CF",
      });
    }
  }

  // ─── 5. Férias Vencidas + 1/3 ──────────────────────────────────────────────
  if (params.feriasVencidas) {
    const periodos = params.periodosFeriasVencidas || 1;
    for (let i = 0; i < periodos; i++) {
      const feriasVencidas = remuneracaoMedia;
      const tercoVencidas = r2(feriasVencidas / 3);
      const dobra = i >= 1 || tempoServico.anos >= 2; // Férias em dobro se vencidas há mais de 1 período

      if (dobra && periodos > 1 && i > 0) {
        verbas.push({
          descricao: `Férias Vencidas em Dobro (${i + 1}º período)`,
          tipo: "provento",
          valor: r2(feriasVencidas * 2),
          fundamentoLegal: "Art. 137, CLT — Férias não concedidas no prazo",
        });
        verbas.push({
          descricao: `1/3 Constitucional sobre Férias em Dobro (${i + 1}º período)`,
          tipo: "provento",
          valor: r2(tercoVencidas * 2),
          fundamentoLegal: "Art. 7º, XVII, CF",
        });
      } else {
        verbas.push({
          descricao: `Férias Vencidas (${i + 1}º período)`,
          tipo: "provento",
          valor: r2(feriasVencidas),
          fundamentoLegal: "Art. 134, CLT",
        });
        verbas.push({
          descricao: `1/3 Constitucional sobre Férias Vencidas (${i + 1}º período)`,
          tipo: "provento",
          valor: tercoVencidas,
          fundamentoLegal: "Art. 7º, XVII, CF",
        });
      }
    }
  }

  // ─── 6. Calcular Totais de Proventos ────────────────────────────────────────
  const totalProventos = r2(verbas.filter(v => v.tipo === "provento").reduce((s, v) => s + v.valor, 0));

  // ─── 7. Descontos — INSS ────────────────────────────────────────────────────
  // INSS incide sobre saldo de salário e 13º separadamente
  const base13 = verbas.find(v => v.descricao.includes("13º"))?.valor || 0;
  const inss = calcularINSS(saldoSalario);
  const inss13 = calcularINSS(base13);
  const totalINSS = r2(inss + inss13);

  if (totalINSS > 0) {
    verbas.push({
      descricao: "INSS (saldo salário + 13º)",
      tipo: "desconto",
      valor: totalINSS,
      fundamentoLegal: "Lei 8.212/1991",
      detalhes: `Saldo: R$ ${inss.toFixed(2)} | 13º: R$ ${inss13.toFixed(2)}`,
    });
  }

  // ─── 8. Descontos — IRRF ────────────────────────────────────────────────────
  // IRRF sobre saldo de salário (após INSS)
  const baseIR = saldoSalario - inss;
  const irrf = calcularIRRF(baseIR, 0);
  // IRRF sobre 13º (tabela separada)
  const baseIR13 = base13 - inss13;
  const irrf13 = calcularIRRF(baseIR13, 0);
  const totalIRRF = r2(irrf + irrf13);

  if (totalIRRF > 0) {
    verbas.push({
      descricao: "IRRF (saldo salário + 13º)",
      tipo: "desconto",
      valor: totalIRRF,
      fundamentoLegal: "Lei 7.713/1988",
      detalhes: `Saldo: R$ ${irrf.toFixed(2)} | 13º: R$ ${irrf13.toFixed(2)}`,
    });
  }

  // ─── 9. Outros Descontos ────────────────────────────────────────────────────
  if (params.adiantamentos && params.adiantamentos > 0) {
    verbas.push({
      descricao: "Adiantamentos",
      tipo: "desconto",
      valor: r2(params.adiantamentos),
      fundamentoLegal: "Art. 462, CLT",
    });
  }

  // ─── 10. FGTS ──────────────────────────────────────────────────────────────
  const fgtsInformadoPeloUsuario = params.saldoFGTS !== undefined && params.saldoFGTS > 0;
  let saldoFGTSTotal: number;

  if (fgtsInformadoPeloUsuario) {
    // Usuário informou o saldo — usar exatamente o valor informado
    saldoFGTSTotal = params.saldoFGTS!;
  } else {
    // Não informou — estimar: 8% sobre remuneração × meses trabalhados
    const mesesTrabalhados = tempoServico.anos * 12 + tempoServico.meses + (tempoServico.dias >= 15 ? 1 : 0);
    const saldoFGTSEstimado = r2(remuneracaoMedia * 0.08 * mesesTrabalhados);
    const baseFGTSRescisorio = saldoSalario + (base13 || 0) + (params.avisoPrevioIndenizado ? valorAvisoPrevio : 0);
    const fgtsRescisorio = r2(baseFGTSRescisorio * 0.08);
    saldoFGTSTotal = r2(saldoFGTSEstimado + fgtsRescisorio);
  }

  let multaFGTS = 0;
  const temDireitoMultaFGTS = ["sem_justa_causa", "rescisao_indireta"].includes(params.tipoRescisao);
  const temDireitoMultaFGTSParcial = params.tipoRescisao === "acordo_mutuo";

  if (temDireitoMultaFGTS) {
    multaFGTS = r2(saldoFGTSTotal * 0.40);
  } else if (temDireitoMultaFGTSParcial) {
    multaFGTS = r2(saldoFGTSTotal * 0.20);
  }

  // ─── 11. Calcular Totais Finais ─────────────────────────────────────────────
  const totalDescontos = r2(verbas.filter(v => v.tipo === "desconto").reduce((s, v) => s + v.valor, 0));
  const valorLiquido = r2(totalProventos - totalDescontos);

  const protocolo = `TRAB-RES-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${randomBytes(3).toString("hex").toUpperCase()}`;

  return {
    verbas,
    totalProventos,
    totalDescontos,
    valorLiquido,
    saldoFGTSEstimado: saldoFGTSTotal,
    fgtsInformado: fgtsInformadoPeloUsuario,
    multaFGTS,
    totalFGTS: r2(saldoFGTSTotal + multaFGTS),
    diasAvisoPrevio,
    valorAvisoPrevio,
    tempoServico,
    inss: totalINSS,
    irrf: totalIRRF,
    protocoloCalculo: protocolo,
  };
}

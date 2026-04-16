/**
 * Gerador de Parecer Técnico Trabalhista
 * 
 * Gera parecer em formato Markdown com fundamentação jurídica
 * para rescisão contratual e horas extras.
 */

import type { ResultadoRescisao, ParametrosRescisao } from "../../shared/trabalhista-types";
import { TIPO_RESCISAO_LABELS, TIPO_CONTRATO_LABELS } from "../../shared/trabalhista-types";
import type { ResultadoHorasExtras, ParametrosHorasExtras } from "../../shared/trabalhista-types";
import { DISCLAIMER_LEGAL } from "./disclaimer-legal";

function formatBRL(v: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

function formatDate(d: string): string {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

// ─── Parecer de Rescisão ──────────────────────────────────────────────────────

export function gerarParecerRescisao(params: ParametrosRescisao, resultado: ResultadoRescisao): string {
  const ts = resultado.tempoServico;
  const tempoStr = `${ts.anos} ano(s), ${ts.meses} mês(es) e ${ts.dias} dia(s)`;

  let parecer = `# PARECER TÉCNICO — RESCISÃO CONTRATUAL\n\n`;
  parecer += `**Protocolo:** ${resultado.protocoloCalculo}\n`;
  parecer += `**Data de Emissão:** ${new Date().toLocaleDateString("pt-BR")}\n\n`;
  parecer += `---\n\n`;

  // 1. Dados do Contrato
  parecer += `## 1. DADOS DO CONTRATO\n\n`;
  parecer += `| Campo | Valor |\n|---|---|\n`;
  parecer += `| **Tipo de Rescisão** | ${TIPO_RESCISAO_LABELS[params.tipoRescisao]} |\n`;
  parecer += `| **Tipo de Contrato** | ${TIPO_CONTRATO_LABELS[params.tipoContrato]} |\n`;
  parecer += `| **Data de Admissão** | ${formatDate(params.dataAdmissao)} |\n`;
  parecer += `| **Data de Desligamento** | ${formatDate(params.dataDesligamento)} |\n`;
  parecer += `| **Tempo de Serviço** | ${tempoStr} |\n`;
  parecer += `| **Salário Bruto** | ${formatBRL(params.salarioBruto)} |\n`;
  if (params.mediaHorasExtras) parecer += `| **Média Horas Extras** | ${formatBRL(params.mediaHorasExtras)} |\n`;
  if (params.mediaComissoes) parecer += `| **Média Comissões** | ${formatBRL(params.mediaComissoes)} |\n`;
  parecer += `| **Aviso Prévio** | ${params.avisoPrevioIndenizado ? "Indenizado" : params.avisoPrevioTrabalhado ? "Trabalhado" : "Não aplicável"} |\n`;
  parecer += `\n`;

  // 2. Verbas Rescisórias
  parecer += `## 2. VERBAS RESCISÓRIAS\n\n`;
  parecer += `### 2.1 Proventos\n\n`;
  parecer += `| Descrição | Valor | Fundamento Legal |\n|---|---|---|\n`;
  for (const v of resultado.verbas.filter(v => v.tipo === "provento")) {
    parecer += `| ${v.descricao} | ${formatBRL(v.valor)} | ${v.fundamentoLegal} |\n`;
  }
  parecer += `| **TOTAL PROVENTOS** | **${formatBRL(resultado.totalProventos)}** | — |\n\n`;

  parecer += `### 2.2 Descontos\n\n`;
  parecer += `| Descrição | Valor | Fundamento Legal |\n|---|---|---|\n`;
  for (const v of resultado.verbas.filter(v => v.tipo === "desconto")) {
    parecer += `| ${v.descricao} | ${formatBRL(v.valor)} | ${v.fundamentoLegal} |\n`;
  }
  parecer += `| **TOTAL DESCONTOS** | **${formatBRL(resultado.totalDescontos)}** | — |\n\n`;

  // 3. FGTS
  parecer += `## 3. FGTS E MULTA RESCISÓRIA\n\n`;
  parecer += `| Item | Valor |\n|---|---|\n`;
  parecer += `| Saldo FGTS (${resultado.fgtsInformado ? "informado" : "estimado"}) | ${formatBRL(resultado.saldoFGTSEstimado)} |\n`;
  if (resultado.multaFGTS > 0) {
    const percentual = ["sem_justa_causa", "rescisao_indireta"].includes(params.tipoRescisao) ? "40%" : "20%";
    parecer += `| Multa ${percentual} FGTS | ${formatBRL(resultado.multaFGTS)} |\n`;
  }
  parecer += `| **Total FGTS** | **${formatBRL(resultado.totalFGTS)}** |\n\n`;

  // 4. Resumo
  parecer += `## 4. RESUMO FINANCEIRO\n\n`;
  parecer += `| Item | Valor |\n|---|---|\n`;
  parecer += `| Total Proventos | ${formatBRL(resultado.totalProventos)} |\n`;
  parecer += `| Total Descontos | ${formatBRL(resultado.totalDescontos)} |\n`;
  parecer += `| **Valor Líquido Rescisão** | **${formatBRL(resultado.valorLiquido)}** |\n`;
  parecer += `| Total FGTS + Multa | ${formatBRL(resultado.totalFGTS)} |\n`;
  parecer += `| **Total Geral a Receber** | **${formatBRL(resultado.valorLiquido + resultado.totalFGTS)}** |\n\n`;

  // 5. Fundamentação Jurídica
  parecer += `## 5. FUNDAMENTAÇÃO JURÍDICA\n\n`;

  if (params.tipoRescisao === "sem_justa_causa") {
    parecer += `A rescisão sem justa causa é direito potestativo do empregador, conforme **Art. 7º, I, da Constituição Federal**, `;
    parecer += `gerando direito a todas as verbas rescisórias previstas na CLT.\n\n`;
    parecer += `O aviso prévio proporcional ao tempo de serviço é garantido pela **Lei 12.506/2011**, `;
    parecer += `que estabelece 30 dias base acrescidos de 3 dias por ano de serviço, limitado a 90 dias.\n\n`;
    parecer += `A multa de 40% sobre o FGTS é devida conforme **Art. 18, §1º, da Lei 8.036/1990**.\n\n`;
  } else if (params.tipoRescisao === "acordo_mutuo") {
    parecer += `A rescisão por acordo mútuo foi introduzida pela **Reforma Trabalhista (Lei 13.467/2017)**, `;
    parecer += `no **Art. 484-A da CLT**, que prevê:\n\n`;
    parecer += `- Metade do aviso prévio indenizado\n`;
    parecer += `- Metade da multa rescisória sobre o FGTS (20%)\n`;
    parecer += `- Saque de até 80% do saldo do FGTS\n`;
    parecer += `- Demais verbas rescisórias integrais\n\n`;
  } else if (params.tipoRescisao === "pedido_demissao") {
    parecer += `No pedido de demissão, o empregado não tem direito ao aviso prévio indenizado, `;
    parecer += `à multa de 40% do FGTS nem ao saque do FGTS, conforme **Art. 487, CLT**.\n\n`;
    parecer += `Mantém direito ao saldo de salário, 13º proporcional e férias proporcionais + 1/3.\n\n`;
  } else if (params.tipoRescisao === "justa_causa") {
    parecer += `Na demissão por justa causa (**Art. 482, CLT**), o empregado perde o direito a:\n\n`;
    parecer += `- Aviso prévio\n- 13º salário proporcional\n- Férias proporcionais\n`;
    parecer += `- Multa de 40% do FGTS\n- Saque do FGTS\n\n`;
    parecer += `Mantém direito apenas ao saldo de salário e férias vencidas (se houver).\n\n`;
  } else if (params.tipoRescisao === "rescisao_indireta") {
    parecer += `A rescisão indireta (**Art. 483, CLT**) ocorre por culpa do empregador e gera `;
    parecer += `os mesmos direitos da demissão sem justa causa, incluindo multa de 40% do FGTS.\n\n`;
  }

  // Aviso prévio
  if (resultado.diasAvisoPrevio > 0) {
    parecer += `### Aviso Prévio Proporcional\n\n`;
    parecer += `Conforme a **Lei 12.506/2011**, o aviso prévio é de ${resultado.diasAvisoPrevio} dias `;
    parecer += `(30 dias base + ${resultado.diasAvisoPrevio - 30} dias proporcionais ao tempo de serviço de ${ts.anos} ano(s)).\n\n`;
  }

  // INSS
  parecer += `### Descontos Previdenciários\n\n`;
  parecer += `O INSS foi calculado de forma progressiva conforme **Tabela INSS 2025**, `;
  parecer += `aplicando-se as alíquotas de 7,5%, 9%, 12% e 14% sobre as respectivas faixas salariais.\n\n`;

  // Disclaimer
  parecer += `---\n\n`;
  parecer += `> **Nota:** Este parecer técnico tem caráter informativo e não substitui a orientação de um advogado trabalhista. `;
  parecer += `Os valores podem sofrer variações conforme convenções coletivas, acordos sindicais e decisões judiciais aplicáveis ao caso concreto.\n`;

  parecer += "\n\n" + DISCLAIMER_LEGAL;

  return parecer;
}

// ─── Parecer de Horas Extras ──────────────────────────────────────────────────

export function gerarParecerHorasExtras(params: ParametrosHorasExtras, resultado: ResultadoHorasExtras): string {
  let parecer = `# PARECER TÉCNICO — HORAS EXTRAS\n\n`;
  parecer += `**Protocolo:** ${resultado.protocoloCalculo}\n`;
  parecer += `**Data de Emissão:** ${new Date().toLocaleDateString("pt-BR")}\n\n`;
  parecer += `---\n\n`;

  // 1. Dados Base
  parecer += `## 1. DADOS BASE DO CÁLCULO\n\n`;
  parecer += `| Campo | Valor |\n|---|---|\n`;
  parecer += `| **Salário Bruto** | ${formatBRL(params.salarioBruto)} |\n`;
  parecer += `| **Carga Horária Mensal** | ${params.cargaHorariaMensal}h |\n`;
  parecer += `| **Valor Hora Normal** | ${formatBRL(resultado.valorHoraNormal)} |\n`;
  parecer += `| **Valor Hora Extra 50%** | ${formatBRL(resultado.valorHoraExtra50)} |\n`;
  parecer += `| **Valor Hora Extra 100%** | ${formatBRL(resultado.valorHoraExtra100)} |\n`;
  if (params.incluirAdicionalNoturno) {
    parecer += `| **Valor Hora Noturna** | ${formatBRL(resultado.valorHoraNoturna)} |\n`;
  }
  parecer += `| **Períodos Analisados** | ${resultado.detalhamentoPeriodos.length} mês(es) |\n\n`;

  // 2. Detalhamento por Período
  parecer += `## 2. DETALHAMENTO POR PERÍODO\n\n`;
  parecer += `| Mês/Ano | Salário Base | HE 50% (h) | Valor 50% | HE 100% (h) | Valor 100% | Adic. Noturno | Total |\n`;
  parecer += `|---|---|---|---|---|---|---|---|\n`;
  for (const p of resultado.detalhamentoPeriodos) {
    parecer += `| ${p.mesAno} | ${formatBRL(p.salarioBase)} | ${p.horasExtras50}h | ${formatBRL(p.valorExtras50)} | ${p.horasExtras100}h | ${formatBRL(p.valorExtras100)} | ${formatBRL(p.valorAdicionalNoturno)} | ${formatBRL(p.totalPeriodo)} |\n`;
  }
  parecer += `\n`;

  // 3. Totais
  parecer += `## 3. TOTAIS\n\n`;
  parecer += `| Item | Quantidade | Valor |\n|---|---|---|\n`;
  parecer += `| Horas Extras 50% | ${resultado.totalHorasExtras50}h | ${formatBRL(resultado.totalValorHorasExtras - (resultado.totalHorasExtras100 * resultado.valorHoraExtra100))} |\n`;
  parecer += `| Horas Extras 100% | ${resultado.totalHorasExtras100}h | ${formatBRL(resultado.totalHorasExtras100 * resultado.valorHoraExtra100)} |\n`;
  if (resultado.totalHorasNoturnas > 0) {
    parecer += `| Adicional Noturno | ${resultado.totalHorasNoturnas}h | ${formatBRL(resultado.totalAdicionalNoturno)} |\n`;
  }
  parecer += `| **Total Horas Extras** | — | **${formatBRL(resultado.totalGeral)}** |\n\n`;

  // 4. Reflexos
  parecer += `## 4. REFLEXOS\n\n`;
  parecer += `| Reflexo | Valor | Fundamento |\n|---|---|---|\n`;
  parecer += `| Férias + 1/3 | ${formatBRL(resultado.reflexos.reflexoFerias)} | Art. 142, §5º, CLT |\n`;
  parecer += `| 13º Salário | ${formatBRL(resultado.reflexos.reflexo13Salario)} | Súmula 45, TST |\n`;
  parecer += `| FGTS (8%) | ${formatBRL(resultado.reflexos.reflexoFGTS)} | Art. 15, Lei 8.036/90 |\n`;
  parecer += `| DSR | ${formatBRL(resultado.reflexos.reflexoDSR)} | Súmula 172, TST |\n`;
  parecer += `| **Total Reflexos** | **${formatBRL(resultado.reflexos.totalReflexos)}** | — |\n\n`;

  // 5. Resumo
  parecer += `## 5. RESUMO FINANCEIRO\n\n`;
  parecer += `| Item | Valor |\n|---|---|\n`;
  parecer += `| Total Horas Extras | ${formatBRL(resultado.totalGeral)} |\n`;
  parecer += `| Total Reflexos | ${formatBRL(resultado.reflexos.totalReflexos)} |\n`;
  parecer += `| **TOTAL GERAL** | **${formatBRL(resultado.totalComReflexos)}** |\n\n`;

  // 6. Fundamentação
  parecer += `## 6. FUNDAMENTAÇÃO JURÍDICA\n\n`;
  parecer += `O cálculo de horas extras observa os seguintes dispositivos legais:\n\n`;
  parecer += `- **Art. 7º, XVI, CF/88**: Remuneração do serviço extraordinário superior, no mínimo, em 50% à do normal.\n`;
  parecer += `- **Art. 59, CLT**: A duração diária do trabalho poderá ser acrescida de horas extras, em número não excedente de duas.\n`;
  parecer += `- **Art. 73, CLT**: O trabalho noturno (22h às 5h) terá remuneração superior à do diurno com acréscimo de 20%.\n`;
  parecer += `- **Súmula 172, TST**: As horas extras habitualmente prestadas integram o DSR.\n`;
  parecer += `- **Súmula 45, TST**: A remuneração do serviço suplementar integra a gratificação natalina.\n`;
  parecer += `- **Art. 142, §5º, CLT**: As horas extras habituais integram a remuneração das férias.\n`;
  parecer += `- **Art. 15, Lei 8.036/90**: O FGTS incide sobre a remuneração paga, incluindo horas extras.\n\n`;

  parecer += `---\n\n`;
  parecer += `> **Nota:** Este parecer técnico tem caráter informativo e não substitui a orientação de um advogado trabalhista. `;
  parecer += `Os valores podem sofrer variações conforme convenções coletivas e acordos sindicais aplicáveis.\n`;

  parecer += "\n\n" + DISCLAIMER_LEGAL;

  return parecer;
}

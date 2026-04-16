/**
 * Gerador de Parecer Técnico — Revisão de Financiamento Bancário
 *
 * Documento profissional para uso em processos judiciais.
 * Estruturado para compreensão por magistrados e partes.
 */

import type {
  ParametrosFinanciamento,
  AnaliseAbusividade,
  ResumoComparativo,
  DadosRecalculoParcelasPagas,
} from "../../shared/financiamento-types";
import { MODALIDADE_LABELS } from "../../shared/financiamento-types";
import { round2 } from "./engine-financiamento";

function formatBRL(v: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}
function formatPercent(v: number, d = 4): string { return `${v.toFixed(d)}%`; }
function formatDate(s: string): string { const [y, m, d] = s.split("-"); return `${d}/${m}/${y}`; }

const SISTEMA_LABELS: Record<string, string> = {
  PRICE: "Tabela Price (parcelas fixas)",
  SAC: "SAC — Sistema de Amortização Constante",
  SACRE: "SACRE — Sistema de Amortização Crescente",
};

export function gerarParecerTecnico(
  params: ParametrosFinanciamento,
  analise: AnaliseAbusividade,
  resumo: ResumoComparativo,
  taxaRecalculoAplicada: number,
  criterioRecalculo: string,
  protocoloCalculo?: string,
  dadosParcelasPagas?: DadosRecalculoParcelasPagas
): string {
  const s: string[] = [];
  const vt = analise.verificacaoTaxas;
  const mora = analise.verificacaoEncargosMora;

  // Identificar irregularidades
  const irregularidades: string[] = [];
  if (analise.taxaAbusiva) irregularidades.push("taxa de juros acima do limite de mercado");
  if (!vt.taxasEquivalentes && vt.capitalizacaoDiaria && !vt.anualAutoCalculada) irregularidades.push("possível capitalização diária de juros");
  const anatocismoIrr = analise.anatocismoDetectado && (!analise.anatocismoPermitido || (!analise.anatocismoExpressoPactuado && !analise.anatocismoPactuadoPorSumula541));
  if (anatocismoIrr) irregularidades.push("capitalização indevida de juros (anatocismo)");
  if (analise.tarifasIlegais.length > 0) irregularidades.push("cobrança de tarifas consideradas ilegais");
  if (mora.irregularidades.length > 0) irregularidades.push("encargos de mora acima dos limites legais");

  // ─── CABEÇALHO ──────────────────────────────────────────────────
  s.push(`# PARECER TÉCNICO\n`);
  s.push(`## Revisão de Contrato de Financiamento Bancário\n`);
  if (protocoloCalculo) s.push(`**Protocolo:** ${protocoloCalculo}`);
  s.push(`**Data de emissão:** ${new Date().toLocaleDateString("pt-BR")}\n`);
  s.push(`---\n`);

  // ─── RESUMO EXECUTIVO ───────────────────────────────────────────
  s.push(`## RESUMO\n`);
  if (irregularidades.length > 0) {
    s.push(`Foram encontradas **${irregularidades.length} irregularidade(s)** no contrato analisado: ${irregularidades.join("; ")}.\n`);
    s.push(`O valor cobrado a mais é de **${formatBRL(resumo.diferencaTotal)}**.\n`);
    if (resumo.repeticaoIndebito > 0) {
      s.push(`O valor para repetição de indébito em dobro (CDC art. 42, p. único) é de **${formatBRL(resumo.repeticaoIndebito)}**.\n`);
    }
    if (dadosParcelasPagas && dadosParcelasPagas.parcelasPagas > 0) {
      s.push(`Com base nas ${dadosParcelasPagas.parcelasPagas} parcelas já pagas, a nova parcela recalculada seria de **${formatBRL(dadosParcelasPagas.parcelaFinalRecalculada)}**.\n`);
    }
  } else {
    s.push(`**Não foram encontradas irregularidades** no contrato analisado. As condições contratadas estão dentro dos parâmetros legais e de mercado.\n`);
  }
  s.push(`---\n`);

  // ─── 1. DADOS DO CONTRATO ──────────────────────────────────────
  s.push(`## 1. DADOS DO CONTRATO\n`);
  s.push(`| Campo | Informação |`);
  s.push(`|-------|------------|`);
  s.push(`| Valor financiado | ${formatBRL(params.valorFinanciado)} |`);
  s.push(`| Taxa de juros | ${formatPercent(params.taxaJurosMensal)} ao mês (${formatPercent(analise.taxaContratadaAnual, 2)} ao ano)${vt.anualAutoCalculada ? " *(anual calculada)*" : ""} |`);
  s.push(`| Prazo | ${params.quantidadeParcelas} parcelas |`);
  if (params.valorParcela) s.push(`| Valor da parcela | ${formatBRL(params.valorParcela)} |`);
  s.push(`| Sistema de amortização | ${SISTEMA_LABELS[params.sistemaAmortizacao] || params.sistemaAmortizacao} |`);
  s.push(`| Modalidade | ${MODALIDADE_LABELS[params.modalidadeCredito]} |`);
  s.push(`| Data do contrato | ${formatDate(params.dataContrato)} |`);
  s.push(`| Primeiro vencimento | ${formatDate(params.dataPrimeiroVencimento)} |`);
  if (params.parcelasJaPagas && params.parcelasJaPagas > 0) {
    s.push(`| Parcelas já pagas | ${params.parcelasJaPagas} |`);
  }
  s.push(``);

  // Tarifas financiadas
  if (resumo.tarifasFinanciadas > 0) {
    s.push(`**Nota:** Do valor financiado de ${formatBRL(params.valorFinanciado)}, a quantia de ${formatBRL(resumo.tarifasFinanciadas)} refere-se a tarifas e custos acessórios incluídos no financiamento. O valor efetivamente recebido pelo mutuário foi de ${formatBRL(resumo.valorFinanciadoLiquido)}.\n`);
  }

  // ─── 2. ANÁLISE DA TAXA DE JUROS ───────────────────────────────
  s.push(`## 2. ANÁLISE DA TAXA DE JUROS\n`);
  s.push(`A taxa média de mercado para a modalidade "${MODALIDADE_LABELS[params.modalidadeCredito]}", conforme dados do Banco Central do Brasil (Sistema SGS), é de **${formatPercent(analise.taxaMediaBACEN_mensal)} ao mês** (${formatPercent(analise.taxaMediaBACEN_anual, 2)} ao ano).\n`);

  // Fundamentação legal diferenciada por modalidade
  if (analise.tetoLegal_mensal && analise.tetoLegal_fundamento) {
    s.push(`Esta modalidade possui **teto legal de ${formatPercent(analise.tetoLegal_mensal, 2)} ao mês**, conforme ${analise.tetoLegal_fundamento}.\n`);
    s.push(`Adicionalmente, o STJ (REsp 1.061.530/RS) firma que a taxa é abusiva quando supera **1,5 vez** a média de mercado.\n`);
  } else if (params.modalidadeCredito === "cartao_credito" && params.dataContrato >= "2024-01-03") {
    s.push(`Para operações de cartão de crédito contratadas a partir de 03/01/2024, a **Lei 14.690/2023 (Desenrola Brasil)**, regulamentada pela **Resolução CMN 5.112/2023**, determina que os juros e encargos acumulados **não podem exceder 100% do valor original da dívida**.\n`);
    s.push(`Adicionalmente, o STJ (REsp 1.061.530/RS) firma que a taxa mensal é abusiva quando supera **1,5 vez** a média de mercado.\n`);
  } else if (params.modalidadeCredito === "consignado" && params.tipoVinculoConsignado === "militar") {
    s.push(`Para militares das Forças Armadas, não há teto legal específico para taxa de juros. A **MP 2.215-10/2001** (art. 14, §3º) estabelece que a soma dos descontos obrigatórios e voluntários não pode ultrapassar **70%** da remuneração, garantindo mínimo de **30%**. Para contratos firmados a partir de 04/08/2022, a **Lei 14.509/2022** impõe limite adicional de **45%** para consignações a terceiros (**STJ, Tema 1.286**, julgado em 12/02/2025). Quanto à taxa de juros, aplica-se o critério geral do STJ (**REsp 1.061.530/RS**): abusividade quando supera **1,5 vez** a média de mercado.\n`);
  } else if (params.modalidadeCredito === "consignado" && params.tipoVinculoConsignado === "clt") {
    s.push(`Para trabalhadores CLT, não há teto legal específico para taxa de juros do consignado. Aplica-se o critério do STJ (REsp 1.061.530/RS): abusividade quando a taxa supera **1,5 vez** a média de mercado.\n`);
  } else {
    s.push(`O Superior Tribunal de Justiça, no julgamento do **REsp 1.061.530/RS** (recurso repetitivo), firmou o entendimento de que a taxa de juros é considerada abusiva quando supera em **1,5 vez** a taxa média de mercado.\n`);
  }

  // Tabela comparativa
  s.push(`| Referência | Mensal | Anual |`);
  s.push(`|------------|--------|-------|`);
  s.push(`| Taxa do contrato | ${formatPercent(analise.taxaContratadaMensal)} | ${formatPercent(analise.taxaContratadaAnual, 2)} |`);
  s.push(`| Média de mercado (BACEN) | ${formatPercent(analise.taxaMediaBACEN_mensal)} | ${formatPercent(analise.taxaMediaBACEN_anual, 2)} |`);
  if (analise.tetoLegal_mensal) {
    s.push(`| **Teto legal** | **${formatPercent(analise.tetoLegal_mensal, 2)}** | — |`);
  }
  s.push(`| Limite STJ (1,5× média) | ${formatPercent(analise.tetoSTJ_mensal)} | ${formatPercent(analise.tetoSTJ_anual, 2)} |`);
  s.push(``);

  // Conclusão
  if (analise.violaTetoLegal && analise.tetoLegal_mensal) {
    s.push(`**Conclusão:** A taxa contratada de ${formatPercent(analise.taxaContratadaMensal)} ao mês **viola o teto legal** de ${formatPercent(analise.tetoLegal_mensal, 2)} ao mês. A cobrança é **ilegal** independentemente da comparação com a média de mercado.\n`);
  } else if (analise.tetoLegal_mensal && !analise.violaTetoLegal) {
    // Tem teto legal e está DENTRO dele — não é abusiva mesmo que supere 1,5× BACEN
    s.push(`**Conclusão:** A taxa contratada de ${formatPercent(analise.taxaContratadaMensal)} ao mês está **dentro do teto legal** de ${formatPercent(analise.tetoLegal_mensal, 2)} ao mês (${analise.tetoLegal_fundamento}). A taxa é **regular** para esta modalidade.\n`);
    if (analise.taxaContratadaMensal > analise.tetoSTJ_mensal) {
      s.push(`Embora a taxa supere o critério geral do STJ (1,5× média BACEN = ${formatPercent(analise.tetoSTJ_mensal)} a.m.), o teto legal específico prevalece sobre a regra geral de mercado.\n`);
    }
  } else if (analise.jurosAcumuladosExcedemPrincipal) {
    s.push(`**Conclusão:** Os juros acumulados de ${formatPercent(analise.jurosAcumuladosPercent ?? 0, 2)} **excedem 100%** do valor original da dívida, violando o limite da **Lei 14.690/2023**. Configura-se cobrança **ilegal**.\n`);
  } else if (analise.taxaAbusiva) {
    s.push(`**Conclusão:** A taxa contratada de ${formatPercent(analise.taxaContratadaMensal)} ao mês **supera** o limite de ${formatPercent(analise.tetoSTJ_mensal)} ao mês, estando ${formatPercent(analise.percentualAcimaDaMedia, 2)} acima da média de mercado. Configura-se **potencial abusividade**.\n`);
  } else {
    s.push(`**Conclusão:** A taxa contratada está **dentro** dos limites aceitos pela legislação e jurisprudência.\n`);
  }

  // ─── 3. CAPITALIZAÇÃO DE JUROS ─────────────────────────────────
  s.push(`## 3. CAPITALIZAÇÃO DE JUROS (ANATOCISMO)\n`);
  s.push(`O contrato utiliza o sistema ${SISTEMA_LABELS[params.sistemaAmortizacao] || params.sistemaAmortizacao}, que calcula juros sobre o saldo devedor do mês anterior. Esse procedimento resulta em juros compostos, ou seja, juros sobre juros (anatocismo).\n`);

  const taxaAnualComp = round2((Math.pow(1 + params.taxaJurosMensal / 100, 12) - 1) * 100);
  const taxaAnualSimples = round2(params.taxaJurosMensal * 12);
  s.push(`Para demonstrar: a taxa de ${formatPercent(params.taxaJurosMensal)} ao mês equivale a ${formatPercent(taxaAnualComp, 2)} ao ano por juros compostos, mas seria apenas ${formatPercent(taxaAnualSimples, 2)} ao ano por juros simples. A diferença de ${formatPercent(round2(taxaAnualComp - taxaAnualSimples), 2)} ao ano confirma a capitalização.\n`);

  if (analise.anatocismoDetectado) {
    if (!analise.anatocismoPermitido) {
      s.push(`O contrato é **anterior à MP 2.170-36/2001**. A capitalização é **irregular** (Súmula 121/STF).\n`);
    } else if (analise.anatocismoPactuadoPorSumula541) {
      s.push(`A **Súmula 541/STJ** autoriza a capitalização quando a taxa anual contratada é superior ao duodécuplo da mensal, o que se verifica neste caso. Capitalização **regular**.\n`);
    } else if (analise.anatocismoExpressoPactuado) {
      s.push(`A capitalização está expressamente pactuada no contrato. **Regular** conforme Súmula 539/STJ.\n`);
    } else {
      s.push(`Não há cláusula expressa autorizando a capitalização, nem taxa anual superior a 12× a mensal. Capitalização **irregular** (Súmula 539/STJ).\n`);
    }
  } else {
    s.push(`Não foi detectada capitalização composta no contrato.\n`);
  }

  // ─── 4. TARIFAS E CUSTOS ───────────────────────────────────────
  s.push(`## 4. TARIFAS E CUSTOS ACESSÓRIOS\n`);
  if (analise.tarifasIlegais.length > 0) {
    s.push(`Foram identificadas as seguintes cobranças consideradas irregulares:\n`);
    s.push(`| Tarifa | Valor | Fundamento Legal |`);
    s.push(`|--------|-------|-----------------|`);
    for (const t of analise.tarifasIlegais) {
      s.push(`| ${t.descricao} | ${formatBRL(t.valor)} | ${t.fundamento} |`);
    }
    s.push(`\n**Total de tarifas ilegais:** ${formatBRL(resumo.tarifasIlegais)}\n`);
  } else {
    s.push(`Não foram identificadas tarifas irregulares.\n`);
  }

  // ─── 5. ENCARGOS DE MORA ───────────────────────────────────────
  s.push(`## 5. ENCARGOS DE MORA\n`);
  if (mora.irregularidades.length > 0) {
    s.push(`Foram identificadas as seguintes irregularidades nos encargos moratórios:\n`);
    for (const irr of mora.irregularidades) s.push(`- ${irr}`);
    if (resumo.encargosAbusivos > 0) s.push(`\n**Valor estimado dos encargos abusivos:** ${formatBRL(resumo.encargosAbusivos)}\n`);
  } else {
    s.push(`Os encargos de mora estão dentro dos limites legais (multa até 2% e juros até 1% ao mês).\n`);
  }

  // ─── 6. CUSTO EFETIVO TOTAL ────────────────────────────────────
  const cet = analise.cet;
  s.push(`## 6. CUSTO EFETIVO TOTAL (CET)\n`);
  s.push(`O CET representa o custo real da operação para o mutuário, incluindo juros, tarifas e demais despesas (Resolução CMN 3.517/2007).\n`);
  s.push(`| Indicador | Valor |`);
  s.push(`|-----------|-------|`);
  s.push(`| CET mensal | ${formatPercent(cet.cetMensal)} ao mês |`);
  s.push(`| CET anual | ${formatPercent(cet.cetAnual, 2)} ao ano |`);
  s.push(`| Taxa nominal do contrato | ${formatPercent(cet.taxaNominalMensal)} ao mês / ${formatPercent(cet.taxaNominalAnual, 2)} ao ano |`);
  s.push(`| Diferença CET × nominal | ${formatPercent(cet.diferencaCET_vs_Nominal, 2)} |`);
  s.push(``);

  // ─── 7. RECÁLCULO ──────────────────────────────────────────────
  s.push(`## 7. RECÁLCULO PELO MÉTODO GAUSS\n`);
  s.push(`O contrato foi recalculado pelo **Método Gauss** (juros simples com parcelas fixas), que distribui os juros de forma linear ao longo do prazo, eliminando a incidência de juros sobre juros.\n`);
  s.push(`**Critério utilizado:** ${criterioRecalculo}`);
  s.push(`**Taxa do recálculo:** ${formatPercent(taxaRecalculoAplicada)} ao mês\n`);

  if (resumo.valorFinanciadoLiquido < resumo.valorFinanciadoOriginal) {
    s.push(`O valor financiado de ${formatBRL(resumo.valorFinanciadoOriginal)} inclui ${formatBRL(resumo.tarifasFinanciadas)} em tarifas ilegais. O recálculo utilizou o valor líquido de ${formatBRL(resumo.valorFinanciadoLiquido)}.\n`);
  }

  s.push(`### Quadro Comparativo\n`);
  s.push(`| Item | Contrato Original | Recálculo (Gauss) | Diferença |`);
  s.push(`|------|-------------------|-------------------|-----------|`);
  s.push(`| Soma das parcelas | ${formatBRL(resumo.totalPagoOriginal)} | ${formatBRL(resumo.totalPagoRecalculado)} | ${formatBRL(resumo.diferencaTotal)} |`);
  s.push(`| Total de juros | ${formatBRL(resumo.totalJurosOriginal)} | ${formatBRL(resumo.totalJurosRecalculado)} | ${formatBRL(resumo.diferencaJuros)} |`);
  if (resumo.tarifasIlegais > 0) s.push(`| Tarifas ilegais | ${formatBRL(resumo.tarifasIlegais)} | — | ${formatBRL(resumo.tarifasIlegais)} |`);
  if (resumo.encargosAbusivos > 0) s.push(`| Encargos abusivos | ${formatBRL(resumo.encargosAbusivos)} | — | ${formatBRL(resumo.encargosAbusivos)} |`);
  s.push(``);

  // ─── 8. PARCELAS JÁ PAGAS ─────────────────────────────────────
  if (dadosParcelasPagas && dadosParcelasPagas.parcelasPagas > 0) {
    s.push(`## 8. PARCELAS JÁ PAGAS\n`);
    s.push(`O mutuário já pagou ${dadosParcelasPagas.parcelasPagas} parcelas. Comparando o valor pago com o valor que seria devido pelo recálculo:\n`);
    s.push(`| Item | Valor |`);
    s.push(`|------|-------|`);
    s.push(`| Valor pago pelo contrato | ${formatBRL(dadosParcelasPagas.valorPagoTotal)} |`);
    s.push(`| Valor devido pelo recálculo | ${formatBRL(dadosParcelasPagas.valorDevidoGauss)} |`);
    s.push(`| **Valor pago a mais** | **${formatBRL(dadosParcelasPagas.valorPagoAMais)}** |`);
    s.push(`| Saldo devedor atualizado | ${formatBRL(dadosParcelasPagas.saldoDevedorAtualizado)} |`);
    s.push(`| Parcelas restantes | ${dadosParcelasPagas.parcelasRestantes} |`);
    s.push(`| **Nova parcela recalculada** | **${formatBRL(dadosParcelasPagas.parcelaFinalRecalculada)}** |`);
    s.push(``);
    s.push(`O excesso de ${formatBRL(dadosParcelasPagas.valorPagoAMais)} foi abatido do saldo devedor. A nova parcela mensal, pelo Método Gauss com taxa de ${formatPercent(dadosParcelasPagas.taxaRecalculo)} ao mês, é de **${formatBRL(dadosParcelasPagas.parcelaFinalRecalculada)}**.\n`);
  }

  // ─── CONCLUSÃO ─────────────────────────────────────────────────
  const secConc = dadosParcelasPagas && dadosParcelasPagas.parcelasPagas > 0 ? "9" : "8";
  s.push(`## ${secConc}. CONCLUSÃO\n`);

  if (irregularidades.length > 0) {
    s.push(`Diante da análise técnica realizada, conclui-se que o contrato apresenta as seguintes irregularidades:\n`);
    for (let i = 0; i < irregularidades.length; i++) {
      s.push(`${i + 1}. ${irregularidades[i].charAt(0).toUpperCase() + irregularidades[i].slice(1)}`);
    }
    s.push(``);
    s.push(`### Valores apurados\n`);
    s.push(`| Descrição | Valor |`);
    s.push(`|-----------|-------|`);
    s.push(`| Valor cobrado a mais | ${formatBRL(resumo.diferencaTotal)} |`);
    if (resumo.tarifasIlegais > 0) s.push(`| Tarifas ilegais | ${formatBRL(resumo.tarifasIlegais)} |`);
    if (resumo.encargosAbusivos > 0) s.push(`| Encargos abusivos | ${formatBRL(resumo.encargosAbusivos)} |`);
    s.push(`| **Repetição de indébito em dobro (CDC art. 42, p. único)** | **${formatBRL(resumo.repeticaoIndebito)}** |`);
    if (dadosParcelasPagas && dadosParcelasPagas.parcelasPagas > 0) {
      s.push(`| Nova parcela recalculada | ${formatBRL(dadosParcelasPagas.parcelaFinalRecalculada)} |`);
    }
    s.push(``);
  } else {
    s.push(`Diante da análise técnica realizada, **não foram identificadas irregularidades** no contrato. As taxas de juros, tarifas e encargos estão dentro dos parâmetros legais e de mercado.\n`);
  }

  s.push(`---\n`);
  s.push(`*Parecer técnico elaborado com base na legislação vigente, jurisprudência do STJ e dados oficiais do Banco Central do Brasil.*`);

  // Disclaimer legal obrigatório (limitações, responsabilidade do advogado)
  const { DISCLAIMER_LEGAL } = require("./disclaimer-legal");
  s.push("\n\n" + DISCLAIMER_LEGAL);

  return s.join("\n");
}

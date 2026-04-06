/**
 * Gerador de Parecer Técnico — Revisão de Financiamento Imobiliário
 * Fundamentação legal corrigida conforme jurisprudência 2024/2025.
 */

import type {
  ParametrosImobiliario,
  AnaliseAbusividadeImob,
  ResumoComparativoImob,
  DadosRecalculoImob,
} from "../../shared/imobiliario-types";
import { INDEXADOR_LABELS } from "../../shared/imobiliario-types";
import { round2 } from "./engine-imobiliario";

function formatBRL(v: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}
function formatPercent(v: number, d = 4): string { return `${v.toFixed(d)}%`; }
function formatDate(s: string): string { const [y, m, dd] = s.split("-"); return `${dd}/${m}/${y}`; }

const SISTEMA_LABELS: Record<string, string> = {
  PRICE: "Tabela Price (parcelas recalculadas mensalmente)",
  SAC: "SAC — Sistema de Amortização Constante",
};

const TIPO_CREDOR_LABELS: Record<string, string> = {
  INSTITUICAO_SFN: "Instituição integrante do SFN (banco/caixa econômica)",
  ENTIDADE_SFI: "Entidade do SFI (não integrante do SFN)",
  INCORPORADORA: "Incorporadora / Construtora / Loteadora (financiamento direto)",
};

export function gerarParecerImobiliario(
  params: ParametrosImobiliario,
  analise: AnaliseAbusividadeImob,
  resumo: ResumoComparativoImob,
  taxaRecalculoAplicada: number,
  criterioRecalculo: string,
  protocoloCalculo?: string,
  dadosParcelasPagas?: DadosRecalculoImob,
): string {
  const s: string[] = [];

  // ─── Cabeçalho ──────────────────────────────────────────────────
  s.push(`# PARECER TÉCNICO — REVISÃO DE FINANCIAMENTO IMOBILIÁRIO\n`);
  if (protocoloCalculo) s.push(`**Protocolo:** ${protocoloCalculo}\n`);
  s.push(`**Data de emissão:** ${new Date().toLocaleDateString("pt-BR")}\n`);
  s.push(`---\n`);

  // ─── 1. Dados do Contrato ──────────────────────────────────────
  s.push(`## 1. DADOS DO CONTRATO\n`);
  s.push(`| Item | Valor |`);
  s.push(`|------|-------|`);
  s.push(`| Valor do Imóvel | ${formatBRL(params.valorImovel)} |`);
  s.push(`| Valor Financiado | ${formatBRL(params.valorFinanciado)} |`);
  s.push(`| Entrada | ${formatBRL(params.valorImovel - params.valorFinanciado)} (${formatPercent(round2((params.valorImovel - params.valorFinanciado) / params.valorImovel * 100), 1)}) |`);
  s.push(`| Enquadramento | **${analise.enquadramento}** |`);
  s.push(`| Tipo de Credor | ${TIPO_CREDOR_LABELS[analise.tipoCredor] ?? analise.tipoCredor} |`);
  s.push(`| Sistema de Amortização | ${SISTEMA_LABELS[params.sistemaAmortizacao] ?? params.sistemaAmortizacao} |`);
  s.push(`| Taxa de Juros | ${formatPercent(analise.taxaContratadaMensal)} a.m. / ${formatPercent(params.taxaJurosAnual, 2)} a.a. |`);
  s.push(`| Indexador de Correção | ${INDEXADOR_LABELS[params.indexador]} (${formatPercent(params.taxaIndexadorAnual, 2)} a.a.) |`);
  s.push(`| Prazo | ${params.prazoMeses} meses (${round2(params.prazoMeses / 12)} anos) |`);
  s.push(`| Data do Contrato | ${formatDate(params.dataContrato)} |`);
  s.push(`| Primeiro Vencimento | ${formatDate(params.dataPrimeiroVencimento)} |`);
  s.push(`| Idade do Comprador | ${params.idadeComprador} anos |`);
  s.push(``);

  // ─── 2. Seguros Obrigatórios ───────────────────────────────────
  s.push(`## 2. SEGUROS OBRIGATÓRIOS E ENCARGOS\n`);
  s.push(`### 2.1 Seguro MIP (Morte e Invalidez Permanente)\n`);
  s.push(analise.mipDetalhes);
  s.push(`\nO seguro MIP incide mensalmente sobre o **saldo devedor**, decrescendo ao longo do financiamento.\n`);

  s.push(`### 2.2 Seguro DFI (Danos Físicos ao Imóvel)\n`);
  s.push(analise.dfiDetalhes);
  s.push(`\nO seguro DFI incide sobre o **valor de avaliação do imóvel** (${formatBRL(params.valorImovel)}), sendo valor fixo.\n`);

  s.push(`### 2.3 Venda Casada de Seguro\n`);
  s.push(analise.vendaCasadaDetalhes);
  s.push(``);

  s.push(`### 2.4 Taxa de Administração\n`);
  s.push(analise.taxaAdminDetalhes);
  s.push(``);

  // ─── 3. Enquadramento e Análise de Taxas ────────────────────────
  s.push(`## 3. ANÁLISE DE TAXAS DE JUROS\n`);

  s.push(`### 3.1 Enquadramento do Contrato\n`);
  if (analise.enquadramento === "SFH") {
    s.push(`O contrato se enquadra no **Sistema Financeiro de Habitação (SFH)** (imóvel de ${formatBRL(params.valorImovel)}, dentro do teto de R$ 2.250.000,00 — Resolução CMN 5.255/2025).\n`);
    s.push(`O SFH possui **teto legal de ${formatPercent(analise.tetoSFH_anual, 0)} ao ano** para taxa efetiva de juros, conforme **Lei 8.692/1993, art. 25** (com redação da MP 2.197-43/2001).\n`);
    s.push(`**NOTA IMPORTANTE:** A Súmula 422 do STJ (Corte Especial, 2010) estabelece que o art. 6º, "e", da Lei 4.380/1964 **não** estabelece limitação aos juros remuneratórios. O fundamento correto do teto é a **Lei 8.692/1993**.\n`);
  } else {
    s.push(`O contrato se enquadra no **Sistema de Financiamento Imobiliário (SFI)** (imóvel de ${formatBRL(params.valorImovel)}, acima do teto SFH). O SFI **não possui teto legal** para taxa de juros (Lei 9.514/1997). A análise de abusividade segue o critério geral do STJ (Súmula 382 + REsp 1.061.530/RS).\n`);
  }

  s.push(`### 3.2 Verificação de Equivalência\n`);
  s.push(`| Item | Valor |`);
  s.push(`|------|-------|`);
  s.push(`| Taxa mensal calculada | ${formatPercent(analise.taxaMensalCalculada)} a.m. |`);
  s.push(`| Taxa anual calculada | ${formatPercent(analise.taxaAnualCalculada, 2)} a.a. |`);
  s.push(`| Taxa anual informada | ${formatPercent(params.taxaJurosAnual, 2)} a.a. |`);
  s.push(`| Taxas equivalentes | ${analise.taxasEquivalentes ? "Sim ✓" : "Não ✗"} |`);
  s.push(``);

  s.push(`### 3.3 Comparação com Média BACEN e Teto Legal\n`);
  s.push(`| Item | Valor |`);
  s.push(`|------|-------|`);
  s.push(`| Taxa contratada | ${formatPercent(params.taxaJurosAnual, 2)} a.a. |`);
  s.push(`| Média BACEN | ${formatPercent(analise.taxaMediaBACEN_anual, 2)} a.a. |`);
  if (analise.enquadramento === "SFH") {
    s.push(`| **Teto legal SFH** | **${formatPercent(analise.tetoSFH_anual, 0)} a.a.** (Lei 8.692/1993) |`);
  }
  s.push(`| Diferença vs média | ${analise.percentualAcimaDaMedia > 0 ? "+" : ""}${formatPercent(analise.percentualAcimaDaMedia, 1)} |`);
  s.push(``);

  if (analise.violaTetoSFH) {
    s.push(`**Conclusão:** A taxa contratada de ${formatPercent(params.taxaJurosAnual, 2)} a.a. **viola o teto legal do SFH** de ${formatPercent(analise.tetoSFH_anual, 0)} a.a. (Lei 8.692/1993, art. 25). A cobrança é **ilegal**.\n`);
  } else if (analise.taxaAbusiva) {
    s.push(`**Conclusão:** A taxa contratada de ${formatPercent(params.taxaJurosAnual, 2)} a.a. é ${formatPercent(analise.percentualAcimaDaMedia, 1)} acima da média BACEN. Configura-se **abusividade** conforme REsp 1.061.530/RS e Súmula 382/STJ.\n`);
  } else {
    s.push(`**Conclusão:** A taxa contratada está **dentro** dos limites legais e parâmetros de mercado.\n`);
  }

  // ─── 4. Capitalização ──────────────────────────────────────────
  s.push(`### 3.4 Capitalização de Juros (Anatocismo)\n`);
  s.push(`**Regime identificado:** ${analise.capitalizacao.regime}\n`);
  s.push(analise.capitalizacao.detalhes);
  s.push(``);
  s.push(`**Fundamentação:** ${analise.capitalizacao.fundamentacao}\n`);
  if (analise.capitalizacao.irregular) {
    s.push(`**Situação:** ⚠️ Potencial irregularidade na capitalização.\n`);
  } else {
    s.push(`**Situação:** ✓ Capitalização dentro dos parâmetros legais para este regime.\n`);
  }

  // ─── 5. Indexador ──────────────────────────────────────────────
  s.push(`### 3.5 Indexador de Correção Monetária\n`);
  s.push(analise.indexadorDetalhes);
  s.push(``);

  // ─── 6. Resumo de Irregularidades ──────────────────────────────
  if (analise.irregularidades.length > 0) {
    s.push(`## 4. IRREGULARIDADES DETECTADAS\n`);
    for (const irr of analise.irregularidades) {
      s.push(`- ${irr}`);
    }
    s.push(``);
  } else {
    s.push(`## 4. IRREGULARIDADES DETECTADAS\n`);
    s.push(`Nenhuma irregularidade significativa foi detectada nos parâmetros analisados.\n`);
  }

  // ─── 7. Resumo Comparativo ─────────────────────────────────────
  s.push(`## 5. RESUMO COMPARATIVO — ORIGINAL vs RECALCULADO\n`);
  s.push(`**Critério de recálculo:** ${criterioRecalculo} (${formatPercent(taxaRecalculoAplicada, 2)} a.a.)\n`);
  s.push(`| Componente | Original | Recalculado | Diferença |`);
  s.push(`|-----------|----------|-------------|-----------|`);
  s.push(`| Total Pago | ${formatBRL(resumo.totalPagoOriginal)} | ${formatBRL(resumo.totalPagoRecalculado)} | ${formatBRL(resumo.diferencaTotal)} |`);
  s.push(`| Total Juros | ${formatBRL(resumo.totalJurosOriginal)} | ${formatBRL(resumo.totalJurosRecalculado)} | ${formatBRL(resumo.diferencaJuros)} |`);
  s.push(`| Total Correção | ${formatBRL(resumo.totalCorrecaoOriginal)} | ${formatBRL(resumo.totalCorrecaoRecalculado)} | ${formatBRL(resumo.diferencaCorrecao)} |`);
  s.push(`| Total MIP | ${formatBRL(resumo.totalMIPOriginal)} | ${formatBRL(resumo.totalMIPRecalculado)} | ${formatBRL(round2(resumo.totalMIPOriginal - resumo.totalMIPRecalculado))} |`);
  s.push(`| Total DFI | ${formatBRL(resumo.totalDFIOriginal)} | ${formatBRL(resumo.totalDFIRecalculado)} | ${formatBRL(round2(resumo.totalDFIOriginal - resumo.totalDFIRecalculado))} |`);
  s.push(`| Total Tx. Admin | ${formatBRL(resumo.totalTxAdminOriginal)} | ${formatBRL(resumo.totalTxAdminRecalculado)} | ${formatBRL(round2(resumo.totalTxAdminOriginal - resumo.totalTxAdminRecalculado))} |`);
  s.push(``);

  s.push(`### Valores Consolidados\n`);
  s.push(`| Item | Valor |`);
  s.push(`|------|-------|`);
  s.push(`| **Diferença total** | **${formatBRL(resumo.diferencaTotal)}** |`);
  s.push(`| Repetição de indébito (art. 42, CDC) | ${formatBRL(resumo.repeticaoIndebito)} |`);
  s.push(``);

  // ─── 8. Parcelas Pagas ─────────────────────────────────────────
  if (dadosParcelasPagas) {
    s.push(`## 6. ANÁLISE DE PARCELAS PAGAS\n`);
    s.push(`| Item | Valor |`);
    s.push(`|------|-------|`);
    s.push(`| Parcelas pagas | ${dadosParcelasPagas.parcelasPagas} de ${dadosParcelasPagas.parcelasPagas + dadosParcelasPagas.parcelasRestantes} |`);
    s.push(`| Total pago (contrato) | ${formatBRL(dadosParcelasPagas.valorPagoTotal)} |`);
    s.push(`| Total devido (recálculo) | ${formatBRL(dadosParcelasPagas.valorDevidoRecalculado)} |`);
    s.push(`| **Valor pago a mais** | **${formatBRL(dadosParcelasPagas.valorPagoAMais)}** |`);
    s.push(`| Saldo devedor atual (contrato) | ${formatBRL(dadosParcelasPagas.saldoDevedorAtualOriginal)} |`);
    s.push(`| Saldo devedor atual (recálculo) | ${formatBRL(dadosParcelasPagas.saldoDevedorAtualRecalculado)} |`);
    s.push(`| Parcelas restantes | ${dadosParcelasPagas.parcelasRestantes} |`);
    s.push(``);
  }

  // ─── 9. Fundamentação Legal ────────────────────────────────────
  const numFund = dadosParcelasPagas ? "7" : "6";
  s.push(`## ${numFund}. FUNDAMENTAÇÃO LEGAL\n`);
  s.push(`Este parecer foi elaborado com base na seguinte legislação e jurisprudência:\n`);
  s.push(`- **Lei 8.692/1993, art. 25** (MP 2.197-43/2001): teto de 12% a.a. no SFH`);
  s.push(`- **Súmula 422/STJ** (Corte Especial, 2010): art. 6º, "e", da Lei 4.380/1964 não limita juros`);
  s.push(`- **Súmula 382/STJ**: juros acima de 12% a.a. não são automaticamente abusivos`);
  s.push(`- **Súmula 596/STF**: Lei de Usura não se aplica a instituições do SFN`);
  s.push(`- **REsp 1.061.530/RS** (repetitivo): critério 1,5× média BACEN para abusividade`);
  s.push(`- **Tema 572/STJ** (REsp 1.124.552/RS): Price é questão de fato, necessita perícia`);
  s.push(`- **Súmula 539/STJ**: capitalização mensal permitida no SFN desde 31/03/2000`);
  s.push(`- **Lei 11.977/2009** (art. 15-A da Lei 4.380/1964): capitalização mensal no SFH`);
  s.push(`- **REsp 2.086.650/MG** (STJ, 3ª Turma, fev/2025): capitalização mensal vedada no SFI`);
  s.push(`- **Súmula 473/STJ**: livre escolha de seguradora no SFH`);
  s.push(`- **Lei 14.905/2024**: capitalização permitida entre PJ com pactuação expressa`);
  s.push(`- **Resolução CMN 5.255/2025**: novo modelo SFH, teto R$ 2,25M`);
  s.push(``);

  // ─── 10. Conclusão ──────────────────────────────────────────────
  const numConcl = dadosParcelasPagas ? "8" : "7";
  s.push(`## ${numConcl}. CONCLUSÃO\n`);

  if (analise.irregularidades.length > 0) {
    s.push(`Diante da análise técnica realizada, foram identificadas **${analise.irregularidades.length} irregularidade(s)** no contrato de financiamento imobiliário.\n`);
    s.push(`A diferença total entre o valor cobrado e o valor devido com a taxa de mercado (${formatPercent(taxaRecalculoAplicada, 2)} a.a.) é de **${formatBRL(resumo.diferencaTotal)}**, podendo atingir **${formatBRL(resumo.repeticaoIndebito)}** em repetição de indébito (art. 42, CDC).\n`);
  } else {
    s.push(`A análise técnica não identificou irregularidades significativas. A diferença entre a taxa contratada e a taxa média resulta em custo adicional de **${formatBRL(resumo.diferencaTotal)}** ao longo do financiamento.\n`);
  }

  s.push(`Este parecer técnico foi elaborado com base nas informações fornecidas e na legislação/jurisprudência vigente.\n`);
  s.push(`---\n`);
  s.push(`*Parecer gerado automaticamente pelo SaaS de Cálculos Jurídicos.*`);

  return s.join("\n");
}

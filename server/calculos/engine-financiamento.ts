/**
 * Engine de Cálculo Bancário — Revisão de Financiamento v4
 *
 * v4 — Melhorias:
 * - Verificação da parcela declarada vs calculada
 * - Validação de datas (bloqueia datas futuras)
 * - Comparativo com 4 cálculos (taxa contrato cap/não-cap + BACEN cap/não-cap)
 * - Validação de taxas BACEN (rejeita valores absurdos)
 */

import type {
  ParametrosFinanciamento, LinhaFinanciamento, AnaliseAbusividade,
  ResumoComparativo, TarifaIlegal, ResultadoFinanciamento,
  VerificacaoTaxas, VerificacaoEncargosMora, CustoEfetivoTotal,
  DadosRecalculoParcelasPagas, ComparativoCenario,
} from "../../shared/financiamento-types";

// ─── Utilitários ───────────────────────────────────────────────────────────────

export function round2(v: number): number { return parseFloat(v.toFixed(2)); }
export function round4(v: number): number { return parseFloat(v.toFixed(4)); }
export function round8(v: number): number { return parseFloat(v.toFixed(8)); }

export function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const tM = (m - 1 + months) % 12;
  const tY = y + Math.floor((m - 1 + months) / 12);
  const last = new Date(tY, tM + 1, 0).getDate();
  return `${tY}-${String(tM + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

export function mensalParaAnual(t: number): number { return round4((Math.pow(1 + t / 100, 12) - 1) * 100); }
export function anualParaMensal(t: number): number { return round4((Math.pow(1 + t / 100, 1 / 12) - 1) * 100); }

// ─── Validação de Datas ──────────────────────────────────────────────────────

export function validarDatas(params: ParametrosFinanciamento): string[] {
  const erros: string[] = [];
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const hojeStr = hoje.toISOString().slice(0, 10);

  const dataContrato = new Date(params.dataContrato + "T00:00:00");
  const dataPrimeiroVenc = new Date(params.dataPrimeiroVencimento + "T00:00:00");

  if (params.dataContrato > hojeStr) {
    erros.push(`Data do contrato (${params.dataContrato}) não pode ser futura. Data atual: ${hojeStr}.`);
  }

  if (params.dataPrimeiroVencimento > hojeStr) {
    // Primeiro vencimento pode ser futuro se o contrato é recente, mas não mais de 60 dias
    const limiteVenc = new Date(hoje);
    limiteVenc.setDate(limiteVenc.getDate() + 60);
    if (dataPrimeiroVenc > limiteVenc) {
      erros.push(`Data do primeiro vencimento (${params.dataPrimeiroVencimento}) está muito no futuro. Máximo: 60 dias a partir de hoje.`);
    }
  }

  if (dataPrimeiroVenc < dataContrato) {
    erros.push(`Data do primeiro vencimento (${params.dataPrimeiroVencimento}) não pode ser anterior à data do contrato (${params.dataContrato}).`);
  }

  return erros;
}

// ─── Verificação de Parcela Declarada ─────────────────────────────────────────

export interface VerificacaoParcela {
  parcelaDeclarada: number;
  parcelaCalculada: number;
  diferenca: number;
  percentualDiferenca: number;
  compativel: boolean;
  observacao: string;
}

export function verificarParcela(params: ParametrosFinanciamento, parcelaCalculada: number): VerificacaoParcela | undefined {
  if (!params.valorParcela || params.valorParcela <= 0) return undefined;

  const diferenca = round2(params.valorParcela - parcelaCalculada);
  const percentual = parcelaCalculada > 0 ? round2(Math.abs(diferenca) / parcelaCalculada * 100) : 0;
  const compativel = percentual <= 5; // tolerância de 5%

  let observacao: string;
  if (compativel) {
    observacao = `Parcela declarada (R$ ${params.valorParcela.toFixed(2)}) é compatível com a calculada (R$ ${parcelaCalculada.toFixed(2)}). Diferença de ${percentual.toFixed(1)}%.`;
  } else if (diferenca > 0) {
    observacao = `Parcela declarada (R$ ${params.valorParcela.toFixed(2)}) é ${percentual.toFixed(1)}% SUPERIOR à calculada (R$ ${parcelaCalculada.toFixed(2)}). Possível cobrança de tarifas embutidas, seguros ou encargos não declarados.`;
  } else {
    observacao = `Parcela declarada (R$ ${params.valorParcela.toFixed(2)}) é ${percentual.toFixed(1)}% INFERIOR à calculada (R$ ${parcelaCalculada.toFixed(2)}). Verifique se os dados do contrato estão corretos.`;
  }

  return { parcelaDeclarada: params.valorParcela, parcelaCalculada, diferenca, percentualDiferenca: percentual, compativel, observacao };
}

// ─── Verificação de Taxas ──────────────────────────────────────────────────────

export function verificarEquivalenciaTaxas(taxaMensal: number, taxaAnual: number): VerificacaoTaxas {
  const anualEq = mensalParaAnual(taxaMensal);
  if (taxaAnual <= 0) {
    return { taxaMensalInformada: taxaMensal, taxaAnualInformada: anualEq, taxaAnualEquivalente: anualEq, taxaMensalEquivalente: taxaMensal, taxasEquivalentes: true, capitalizacaoDiaria: false, capitalizacaoDetalhes: `Taxa anual calculada automaticamente: ${anualEq.toFixed(2)}% a.a.`, anualAutoCalculada: true };
  }
  const mensalEq = anualParaMensal(taxaAnual);
  const diff = Math.abs(taxaAnual - anualEq);
  const equiv = diff < 0.05;
  const capDiaria = taxaAnual > anualEq + 0.1;
  let det = equiv ? "Taxas equivalentes por capitalização composta mensal." : capDiaria ? `Possível capitalização diária. Anual informada ${taxaAnual.toFixed(2)}% > equivalente ${anualEq.toFixed(2)}%. Diferença ${diff.toFixed(4)} p.p.` : `Taxas não equivalentes. Informada: ${taxaAnual.toFixed(2)}% vs equivalente: ${anualEq.toFixed(2)}%. Diferença ${diff.toFixed(4)} p.p.`;
  return { taxaMensalInformada: taxaMensal, taxaAnualInformada: taxaAnual, taxaAnualEquivalente: anualEq, taxaMensalEquivalente: mensalEq, taxasEquivalentes: equiv, capitalizacaoDiaria: capDiaria, capitalizacaoDetalhes: det, anualAutoCalculada: false };
}

// ─── Encargos de Mora ──────────────────────────────────────────────────────────

export function verificarEncargosMora(params: ParametrosFinanciamento): VerificacaoEncargosMora {
  const multa = params.multaMora ?? 0, juros = params.jurosMora ?? 0, cp = params.comissaoPermanencia ?? 0;
  const multaAbusiva = multa > 2, jurosAbusivos = juros > 1;
  const cpCumulada = cp > 0 && (multa > 0 || juros > 0);
  const irr: string[] = [];
  if (multaAbusiva) irr.push(`Multa moratória de ${multa}% excede o limite de 2% (CDC art. 52, §1°). Excesso: ${round2(multa - 2)} p.p.`);
  if (jurosAbusivos) irr.push(`Juros moratórios de ${juros}% a.m. excedem o limite de 1% a.m. (CC art. 406). Excesso: ${round4(juros - 1)} p.p.`);
  if (cpCumulada) irr.push(`Comissão de permanência (${cp}% a.m.) cumulada com outros encargos. Vedado pela Súmula 472 do STJ.`);
  return { multaMoraInformada: multa, multaMoraLegal: 2, multaMoraAbusiva: multaAbusiva, jurosMoraInformados: juros, jurosMoraLegal: 1, jurosMoraAbusivos: jurosAbusivos, comissaoPermanencia: cp, comissaoPermanenciaCumulada: cpCumulada, irregularidades: irr };
}

// ─── Amortização ───────────────────────────────────────────────────────────────

function semJuros(pv: number, n: number, dv: string): LinhaFinanciamento[] {
  const a = round2(pv / n); const ls: LinhaFinanciamento[] = []; let s = pv;
  for (let p = 1; p <= n; p++) { const sA = round2(s); const am = p === n ? sA : a; s = p === n ? 0 : round2(sA - am); ls.push({ parcela: p, dataVencimento: addMonths(dv, p - 1), saldoDevedorAnterior: sA, juros: 0, amortizacao: am, valorParcela: am, saldoDevedorAtual: Math.max(0, s) }); }
  return ls;
}

export function calcularPRICE(pv: number, i: number, n: number, dv: string): LinhaFinanciamento[] {
  if (i === 0) return semJuros(round2(pv), n, dv);
  const ii = round8(i), pvr = round2(pv);
  const f = round8((ii * Math.pow(1 + ii, n)) / (Math.pow(1 + ii, n) - 1));
  const pmt = round2(pvr * f); const ls: LinhaFinanciamento[] = []; let s = pvr;
  for (let p = 1; p <= n; p++) { const sA = round2(s); const j = round2(sA * ii); const am = p === n ? sA : round2(pmt - j); const vp = p === n ? round2(sA + j) : pmt; s = p === n ? 0 : round2(sA - am); ls.push({ parcela: p, dataVencimento: addMonths(dv, p - 1), saldoDevedorAnterior: sA, juros: j, amortizacao: am, valorParcela: vp, saldoDevedorAtual: Math.max(0, s) }); }
  return ls;
}

export function calcularSAC(pv: number, i: number, n: number, dv: string): LinhaFinanciamento[] {
  if (i === 0) return semJuros(round2(pv), n, dv);
  const ii = round8(i), pvr = round2(pv), af = round2(pvr / n); const ls: LinhaFinanciamento[] = []; let s = pvr;
  for (let p = 1; p <= n; p++) { const sA = round2(s); const j = round2(sA * ii); const am = p === n ? sA : af; const vp = round2(am + j); s = p === n ? 0 : round2(sA - am); ls.push({ parcela: p, dataVencimento: addMonths(dv, p - 1), saldoDevedorAnterior: sA, juros: j, amortizacao: am, valorParcela: vp, saldoDevedorAtual: Math.max(0, s) }); }
  return ls;
}

export function calcularSACRE(pv: number, i: number, n: number, dv: string): LinhaFinanciamento[] {
  if (i === 0) return semJuros(round2(pv), n, dv);
  const ii = round8(i), pvr = round2(pv); const ls: LinhaFinanciamento[] = []; let s = pvr;
  for (let p = 1; p <= n; p++) { const sA = round2(s); const r = n - p + 1; const f = round8((ii * Math.pow(1 + ii, r)) / (Math.pow(1 + ii, r) - 1)); const pmt = round2(sA * f); const j = round2(sA * ii); const am = p === n ? sA : round2(pmt - j); const vp = p === n ? round2(sA + j) : pmt; s = p === n ? 0 : round2(sA - am); ls.push({ parcela: p, dataVencimento: addMonths(dv, p - 1), saldoDevedorAnterior: sA, juros: j, amortizacao: am, valorParcela: vp, saldoDevedorAtual: Math.max(0, s) }); }
  return ls;
}

/**
 * Método Gauss (Juros Simples com parcelas fixas).
 *
 * Fórmulas (Revista FT, DOI: 10.5281/zenodo.12601223):
 *   PMT = 2 × P × (1 + i×n) / (n × (2 + (n−1)×i))
 *   A₁  = 2 × P / (n × (2 + (n−1)×i))
 *   r   = A₁ × i   (razão da PA de amortizações)
 *   Aₖ  = A₁ + (k−1) × r
 *   Jₖ  = PMT − Aₖ
 *
 * Propriedades:
 * - Amortização cresce em PA (A₁ < A₂ < … < Aₙ)
 * - Juros decrescem linearmente (J₁ > J₂ > … > Jₙ)
 * - Saldo devedor SEMPRE decresce e zera na última parcela
 * - Total de juros < PRICE (juros simples < compostos)
 */
export function calcularGauss(K: number, i: number, n: number, dv: string): LinhaFinanciamento[] {
  if (i === 0) return semJuros(round2(K), n, dv);
  const capital = round2(K);

  // PMT = 2P(1+in) / (n(2+(n-1)i))
  const pmt = round2(2 * capital * (1 + i * n) / (n * (2 + (n - 1) * i)));

  // Primeira amortização e razão da PA
  const A1 = 2 * capital / (n * (2 + (n - 1) * i));
  const r = A1 * i;

  const ls: LinhaFinanciamento[] = [];
  let s = capital;
  for (let p = 1; p <= n; p++) {
    const sA = round2(s);
    const am = p === n ? sA : round2(A1 + (p - 1) * r);
    const j = p === n ? round2(pmt - sA) : round2(pmt - am);
    const vp = p === n ? round2(sA + j) : pmt;
    s = p === n ? 0 : round2(sA - am);
    ls.push({ parcela: p, dataVencimento: addMonths(dv, p - 1), saldoDevedorAnterior: sA, juros: Math.max(0, j), amortizacao: am, valorParcela: vp, saldoDevedorAtual: Math.max(0, s) });
  }
  return ls;
}

export function calcularPMTGauss(K: number, i: number, n: number): number {
  if (i === 0 || n === 0) return n > 0 ? round2(K / n) : 0;
  return round2(K * (1 + i * n) / ((1 + i * (n - 1) / 2) * n));
}

// ─── Tarifas ───────────────────────────────────────────────────────────────────

export function calcularTarifasFinanciadas(p: ParametrosFinanciamento): number {
  const t = p.tarifas; if (!t) return 0; let tot = 0;
  if (t.tac && t.tacFinanciada) tot += t.tac;
  if (t.tec && t.tecFinanciada) tot += t.tec;
  if (t.iof && t.iofFinanciado) tot += t.iof;
  if (t.seguro && t.seguroFinanciado) tot += t.seguro;
  if (t.avaliacaoBem && t.avaliacaoBemFinanciada) tot += t.avaliacaoBem;
  if (t.registroContrato && t.registroContratoFinanciado) tot += t.registroContrato;
  if (t.outras) for (const o of t.outras) if (o.valor > 0 && o.financiada) tot += o.valor;
  return round2(tot);
}

// ─── Demonstrativo Original ──────────────────────────────────────────────────

function gerarDemonstrativoOriginal(params: ParametrosFinanciamento): LinhaFinanciamento[] {
  const taxa = params.taxaJurosMensal / 100;
  const valor = params.valorFinanciado;
  switch (params.sistemaAmortizacao) {
    case "PRICE": return calcularPRICE(valor, taxa, params.quantidadeParcelas, params.dataPrimeiroVencimento);
    case "SAC": return calcularSAC(valor, taxa, params.quantidadeParcelas, params.dataPrimeiroVencimento);
    case "SACRE": return calcularSACRE(valor, taxa, params.quantidadeParcelas, params.dataPrimeiroVencimento);
    default: return calcularPRICE(valor, taxa, params.quantidadeParcelas, params.dataPrimeiroVencimento);
  }
}

// ─── CET ───────────────────────────────────────────────────────────────────────

export function calcularCET(params: ParametrosFinanciamento): CustoEfetivoTotal {
  const t = params.tarifas; let tarifasAnt = 0;
  if (t) {
    if (t.tac && !t.tacFinanciada) tarifasAnt += t.tac;
    if (t.tec && !t.tecFinanciada) tarifasAnt += t.tec;
    if (t.iof && !t.iofFinanciado) tarifasAnt += t.iof;
    if (t.seguro && !t.seguroFinanciado) tarifasAnt += t.seguro;
    if (t.avaliacaoBem && !t.avaliacaoBemFinanciada) tarifasAnt += t.avaliacaoBem;
    if (t.registroContrato && !t.registroContratoFinanciado) tarifasAnt += t.registroContrato;
    if (t.outras) for (const o of t.outras) if (o.valor > 0 && !o.financiada) tarifasAnt += o.valor;
  }
  const valorRecebido = params.valorFinanciado - calcularTarifasFinanciadas(params);
  const demo = gerarDemonstrativoOriginal(params);
  const parcelas = demo.map(l => l.valorParcela);
  const valorLiq = valorRecebido - tarifasAnt;
  if (valorLiq <= 0) return { cetMensal: 0, cetAnual: 0, taxaNominalMensal: params.taxaJurosMensal, taxaNominalAnual: params.taxaJurosAnual || mensalParaAnual(params.taxaJurosMensal), diferencaCET_vs_Nominal: 0 };

  let cet = params.taxaJurosMensal / 100; if (cet <= 0) cet = 0.01;
  for (let it = 0; it < 100; it++) {
    let vpl = -valorLiq, dv = 0;
    for (let k = 0; k < parcelas.length; k++) { const f = Math.pow(1 + cet, k + 1); vpl += parcelas[k] / f; dv -= (k + 1) * parcelas[k] / Math.pow(1 + cet, k + 2); }
    if (Math.abs(dv) < 1e-12) break;
    const nv = cet - vpl / dv; if (Math.abs(nv - cet) < 1e-10) { cet = nv; break; } cet = Math.max(nv, 1e-8);
  }
  const cetM = round4(cet * 100), cetA = round4((Math.pow(1 + cet, 12) - 1) * 100);
  const nomA = params.taxaJurosAnual > 0 ? params.taxaJurosAnual : mensalParaAnual(params.taxaJurosMensal);
  return { cetMensal: cetM, cetAnual: cetA, taxaNominalMensal: params.taxaJurosMensal, taxaNominalAnual: nomA, diferencaCET_vs_Nominal: round4(cetA - nomA) };
}

// ─── Análise ───────────────────────────────────────────────────────────────────

const DATA_MP_2170 = "2000-03-31", DATA_RES_3518 = "2008-04-30";

export function detectarAnatocismo(tM: number, tA: number): boolean { return tA > 0 && tA > tM * 12 + 0.1; }
export function anatocismoPermitido(dc: string): boolean { return dc > DATA_MP_2170; }
export function anatocismoPactuadoPorSumula541(tM: number, tA: number): boolean { return tA > 0 && tA > tM * 12 + 0.1; }

export function analisarTarifas(p: ParametrosFinanciamento): TarifaIlegal[] {
  const il: TarifaIlegal[] = []; const t = p.tarifas; if (!t) return il;
  const apos = p.dataContrato > DATA_RES_3518;
  if (t.tac && t.tac > 0 && apos) il.push({ descricao: "Tarifa de Abertura de Crédito (TAC)", valor: t.tac, fundamento: "Resolução CMN 3.518/2007 — Ilegal após 30/04/2008 (Súmula 565 STJ)" });
  if (t.tec && t.tec > 0 && apos) il.push({ descricao: "Tarifa de Emissão de Carnê (TEC)", valor: t.tec, fundamento: "Resolução CMN 3.518/2007 — Ilegal após 30/04/2008 (Súmula 566 STJ)" });
  if (t.seguro && t.seguro > 0 && !t.seguroLivreEscolha) il.push({ descricao: "Seguro Prestamista (venda casada)", valor: t.seguro, fundamento: "CDC art. 39, I — Sem livre escolha da seguradora (REsp 1.639.259/SP)" });
  return il;
}

// ─── Tetos legais por modalidade ──────────────────────────────────────────────

/**
 * Tetos legais de taxa de juros por modalidade (timeline-aware).
 *
 * A busca real é feita pelo router (async, via tabela tetos_legais com
 * vigência temporal). O resultado pre-fetched é passado ao engine como
 * parâmetro para manter `analisarAbusividade` sync.
 *
 * Se o router não passou teto (null), o engine aplica regra geral
 * (1,5× BACEN). O parecer inclui nota explicando que não há teto legal
 * específico cadastrado para a data da contratação.
 *
 * FALLBACK DE SEGURANÇA: se router não fez pre-fetch (undefined), usa
 * os valores hardcoded antigos como ÚLTIMO recurso — melhor do que
 * deixar o cálculo sem nenhum teto quando a tabela ainda não existe.
 */
function obterTetoLegal(
  params: ParametrosFinanciamento,
  tetoPreFetched?: { tetoMensal: number; fundamento: string } | null,
): { tetoMensal: number; fundamento: string } | undefined {
  // Se o router fez o pre-fetch, usar (pode ser null = sem teto pra essa data)
  if (tetoPreFetched !== undefined) {
    return tetoPreFetched ?? undefined;
  }

  // FALLBACK: valores hardcoded (se tabela não existe ainda ou router antigo)
  const { modalidadeCredito, tipoVinculoConsignado, dataContrato } = params;
  if (modalidadeCredito === "cheque_especial" && dataContrato >= "2020-01-06") {
    return { tetoMensal: 8, fundamento: "Resolução CMN 4.765/2019 — Teto de 8% a.m. para cheque especial (PF e MEI)" };
  }
  if (modalidadeCredito === "consignado" && tipoVinculoConsignado) {
    if (tipoVinculoConsignado === "inss") {
      return { tetoMensal: 1.85, fundamento: "Resolução CNPS 1.368/2025 — Teto de 1,85% a.m. para consignado INSS (fallback)" };
    }
    if (tipoVinculoConsignado === "servidor_publico") {
      return { tetoMensal: 1.80, fundamento: "Portaria MGI (dez/2023) — Teto de 1,80% a.m. para consignado servidor (fallback)" };
    }
  }
  return undefined;
}

/**
 * Verifica se juros acumulados excedem 100% do principal (Lei 14.690/2023 — Cartão de Crédito).
 * Vigente desde 03/01/2024. Aplica-se ao crédito rotativo e parcelamento de fatura.
 */
function verificarTetoJurosCartao(
  params: ParametrosFinanciamento,
): { excede: boolean; percentual: number } | undefined {
  if (params.modalidadeCredito !== "cartao_credito") return undefined;
  if (params.dataContrato < "2024-01-03") return undefined;

  const i = params.taxaJurosMensal / 100;
  const n = params.parcelasJaPagas ?? params.quantidadeParcelas;
  // Total de juros acumulados como % do principal (juros compostos)
  const fatorAcumulado = Math.pow(1 + i, n);
  const jurosAcumuladosPct = round2((fatorAcumulado - 1) * 100);

  return {
    excede: jurosAcumuladosPct > 100,
    percentual: jurosAcumuladosPct,
  };
}

export function analisarAbusividade(
  params: ParametrosFinanciamento,
  bacenM: number,
  bacenA: number,
  /** Teto legal pre-fetched da tabela tetos_legais (por data do contrato).
   *  undefined = router não fez fetch (fallback hardcoded interno).
   *  null = buscou mas não tem teto pra essa categoria/data. */
  tetoPreFetched?: { tetoMensal: number; fundamento: string } | null,
): AnaliseAbusividade {
  // 1. Teto STJ (regra geral): 1,5× média BACEN
  const tetoM = round4(bacenM * 1.5), tetoA = round4(mensalParaAnual(tetoM));
  const abusivaSTJ = params.taxaJurosMensal > tetoM;
  const pctAcima = bacenM > 0 ? round2(((params.taxaJurosMensal - bacenM) / bacenM) * 100) : 0;

  // 2. Teto legal específico (cheque especial, consignado servidor/INSS)
  const tetoLegal = obterTetoLegal(params, tetoPreFetched);
  const violaTetoLegal = tetoLegal ? params.taxaJurosMensal > tetoLegal.tetoMensal : false;

  // 3. Cartão de crédito: juros acumulados > 100% (Lei 14.690/2023)
  const cartaoCheck = verificarTetoJurosCartao(params);

  // Lógica de abusividade:
  // - Se tem teto legal (INSS, servidor, cheque especial): o teto legal PREVALECE sobre 1,5× BACEN.
  //   Taxa abaixo do teto legal → NÃO abusiva (mesmo que supere 1,5× BACEN).
  //   Taxa acima do teto legal → ILEGAL (não apenas abusiva).
  // - Se NÃO tem teto legal (CLT, militar, pessoal, veículo, capital giro): usa regra STJ 1,5× BACEN.
  // - Cartão de crédito: cumulativo (pode violar teto juros E excedem 100%).
  const abusiva = tetoLegal
    ? violaTetoLegal || (cartaoCheck?.excede ?? false)  // teto legal prevalece
    : abusivaSTJ || (cartaoCheck?.excede ?? false);     // regra geral STJ

  const vTaxas = verificarEquivalenciaTaxas(params.taxaJurosMensal, params.taxaJurosAnual);
  const tAEf = vTaxas.anualAutoCalculada ? vTaxas.taxaAnualEquivalente : params.taxaJurosAnual;
  const anat = detectarAnatocismo(params.taxaJurosMensal, tAEf);
  const perm = anatocismoPermitido(params.dataContrato);
  const expr = params.anatocismoExpressoPactuado ?? false;
  const s541 = anatocismoPactuadoPorSumula541(params.taxaJurosMensal, params.taxaJurosAnual);
  return {
    taxaContratadaMensal: params.taxaJurosMensal, taxaContratadaAnual: tAEf,
    taxaMediaBACEN_mensal: bacenM, taxaMediaBACEN_anual: bacenA,
    tetoSTJ_mensal: tetoM, tetoSTJ_anual: tetoA, taxaAbusiva: abusiva,
    percentualAcimaDaMedia: pctAcima,
    tetoLegal_mensal: tetoLegal?.tetoMensal,
    tetoLegal_fundamento: tetoLegal?.fundamento,
    violaTetoLegal,
    jurosAcumuladosExcedemPrincipal: cartaoCheck?.excede,
    jurosAcumuladosPercent: cartaoCheck?.percentual,
    verificacaoTaxas: vTaxas,
    anatocismoDetectado: anat, anatocismoPermitido: perm,
    anatocismoExpressoPactuado: expr,
    anatocismoPactuadoPorSumula541: s541,
    tarifasIlegais: analisarTarifas(params), totalTarifasFinanciadas: calcularTarifasFinanciadas(params),
    verificacaoEncargosMora: verificarEncargosMora(params), cet: calcularCET(params),
  };
}

// ─── Recálculo ─────────────────────────────────────────────────────────────────

export function calcularValorLiquido(p: ParametrosFinanciamento, il: TarifaIlegal[]): number {
  let tot = 0; const t = p.tarifas;
  for (const i of il) {
    if (i.descricao.includes("TAC") && t?.tacFinanciada) tot += i.valor;
    else if (i.descricao.includes("TEC") && t?.tecFinanciada) tot += i.valor;
    else if (i.descricao.includes("Seguro") && t?.seguroFinanciado) tot += i.valor;
  }
  return round2(p.valorFinanciado - tot);
}

export function determinarTaxaRecalculo(
  params: ParametrosFinanciamento, bacenM: number, analise: AnaliseAbusividade
): { taxa: number; criterio: string } {
  if (!analise.taxaAbusiva) {
    return {
      taxa: params.taxaJurosMensal / 100,
      criterio: `Taxa contratada (${params.taxaJurosMensal.toFixed(4)}% a.m.) — recálculo por Método Gauss (juros simples)`,
    };
  }
  const crit = params.taxaRecalculo ?? "media_bacen";
  switch (crit) {
    case "teto_stj": return { taxa: analise.tetoSTJ_mensal / 100, criterio: `Teto STJ (1,5× BACEN): ${analise.tetoSTJ_mensal.toFixed(4)}% a.m. + Método Gauss` };
    case "manual": return { taxa: (params.taxaManual ?? params.taxaJurosMensal) / 100, criterio: `Taxa manual: ${(params.taxaManual ?? params.taxaJurosMensal).toFixed(4)}% a.m. + Método Gauss` };
    default: {
      // Se viola teto legal, usa o teto legal como taxa substitutiva
      if (analise.violaTetoLegal && analise.tetoLegal_mensal) {
        return {
          taxa: analise.tetoLegal_mensal / 100,
          criterio: `Teto legal: ${analise.tetoLegal_mensal.toFixed(2)}% a.m. (${analise.tetoLegal_fundamento}) + Método Gauss`,
        };
      }
      // Se não viola teto legal mas viola STJ, usa média BACEN
      return { taxa: bacenM / 100, criterio: `Taxa média BACEN: ${bacenM.toFixed(4)}% a.m. (${analise.taxaMediaBACEN_anual.toFixed(2)}% a.a.) + Método Gauss` };
    }
  }
}

// ─── Parcelas Já Pagas ─────────────────────────────────────────────────────────

export function calcularRecalculoParcelasPagas(
  params: ParametrosFinanciamento, taxaRec: number, valorLiq: number,
  demoOrig: LinhaFinanciamento[], demoRecalc: LinhaFinanciamento[]
): DadosRecalculoParcelasPagas | undefined {
  const pp = params.parcelasJaPagas ?? 0;
  if (pp <= 0 || pp >= params.quantidadeParcelas) return undefined;
  const rest = params.quantidadeParcelas - pp;
  const pagoPrice = round2(demoOrig.slice(0, pp).reduce((s, l) => s + l.valorParcela, 0));
  const devidoGauss = round2(demoRecalc.slice(0, pp).reduce((s, l) => s + l.valorParcela, 0));
  const pagoAMais = round2(pagoPrice - devidoGauss);
  const saldoLegal = pp < demoRecalc.length ? demoRecalc[pp - 1].saldoDevedorAtual : 0;
  const saldoAtualizado = round2(Math.max(0, saldoLegal - pagoAMais));
  const novaParcela = calcularPMTGauss(saldoAtualizado, taxaRec, rest);
  return { parcelasPagas: pp, valorPagoTotal: pagoPrice, valorDevidoGauss: devidoGauss, valorPagoAMais: pagoAMais, saldoDevedorLegal: saldoLegal, saldoDevedorAtualizado: saldoAtualizado, parcelaFinalRecalculada: novaParcela, parcelasRestantes: rest, taxaRecalculo: round4(taxaRec * 100) };
}

// ─── Comparativo 4 Cenários ───────────────────────────────────────────────────

export function gerarComparativo4Cenarios(
  params: ParametrosFinanciamento,
  taxaBacenMensal: number,
  taxaBacenAnual: number
): ComparativoCenario[] {
  const valor = params.valorFinanciado;
  const n = params.quantidadeParcelas;
  const dv = params.dataPrimeiroVencimento;
  const taxaContratoDecimal = params.taxaJurosMensal / 100;
  const taxaBacenDecimal = taxaBacenMensal / 100;

  // 1. Taxa do contrato — Capitalizado (PRICE)
  const demoContratoPrice = calcularPRICE(valor, taxaContratoDecimal, n, dv);
  const totalContratoPrice = round2(demoContratoPrice.reduce((s, l) => s + l.valorParcela, 0));

  // 2. Taxa do contrato — Não capitalizado (Gauss)
  const demoContratoGauss = calcularGauss(valor, taxaContratoDecimal, n, dv);
  const totalContratoGauss = round2(demoContratoGauss.reduce((s, l) => s + l.valorParcela, 0));

  // 3. Taxa BACEN — Capitalizado (PRICE)
  const demoBacenPrice = calcularPRICE(valor, taxaBacenDecimal, n, dv);
  const totalBacenPrice = round2(demoBacenPrice.reduce((s, l) => s + l.valorParcela, 0));

  // 4. Taxa BACEN — Não capitalizado (Gauss)
  const demoBacenGauss = calcularGauss(valor, taxaBacenDecimal, n, dv);
  const totalBacenGauss = round2(demoBacenGauss.reduce((s, l) => s + l.valorParcela, 0));

  return [
    {
      descricao: "Taxa do Contrato — Capitalizado (PRICE)",
      valorFinanciado: valor,
      taxaMensal: params.taxaJurosMensal,
      taxaAnual: mensalParaAnual(params.taxaJurosMensal),
      valorParcela: demoContratoPrice[0]?.valorParcela ?? 0,
      totalPago: totalContratoPrice,
      capitalizado: true,
      fonteTaxa: "contrato",
    },
    {
      descricao: "Taxa do Contrato — Não Capitalizado (GAUSS)",
      valorFinanciado: valor,
      taxaMensal: params.taxaJurosMensal,
      taxaAnual: round4(params.taxaJurosMensal * 12),
      valorParcela: demoContratoGauss[0]?.valorParcela ?? 0,
      totalPago: totalContratoGauss,
      capitalizado: false,
      fonteTaxa: "contrato",
    },
    {
      descricao: "Taxa Média BACEN — Capitalizado (PRICE)",
      valorFinanciado: valor,
      taxaMensal: taxaBacenMensal,
      taxaAnual: taxaBacenAnual,
      valorParcela: demoBacenPrice[0]?.valorParcela ?? 0,
      totalPago: totalBacenPrice,
      capitalizado: true,
      fonteTaxa: "bacen",
    },
    {
      descricao: "Taxa Média BACEN — Não Capitalizado (GAUSS)",
      valorFinanciado: valor,
      taxaMensal: taxaBacenMensal,
      taxaAnual: round4(taxaBacenMensal * 12),
      valorParcela: demoBacenGauss[0]?.valorParcela ?? 0,
      totalPago: totalBacenGauss,
      capitalizado: false,
      fonteTaxa: "bacen",
    },
  ];
}

// ─── Resumo ────────────────────────────────────────────────────────────────────

export function gerarResumo(
  orig: LinhaFinanciamento[], recalc: LinhaFinanciamento[],
  analise: AnaliseAbusividade, vfOrig: number, vfLiq: number
): ResumoComparativo {
  const tpO = round2(orig.reduce((s, l) => s + l.valorParcela, 0));
  const tpR = round2(recalc.reduce((s, l) => s + l.valorParcela, 0));
  const tjO = round2(orig.reduce((s, l) => s + l.juros, 0));
  const tjR = round2(recalc.reduce((s, l) => s + l.juros, 0));
  const tTarif = round2(analise.tarifasIlegais.reduce((s, t) => s + t.valor, 0));
  let encAbusivos = 0; const mora = analise.verificacaoEncargosMora;
  const sM = round2(orig.reduce((s, l) => s + l.saldoDevedorAnterior, 0) / orig.length);
  if (mora.multaMoraAbusiva) encAbusivos += round2(sM * (mora.multaMoraInformada - 2) / 100);
  if (mora.jurosMoraAbusivos) encAbusivos += round2(sM * (mora.jurosMoraInformados - 1) / 100);
  const difT = round2(tpO - tpR + tTarif + encAbusivos);
  return { valorFinanciadoOriginal: vfOrig, valorFinanciadoLiquido: vfLiq, totalPagoOriginal: tpO, totalPagoRecalculado: tpR, diferencaTotal: difT, totalJurosOriginal: tjO, totalJurosRecalculado: tjR, diferencaJuros: round2(tjO - tjR), tarifasIlegais: tTarif, tarifasFinanciadas: analise.totalTarifasFinanciadas, encargosAbusivos: encAbusivos, repeticaoIndebito: round2(difT * 2) };
}

// ─── Protocolo ─────────────────────────────────────────────────────────────────

export function gerarProtocolo(): string {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `RC-${d}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
}

// ─── Validação de Taxa BACEN ──────────────────────────────────────────────────

/**
 * Valida se a taxa BACEN retornada é razoável para a modalidade.
 * Limites máximos por modalidade (% a.m.) — valores muito acima indicam erro.
 */
const LIMITES_TAXA_MENSAL: Record<string, number> = {
  credito_pessoal: 15,
  consignado: 5,
  financiamento_veiculo: 5,
  financiamento_imobiliario: 3,
  cartao_credito: 20,
  cheque_especial: 15,
  capital_giro: 8,
};

export function validarTaxaBACEN(taxaMensal: number, taxaAnual: number, modalidade: string): { valida: boolean; erro?: string } {
  const limite = LIMITES_TAXA_MENSAL[modalidade] ?? 20;

  if (taxaMensal <= 0 || taxaAnual <= 0) {
    return { valida: false, erro: `Taxa BACEN inválida (${taxaMensal}% a.m. / ${taxaAnual}% a.a.). Valor zero ou negativo.` };
  }

  if (taxaMensal > limite) {
    return { valida: false, erro: `Taxa BACEN mensal (${taxaMensal.toFixed(4)}% a.m.) excede o limite razoável de ${limite}% a.m. para ${modalidade}. Possível dado corrompido.` };
  }

  // Verificar coerência: taxa mensal convertida para anual deve ser próxima da anual informada
  const anualCalculada = (Math.pow(1 + taxaMensal / 100, 12) - 1) * 100;
  const diff = Math.abs(anualCalculada - taxaAnual);
  if (diff > 5) {
    return { valida: false, erro: `Incoerência entre taxa mensal (${taxaMensal.toFixed(4)}%) e anual (${taxaAnual.toFixed(2)}%). Diferença: ${diff.toFixed(2)} p.p.` };
  }

  return { valida: true };
}

// ─── MOTOR PRINCIPAL ───────────────────────────────────────────────────────────

export function calcularRevisaoFinanciamento(
  params: ParametrosFinanciamento,
  taxaMediaBACEN_mensal: number,
  taxaMediaBACEN_anual: number,
  /** Teto legal pre-fetched (timeline). undefined = sem fetch, null = sem teto. */
  tetoPreFetched?: { tetoMensal: number; fundamento: string } | null,
): Omit<ResultadoFinanciamento, "parecerTecnico"> & {
  verificacaoParcela?: VerificacaoParcela;
  comparativo4Cenarios: ComparativoCenario[];
} {
  // 0. Validar datas
  const errosDatas = validarDatas(params);
  if (errosDatas.length > 0) {
    throw new Error(`Erro de validação: ${errosDatas.join(" | ")}`);
  }

  // 1. Demonstrativo Original
  const demonstrativoOriginal = gerarDemonstrativoOriginal(params);

  // 1.5 Verificação da parcela declarada
  const parcelaCalculada = demonstrativoOriginal[0]?.valorParcela ?? 0;
  const verificacaoParcela = verificarParcela(params, parcelaCalculada);

  // 2. Análise completa (com teto legal por data do contrato, se disponível)
  const analise = analisarAbusividade(params, taxaMediaBACEN_mensal, taxaMediaBACEN_anual, tetoPreFetched);

  // 3. Determinar taxa para recálculo
  const { taxa: taxaRecalculo, criterio } = determinarTaxaRecalculo(params, taxaMediaBACEN_mensal, analise);

  // 4. Valor líquido
  const valorLiquido = calcularValorLiquido(params, analise.tarifasIlegais);

  // 5. Demonstrativo Recalculado — SEMPRE pelo Método Gauss
  const demonstrativoRecalculado = calcularGauss(
    valorLiquido, taxaRecalculo, params.quantidadeParcelas, params.dataPrimeiroVencimento
  );

  // 6. Resumo comparativo
  const resumo = gerarResumo(demonstrativoOriginal, demonstrativoRecalculado, analise, params.valorFinanciado, valorLiquido);

  // 7. Parcelas já pagas
  const dadosParcelasPagas = calcularRecalculoParcelasPagas(
    params, taxaRecalculo, valorLiquido, demonstrativoOriginal, demonstrativoRecalculado
  );

  // 8. Comparativo 4 cenários
  const comparativo4Cenarios = gerarComparativo4Cenarios(params, taxaMediaBACEN_mensal, taxaMediaBACEN_anual);

  return {
    demonstrativoOriginal, demonstrativoRecalculado, resumo, analiseAbusividade: analise,
    taxaRecalculoAplicada: taxaRecalculo * 100, criterioRecalculo: criterio,
    protocoloCalculo: gerarProtocolo(), dadosParcelasPagas,
    verificacaoParcela, comparativo4Cenarios,
  };
}

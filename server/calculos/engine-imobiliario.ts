/**
 * Engine de Cálculo Imobiliário — Revisão de Financiamento Habitacional v1
 *
 * Cobre:
 * - SAC e PRICE com correção monetária mensal (TR, IPCA, IGPM, IPC, Poupança)
 * - Seguros obrigatórios: MIP (Morte e Invalidez Permanente) e DFI (Danos Físicos ao Imóvel)
 * - Taxa de administração mensal
 * - Análise de abusividade (taxa vs BACEN, capitalização, seguros, indexador)
 * - Recálculo com taxa substitutiva e/ou indexador alternativo
 * - Comparativo original vs recalculado
 *
 * Referências:
 * - Resolução BACEN 3.811/2009 (seguros obrigatórios)
 * - Itaú: Cálculo das Prestações (fórmulas oficiais)
 * - CCCPM/Marinha: Tabela MIP por faixa etária
 */

import type {
  ParametrosImobiliario,
  LinhaImobiliario,
  AnaliseAbusividadeImob,
  AnaliseCapitalizacao,
  ResumoComparativoImob,
  ResultadoImobiliario,
  DadosRecalculoImob,
  IndexadorCorrecao,
  EnquadramentoImob,
  TipoCredor,
} from "../../shared/imobiliario-types";
import {
  TABELA_MIP_REFERENCIA,
  TAXA_DFI_REFERENCIA,
  TETO_SFH_VALOR_IMOVEL,
  TETO_SFH_TAXA_ANUAL,
  DATA_LEI_11977,
  DATA_LEI_14905,
} from "../../shared/imobiliario-types";

// ─── Utilitários ─────────────────────────────────────────────────────────────

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

/** Converte taxa anual para mensal (juros compostos) */
export function anualParaMensal(taxaAnual: number): number {
  return round8((Math.pow(1 + taxaAnual / 100, 1 / 12) - 1) * 100);
}

/** Converte taxa mensal para anual (juros compostos) */
export function mensalParaAnual(taxaMensal: number): number {
  return round4((Math.pow(1 + taxaMensal / 100, 12) - 1) * 100);
}

// ─── MIP e DFI ───────────────────────────────────────────────────────────────

/**
 * Obtém a taxa MIP mensal baseada na idade do comprador.
 * Retorna a taxa em percentual (ex: 0.022866 = 0.022866%).
 */
export function obterTaxaMIP(idade: number): number {
  for (const faixa of TABELA_MIP_REFERENCIA) {
    if (idade >= faixa.idadeMin && idade <= faixa.idadeMax) {
      return faixa.taxa;
    }
  }
  // Se idade fora da tabela, usa a faixa mais próxima
  if (idade < 18) return TABELA_MIP_REFERENCIA[0].taxa;
  return TABELA_MIP_REFERENCIA[TABELA_MIP_REFERENCIA.length - 1].taxa;
}

/**
 * Calcula o valor mensal do MIP.
 * MIP = saldoDevedor × (taxaMIP / 100)
 */
export function calcularMIP(saldoDevedor: number, taxaMIP: number): number {
  return round2(saldoDevedor * (taxaMIP / 100));
}

/**
 * Calcula o valor mensal do DFI.
 * DFI = valorAvaliacao × (taxaDFI / 100)
 */
export function calcularDFI(valorImovel: number, taxaDFI: number): number {
  return round2(valorImovel * (taxaDFI / 100));
}

// ─── Validação de Datas ──────────────────────────────────────────────────────

export function validarDatasImob(params: ParametrosImobiliario): string[] {
  const erros: string[] = [];
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const hojeStr = hoje.toISOString().slice(0, 10);

  if (params.dataContrato > hojeStr) {
    erros.push(`Data do contrato (${params.dataContrato}) não pode ser futura.`);
  }

  const dataPV = new Date(params.dataPrimeiroVencimento + "T00:00:00");
  const dataCont = new Date(params.dataContrato + "T00:00:00");
  if (dataPV < dataCont) {
    erros.push(`Data do primeiro vencimento não pode ser anterior à data do contrato.`);
  }

  if (params.prazoMeses < 1 || params.prazoMeses > 600) {
    erros.push(`Prazo deve estar entre 1 e 600 meses.`);
  }

  if (params.valorFinanciado > params.valorImovel) {
    erros.push(`Valor financiado (R$ ${params.valorFinanciado.toFixed(2)}) não pode ser superior ao valor do imóvel (R$ ${params.valorImovel.toFixed(2)}).`);
  }

  if (params.idadeComprador < 18 || params.idadeComprador > 80) {
    erros.push(`Idade do comprador deve estar entre 18 e 80 anos.`);
  }

  return erros;
}

// ─── Geração de Protocolo ────────────────────────────────────────────────────

export function gerarProtocolo(): string {
  const agora = new Date();
  const ts = agora.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `IMOB-${ts}-${rand}`;
}

// ─── Demonstrativo SAC com Correção Monetária ────────────────────────────────

/**
 * Gera o demonstrativo completo de um financiamento imobiliário pelo SAC
 * com correção monetária mensal.
 *
 * No SAC:
 * 1. Corrige o saldo devedor pelo indexador mensal
 * 2. Amortização = saldo corrigido / parcelas restantes
 * 3. Juros = saldo corrigido × taxa mensal
 * 4. MIP = saldo corrigido × taxa MIP
 * 5. DFI = valor imóvel × taxa DFI (fixo)
 * 6. Prestação = amort + juros + MIP + DFI + txAdmin
 * 7. Novo saldo = saldo corrigido - amortização
 */
export function calcularSACImob(
  valorFinanciado: number,
  taxaJurosMensal: number,    // em % (ex: 0.7207)
  prazoMeses: number,
  dataPrimeiroVencimento: string,
  taxaIndexadorMensal: number, // em % — usado como fallback se não houver série histórica
  taxaMIP: number,             // em % (ex: 0.022866)
  taxaDFI: number,             // em % (ex: 0.004684)
  valorImovel: number,
  txAdmin: number,             // valor fixo em R$
  serieHistorica?: Record<string, number>, // mapa "YYYY-MM" → taxa mensal % (opcional)
): LinhaImobiliario[] {
  const linhas: LinhaImobiliario[] = [];
  const iJuros = round8(taxaJurosMensal / 100);
  let saldo = round2(valorFinanciado);

  for (let p = 1; p <= prazoMeses; p++) {
    const saldoAnterior = round2(saldo);
    const restantes = prazoMeses - p + 1;
    const dataVenc = addMonths(dataPrimeiroVencimento, p - 1);
    const competencia = dataVenc.slice(0, 7); // "YYYY-MM"

    // 1. Correção monetária — usa taxa real do mês se disponível, senão fallback
    const taxaIndexMes = serieHistorica?.[competencia] ?? taxaIndexadorMensal;
    const iIndex = round8(taxaIndexMes / 100);
    const correcao = round2(saldoAnterior * iIndex);
    const saldoCorrigido = round2(saldoAnterior + correcao);

    // 2. Amortização (constante sobre saldo corrigido / restantes)
    const amort = p === prazoMeses ? saldoCorrigido : round2(saldoCorrigido / restantes);

    // 3. Juros sobre saldo corrigido
    const juros = round2(saldoCorrigido * iJuros);

    // 4. MIP sobre saldo corrigido
    const mip = calcularMIP(saldoCorrigido, taxaMIP);

    // 5. DFI sobre valor do imóvel (fixo)
    const dfi = calcularDFI(valorImovel, taxaDFI);

    // 6. Prestação total
    const prestacao = round2(amort + juros + mip + dfi + txAdmin);

    // 7. Novo saldo
    saldo = p === prazoMeses ? 0 : round2(saldoCorrigido - amort);

    linhas.push({
      parcela: p,
      dataVencimento: addMonths(dataPrimeiroVencimento, p - 1),
      saldoDevedorAnterior: saldoAnterior,
      correcaoMonetaria: correcao,
      saldoDevedorCorrigido: saldoCorrigido,
      amortizacao: amort,
      juros,
      mip,
      dfi,
      taxaAdministracao: txAdmin,
      prestacaoTotal: prestacao,
      saldoDevedorAtual: Math.max(0, saldo),
    });
  }

  return linhas;
}

// ─── Demonstrativo PRICE com Correção Monetária ──────────────────────────────

/**
 * Gera o demonstrativo completo de um financiamento imobiliário pela Tabela PRICE
 * com correção monetária mensal.
 *
 * Na PRICE com correção:
 * 1. Corrige o saldo devedor pelo indexador mensal
 * 2. Recalcula o PMT sobre o saldo corrigido com parcelas restantes
 * 3. Juros = saldo corrigido × taxa mensal
 * 4. Amortização = PMT - juros
 * 5. MIP, DFI, txAdmin iguais ao SAC
 * 6. Prestação = PMT + MIP + DFI + txAdmin
 * 7. Novo saldo = saldo corrigido - amortização
 *
 * NOTA: Na PRICE pura (sem correção), PMT é constante.
 * Com correção monetária, a PMT é recalculada a cada mês, por isso a parcela NÃO é fixa.
 */
export function calcularPRICEImob(
  valorFinanciado: number,
  taxaJurosMensal: number,
  prazoMeses: number,
  dataPrimeiroVencimento: string,
  taxaIndexadorMensal: number,
  taxaMIP: number,
  taxaDFI: number,
  valorImovel: number,
  txAdmin: number,
  serieHistorica?: Record<string, number>,
): LinhaImobiliario[] {
  const linhas: LinhaImobiliario[] = [];
  const iJuros = round8(taxaJurosMensal / 100);
  let saldo = round2(valorFinanciado);

  for (let p = 1; p <= prazoMeses; p++) {
    const saldoAnterior = round2(saldo);
    const restantes = prazoMeses - p + 1;
    const dataVenc = addMonths(dataPrimeiroVencimento, p - 1);
    const competencia = dataVenc.slice(0, 7);

    // 1. Correção monetária — taxa real do mês se disponível
    const taxaIndexMes = serieHistorica?.[competencia] ?? taxaIndexadorMensal;
    const iIndex = round8(taxaIndexMes / 100);
    const correcao = round2(saldoAnterior * iIndex);
    const saldoCorrigido = round2(saldoAnterior + correcao);

    // 2. PMT recalculado sobre saldo corrigido
    let pmt: number;
    if (iJuros === 0) {
      pmt = round2(saldoCorrigido / restantes);
    } else {
      const fator = round8((iJuros * Math.pow(1 + iJuros, restantes)) / (Math.pow(1 + iJuros, restantes) - 1));
      pmt = round2(saldoCorrigido * fator);
    }

    // 3. Juros
    const juros = round2(saldoCorrigido * iJuros);

    // 4. Amortização
    const amort = p === prazoMeses ? saldoCorrigido : round2(pmt - juros);

    // 5. MIP sobre saldo corrigido
    const mip = calcularMIP(saldoCorrigido, taxaMIP);

    // 6. DFI sobre valor do imóvel (fixo)
    const dfi = calcularDFI(valorImovel, taxaDFI);

    // 7. Prestação total (na última parcela, PMT pode ser ajustado)
    const pmtFinal = p === prazoMeses ? round2(saldoCorrigido + juros) : pmt;
    const prestacao = round2(pmtFinal + mip + dfi + txAdmin);

    // 8. Novo saldo
    saldo = p === prazoMeses ? 0 : round2(saldoCorrigido - amort);

    linhas.push({
      parcela: p,
      dataVencimento: addMonths(dataPrimeiroVencimento, p - 1),
      saldoDevedorAnterior: saldoAnterior,
      correcaoMonetaria: correcao,
      saldoDevedorCorrigido: saldoCorrigido,
      amortizacao: p === prazoMeses ? saldoCorrigido : amort,
      juros,
      mip,
      dfi,
      taxaAdministracao: txAdmin,
      prestacaoTotal: prestacao,
      saldoDevedorAtual: Math.max(0, saldo),
    });
  }

  return linhas;
}

// ─── Enquadramento automático ────────────────────────────────────────────────

export function determinarEnquadramento(params: ParametrosImobiliario): EnquadramentoImob {
  if (params.enquadramento) return params.enquadramento;
  return params.valorImovel <= TETO_SFH_VALOR_IMOVEL ? "SFH" : "SFI";
}

export function determinarTipoCredor(params: ParametrosImobiliario): TipoCredor {
  return params.tipoCredor ?? "INSTITUICAO_SFN";
}

// ─── Análise de Capitalização (por regime) ──────────────────────────────────

/**
 * Determina o regime de capitalização aplicável e verifica regularidade.
 *
 * Regras:
 * 1. SFH pré-Lei 11.977/2009: capitalização mensal VEDADA (Súmula 121/STF)
 * 2. SFH pós-2009 (inst. SFN): capitalização mensal PERMITIDA se expressamente pactuada
 *    (art. 15-A da Lei 4.380/1964, Súmula 539/STJ, MP 2.170-36/2001)
 * 3. SFI: capitalização mensal VEDADA mesmo se pactuada (REsp 2.086.650/MG, fev/2025)
 *    Apenas capitalização anual é permitida (art. 5º, III, Lei 9.514/1997 + art. 4º Dec. 22.626/1933)
 * 4. Incorporadora pré-Lei 14.905/2024: capitalização VEDADA (Decreto 22.626/1933)
 * 5. Incorporadora pós-30/08/2024: capitalização PERMITIDA se expressamente pactuada entre PJ
 *
 * IMPORTANTE sobre Tabela Price (Tema 572/STJ):
 * - A existência de anatocismo na Price é questão de FATO, não de direito
 * - Necessária perícia para aferir se há capitalização no caso concreto
 * - O módulo NÃO afirma que Price = anatocismo; simula a diferença para subsidiar perícia
 */
export function analisarCapitalizacao(params: ParametrosImobiliario): AnaliseCapitalizacao {
  const enquadramento = determinarEnquadramento(params);
  const tipoCredor = determinarTipoCredor(params);
  const usaPrice = params.sistemaAmortizacao === "PRICE";
  const pactuada = params.capitalizacaoExpressaPactuada ?? false;

  // Determinar regime
  let regime: AnaliseCapitalizacao["regime"];
  let permitida: boolean;
  let detalhes: string;
  let fundamentacao: string;

  if (enquadramento === "SFH") {
    if (params.dataContrato < DATA_LEI_11977) {
      regime = "SFH_PRE_2009";
      permitida = false;
      detalhes = "Contrato SFH celebrado antes da Lei 11.977/2009. Nesse período, a capitalização de juros em qualquer periodicidade era vedada no SFH (Súmula 121/STF). Não havia autorização legal para capitalização mensal.";
      fundamentacao = "Súmula 121/STF; REsp 1.070.297/PR (repetitivo); art. 4º do Decreto 22.626/1933 (Lei de Usura)";
    } else {
      regime = "SFH_POS_2009";
      if (tipoCredor === "INSTITUICAO_SFN") {
        permitida = pactuada;
        detalhes = pactuada
          ? "Contrato SFH pós-2009 com instituição do SFN e capitalização expressamente pactuada. A capitalização mensal é permitida pelo art. 15-A da Lei 4.380/1964 (incluído pela Lei 11.977/2009) e pela MP 2.170-36/2001, conforme Súmula 539/STJ."
          : "Contrato SFH pós-2009 com instituição do SFN, mas SEM capitalização expressamente pactuada. A capitalização mensal exige pactuação expressa (Súmula 539/STJ).";
        fundamentacao = "Art. 15-A da Lei 4.380/1964 (Lei 11.977/2009); Súmula 539/STJ; MP 2.170-36/2001; STF Tema 33 (RE 592.377)";
      } else {
        // SFH mas credor não é do SFN — MP 2.170-36/2001 não se aplica
        permitida = false;
        detalhes = "Contrato SFH pós-2009, porém o credor não integra o SFN. A MP 2.170-36/2001 (que autoriza capitalização mensal) aplica-se apenas a instituições integrantes do Sistema Financeiro Nacional.";
        fundamentacao = "MP 2.170-36/2001 (restrita ao SFN); art. 4º do Decreto 22.626/1933";
      }
    }
  } else {
    // SFI
    if (tipoCredor === "INCORPORADORA") {
      if (params.dataContrato < DATA_LEI_14905) {
        regime = "INCORPORADORA_PRE_14905";
        permitida = false;
        detalhes = "Financiamento direto com incorporadora/loteadora celebrado antes da Lei 14.905/2024. Capitalização de juros vedada pelo Decreto 22.626/1933, que se aplicava integralmente a entidades fora do SFN.";
        fundamentacao = "Art. 4º do Decreto 22.626/1933; Súmula 121/STF; Súmula 93/STJ";
      } else {
        regime = "INCORPORADORA_POS_14905";
        permitida = pactuada;
        detalhes = pactuada
          ? "Financiamento direto com incorporadora/loteadora pós-Lei 14.905/2024, com capitalização expressamente pactuada. A Lei 14.905/2024 afastou a vedação do Decreto 22.626/1933 para obrigações entre pessoas jurídicas, permitindo capitalização com pactuação expressa."
          : "Financiamento direto com incorporadora/loteadora pós-Lei 14.905/2024, mas SEM capitalização expressamente pactuada. Mesmo após a Lei 14.905/2024, a capitalização exige pactuação expressa.";
        fundamentacao = "Lei 14.905/2024, art. 3º; art. 591 do CC (nova redação)";
      }
    } else {
      // SFI com entidade SFI ou instituição SFN
      regime = "SFI";
      permitida = false;
      detalhes = "Contrato celebrado no âmbito do SFI (Lei 9.514/1997). O STJ firmou em fev/2025 (REsp 2.086.650/MG) que a capitalização de juros com periodicidade inferior à anual NÃO é permitida no SFI, ainda que expressamente pactuada. O SFI não se confunde com o SFN, e a MP 2.170-36/2001 não se aplica. A Lei 9.514/1997 (art. 5º, III) autoriza capitalização sem especificar periodicidade, incidindo o art. 4º da Lei de Usura (apenas anual).";
      fundamentacao = "REsp 2.086.650/MG (STJ, 3ª Turma, Rel. Min. Nancy Andrighi, j. 04/02/2025); art. 5º, III, Lei 9.514/1997; art. 4º, Decreto 22.626/1933";
    }
  }

  // Verificar irregularidade
  let irregular = false;
  if (usaPrice && !permitida) {
    // Tabela Price pode conter capitalização mensal, mas isso é questão de FATO (Tema 572/STJ)
    // Informamos o risco, mas não afirmamos categoricamente
    detalhes += "\n\nO contrato utiliza a Tabela Price. Conforme Tema 572/STJ (REsp 1.124.552/RS), a existência de capitalização na Tabela Price é questão de fato, não de direito, necessitando de perícia para aferir se há anatocismo no caso concreto. O presente cálculo simula a diferença para subsidiar eventual prova pericial.";
    irregular = true; // sinaliza como potencialmente irregular para alerta
  } else if (usaPrice && permitida && !pactuada) {
    detalhes += "\n\nO contrato utiliza a Tabela Price. Embora o regime permita capitalização mensal, esta deve ser expressamente pactuada (Súmula 539/STJ, Súmula 541/STJ). Verificar se a taxa anual contratada é superior ao duodécuplo da mensal.";
    irregular = true;
  }

  return {
    regime,
    capitalizacaoMensalPermitida: permitida,
    usaPrice,
    expressamentePactuada: pactuada,
    irregular,
    detalhes,
    fundamentacao,
  };
}

// ─── Análise de Abusividade ──────────────────────────────────────────────────

export function analisarAbusividade(
  params: ParametrosImobiliario,
  taxaMediaBACEN_anual: number,
): AnaliseAbusividadeImob {
  const enquadramento = determinarEnquadramento(params);
  const tipoCredor = determinarTipoCredor(params);
  const taxaMensal = anualParaMensal(params.taxaJurosAnual);
  const taxaAnualCalc = mensalParaAnual(taxaMensal);
  const taxaMediaBACEN_mensal = anualParaMensal(taxaMediaBACEN_anual);

  // Verificação de equivalência
  const diffAnual = Math.abs(params.taxaJurosAnual - taxaAnualCalc);
  const taxasEquivalentes = diffAnual < 0.05;

  // 1. Teto legal SFH: Lei 8.692/1993, art. 25 (NÃO Lei 4.380/1964 — Súmula 422/STJ)
  const violaTetoSFH = enquadramento === "SFH" && params.taxaJurosAnual > TETO_SFH_TAXA_ANUAL;
  const tetoSFH_fundamento = "Lei 8.692/1993, art. 25, com redação da MP 2.197-43/2001. NOTA: a Súmula 422/STJ afasta a limitação pelo art. 6º, 'e', da Lei 4.380/1964.";

  // 2. Taxa abusiva: acima de 1.5× a média BACEN (REsp 1.061.530/RS, Súmula 382/STJ)
  const percentualAcima = taxaMediaBACEN_anual > 0
    ? round4(((params.taxaJurosAnual - taxaMediaBACEN_anual) / taxaMediaBACEN_anual) * 100)
    : 0;
  const abusivaSTJ = percentualAcima > 50;
  const taxaAbusiva = violaTetoSFH || abusivaSTJ;

  // 3. Capitalização (análise completa por regime)
  const capitalizacao = analisarCapitalizacao(params);

  // 4. MIP
  const taxaMIPRef = obterTaxaMIP(params.idadeComprador);
  const taxaMIPUsada = params.taxaMIP ?? taxaMIPRef;
  const mipAbusivo = taxaMIPUsada > taxaMIPRef * 2;
  const mipDetalhes = mipAbusivo
    ? `Taxa MIP contratada (${taxaMIPUsada.toFixed(6)}%) é ${round2(taxaMIPUsada / taxaMIPRef * 100)}% da taxa de referência (${taxaMIPRef.toFixed(6)}%) para ${params.idadeComprador} anos. Possível abusividade.`
    : `Taxa MIP (${taxaMIPUsada.toFixed(6)}%) dentro dos parâmetros para ${params.idadeComprador} anos (ref: ${taxaMIPRef.toFixed(6)}%).`;

  // 5. DFI
  const taxaDFIUsada = params.taxaDFI ?? TAXA_DFI_REFERENCIA;
  const dfiAbusivo = taxaDFIUsada > TAXA_DFI_REFERENCIA * 3;
  const dfiDetalhes = dfiAbusivo
    ? `Taxa DFI contratada (${taxaDFIUsada.toFixed(6)}%) é ${round2(taxaDFIUsada / TAXA_DFI_REFERENCIA * 100)}% da referência (${TAXA_DFI_REFERENCIA.toFixed(6)}%). Possível abusividade.`
    : `Taxa DFI (${taxaDFIUsada.toFixed(6)}%) dentro dos parâmetros (ref: ${TAXA_DFI_REFERENCIA.toFixed(6)}%).`;

  // 6. Venda casada de seguro (Súmula 473/STJ)
  const vendaCasadaSeguro = params.seguroLivreEscolha === false;
  const vendaCasadaDetalhes = vendaCasadaSeguro
    ? "O mutuário foi impedido de escolher livremente a seguradora. Configura venda casada, vedada pela Súmula 473/STJ e art. 39, I, do CDC. O mutuário do SFH não pode ser compelido a contratar seguro com a instituição financeira mutuante ou seguradora por ela indicada."
    : "Livre escolha de seguradora mantida, conforme Súmula 473/STJ.";

  // 7. Taxa de administração
  const txAdmin = params.taxaAdministracao ?? 25;
  const taxaAdminAbusiva = txAdmin > 50;
  const taxaAdminDetalhes = taxaAdminAbusiva
    ? `Taxa de administração (R$ ${txAdmin.toFixed(2)}) acima do valor usual de mercado (R$ 25,00 a R$ 50,00).`
    : `Taxa de administração (R$ ${txAdmin.toFixed(2)}) dentro dos parâmetros de mercado.`;

  // 8. Indexador
  const indexadorIrregular = params.indexador === "IGPM" && params.taxaIndexadorAnual > 15;
  const indexadorDetalhes = indexadorIrregular
    ? `Indexador IGP-M com taxa de ${params.taxaIndexadorAnual.toFixed(2)}% a.a. pode gerar desequilíbrio contratual. Considerar substituição por TR ou IPCA.`
    : `Indexador ${params.indexador} com taxa de ${params.taxaIndexadorAnual.toFixed(2)}% a.a. dentro dos parâmetros usuais.`;

  // Resumo de irregularidades
  const irregularidades: string[] = [];
  if (violaTetoSFH) irregularidades.push(`Taxa de juros ${params.taxaJurosAnual.toFixed(2)}% a.a. viola o teto legal do SFH de ${TETO_SFH_TAXA_ANUAL}% a.a. (Lei 8.692/1993, art. 25).`);
  if (abusivaSTJ && !violaTetoSFH) irregularidades.push(`Taxa de juros ${params.taxaJurosAnual.toFixed(2)}% a.a. é ${percentualAcima.toFixed(1)}% acima da média BACEN (${taxaMediaBACEN_anual.toFixed(2)}% a.a.) — REsp 1.061.530/RS.`);
  if (capitalizacao.irregular) irregularidades.push(`Capitalização de juros potencialmente irregular (${capitalizacao.regime}).`);
  if (vendaCasadaSeguro) irregularidades.push(`Venda casada de seguro habitacional (Súmula 473/STJ).`);
  if (mipAbusivo) irregularidades.push(`Seguro MIP com taxa abusiva.`);
  if (dfiAbusivo) irregularidades.push(`Seguro DFI com taxa abusiva.`);
  if (taxaAdminAbusiva) irregularidades.push(`Taxa de administração excessiva.`);
  if (indexadorIrregular) irregularidades.push(`Indexador com taxa potencialmente abusiva.`);

  return {
    enquadramento,
    tipoCredor,
    taxaContratadaAnual: params.taxaJurosAnual,
    taxaContratadaMensal: round4(taxaMensal),
    taxaMediaBACEN_anual,
    taxaMediaBACEN_mensal: round4(taxaMediaBACEN_mensal),
    taxaAbusiva,
    percentualAcimaDaMedia: percentualAcima,
    violaTetoSFH,
    tetoSFH_anual: TETO_SFH_TAXA_ANUAL,
    tetoSFH_fundamento,
    tetoSTJ_anual: round4(taxaMediaBACEN_anual * 1.5),
    tetoSTJ_mensal: round4(taxaMediaBACEN_mensal * 1.5),
    abusivaSTJ,
    taxaMensalCalculada: round4(taxaMensal),
    taxaAnualCalculada: round4(taxaAnualCalc),
    taxasEquivalentes,
    capitalizacao,
    mipAbusivo,
    mipDetalhes,
    dfiAbusivo,
    dfiDetalhes,
    vendaCasadaSeguro,
    vendaCasadaDetalhes,
    taxaAdminAbusiva,
    taxaAdminDetalhes,
    indexadorIrregular,
    indexadorDetalhes,
    irregularidades,
  };
}

// ─── Resumo Comparativo ──────────────────────────────────────────────────────

export function calcularResumo(
  original: LinhaImobiliario[],
  recalculado: LinhaImobiliario[],
  params: ParametrosImobiliario,
): ResumoComparativoImob {
  const somaOrig = (fn: (l: LinhaImobiliario) => number) => round2(original.reduce((s, l) => s + fn(l), 0));
  const somaRecalc = (fn: (l: LinhaImobiliario) => number) => round2(recalculado.reduce((s, l) => s + fn(l), 0));

  const totalPagoOrig = somaOrig(l => l.prestacaoTotal);
  const totalJurosOrig = somaOrig(l => l.juros);
  const totalAmortOrig = somaOrig(l => l.amortizacao);
  const totalMIPOrig = somaOrig(l => l.mip);
  const totalDFIOrig = somaOrig(l => l.dfi);
  const totalTxAdminOrig = somaOrig(l => l.taxaAdministracao);
  const totalCorrecaoOrig = somaOrig(l => l.correcaoMonetaria);

  const totalPagoRecalc = somaRecalc(l => l.prestacaoTotal);
  const totalJurosRecalc = somaRecalc(l => l.juros);
  const totalAmortRecalc = somaRecalc(l => l.amortizacao);
  const totalMIPRecalc = somaRecalc(l => l.mip);
  const totalDFIRecalc = somaRecalc(l => l.dfi);
  const totalTxAdminRecalc = somaRecalc(l => l.taxaAdministracao);
  const totalCorrecaoRecalc = somaRecalc(l => l.correcaoMonetaria);

  const diferencaTotal = round2(totalPagoOrig - totalPagoRecalc);
  const diferencaJuros = round2(totalJurosOrig - totalJurosRecalc);
  const diferencaCorrecao = round2(totalCorrecaoOrig - totalCorrecaoRecalc);
  const diferencaSeguros = round2((totalMIPOrig + totalDFIOrig) - (totalMIPRecalc + totalDFIRecalc));

  return {
    valorFinanciado: params.valorFinanciado,
    valorImovel: params.valorImovel,
    totalPagoOriginal: totalPagoOrig,
    totalJurosOriginal: totalJurosOrig,
    totalAmortizacaoOriginal: totalAmortOrig,
    totalMIPOriginal: totalMIPOrig,
    totalDFIOriginal: totalDFIOrig,
    totalTxAdminOriginal: totalTxAdminOrig,
    totalCorrecaoOriginal: totalCorrecaoOrig,
    totalPagoRecalculado: totalPagoRecalc,
    totalJurosRecalculado: totalJurosRecalc,
    totalAmortizacaoRecalculado: totalAmortRecalc,
    totalMIPRecalculado: totalMIPRecalc,
    totalDFIRecalculado: totalDFIRecalc,
    totalTxAdminRecalculado: totalTxAdminRecalc,
    totalCorrecaoRecalculado: totalCorrecaoRecalc,
    diferencaTotal,
    diferencaJuros,
    diferencaCorrecao,
    diferencaSeguros,
    repeticaoIndebito: round2(diferencaTotal * 2),
  };
}

// ─── Dados de Recálculo com Parcelas Pagas ──────────────────────────────────

export function calcularDadosParcelasPagas(
  original: LinhaImobiliario[],
  recalculado: LinhaImobiliario[],
  parcelasPagas: number,
): DadosRecalculoImob {
  const pagoOrig = round2(original.slice(0, parcelasPagas).reduce((s, l) => s + l.prestacaoTotal, 0));
  const devidoRecalc = round2(recalculado.slice(0, parcelasPagas).reduce((s, l) => s + l.prestacaoTotal, 0));
  const pagoAMais = round2(pagoOrig - devidoRecalc);
  const saldoOriginal = parcelasPagas < original.length ? original[parcelasPagas - 1].saldoDevedorAtual : 0;
  const saldoRecalculado = parcelasPagas < recalculado.length ? recalculado[parcelasPagas - 1].saldoDevedorAtual : 0;

  return {
    parcelasPagas,
    valorPagoTotal: pagoOrig,
    valorDevidoRecalculado: devidoRecalc,
    valorPagoAMais: pagoAMais,
    saldoDevedorAtualOriginal: saldoOriginal,
    saldoDevedorAtualRecalculado: saldoRecalculado,
    parcelasRestantes: original.length - parcelasPagas,
  };
}

// ─── Função Principal ────────────────────────────────────────────────────────

export function calcularRevisaoImobiliario(
  params: ParametrosImobiliario,
  taxaMediaBACEN_anual: number,
  serieHistoricaOriginal?: Record<string, number>,  // indexador do contrato
  serieHistoricaRecalculo?: Record<string, number>,  // indexador do recálculo
): ResultadoImobiliario {
  // Validação
  const erros = validarDatasImob(params);
  if (erros.length > 0) {
    throw new Error(`Erros de validação:\n${erros.join("\n")}`);
  }

  // Protocolo
  const protocolo = gerarProtocolo();

  // Taxas
  const taxaJurosMensal = anualParaMensal(params.taxaJurosAnual);
  const taxaIndexMensal = params.indexador === "NENHUM" ? 0 : anualParaMensal(params.taxaIndexadorAnual);
  const taxaMIP = params.taxaMIP ?? obterTaxaMIP(params.idadeComprador);
  const taxaDFI = params.taxaDFI ?? TAXA_DFI_REFERENCIA;
  const txAdmin = params.taxaAdministracao ?? 25;

  // Demonstrativo Original
  const calcFn = params.sistemaAmortizacao === "SAC" ? calcularSACImob : calcularPRICEImob;
  const demonstrativoOriginal = calcFn(
    params.valorFinanciado,
    taxaJurosMensal,
    params.prazoMeses,
    params.dataPrimeiroVencimento,
    taxaIndexMensal,
    taxaMIP,
    taxaDFI,
    params.valorImovel,
    txAdmin,
    serieHistoricaOriginal,
  );

  // Taxa de recálculo
  let taxaRecalculoAnual: number;
  let criterioRecalculo: string;
  if (params.taxaRecalculo === "manual" && params.taxaManualAnual != null) {
    taxaRecalculoAnual = params.taxaManualAnual;
    criterioRecalculo = "Taxa manual informada pelo perito";
  } else {
    taxaRecalculoAnual = taxaMediaBACEN_anual;
    criterioRecalculo = "Média BACEN para financiamento imobiliário";
  }

  const taxaRecalculoMensal = anualParaMensal(taxaRecalculoAnual);

  // Indexador do recálculo
  const indexRecalculo = params.indexadorRecalculo ?? params.indexador;
  const taxaIndexRecalcAnual = params.taxaIndexadorRecalculoAnual ?? params.taxaIndexadorAnual;
  const taxaIndexRecalcMensal = indexRecalculo === "NENHUM" ? 0 : anualParaMensal(taxaIndexRecalcAnual);

  // Demonstrativo Recalculado
  const demonstrativoRecalculado = calcFn(
    params.valorFinanciado,
    taxaRecalculoMensal,
    params.prazoMeses,
    params.dataPrimeiroVencimento,
    taxaIndexRecalcMensal,
    taxaMIP,
    taxaDFI,
    params.valorImovel,
    txAdmin,
    serieHistoricaRecalculo ?? serieHistoricaOriginal,
  );

  // Análise de abusividade
  const analise = analisarAbusividade(params, taxaMediaBACEN_anual);

  // Resumo comparativo
  const resumo = calcularResumo(demonstrativoOriginal, demonstrativoRecalculado, params);

  // Dados de parcelas pagas
  let dadosParcelasPagas: DadosRecalculoImob | undefined;
  if (params.parcelasJaPagas && params.parcelasJaPagas > 0) {
    dadosParcelasPagas = calcularDadosParcelasPagas(
      demonstrativoOriginal,
      demonstrativoRecalculado,
      params.parcelasJaPagas,
    );
  }

  return {
    demonstrativoOriginal,
    demonstrativoRecalculado,
    resumo,
    analiseAbusividade: analise,
    parecerTecnico: "", // será gerado pelo parecer-imobiliario.ts
    protocoloCalculo: protocolo,
    taxaRecalculoAplicada: taxaRecalculoAnual,
    criterioRecalculo,
    dadosParcelasPagas,
  };
}

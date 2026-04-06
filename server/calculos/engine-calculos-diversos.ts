/**
 * Engine de Cálculos Diversos
 * Funções puras para conversão de taxas, juros, atualização monetária e prazos prescricionais.
 */

import type {
  ConversaoTaxaInput,
  ConversaoTaxaResult,
  TaxaRealInput,
  TaxaRealResult,
  JurosInput,
  JurosResult,
  JurosEvolucao,
  PeriodoTaxa,
  PrazoPrescricional,
  PrazoPrescricionalInput,
  PrazoPrescricionalResult,
  IndiceVariacao,
  AtualizacaoMonetariaResult,
  IndiceCorrecao,
} from "../../shared/calculos-diversos-types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

export function round4(v: number): number {
  return Math.round((v + Number.EPSILON) * 10000) / 10000;
}

export function round6(v: number): number {
  return Math.round((v + Number.EPSILON) * 1000000) / 1000000;
}

export function round8(v: number): number {
  return Math.round((v + Number.EPSILON) * 100000000) / 100000000;
}

// ─── Mapeamento de Períodos ──────────────────────────────────────────────────

/** Retorna o número de períodos por ano para cada tipo de período */
function periodosPorAno(periodo: PeriodoTaxa, baseDias: "corridos" | "uteis"): number {
  switch (periodo) {
    case "diaria": return baseDias === "uteis" ? 252 : 365;
    case "mensal": return 12;
    case "bimestral": return 6;
    case "trimestral": return 4;
    case "semestral": return 2;
    case "anual": return 1;
  }
}

function nomePeriodo(periodo: PeriodoTaxa): string {
  const nomes: Record<PeriodoTaxa, string> = {
    diaria: "ao dia",
    mensal: "ao mês",
    bimestral: "ao bimestre",
    trimestral: "ao trimestre",
    semestral: "ao semestre",
    anual: "ao ano",
  };
  return nomes[periodo];
}

function abrevPeriodo(periodo: PeriodoTaxa): string {
  const abrevs: Record<PeriodoTaxa, string> = {
    diaria: "a.d.",
    mensal: "a.m.",
    bimestral: "a.b.",
    trimestral: "a.t.",
    semestral: "a.s.",
    anual: "a.a.",
  };
  return abrevs[periodo];
}

// ─── Conversão de Taxas ──────────────────────────────────────────────────────

/**
 * Converte taxa efetiva de um período para outro.
 * Fórmula: i_destino = (1 + i_origem)^(n_origem/n_destino) - 1
 */
export function converterTaxaEfetiva(
  taxa: number,
  periodoOrigem: PeriodoTaxa,
  periodoDestino: PeriodoTaxa,
  baseDias: "corridos" | "uteis" = "corridos",
): number {
  const i = taxa / 100;
  const nOrigem = periodosPorAno(periodoOrigem, baseDias);
  const nDestino = periodosPorAno(periodoDestino, baseDias);
  const expoente = nOrigem / nDestino;
  const resultado = (Math.pow(1 + i, expoente) - 1) * 100;
  return round8(resultado);
}

/**
 * Converte taxa nominal para efetiva.
 * Fórmula: i_efetiva = (1 + i_nominal/n)^n - 1
 * onde n = número de capitalizações por período
 */
export function nominalParaEfetiva(
  taxaNominal: number,
  periodoNominal: PeriodoTaxa,
  capitalizacao: PeriodoTaxa,
  baseDias: "corridos" | "uteis" = "corridos",
): number {
  const iNom = taxaNominal / 100;
  const nNominal = periodosPorAno(periodoNominal, baseDias);
  const nCap = periodosPorAno(capitalizacao, baseDias);
  const n = nCap / nNominal; // capitalizações por período nominal
  const resultado = (Math.pow(1 + iNom / n, n) - 1) * 100;
  return round8(resultado);
}

/**
 * Converte taxa efetiva para nominal.
 * Fórmula: i_nominal = n × [(1 + i_efetiva)^(1/n) - 1]
 */
export function efetivaParaNominal(
  taxaEfetiva: number,
  periodoEfetiva: PeriodoTaxa,
  capitalizacao: PeriodoTaxa,
  baseDias: "corridos" | "uteis" = "corridos",
): number {
  const iEf = taxaEfetiva / 100;
  const nEfetiva = periodosPorAno(periodoEfetiva, baseDias);
  const nCap = periodosPorAno(capitalizacao, baseDias);
  const n = nCap / nEfetiva;
  const resultado = (n * (Math.pow(1 + iEf, 1 / n) - 1)) * 100;
  return round8(resultado);
}

/**
 * Função principal de conversão de taxas.
 */
export function converterTaxa(input: ConversaoTaxaInput): ConversaoTaxaResult {
  const { taxaOriginal, periodoOrigem, periodoDestino, tipoOrigem, tipoDestino, baseDias, capitalizacaoNominal } = input;

  let taxaEfetivaOrigem: number;
  let formulaParts: string[] = [];

  // Step 1: Se nominal, converter para efetiva primeiro
  if (tipoOrigem === "nominal") {
    const cap = capitalizacaoNominal || "mensal";
    taxaEfetivaOrigem = nominalParaEfetiva(taxaOriginal, periodoOrigem, cap, baseDias);
    formulaParts.push(
      `1) Nominal ${nomePeriodo(periodoOrigem)} → Efetiva ${nomePeriodo(periodoOrigem)}: ` +
      `i_ef = (1 + ${taxaOriginal}%/${periodosPorAno(cap, baseDias) / periodosPorAno(periodoOrigem, baseDias)})^${periodosPorAno(cap, baseDias) / periodosPorAno(periodoOrigem, baseDias)} - 1 = ${round6(taxaEfetivaOrigem)}%`
    );
  } else {
    taxaEfetivaOrigem = taxaOriginal;
  }

  // Step 2: Converter período (efetiva → efetiva)
  let taxaEfetivaDestino: number;
  if (periodoOrigem !== periodoDestino) {
    taxaEfetivaDestino = converterTaxaEfetiva(taxaEfetivaOrigem, periodoOrigem, periodoDestino, baseDias);
    const nO = periodosPorAno(periodoOrigem, baseDias);
    const nD = periodosPorAno(periodoDestino, baseDias);
    formulaParts.push(
      `${formulaParts.length + 1}) Efetiva ${nomePeriodo(periodoOrigem)} → Efetiva ${nomePeriodo(periodoDestino)}: ` +
      `i = (1 + ${round6(taxaEfetivaOrigem)}%)^(${nO}/${nD}) - 1 = ${round6(taxaEfetivaDestino)}%`
    );
  } else {
    taxaEfetivaDestino = taxaEfetivaOrigem;
  }

  // Step 3: Se destino nominal, converter de efetiva para nominal
  let taxaFinal: number;
  if (tipoDestino === "nominal") {
    const cap = capitalizacaoNominal || "mensal";
    taxaFinal = efetivaParaNominal(taxaEfetivaDestino, periodoDestino, cap, baseDias);
    formulaParts.push(
      `${formulaParts.length + 1}) Efetiva ${nomePeriodo(periodoDestino)} → Nominal ${nomePeriodo(periodoDestino)}: ` +
      `i_nom = ${periodosPorAno(cap, baseDias) / periodosPorAno(periodoDestino, baseDias)} × [(1 + ${round6(taxaEfetivaDestino)}%)^(1/${periodosPorAno(cap, baseDias) / periodosPorAno(periodoDestino, baseDias)}) - 1] = ${round6(taxaFinal)}%`
    );
  } else {
    taxaFinal = taxaEfetivaDestino;
  }

  // Se conversão direta sem passos intermediários
  if (formulaParts.length === 0) {
    formulaParts.push(`Taxa já está no formato desejado: ${round6(taxaFinal)}% ${abrevPeriodo(periodoDestino)}`);
  }

  const detalhamento = [
    `Taxa original: ${taxaOriginal}% ${abrevPeriodo(periodoOrigem)} (${tipoOrigem})`,
    `Taxa convertida: ${round6(taxaFinal)}% ${abrevPeriodo(periodoDestino)} (${tipoDestino})`,
    `Base de dias: ${baseDias === "uteis" ? "252 dias úteis" : "365 dias corridos"}`,
    "",
    "Passos do cálculo:",
    ...formulaParts,
  ].join("\n");

  return {
    taxaOriginal,
    taxaConvertida: round8(taxaFinal),
    periodoOrigem,
    periodoDestino,
    tipoOrigem,
    tipoDestino,
    formulaAplicada: formulaParts.join(" → "),
    detalhamento,
  };
}

// ─── Taxa Real (Fisher) ─────────────────────────────────────────────────────

/**
 * Calcula a taxa real usando a equação de Fisher.
 * (1 + i_real) = (1 + i_nominal) / (1 + inflação)
 */
export function calcularTaxaReal(input: TaxaRealInput): TaxaRealResult {
  const { taxaNominal, inflacao } = input;
  const iNom = taxaNominal / 100;
  const iInf = inflacao / 100;
  const iReal = ((1 + iNom) / (1 + iInf) - 1) * 100;

  return {
    taxaNominal,
    inflacao,
    taxaReal: round6(iReal),
    formulaAplicada: `i_real = [(1 + ${taxaNominal}%) / (1 + ${inflacao}%)] - 1 = ${round6(iReal)}%`,
  };
}

// ─── Juros Simples e Compostos ───────────────────────────────────────────────

/**
 * Converte prazo para o mesmo período da taxa.
 */
function converterPrazo(prazo: number, periodoPrazo: PeriodoTaxa, periodoTaxa: PeriodoTaxa): number {
  // Converter ambos para meses como base
  const paraMeses: Record<PeriodoTaxa, number> = {
    diaria: 1 / 30,
    mensal: 1,
    bimestral: 2,
    trimestral: 3,
    semestral: 6,
    anual: 12,
  };
  const prazoEmMeses = prazo * paraMeses[periodoPrazo];
  return prazoEmMeses / paraMeses[periodoTaxa];
}

/**
 * Calcula juros simples ou compostos com evolução período a período.
 */
export function calcularJuros(input: JurosInput): JurosResult {
  const { capital, taxa, periodoTaxa, prazo, periodoPrazo, tipo } = input;
  const i = taxa / 100;

  // Converter prazo para o período da taxa
  const n = converterPrazo(prazo, periodoPrazo, periodoTaxa);

  let montante: number;
  let juros: number;
  let formulaAplicada: string;

  if (tipo === "simples") {
    montante = capital * (1 + i * n);
    juros = capital * i * n;
    formulaAplicada = `M = C × (1 + i × n) = ${capital} × (1 + ${taxa}% × ${round4(n)}) = ${round2(montante)}`;
  } else {
    montante = capital * Math.pow(1 + i, n);
    juros = montante - capital;
    formulaAplicada = `M = C × (1 + i)^n = ${capital} × (1 + ${taxa}%)^${round4(n)} = ${round2(montante)}`;
  }

  // Gerar evolução mensal (máximo 600 períodos para não sobrecarregar)
  const periodosMostrar = Math.min(Math.ceil(n), 600);
  const evolucaoMensal: JurosEvolucao[] = [];

  for (let p = 1; p <= periodosMostrar; p++) {
    if (tipo === "simples") {
      const saldoInicial = capital + capital * i * (p - 1);
      const jurosP = capital * i;
      evolucaoMensal.push({
        periodo: p,
        saldoInicial: round2(saldoInicial),
        juros: round2(jurosP),
        saldoFinal: round2(saldoInicial + jurosP),
      });
    } else {
      const saldoInicial = capital * Math.pow(1 + i, p - 1);
      const jurosP = saldoInicial * i;
      evolucaoMensal.push({
        periodo: p,
        saldoInicial: round2(saldoInicial),
        juros: round2(jurosP),
        saldoFinal: round2(saldoInicial + jurosP),
      });
    }
  }

  return {
    capital,
    taxa,
    prazo: round4(n),
    tipo,
    juros: round2(juros),
    montante: round2(montante),
    formulaAplicada,
    evolucaoMensal,
  };
}

// ─── Atualização Monetária ───────────────────────────────────────────────────

/**
 * Calcula atualização monetária a partir de índices mensais já obtidos.
 * Os índices devem ser buscados da API do BCB no router.
 */
export function calcularAtualizacaoMonetaria(
  valorOriginal: number,
  indice: IndiceCorrecao,
  dataInicial: string,
  dataFinal: string,
  indices: IndiceVariacao[],
  aplicarJurosMora: boolean = false,
  taxaJurosMoraAnual: number = 12,
  aplicarMulta: boolean = false,
  percentualMulta: number = 2,
): AtualizacaoMonetariaResult {
  // Calcular fator de correção acumulado
  let fatorAcumulado = 1;
  for (const idx of indices) {
    fatorAcumulado *= (1 + idx.variacao / 100);
  }

  const valorCorrigido = round2(valorOriginal * fatorAcumulado);
  const correcaoMonetaria = round2(valorCorrigido - valorOriginal);
  const variacaoPercentual = round4((fatorAcumulado - 1) * 100);

  // Juros de mora
  let jurosMora = 0;
  if (aplicarJurosMora) {
    const taxaMensal = taxaJurosMoraAnual / 12 / 100;
    const meses = indices.length;
    jurosMora = round2(valorCorrigido * taxaMensal * meses);
  }

  // Multa
  let multa = 0;
  if (aplicarMulta) {
    multa = round2(valorCorrigido * percentualMulta / 100);
  }

  const valorTotal = round2(valorCorrigido + jurosMora + multa);

  // Recalcular fator acumulado em cada índice
  let fatorParcial = 1;
  const indicesComFator = indices.map(idx => {
    fatorParcial *= (1 + idx.variacao / 100);
    return { ...idx, fatorAcumulado: round8(fatorParcial) };
  });

  const nomeIndice = {
    IPCA: "IPCA (IBGE)", IGPM: "IGP-M (FGV)", INPC: "INPC (IBGE)",
    IPCAE: "IPCA-E (IBGE)", SELIC: "Taxa SELIC", TR: "Taxa Referencial",
    CDI: "CDI", POUPANCA: "Poupança",
  }[indice];

  const detalhamento = [
    `Valor original: R$ ${valorOriginal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
    `Índice: ${nomeIndice}`,
    `Período: ${dataInicial} a ${dataFinal}`,
    `Meses de correção: ${indices.length}`,
    `Fator de correção acumulado: ${round8(fatorAcumulado)}`,
    `Variação percentual: ${variacaoPercentual}%`,
    `Valor corrigido: R$ ${valorCorrigido.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
    `Correção monetária: R$ ${correcaoMonetaria.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
    ...(aplicarJurosMora ? [`Juros de mora (${taxaJurosMoraAnual}% a.a.): R$ ${jurosMora.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`] : []),
    ...(aplicarMulta ? [`Multa (${percentualMulta}%): R$ ${multa.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`] : []),
    `Valor total: R$ ${valorTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
  ].join("\n");

  return {
    valorOriginal,
    valorCorrigido,
    correcaoMonetaria,
    jurosMora,
    multa,
    valorTotal,
    indice,
    dataInicial,
    dataFinal,
    fatorCorrecao: round8(fatorAcumulado),
    variacaoPercentual,
    indices: indicesComFator,
    detalhamento,
  };
}

// ─── Prazos Prescricionais ───────────────────────────────────────────────────

export const PRAZOS_PRESCRICIONAIS: PrazoPrescricional[] = [
  // Civil
  { id: "civil_1_hospedeiro", area: "civil", prazoAnos: 1, descricao: "Pretensão dos hospedeiros ou fornecedores de víveres", fundamentacao: "Art. 206, §1º, I, CC" },
  { id: "civil_1_segurado", area: "civil", prazoAnos: 1, descricao: "Pretensão do segurado contra o segurador", fundamentacao: "Art. 206, §1º, II, CC" },
  { id: "civil_1_auxiliar", area: "civil", prazoAnos: 1, descricao: "Pretensão dos tabeliães, auxiliares da justiça, serventuários", fundamentacao: "Art. 206, §1º, III, CC" },
  { id: "civil_2_alimentos", area: "civil", prazoAnos: 2, descricao: "Pretensão para haver prestações alimentares", fundamentacao: "Art. 206, §2º, CC" },
  { id: "civil_3_aluguel", area: "civil", prazoAnos: 3, descricao: "Pretensão relativa a aluguéis de prédios", fundamentacao: "Art. 206, §3º, I, CC" },
  { id: "civil_3_reparacao", area: "civil", prazoAnos: 3, descricao: "Pretensão de reparação civil (responsabilidade civil)", fundamentacao: "Art. 206, §3º, V, CC" },
  { id: "civil_3_enriquecimento", area: "civil", prazoAnos: 3, descricao: "Pretensão de restituição por enriquecimento sem causa", fundamentacao: "Art. 206, §3º, IV, CC" },
  { id: "civil_3_seguro", area: "civil", prazoAnos: 3, descricao: "Pretensão do beneficiário contra o segurador (seguro obrigatório)", fundamentacao: "Art. 206, §3º, IX, CC" },
  { id: "civil_4_tutela", area: "civil", prazoAnos: 4, descricao: "Pretensão relativa à tutela (a partir da aprovação de contas)", fundamentacao: "Art. 206, §4º, CC" },
  { id: "civil_5_divida_liquida", area: "civil", prazoAnos: 5, descricao: "Pretensão de cobrança de dívidas líquidas constantes de instrumento", fundamentacao: "Art. 206, §5º, I, CC" },
  { id: "civil_5_profissional", area: "civil", prazoAnos: 5, descricao: "Pretensão dos profissionais liberais por seus honorários", fundamentacao: "Art. 206, §5º, II, CC" },
  { id: "civil_5_vencedor", area: "civil", prazoAnos: 5, descricao: "Pretensão do vencedor para haver do vencido o que despendeu em juízo", fundamentacao: "Art. 206, §5º, III, CC" },
  { id: "civil_10_geral", area: "civil", prazoAnos: 10, descricao: "Regra geral — quando a lei não fixar prazo menor", fundamentacao: "Art. 205, CC" },

  // Trabalhista
  { id: "trab_2_bienal", area: "trabalhista", prazoAnos: 2, descricao: "Prescrição bienal — após extinção do contrato de trabalho", fundamentacao: "Art. 7º, XXIX, CF/88 e Art. 11, CLT", observacao: "Conta-se da data da rescisão do contrato" },
  { id: "trab_5_quinquenal", area: "trabalhista", prazoAnos: 5, descricao: "Prescrição quinquenal — créditos durante vigência do contrato", fundamentacao: "Art. 7º, XXIX, CF/88 e Art. 11, CLT", observacao: "Limita a pretensão aos últimos 5 anos a contar do ajuizamento" },
  { id: "trab_2_intercorrente", area: "trabalhista", prazoAnos: 2, descricao: "Prescrição intercorrente — inércia na fase de execução", fundamentacao: "Art. 11-A, CLT (Reforma Trabalhista)", observacao: "Flui a partir da intimação para cumprimento" },
  { id: "trab_2_fgts", area: "trabalhista", prazoAnos: 5, descricao: "FGTS — prescrição quinquenal", fundamentacao: "STF, ARE 709.212 (2014)", observacao: "Antes era de 30 anos; STF alterou para 5 anos em 2014" },

  // Tributário
  { id: "trib_5_constituicao", area: "tributario", prazoAnos: 5, descricao: "Constituição do crédito tributário (lançamento)", fundamentacao: "Art. 173, I, CTN" },
  { id: "trib_5_cobranca", area: "tributario", prazoAnos: 5, descricao: "Cobrança do crédito tributário (execução fiscal)", fundamentacao: "Art. 174, CTN" },
  { id: "trib_5_repeticao", area: "tributario", prazoAnos: 5, descricao: "Repetição de indébito tributário (restituição)", fundamentacao: "Art. 168, CTN" },
  { id: "trib_5_acao_anulatoria", area: "tributario", prazoAnos: 5, descricao: "Ação anulatória de débito fiscal", fundamentacao: "Art. 1º, Decreto 20.910/32" },

  // Consumidor
  { id: "cons_5_fato", area: "consumidor", prazoAnos: 5, descricao: "Pretensão à reparação por fato do produto ou serviço", fundamentacao: "Art. 27, CDC" },
  { id: "cons_30_vicio_aparente", area: "consumidor", prazoAnos: 0, descricao: "Reclamação por vício aparente — 30 dias (não durável) / 90 dias (durável)", fundamentacao: "Art. 26, CDC", observacao: "Prazo decadencial, não prescricional. 30 dias para não duráveis, 90 para duráveis." },

  // Penal (para referência em cálculos cíveis decorrentes de crime)
  { id: "penal_3_menor", area: "penal", prazoAnos: 3, descricao: "Pena máxima inferior a 1 ano", fundamentacao: "Art. 109, VI, CP" },
  { id: "penal_4_1a2", area: "penal", prazoAnos: 4, descricao: "Pena máxima de 1 a 2 anos", fundamentacao: "Art. 109, V, CP" },
  { id: "penal_8_2a4", area: "penal", prazoAnos: 8, descricao: "Pena máxima de 2 a 4 anos", fundamentacao: "Art. 109, IV, CP" },
  { id: "penal_12_4a8", area: "penal", prazoAnos: 12, descricao: "Pena máxima de 4 a 8 anos", fundamentacao: "Art. 109, III, CP" },
  { id: "penal_16_8a12", area: "penal", prazoAnos: 16, descricao: "Pena máxima de 8 a 12 anos", fundamentacao: "Art. 109, II, CP" },
  { id: "penal_20_maior12", area: "penal", prazoAnos: 20, descricao: "Pena máxima superior a 12 anos", fundamentacao: "Art. 109, I, CP" },
];

/**
 * Calcula prazo prescricional com suspensões.
 */
export function calcularPrazoPrescricional(input: PrazoPrescricionalInput): PrazoPrescricionalResult {
  const prazo = PRAZOS_PRESCRICIONAIS.find(p => p.id === input.tipoAcao);
  if (!prazo) {
    throw new Error(`Prazo prescricional não encontrado: ${input.tipoAcao}`);
  }

  const dataFato = new Date(input.dataFatoGerador + "T00:00:00");
  if (isNaN(dataFato.getTime())) {
    throw new Error("Data do fato gerador inválida");
  }

  // Calcular total de dias suspensos
  let totalDiasSuspensos = 0;
  const suspensoes = (input.suspensoes || []).map(s => {
    const inicio = new Date(s.inicio + "T00:00:00");
    const fim = new Date(s.fim + "T00:00:00");
    const dias = Math.ceil((fim.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24));
    totalDiasSuspensos += Math.max(0, dias);
    return { inicio: s.inicio, fim: s.fim, dias: Math.max(0, dias) };
  });

  // Data de prescrição = data fato + prazo em anos + dias suspensos
  const dataPrescricao = new Date(dataFato);
  dataPrescricao.setFullYear(dataPrescricao.getFullYear() + prazo.prazoAnos);
  dataPrescricao.setDate(dataPrescricao.getDate() + totalDiasSuspensos);

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const diasRestantes = Math.ceil((dataPrescricao.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
  const prescrito = diasRestantes <= 0;

  const detalhamento = [
    `Tipo: ${prazo.descricao}`,
    `Fundamentação: ${prazo.fundamentacao}`,
    `Prazo: ${prazo.prazoAnos} ano(s)`,
    `Data do fato gerador: ${dataFato.toLocaleDateString("pt-BR")}`,
    ...(suspensoes.length > 0 ? [`Suspensões: ${suspensoes.length} (total de ${totalDiasSuspensos} dias)`] : []),
    `Data de prescrição: ${dataPrescricao.toLocaleDateString("pt-BR")}`,
    prescrito
      ? `Status: PRESCRITO (há ${Math.abs(diasRestantes)} dias)`
      : `Status: NÃO PRESCRITO (faltam ${diasRestantes} dias)`,
    ...(prazo.observacao ? [`\nObservação: ${prazo.observacao}`] : []),
  ].join("\n");

  return {
    prazo,
    dataFatoGerador: input.dataFatoGerador,
    dataPrescricao: dataPrescricao.toISOString().split("T")[0],
    diasRestantes,
    prescrito,
    suspensoes,
    totalDiasSuspensos,
    detalhamento,
  };
}

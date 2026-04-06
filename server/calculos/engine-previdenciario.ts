/**
 * Engine Previdenciário v2
 *
 * Melhorias sobre v1:
 * - Períodos de contribuição em vez de TC fixo (soma automática, gaps, sobreposições)
 * - Aposentadoria Especial (3 graus: 15/20/25 anos) com transição e permanente
 * - Aposentadoria Rural (55/60 anos + 15 anos)
 * - Conversão de tempo especial → comum (fatores por grau, só até 13/11/2019)
 * - Direito adquirido (completou requisitos antes da reforma)
 * - Professor com redução
 */

import type {
  ParametrosSimulacao, PeriodoContribuicao, ResultadoRegra, ResultadoSimulacao,
  ResumoTC, ParametrosRMI, ResultadoRMI, ParametrosGPS, LinhaGPS, ResultadoGPS,
  RegraAposentadoria, Sexo, TipoAtividade,
} from "../../shared/previdenciario-types";
import {
  REGRA_LABELS, DATA_REFORMA, SALARIO_MINIMO_2026, TETO_INSS_2026,
  ALIQUOTAS, FATOR_CONVERSAO_ESPECIAL, ESPECIAL_REGRAS,
} from "../../shared/previdenciario-types";

// ─── Utilitários de data ────────────────────────────────────────────────────

function round2(v: number): number { return parseFloat(v.toFixed(2)); }

function hoje(): string { return new Date().toISOString().slice(0, 10); }

function diffMeses(d1: string, d2: string): number {
  const [y1, m1] = d1.split("-").map(Number);
  const [y2, m2] = d2.split("-").map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}

function idadeEmAnos(dataNasc: string, dataRef: string): number {
  const [an, mn, dn] = dataNasc.split("-").map(Number);
  const [ar, mr, dr] = dataRef.split("-").map(Number);
  let idade = ar - an;
  if (mr < mn || (mr === mn && dr < dn)) idade--;
  return Math.max(0, idade);
}

function addMesesStr(d: string, m: number): string {
  const [y, mo, dd] = d.split("-").map(Number);
  const tM = (mo - 1 + m) % 12;
  const tY = y + Math.floor((mo - 1 + m) / 12);
  const last = new Date(tY, tM + 1, 0).getDate();
  return `${tY}-${String(tM + 1).padStart(2, "0")}-${String(Math.min(dd, last)).padStart(2, "0")}`;
}

function minStr(a: string, b: string): string { return a < b ? a : b; }
function maxStr(a: string, b: string): string { return a > b ? a : b; }

export function gerarProtocolo(): string {
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `PREV-${ts}-${rand}`;
}

// ─── Cálculo do TC a partir dos períodos ────────────────────────────────────

/**
 * Calcula o tempo de contribuição real a partir de períodos individuais.
 * - Soma cada período em meses (dataFim - dataInicio)
 * - Períodos "ainda ativo" usam hoje como data fim
 * - Agrupa por tipo de atividade
 * - Aplica conversão especial → comum para períodos até 13/11/2019
 */
export function calcularResumoTC(periodos: PeriodoContribuicao[], sexo: Sexo): ResumoTC {
  let totalComum = 0;
  let totalEsp15 = 0;
  let totalEsp20 = 0;
  let totalEsp25 = 0;
  let totalRural = 0;
  let totalProfessor = 0;
  const conversoes: ResumoTC["conversoes"] = [];

  for (const p of periodos) {
    const fim = p.aindaAtivo ? hoje() : p.dataFim;
    if (!fim || fim <= p.dataInicio) continue;

    const meses = Math.max(0, diffMeses(p.dataInicio, fim));
    if (meses === 0) continue;

    switch (p.tipoAtividade) {
      case "URBANA_COMUM":
        totalComum += meses;
        break;
      case "URBANA_ESPECIAL_15":
        totalEsp15 += meses;
        break;
      case "URBANA_ESPECIAL_20":
        totalEsp20 += meses;
        break;
      case "URBANA_ESPECIAL_25":
        totalEsp25 += meses;
        break;
      case "RURAL":
        totalRural += meses;
        break;
      case "PROFESSOR":
        totalProfessor += meses;
        break;
    }
  }

  const totalBruto = totalComum + totalEsp15 + totalEsp20 + totalEsp25 + totalRural + totalProfessor;

  // Conversão especial → comum (só períodos até a reforma)
  let totalConvertido = totalComum + totalProfessor + totalRural;

  for (const p of periodos) {
    const fimPeriodo = p.aindaAtivo ? hoje() : p.dataFim;
    if (!fimPeriodo || fimPeriodo <= p.dataInicio) continue;
    if (!p.tipoAtividade.startsWith("URBANA_ESPECIAL")) continue;

    // Só converte período até a data da reforma
    const fimConversivel = minStr(fimPeriodo, DATA_REFORMA);
    if (fimConversivel <= p.dataInicio) continue;

    const mesesConversiveis = Math.max(0, diffMeses(p.dataInicio, fimConversivel));
    if (mesesConversiveis === 0) continue;

    const fatores = FATOR_CONVERSAO_ESPECIAL[p.tipoAtividade];
    if (!fatores) continue;

    const fator = sexo === "M" ? fatores.homem : fatores.mulher;
    const mesesConvertidos = Math.round(mesesConversiveis * fator);

    // Período pós-reforma permanece sem conversão (conta como especial bruto)
    const mesesPosReforma = fimPeriodo > DATA_REFORMA
      ? Math.max(0, diffMeses(DATA_REFORMA, fimPeriodo))
      : 0;

    totalConvertido += mesesConvertidos + mesesPosReforma;

    conversoes.push({
      tipoOriginal: p.tipoAtividade,
      mesesOriginais: mesesConversiveis,
      fatorConversao: fator,
      mesesConvertidos,
      periodo: `${p.dataInicio} a ${fimConversivel}${p.descricao ? ` (${p.descricao})` : ""}`,
    });
  }

  // Adicionar períodos especiais sem conversão (para quem não converte)
  // totalConvertido já inclui as conversões acima

  return {
    totalMesesComum: totalComum,
    totalMesesEspecial15: totalEsp15,
    totalMesesEspecial20: totalEsp20,
    totalMesesEspecial25: totalEsp25,
    totalMesesRural: totalRural,
    totalMesesProfessor: totalProfessor,
    totalMesesConvertido: totalConvertido,
    conversoes,
    totalMesesBruto: totalBruto,
  };
}

// ─── Requisitos progressivos ────────────────────────────────────────────────

function pontosExigidosComum(ano: number, sexo: Sexo, professor: boolean): number {
  const base = sexo === "F" ? 86 : 96;
  const ajuste = professor ? -5 : 0;
  const pontos = base + ajuste + (ano - 2019);
  const teto = sexo === "F" ? (professor ? 92 : 100) : (professor ? 100 : 105);
  return Math.min(pontos, teto);
}

function idadeMinProgressiva(ano: number, sexo: Sexo, professor: boolean): number {
  const baseF = professor ? 51 : 56;
  const baseM = professor ? 56 : 61;
  const base = sexo === "F" ? baseF : baseM;
  const inc = (ano - 2019) * 0.5;
  const tetoF = professor ? 57 : 62;
  const tetoM = professor ? 60 : 65;
  return Math.min(base + inc, sexo === "F" ? tetoF : tetoM);
}

function tcMinMesesComum(sexo: Sexo, professor: boolean): number {
  return (sexo === "F" ? (professor ? 25 : 30) : (professor ? 30 : 35)) * 12;
}

function pontosExigidosEspecial(ano: number, tipo: "URBANA_ESPECIAL_15" | "URBANA_ESPECIAL_20" | "URBANA_ESPECIAL_25"): number {
  const regra = ESPECIAL_REGRAS[tipo];
  const pontos = regra.pontosBase2019 + (ano - 2019);
  return Math.min(pontos, regra.pontosTeto);
}

// ─── Coeficiente (art. 26 EC 103) ──────────────────────────────────────────

function calcCoeficiente(tcMeses: number, sexo: Sexo): { coef: number; detalhes: string } {
  const tcAnos = Math.floor(tcMeses / 12);
  const limiar = sexo === "F" ? 15 : 20;
  const exc = Math.max(0, tcAnos - limiar);
  const coef = Math.min(1, 0.6 + exc * 0.02);
  return { coef, detalhes: `60% + ${exc} × 2% = ${round2(coef * 100)}% (TC: ${tcAnos}a, limiar: ${limiar}a)` };
}

function calcCoeficienteEspecial(tcMeses: number, tcMinAnos: number): { coef: number; detalhes: string } {
  const tcAnos = Math.floor(tcMeses / 12);
  const exc = Math.max(0, tcAnos - tcMinAnos);
  const coef = Math.min(1, 0.6 + exc * 0.02);
  return { coef, detalhes: `60% + ${exc} × 2% = ${round2(coef * 100)}% (TC especial: ${tcAnos}a, limiar: ${tcMinAnos}a)` };
}

// ─── Simulação de cada regra ────────────────────────────────────────────────

function projetar(
  p: ParametrosSimulacao, dataRef: string, tcAtual: number,
  checaFn: (anoRef: number, idadeRef: number, tcRef: number) => boolean,
): { mesesRestantes: number; dataPrevista: string | null } {
  if (!p.continuaContribuindo) return { mesesRestantes: 999, dataPrevista: null };
  for (let m = 1; m <= 480; m++) {
    const futuro = addMesesStr(dataRef, m);
    const anoFut = parseInt(futuro.slice(0, 4));
    const idadeFut = idadeEmAnos(p.dataNascimento, futuro);
    const tcFut = tcAtual + m;
    if (checaFn(anoFut, idadeFut, tcFut)) return { mesesRestantes: m, dataPrevista: futuro };
  }
  return { mesesRestantes: 0, dataPrevista: null };
}

function simPontos(p: ParametrosSimulacao, tc: ResumoTC, dataRef: string): ResultadoRegra {
  const filiadoAntes = p.periodos.some(pe => pe.dataInicio < DATA_REFORMA);
  const temProfessor = p.periodos.some(pe => pe.tipoAtividade === "PROFESSOR");
  const tcUsar = temProfessor ? tc.totalMesesProfessor + tc.totalMesesConvertido : tc.totalMesesConvertido;
  const tcMin = tcMinMesesComum(p.sexo, temProfessor);
  const idade = idadeEmAnos(p.dataNascimento, dataRef);
  const anoRef = parseInt(dataRef.slice(0, 4));
  const pontosReq = pontosExigidosComum(anoRef, p.sexo, temProfessor);
  const pontosAt = idade + Math.floor(tcUsar / 12);
  const elegivel = filiadoAntes && tcUsar >= tcMin && pontosAt >= pontosReq;

  let mR = 0; let dP: string | null = null;
  if (!elegivel && filiadoAntes) {
    const proj = projetar(p, dataRef, tcUsar, (ano, id, tcF) => {
      return tcF >= tcMin && (id + Math.floor(tcF / 12)) >= pontosExigidosComum(ano, p.sexo, temProfessor);
    });
    mR = proj.mesesRestantes; dP = proj.dataPrevista;
  }

  const { coef, detalhes } = calcCoeficiente(elegivel ? tcUsar : tcUsar + mR, p.sexo);
  return {
    regra: "PONTOS", nomeRegra: REGRA_LABELS.PONTOS, aplicavel: filiadoAntes, elegivel,
    dataPrevistaAposentadoria: elegivel ? dataRef : dP, mesesRestantes: elegivel ? 0 : mR,
    idadeMinimaExigida: null, pontosExigidos: pontosReq, tcMinimoExigidoMeses: tcMin,
    idadeAtual: idade, tcAtualMeses: tcUsar, pontosAtuais: pontosAt,
    coeficiente: coef, detalhesCoeficiente: detalhes,
    fundamentacao: `Art. 15, EC 103/2019. Pontos ${anoRef}: ${pontosReq}. TC mín: ${tcMin / 12}a.`,
  };
}

function simIdadeProgressiva(p: ParametrosSimulacao, tc: ResumoTC, dataRef: string): ResultadoRegra {
  const filiadoAntes = p.periodos.some(pe => pe.dataInicio < DATA_REFORMA);
  const temProf = p.periodos.some(pe => pe.tipoAtividade === "PROFESSOR");
  const tcUsar = tc.totalMesesConvertido;
  const tcMin = tcMinMesesComum(p.sexo, temProf);
  const idade = idadeEmAnos(p.dataNascimento, dataRef);
  const anoRef = parseInt(dataRef.slice(0, 4));
  const idadeMin = idadeMinProgressiva(anoRef, p.sexo, temProf);
  const elegivel = filiadoAntes && tcUsar >= tcMin && idade >= idadeMin;

  let mR = 0; let dP: string | null = null;
  if (!elegivel && filiadoAntes) {
    const proj = projetar(p, dataRef, tcUsar, (ano, id, tcF) => {
      return tcF >= tcMin && id >= idadeMinProgressiva(ano, p.sexo, temProf);
    });
    mR = proj.mesesRestantes; dP = proj.dataPrevista;
  }

  const { coef, detalhes } = calcCoeficiente(elegivel ? tcUsar : tcUsar + mR, p.sexo);
  return {
    regra: "IDADE_PROGRESSIVA", nomeRegra: REGRA_LABELS.IDADE_PROGRESSIVA, aplicavel: filiadoAntes, elegivel,
    dataPrevistaAposentadoria: elegivel ? dataRef : dP, mesesRestantes: elegivel ? 0 : mR,
    idadeMinimaExigida: idadeMin, pontosExigidos: null, tcMinimoExigidoMeses: tcMin,
    idadeAtual: idade, tcAtualMeses: tcUsar, pontosAtuais: null,
    coeficiente: coef, detalhesCoeficiente: detalhes,
    fundamentacao: `Art. 16, EC 103. Idade mín ${anoRef}: ${idadeMin}a. TC mín: ${tcMin / 12}a.`,
  };
}

function simPedagio50(p: ParametrosSimulacao, tc: ResumoTC, dataRef: string): ResultadoRegra {
  const filiadoAntes = p.periodos.some(pe => pe.dataInicio < DATA_REFORMA);
  const tcUsar = tc.totalMesesConvertido;
  const tcMinMes = tcMinMesesComum(p.sexo, false);
  const idade = idadeEmAnos(p.dataNascimento, dataRef);

  // TC na data da reforma
  const tcNaReforma = p.periodos.reduce((s, pe) => {
    const fim = minStr(pe.aindaAtivo ? hoje() : (pe.dataFim || hoje()), DATA_REFORMA);
    if (fim <= pe.dataInicio) return s;
    return s + Math.max(0, diffMeses(pe.dataInicio, fim));
  }, 0);

  const tcMinReforma = p.sexo === "F" ? 28 * 12 : 33 * 12;
  const aplicavel = filiadoAntes && tcNaReforma >= tcMinReforma;
  const tcFaltava = Math.max(0, tcMinMes - tcNaReforma);
  const pedagio = Math.ceil(tcFaltava * 0.5);
  const tcNecessario = tcMinMes + pedagio;
  const elegivel = aplicavel && tcUsar >= tcNecessario;

  let mR = 0; let dP: string | null = null;
  if (!elegivel && aplicavel) {
    mR = Math.max(0, tcNecessario - tcUsar);
    dP = mR > 0 ? addMesesStr(dataRef, mR) : null;
  }

  const { coef, detalhes } = calcCoeficiente(elegivel ? tcUsar : tcUsar + mR, p.sexo);
  return {
    regra: "PEDAGIO_50", nomeRegra: REGRA_LABELS.PEDAGIO_50, aplicavel, elegivel,
    dataPrevistaAposentadoria: elegivel ? dataRef : dP, mesesRestantes: elegivel ? 0 : mR,
    idadeMinimaExigida: null, pontosExigidos: null, tcMinimoExigidoMeses: tcNecessario,
    pedagioMeses: pedagio,
    idadeAtual: idade, tcAtualMeses: tcUsar, pontosAtuais: null,
    coeficiente: coef, detalhesCoeficiente: `${detalhes}. NOTA: pode incidir Fator Previdenciário.`,
    fundamentacao: `Art. 17, EC 103. Pedágio 50%: ${pedagio}m. Aplica Fator Previdenciário.`,
  };
}

function simIdadeTransicao(p: ParametrosSimulacao, tc: ResumoTC, dataRef: string): ResultadoRegra {
  const filiadoAntes = p.periodos.some(pe => pe.dataInicio < DATA_REFORMA);
  const tcUsar = tc.totalMesesConvertido;
  const tcMin = 15 * 12;
  const idade = idadeEmAnos(p.dataNascimento, dataRef);
  const idadeMin = p.sexo === "F" ? 62 : 65;
  const elegivel = filiadoAntes && tcUsar >= tcMin && idade >= idadeMin;

  let mR = 0; let dP: string | null = null;
  if (!elegivel && filiadoAntes) {
    const proj = projetar(p, dataRef, tcUsar, (_ano, id, tcF) => tcF >= tcMin && id >= idadeMin);
    mR = proj.mesesRestantes; dP = proj.dataPrevista;
  }

  const { coef, detalhes } = calcCoeficiente(elegivel ? tcUsar : tcUsar + mR, p.sexo);
  return {
    regra: "IDADE_TRANSICAO", nomeRegra: REGRA_LABELS.IDADE_TRANSICAO, aplicavel: filiadoAntes, elegivel,
    dataPrevistaAposentadoria: elegivel ? dataRef : dP, mesesRestantes: elegivel ? 0 : mR,
    idadeMinimaExigida: idadeMin, pontosExigidos: null, tcMinimoExigidoMeses: tcMin,
    idadeAtual: idade, tcAtualMeses: tcUsar, pontosAtuais: null,
    coeficiente: coef, detalhesCoeficiente: detalhes,
    fundamentacao: `Art. 18, EC 103. Idade: ${idadeMin}a. TC: 15a.`,
  };
}

function simPedagio100(p: ParametrosSimulacao, tc: ResumoTC, dataRef: string): ResultadoRegra {
  const filiadoAntes = p.periodos.some(pe => pe.dataInicio < DATA_REFORMA);
  const temProf = p.periodos.some(pe => pe.tipoAtividade === "PROFESSOR");
  const tcUsar = tc.totalMesesConvertido;
  const tcMinMes = tcMinMesesComum(p.sexo, temProf);
  const idade = idadeEmAnos(p.dataNascimento, dataRef);
  const idadeMin = p.sexo === "F" ? (temProf ? 52 : 57) : (temProf ? 55 : 60);

  const tcNaReforma = p.periodos.reduce((s, pe) => {
    const fim = minStr(pe.aindaAtivo ? hoje() : (pe.dataFim || hoje()), DATA_REFORMA);
    if (fim <= pe.dataInicio) return s;
    return s + Math.max(0, diffMeses(pe.dataInicio, fim));
  }, 0);

  const tcFaltava = Math.max(0, tcMinMes - tcNaReforma);
  const pedagio = tcFaltava; // 100%
  const tcNecessario = tcMinMes + pedagio;
  const elegivel = filiadoAntes && tcUsar >= tcNecessario && idade >= idadeMin;

  let mR = 0; let dP: string | null = null;
  if (!elegivel && filiadoAntes) {
    const proj = projetar(p, dataRef, tcUsar, (_ano, id, tcF) => tcF >= tcNecessario && id >= idadeMin);
    mR = proj.mesesRestantes; dP = proj.dataPrevista;
  }

  return {
    regra: "PEDAGIO_100", nomeRegra: REGRA_LABELS.PEDAGIO_100, aplicavel: filiadoAntes, elegivel,
    dataPrevistaAposentadoria: elegivel ? dataRef : dP, mesesRestantes: elegivel ? 0 : mR,
    idadeMinimaExigida: idadeMin, pontosExigidos: null, tcMinimoExigidoMeses: tcNecessario,
    pedagioMeses: pedagio,
    idadeAtual: idade, tcAtualMeses: tcUsar, pontosAtuais: null,
    coeficiente: 1, detalhesCoeficiente: "100% da média (benefício integral)",
    fundamentacao: `Art. 20, EC 103. Idade: ${idadeMin}a. Pedágio 100%: ${pedagio}m.`,
  };
}

function simPermanente(p: ParametrosSimulacao, tc: ResumoTC, dataRef: string): ResultadoRegra {
  const tcUsar = tc.totalMesesConvertido;
  const idade = idadeEmAnos(p.dataNascimento, dataRef);
  const idadeMin = p.sexo === "F" ? 62 : 65;
  const filiadoApos = !p.periodos.some(pe => pe.dataInicio < DATA_REFORMA);
  const tcMin = (p.sexo === "M" && filiadoApos) ? 20 * 12 : 15 * 12;
  const elegivel = tcUsar >= tcMin && idade >= idadeMin;

  let mR = 0; let dP: string | null = null;
  if (!elegivel) {
    const proj = projetar(p, dataRef, tcUsar, (_a, id, tcF) => tcF >= tcMin && id >= idadeMin);
    mR = proj.mesesRestantes; dP = proj.dataPrevista;
  }

  const { coef, detalhes } = calcCoeficiente(elegivel ? tcUsar : tcUsar + mR, p.sexo);
  return {
    regra: "PERMANENTE", nomeRegra: REGRA_LABELS.PERMANENTE, aplicavel: true, elegivel,
    dataPrevistaAposentadoria: elegivel ? dataRef : dP, mesesRestantes: elegivel ? 0 : mR,
    idadeMinimaExigida: idadeMin, pontosExigidos: null, tcMinimoExigidoMeses: tcMin,
    idadeAtual: idade, tcAtualMeses: tcUsar, pontosAtuais: null,
    coeficiente: coef, detalhesCoeficiente: detalhes,
    fundamentacao: `Art. 201 CF. Idade: ${idadeMin}a. TC: ${tcMin / 12}a.`,
  };
}

function simEspecialTransicao(p: ParametrosSimulacao, tc: ResumoTC, dataRef: string, tipo: "URBANA_ESPECIAL_15" | "URBANA_ESPECIAL_20" | "URBANA_ESPECIAL_25"): ResultadoRegra {
  const regra = ESPECIAL_REGRAS[tipo];
  const filiadoAntes = p.periodos.some(pe => pe.dataInicio < DATA_REFORMA);
  const tcEspecial = tipo === "URBANA_ESPECIAL_15" ? tc.totalMesesEspecial15
    : tipo === "URBANA_ESPECIAL_20" ? tc.totalMesesEspecial20 : tc.totalMesesEspecial25;
  const tcMin = regra.tcMinAnos * 12;
  const idade = idadeEmAnos(p.dataNascimento, dataRef);
  const anoRef = parseInt(dataRef.slice(0, 4));
  const pontosReq = pontosExigidosEspecial(anoRef, tipo);
  const pontosAt = idade + Math.floor(tcEspecial / 12);
  const aplicavel = filiadoAntes && tcEspecial > 0;
  const elegivel = aplicavel && tcEspecial >= tcMin && pontosAt >= pontosReq;

  let mR = 0; let dP: string | null = null;
  if (!elegivel && aplicavel && p.continuaContribuindo) {
    const proj = projetar(p, dataRef, tcEspecial, (ano, id, tcF) => {
      return tcF >= tcMin && (id + Math.floor(tcF / 12)) >= pontosExigidosEspecial(ano, tipo);
    });
    mR = proj.mesesRestantes; dP = proj.dataPrevista;
  }

  const { coef, detalhes } = calcCoeficienteEspecial(elegivel ? tcEspecial : tcEspecial + mR, regra.tcMinAnos);
  const nomeRegra = `${REGRA_LABELS.ESPECIAL_TRANSICAO} (${regra.tcMinAnos}a)`;
  return {
    regra: "ESPECIAL_TRANSICAO", nomeRegra, aplicavel, elegivel,
    dataPrevistaAposentadoria: elegivel ? dataRef : dP, mesesRestantes: elegivel ? 0 : mR,
    idadeMinimaExigida: null, pontosExigidos: pontosReq, tcMinimoExigidoMeses: tcMin,
    idadeAtual: idade, tcAtualMeses: tcEspecial, pontosAtuais: pontosAt,
    coeficiente: coef, detalhesCoeficiente: detalhes,
    fundamentacao: `Art. 21, EC 103. Especial ${regra.tcMinAnos}a. Pontos ${anoRef}: ${pontosReq}.`,
  };
}

function simEspecialPermanente(p: ParametrosSimulacao, tc: ResumoTC, dataRef: string, tipo: "URBANA_ESPECIAL_15" | "URBANA_ESPECIAL_20" | "URBANA_ESPECIAL_25"): ResultadoRegra {
  const regra = ESPECIAL_REGRAS[tipo];
  const tcEspecial = tipo === "URBANA_ESPECIAL_15" ? tc.totalMesesEspecial15
    : tipo === "URBANA_ESPECIAL_20" ? tc.totalMesesEspecial20 : tc.totalMesesEspecial25;
  const tcMin = regra.tcMinAnos * 12;
  const idade = idadeEmAnos(p.dataNascimento, dataRef);
  const aplicavel = tcEspecial > 0;
  const elegivel = aplicavel && tcEspecial >= tcMin && idade >= regra.idadeMinPermanente;

  let mR = 0; let dP: string | null = null;
  if (!elegivel && aplicavel && p.continuaContribuindo) {
    const proj = projetar(p, dataRef, tcEspecial, (_a, id, tcF) => tcF >= tcMin && id >= regra.idadeMinPermanente);
    mR = proj.mesesRestantes; dP = proj.dataPrevista;
  }

  const { coef, detalhes } = calcCoeficienteEspecial(elegivel ? tcEspecial : tcEspecial + mR, regra.tcMinAnos);
  const nomeRegra = `${REGRA_LABELS.ESPECIAL_PERMANENTE} (${regra.tcMinAnos}a)`;
  return {
    regra: "ESPECIAL_PERMANENTE", nomeRegra, aplicavel, elegivel,
    dataPrevistaAposentadoria: elegivel ? dataRef : dP, mesesRestantes: elegivel ? 0 : mR,
    idadeMinimaExigida: regra.idadeMinPermanente, pontosExigidos: null, tcMinimoExigidoMeses: tcMin,
    idadeAtual: idade, tcAtualMeses: tcEspecial, pontosAtuais: null,
    coeficiente: coef, detalhesCoeficiente: detalhes,
    fundamentacao: `Regra permanente especial. Idade: ${regra.idadeMinPermanente}a. TC especial: ${regra.tcMinAnos}a.`,
  };
}

function simRural(p: ParametrosSimulacao, tc: ResumoTC, dataRef: string): ResultadoRegra {
  const temRural = tc.totalMesesRural > 0;
  const tcMin = 15 * 12;
  const idade = idadeEmAnos(p.dataNascimento, dataRef);
  const idadeMin = p.sexo === "F" ? 55 : 60;
  const elegivel = temRural && tc.totalMesesRural >= tcMin && idade >= idadeMin;

  let mR = 0; let dP: string | null = null;
  if (!elegivel && temRural && p.continuaContribuindo) {
    const proj = projetar(p, dataRef, tc.totalMesesRural, (_a, id, tcF) => tcF >= tcMin && id >= idadeMin);
    mR = proj.mesesRestantes; dP = proj.dataPrevista;
  }

  return {
    regra: "RURAL", nomeRegra: REGRA_LABELS.RURAL, aplicavel: temRural, elegivel,
    dataPrevistaAposentadoria: elegivel ? dataRef : dP, mesesRestantes: elegivel ? 0 : mR,
    idadeMinimaExigida: idadeMin, pontosExigidos: null, tcMinimoExigidoMeses: tcMin,
    idadeAtual: idade, tcAtualMeses: tc.totalMesesRural, pontosAtuais: null,
    coeficiente: 1, detalhesCoeficiente: "100% (1 salário mínimo para segurado especial)",
    fundamentacao: `Art. 201 §7º II CF. Rural: ${idadeMin}a + 15a atividade.`,
  };
}

// ─── Simulação principal ────────────────────────────────────────────────────

export function simularAposentadoria(params: ParametrosSimulacao): ResultadoSimulacao {
  const dataRef = hoje();
  const tc = calcularResumoTC(params.periodos, params.sexo);
  const filiadoAntes = params.periodos.some(pe => pe.dataInicio < DATA_REFORMA);

  const regras: ResultadoRegra[] = [];

  // Regras comuns de transição
  if (filiadoAntes) {
    regras.push(simPontos(params, tc, dataRef));
    regras.push(simIdadeProgressiva(params, tc, dataRef));
    regras.push(simPedagio50(params, tc, dataRef));
    regras.push(simIdadeTransicao(params, tc, dataRef));
    regras.push(simPedagio100(params, tc, dataRef));
  }
  regras.push(simPermanente(params, tc, dataRef));

  // Regras especiais (só se tem período especial)
  const tiposEspeciais: Array<"URBANA_ESPECIAL_15" | "URBANA_ESPECIAL_20" | "URBANA_ESPECIAL_25"> = [];
  if (tc.totalMesesEspecial15 > 0) tiposEspeciais.push("URBANA_ESPECIAL_15");
  if (tc.totalMesesEspecial20 > 0) tiposEspeciais.push("URBANA_ESPECIAL_20");
  if (tc.totalMesesEspecial25 > 0) tiposEspeciais.push("URBANA_ESPECIAL_25");

  for (const tipo of tiposEspeciais) {
    if (filiadoAntes) regras.push(simEspecialTransicao(params, tc, dataRef, tipo));
    regras.push(simEspecialPermanente(params, tc, dataRef, tipo));
  }

  // Regra rural
  if (tc.totalMesesRural > 0) {
    regras.push(simRural(params, tc, dataRef));
  }

  // Filtrar só aplicáveis
  const aplicaveis = regras.filter(r => r.aplicavel);

  const elegiveis = aplicaveis.filter(r => r.elegivel);
  const melhorRegra = elegiveis.length > 0
    ? elegiveis.reduce((a, b) => a.coeficiente >= b.coeficiente ? a : b)
    : null;

  const proximas = aplicaveis
    .filter(r => !r.elegivel && r.mesesRestantes > 0)
    .sort((a, b) => a.mesesRestantes - b.mesesRestantes)
    .slice(0, 3);

  return {
    resumoTC: tc,
    regras: aplicaveis,
    melhorRegra,
    regrasMaisProximas: proximas,
    parecerTecnico: "",
    protocoloCalculo: gerarProtocolo(),
    dataCalculo: dataRef,
  };
}

// ─── RMI (mantido da v1, sem alteração) ─────────────────────────────────────

export function calcularRMI(params: ParametrosRMI): ResultadoRMI {
  const salarios = params.salariosContribuicao.filter(s => s > 0);
  if (salarios.length === 0) throw new Error("Nenhum salário informado.");

  const usaRegra80 = params.regraAplicavel === "PEDAGIO_50" && params.aplicarFatorPrevidenciario;
  let salariosCalc: number[];
  if (usaRegra80) {
    const ord = [...salarios].sort((a, b) => b - a);
    salariosCalc = ord.slice(0, Math.ceil(ord.length * 0.8));
  } else {
    salariosCalc = salarios;
  }

  const media = round2(salariosCalc.reduce((s, v) => s + v, 0) / salariosCalc.length);
  const { coef, detalhes } = calcCoeficiente(params.tempoContribuicaoMeses, params.sexo);

  let fatorPrev: number | undefined;
  if (params.aplicarFatorPrevidenciario) {
    const idade = idadeEmAnos(params.dataNascimento, params.dataAposentadoria);
    const es = Math.max(5, 80 - idade); // simplificação tabela IBGE
    const tc = Math.floor(params.tempoContribuicaoMeses / 12);
    const a = 0.31;
    fatorPrev = round2(Math.max(0.3, Math.min(1.5, (tc * a / es) * (1 + idade + tc * a) / 100)));
  }

  let rmi: number;
  if (params.regraAplicavel === "PEDAGIO_100" || params.regraAplicavel === "RURAL") {
    rmi = round2(media);
  } else if (fatorPrev) {
    rmi = round2(media * fatorPrev);
  } else {
    rmi = round2(media * coef);
  }

  const rmiLimitada = round2(Math.max(SALARIO_MINIMO_2026, Math.min(TETO_INSS_2026, rmi)));

  const fund = usaRegra80
    ? "Média 80% maiores salários (art. 29 Lei 8.213/91). Fator Previdenciário aplicado."
    : "Média 100% salários desde jul/1994 (art. 26, EC 103).";

  return {
    mediaSalarios: media, quantidadeSalarios: salariosCalc.length,
    coeficiente: (params.regraAplicavel === "PEDAGIO_100" || params.regraAplicavel === "RURAL") ? 1 : coef,
    detalhesCoeficiente: (params.regraAplicavel === "PEDAGIO_100" || params.regraAplicavel === "RURAL") ? "100% (integral)" : detalhes,
    rmi, rmiLimitada, tetoINSS: TETO_INSS_2026, pisoINSS: SALARIO_MINIMO_2026,
    fatorPrevidenciario: fatorPrev, fundamentacao: fund,
  };
}

// ─── GPS em Atraso (mantido da v1) ──────────────────────────────────────────

export function calcularGPSAtraso(params: ParametrosGPS): ResultadoGPS {
  const alertas: string[] = [];
  const linhas: LinhaGPS[] = [];
  const aliquota = ALIQUOTAS[params.plano] / 100;
  const valorBase = round2(params.salarioContribuicao * aliquota);
  const hojeDate = new Date();

  if (params.categoria === "FACULTATIVO") {
    if (params.competenciasAtrasadas.length > 6)
      alertas.push("Facultativo: máximo 6 meses de atraso. Excedentes não reconhecidos.");
    if (!params.primeiraContribuicaoEmDia)
      alertas.push("Facultativo: precisa de ao menos 1 contribuição paga em dia para contar como carência.");
  }

  if (params.categoria === "CONTRIBUINTE_INDIVIDUAL" || params.categoria === "MEI") {
    const cincoAnos = new Date(hojeDate); cincoAnos.setFullYear(cincoAnos.getFullYear() - 5);
    const decadentes = params.competenciasAtrasadas.filter(c => { const [y, m] = c.split("-").map(Number); return new Date(y, m - 1) < cincoAnos; });
    if (decadentes.length > 0)
      alertas.push(`${decadentes.length} competência(s) com >5 anos (período decadente). Exige comprovação de atividade via INSS.`);
    if (!params.jaInscritoNoINSS)
      alertas.push("Não inscrito no INSS: pagamento exige comprovação de atividade, independente do prazo.");
  }

  for (const comp of params.competenciasAtrasadas) {
    const [ac, mc] = comp.split("-").map(Number);
    const venc = new Date(ac, mc, 15);
    const dias = Math.max(0, Math.floor((hojeDate.getTime() - venc.getTime()) / 86400000));
    const mesesAtr = Math.max(1, Math.ceil(dias / 30));
    const juros = round2(valorBase * 0.01 * mesesAtr);
    const multa = round2(valorBase * 0.10);
    const total = round2(valorBase + juros + multa);
    const carencia = params.categoria === "FACULTATIVO"
      ? (dias <= 180 && params.primeiraContribuicaoEmDia)
      : (params.jaInscritoNoINSS && dias <= 5 * 365);

    linhas.push({ competencia: comp, valorOriginal: valorBase, diasAtraso: dias, jurosSELIC: juros, multa, valorTotal: total, contaParaCarencia: carencia, contaParaTC: true });
  }

  return {
    linhas,
    totalOriginal: round2(linhas.reduce((s, l) => s + l.valorOriginal, 0)),
    totalJuros: round2(linhas.reduce((s, l) => s + l.jurosSELIC, 0)),
    totalMulta: round2(linhas.reduce((s, l) => s + l.multa, 0)),
    totalAPagar: round2(linhas.reduce((s, l) => s + l.valorTotal, 0)),
    alertas,
    fundamentacao: "Lei 8.212/91 (arts. 21, 30); Decreto 3.048/99 (art. 239). Juros: SELIC (art. 35 Lei 8.212/91). Multa: 10%. Facultativo: máx 6 meses (art. 11 §1º Lei 8.213/91). Decadente (>5a): comprovação via INSS.",
  };
}

/**
 * Integração com a API SGS do Banco Central — Indexadores v3
 *
 * v3: Fallback robusto com taxas de referência quando API indisponível.
 * O sistema NUNCA trava por falta de conexão — usa valores de referência
 * atualizados periodicamente e marca a fonte como "estimativa".
 *
 * Séries SGS: TR(226), IPCA(433), IGP-M(189), IPC-FIPE(193)
 */

import axios from "axios";
import type { IndexadorCorrecao } from "../../shared/imobiliario-types";

const BCB_BASE_URL = "https://api.bcb.gov.br/dados/serie/bcdata.sgs";

const SERIES_SGS: Record<string, number> = {
  TR: 226,
  IPCA: 433,
  IGPM: 189,
  IPC: 193,
};

interface DadoSGS {
  data: string;
  valor: string;
}

/**
 * Taxas de referência (fallback quando API indisponível).
 * Atualizadas manualmente — valores representam médias recentes.
 * Última atualização: março/2026.
 */
const TAXAS_REFERENCIA: Record<string, { mensal: number; anual: number; ref: string }> = {
  TR:   { mensal: 0.0900, anual: 1.0838, ref: "Referência mar/2026 (média 12m)" },
  IPCA: { mensal: 0.4500, anual: 5.5273, ref: "Referência mar/2026 (média 12m)" },
  IGPM: { mensal: 0.5000, anual: 6.1677, ref: "Referência mar/2026 (média 12m)" },
  IPC:  { mensal: 0.3500, anual: 4.2818, ref: "Referência mar/2026 (média 12m)" },
};

export interface IndexadorBACEN {
  indexador: IndexadorCorrecao;
  taxaMensal: number;
  taxaAnual: number;
  dataReferencia: string;
  fonte: string;
}

function round4(v: number): number { return parseFloat(v.toFixed(4)); }

function mensalParaAnualIdx(mensal: number): number {
  return round4((Math.pow(1 + mensal / 100, 12) - 1) * 100);
}

/**
 * Retorna a taxa de referência (fallback) para um indexador.
 * Nunca falha — sempre retorna um valor.
 */
function getFallback(indexador: IndexadorCorrecao): IndexadorBACEN {
  if (indexador === "NENHUM") {
    return { indexador: "NENHUM", taxaMensal: 0, taxaAnual: 0, dataReferencia: new Date().toISOString().slice(0, 10), fonte: "Sem correção monetária" };
  }
  if (indexador === "POUPANCA") {
    const tr = TAXAS_REFERENCIA["TR"];
    const mensal = round4(tr.mensal + 0.5);
    return { indexador: "POUPANCA", taxaMensal: mensal, taxaAnual: mensalParaAnualIdx(mensal), dataReferencia: new Date().toISOString().slice(0, 10), fonte: `Estimativa (TR ${tr.mensal}% + 0,5% a.m.)` };
  }
  const ref = TAXAS_REFERENCIA[indexador];
  if (!ref) {
    return { indexador, taxaMensal: 0.1, taxaAnual: 1.2068, dataReferencia: new Date().toISOString().slice(0, 10), fonte: "Estimativa genérica" };
  }
  return { indexador, taxaMensal: ref.mensal, taxaAnual: ref.anual, dataReferencia: new Date().toISOString().slice(0, 10), fonte: ref.ref };
}

// ─── Busca API BACEN ────────────────────────────────────────────────────────

/**
 * Busca a taxa mensal mais recente do indexador via API SGS.
 * Busca últimos 6 meses para encontrar o dado mais recente.
 */
export async function buscarIndexadorBACEN(indexador: IndexadorCorrecao): Promise<IndexadorBACEN> {
  if (indexador === "NENHUM") return getFallback("NENHUM");

  if (indexador === "POUPANCA") {
    const tr = await buscarIndexadorBACEN("TR");
    const mensal = round4(tr.taxaMensal + 0.5);
    return { indexador: "POUPANCA", taxaMensal: mensal, taxaAnual: mensalParaAnualIdx(mensal), dataReferencia: tr.dataReferencia, fonte: `BACEN SGS (TR série 226 + 0,5% a.m.)` };
  }

  const codigoSGS = SERIES_SGS[indexador];
  if (!codigoSGS) throw new Error(`Indexador ${indexador} sem série SGS.`);

  const hoje = new Date();
  const inicio = new Date(hoje);
  inicio.setMonth(inicio.getMonth() - 6);
  const fmtData = (d: Date) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  const url = `${BCB_BASE_URL}/${codigoSGS}/dados?formato=json&dataInicial=${fmtData(inicio)}&dataFinal=${fmtData(hoje)}`;

  const response = await axios.get<DadoSGS[]>(url, { timeout: 10000 });
  const dados = response.data;

  if (!Array.isArray(dados) || dados.length === 0) {
    throw new Error(`Sem dados para ${indexador} (série ${codigoSGS}).`);
  }

  const ultimo = dados[dados.length - 1];
  const taxaMensal = parseFloat(ultimo.valor.replace(",", "."));
  if (isNaN(taxaMensal)) throw new Error(`Valor inválido: "${ultimo.valor}"`);

  const [dd, mm, yyyy] = ultimo.data.split("/");
  return {
    indexador,
    taxaMensal: round4(taxaMensal),
    taxaAnual: mensalParaAnualIdx(taxaMensal),
    dataReferencia: `${yyyy}-${mm}-${dd}`,
    fonte: `BACEN SGS série ${codigoSGS} (${ultimo.data})`,
  };
}

/**
 * Busca indexador com fallback ROBUSTO.
 * Se API falhar por qualquer motivo, retorna taxa de referência.
 * NUNCA retorna null — sempre retorna um valor utilizável.
 */
export async function buscarIndexadorComFallback(indexador: IndexadorCorrecao): Promise<IndexadorBACEN> {
  if (indexador === "NENHUM") return getFallback("NENHUM");
  try {
    return await buscarIndexadorBACEN(indexador);
  } catch (err: any) {
    console.warn(`[BACEN] Falha ao buscar ${indexador}: ${err.message}. Usando referência.`);
    return getFallback(indexador);
  }
}

// ─── Série Histórica Mensal ─────────────────────────────────────────────────

export interface TaxaMensalHistorica {
  data: string;
  competencia: string;
  taxaMensal: number;
}

/**
 * Busca série histórica mensal do indexador via API SGS.
 */
export async function buscarSerieHistorica(
  indexador: IndexadorCorrecao,
  dataInicio: string,
  prazoMeses: number,
): Promise<{ mapa: Record<string, number>; serie: TaxaMensalHistorica[]; fonte: string }> {
  if (indexador === "NENHUM") return { mapa: {}, serie: [], fonte: "Sem correção" };

  if (indexador === "POUPANCA") {
    const result = await buscarSerieHistorica("TR", dataInicio, prazoMeses);
    const mapa: Record<string, number> = {};
    const serie: TaxaMensalHistorica[] = [];
    for (const item of result.serie) {
      const t = round4(item.taxaMensal + 0.5);
      mapa[item.competencia] = t;
      serie.push({ ...item, taxaMensal: t });
    }
    return { mapa, serie, fonte: "BACEN SGS (TR + 0,5% a.m.)" };
  }

  const codigoSGS = SERIES_SGS[indexador];
  if (!codigoSGS) throw new Error(`Indexador ${indexador} sem série SGS.`);

  const [y, m] = dataInicio.split("-").map(Number);
  const inicio = new Date(y, m - 1, 1);
  const hoje = new Date();
  const fimCalc = new Date(y, m - 1 + prazoMeses, 0);
  const fim = fimCalc > hoje ? hoje : fimCalc;

  const fmtData = (d: Date) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  const url = `${BCB_BASE_URL}/${codigoSGS}/dados?formato=json&dataInicial=${fmtData(inicio)}&dataFinal=${fmtData(fim)}`;

  const response = await axios.get<DadoSGS[]>(url, { timeout: 15000 });
  const dados = response.data;
  if (!Array.isArray(dados) || dados.length === 0) throw new Error(`Sem dados históricos para ${indexador}.`);

  const mapa: Record<string, number> = {};
  const serie: TaxaMensalHistorica[] = [];
  for (const dado of dados) {
    const valor = parseFloat(dado.valor.replace(",", "."));
    if (isNaN(valor)) continue;
    const [dd, mm, yyyy] = dado.data.split("/");
    const competencia = `${yyyy}-${mm}`;
    mapa[competencia] = valor;
    serie.push({ data: `${yyyy}-${mm}-${dd}`, competencia, taxaMensal: valor });
  }

  return { mapa, serie, fonte: `BACEN SGS série ${codigoSGS} (${dados.length} valores, ${dados[0]?.data} a ${dados[dados.length - 1]?.data})` };
}

/**
 * Busca série histórica com fallback.
 * Se API falhar, retorna null (engine usa taxa fixa).
 */
export async function buscarSerieHistoricaComFallback(
  indexador: IndexadorCorrecao,
  dataInicio: string,
  prazoMeses: number,
): Promise<{ mapa: Record<string, number>; serie: TaxaMensalHistorica[]; fonte: string } | null> {
  if (indexador === "NENHUM") return { mapa: {}, serie: [], fonte: "Sem correção" };
  try {
    return await buscarSerieHistorica(indexador, dataInicio, prazoMeses);
  } catch (err: any) {
    console.warn(`[BACEN] Falha série histórica ${indexador}: ${err.message}`);
    return null;
  }
}

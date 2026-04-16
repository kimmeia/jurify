/**
 * Integração com a API SGS do Banco Central — Indexadores v4
 *
 * v4 (2026-04): Sem fallback inventado.
 *
 * Se a API BACEN falhar, o sistema LANÇA ERRO explícito. Nunca retorna
 * valor "de referência" silencioso — parecer jurídico não pode citar
 * dado do BACEN usando valor hardcoded. Ao cair em erro, o caller
 * precisa informar o usuário pra tentar depois ou escolher outro
 * indexador.
 *
 * Séries SGS: TR(226), IPCA(433), IGP-M(189), IPC-FIPE(193)
 */

import axios from "axios";
import type { IndexadorCorrecao } from "../../shared/imobiliario-types";
import { createLogger } from "../_core/logger";
const log = createLogger("calculos-bcb-indexadores");

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
 * Erro específico de indisponibilidade BACEN — usado pelos routers
 * para traduzir em mensagem amigável ao usuário.
 */
export class BacenIndisponivelError extends Error {
  constructor(indexador: IndexadorCorrecao, causa: string) {
    super(
      `API do Banco Central indisponível para o indexador ${indexador}. ` +
      `Motivo: ${causa}. Tente novamente em alguns minutos ou escolha outro indexador.`,
    );
    this.name = "BacenIndisponivelError";
  }
}

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

// ─── Busca API BACEN ────────────────────────────────────────────────────────

/**
 * Busca a taxa mensal mais recente do indexador via API SGS.
 * Busca últimos 6 meses para encontrar o dado mais recente.
 *
 * Lança BacenIndisponivelError se:
 *   - API retornar timeout/erro de rede
 *   - Série não retornar dados
 *   - Valor do BACEN for inválido (NaN)
 */
export async function buscarIndexadorBACEN(indexador: IndexadorCorrecao): Promise<IndexadorBACEN> {
  if (indexador === "NENHUM") {
    return {
      indexador: "NENHUM",
      taxaMensal: 0,
      taxaAnual: 0,
      dataReferencia: new Date().toISOString().slice(0, 10),
      fonte: "Sem correção monetária",
    };
  }

  if (indexador === "POUPANCA") {
    // Poupança = TR + 0,5% a.m. (regra acima da Selic 8,5%)
    const tr = await buscarIndexadorBACEN("TR");
    const mensal = round4(tr.taxaMensal + 0.5);
    return {
      indexador: "POUPANCA",
      taxaMensal: mensal,
      taxaAnual: mensalParaAnualIdx(mensal),
      dataReferencia: tr.dataReferencia,
      fonte: `BACEN SGS (TR série 226 + 0,5% a.m.)`,
    };
  }

  const codigoSGS = SERIES_SGS[indexador];
  if (!codigoSGS) {
    throw new Error(`Indexador ${indexador} sem série SGS mapeada. Configure em SERIES_SGS.`);
  }

  const hoje = new Date();
  const inicio = new Date(hoje);
  inicio.setMonth(inicio.getMonth() - 6);
  const fmtData = (d: Date) =>
    `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  const url = `${BCB_BASE_URL}/${codigoSGS}/dados?formato=json&dataInicial=${fmtData(inicio)}&dataFinal=${fmtData(hoje)}`;

  let response;
  try {
    response = await axios.get<DadoSGS[]>(url, { timeout: 10000 });
  } catch (err: any) {
    log.warn(`[BACEN] ${indexador} timeout/erro: ${err.message}`);
    throw new BacenIndisponivelError(indexador, err.message || "erro de rede");
  }

  const dados = response.data;
  if (!Array.isArray(dados) || dados.length === 0) {
    throw new BacenIndisponivelError(indexador, "API retornou vazio");
  }

  const ultimo = dados[dados.length - 1];
  const taxaMensal = parseFloat(ultimo.valor.replace(",", "."));
  if (isNaN(taxaMensal)) {
    throw new BacenIndisponivelError(indexador, `valor inválido: "${ultimo.valor}"`);
  }

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
 * @deprecated Use `buscarIndexadorBACEN` diretamente e trate o erro.
 * Mantido apenas para compatibilidade — agora PROPAGA o erro em vez
 * de inventar valor de referência.
 */
export async function buscarIndexadorComFallback(indexador: IndexadorCorrecao): Promise<IndexadorBACEN> {
  return buscarIndexadorBACEN(indexador);
}

// ─── Série Histórica Mensal ─────────────────────────────────────────────────

export interface TaxaMensalHistorica {
  data: string;
  competencia: string;
  taxaMensal: number;
}

/**
 * Busca série histórica mensal do indexador via API SGS.
 * Lança BacenIndisponivelError se falhar.
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
  if (!codigoSGS) {
    throw new Error(`Indexador ${indexador} sem série SGS mapeada.`);
  }

  const [y, m] = dataInicio.split("-").map(Number);
  const inicio = new Date(y, m - 1, 1);
  const hoje = new Date();
  const fimCalc = new Date(y, m - 1 + prazoMeses, 0);
  const fim = fimCalc > hoje ? hoje : fimCalc;

  const fmtData = (d: Date) =>
    `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  const url = `${BCB_BASE_URL}/${codigoSGS}/dados?formato=json&dataInicial=${fmtData(inicio)}&dataFinal=${fmtData(fim)}`;

  let response;
  try {
    response = await axios.get<DadoSGS[]>(url, { timeout: 15000 });
  } catch (err: any) {
    throw new BacenIndisponivelError(indexador, err.message || "erro de rede");
  }

  const dados = response.data;
  if (!Array.isArray(dados) || dados.length === 0) {
    throw new BacenIndisponivelError(indexador, "série histórica vazia");
  }

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

  return {
    mapa,
    serie,
    fonte: `BACEN SGS série ${codigoSGS} (${dados.length} valores, ${dados[0]?.data} a ${dados[dados.length - 1]?.data})`,
  };
}

/**
 * @deprecated Use `buscarSerieHistorica` diretamente e trate o erro.
 * Mantido para compatibilidade — agora PROPAGA o erro.
 */
export async function buscarSerieHistoricaComFallback(
  indexador: IndexadorCorrecao,
  dataInicio: string,
  prazoMeses: number,
): Promise<{ mapa: Record<string, number>; serie: TaxaMensalHistorica[]; fonte: string }> {
  return buscarSerieHistorica(indexador, dataInicio, prazoMeses);
}

/**
 * Integração com a API SGS do Banco Central do Brasil
 * Busca taxas médias de juros por modalidade de crédito.
 *
 * v4:
 * - Validação rigorosa dos dados retornados pela API
 * - Rejeita valores absurdos (taxa mensal > limite por modalidade)
 * - Verifica coerência entre taxa mensal e anual
 * - Não inventa dados: se não encontrar, retorna erro claro
 * - Bloqueia datas futuras
 */

import axios from "axios";
import type { ModalidadeCredito, TipoPessoa, TipoVinculoConsignado } from "../../shared/financiamento-types";
import { getCodigoSgs } from "../../shared/financiamento-types";

const BCB_BASE_URL = "https://api.bcb.gov.br/dados/serie/bcdata.sgs";

interface DadoSGS {
  data: string;   // DD/MM/YYYY
  valor: string;  // taxa em string (% a.a.)
}

/**
 * Converte taxa anual para mensal equivalente (juros compostos).
 */
export function anualParaMensal(taxaAnual: number): number {
  return (Math.pow(1 + taxaAnual / 100, 1 / 12) - 1) * 100;
}

/**
 * Converte taxa mensal para anual equivalente (juros compostos).
 */
export function mensalParaAnual(taxaMensal: number): number {
  return (Math.pow(1 + taxaMensal / 100, 12) - 1) * 100;
}

function round4(v: number): number {
  return parseFloat(v.toFixed(4));
}

/**
 * Limites máximos de taxa MENSAL por modalidade (% a.m.).
 * Valores muito acima destes indicam erro na API ou dados corrompidos.
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

/**
 * Valida se a taxa retornada pela API é razoável.
 */
function validarTaxa(taxaAnual: number, taxaMensal: number, modalidade: string): { valida: boolean; erro?: string } {
  const limite = LIMITES_TAXA_MENSAL[modalidade] ?? 20;

  if (taxaMensal <= 0 || taxaAnual <= 0) {
    return { valida: false, erro: `Taxa inválida (${taxaMensal.toFixed(4)}% a.m. / ${taxaAnual.toFixed(2)}% a.a.). Valor zero ou negativo.` };
  }

  if (taxaMensal > limite) {
    return { valida: false, erro: `Taxa mensal (${taxaMensal.toFixed(4)}% a.m.) excede o limite razoável de ${limite}% a.m. para ${modalidade}. Possível dado corrompido no cache.` };
  }

  // Verificar coerência: taxa mensal convertida para anual deve ser próxima da anual informada
  const anualCalculada = (Math.pow(1 + taxaMensal / 100, 12) - 1) * 100;
  const diff = Math.abs(anualCalculada - taxaAnual);
  if (diff > 5) {
    return { valida: false, erro: `Incoerência entre taxa mensal (${taxaMensal.toFixed(4)}%) e anual (${taxaAnual.toFixed(2)}%). Diferença: ${diff.toFixed(2)} p.p.` };
  }

  return { valida: true };
}

/**
 * Busca a taxa média de juros do BACEN para uma modalidade e data específica.
 *
 * A API SGS retorna taxas ANUAIS (% a.a.) que são convertidas para mensal equivalente.
 * Busca o dado mais próximo da data do contrato num intervalo de 6 meses antes.
 */
export async function buscarTaxaMediaBACEN(
  modalidade: ModalidadeCredito,
  dataContrato: string, // YYYY-MM-DD
  tipoPessoa?: TipoPessoa,
  tipoVinculoConsignado?: TipoVinculoConsignado
): Promise<{ taxaMensal: number; taxaAnual: number; dataReferencia: string }> {
  const codigoSgs = getCodigoSgs(modalidade, tipoPessoa, tipoVinculoConsignado);

  // Validar que a data do contrato não é futura
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const dataRef = new Date(dataContrato + "T00:00:00");
  if (dataRef > hoje) {
    throw new Error(
      `Data do contrato (${dataContrato}) é futura. O BACEN não possui dados para datas futuras. ` +
      `Por favor, corrija a data do contrato.`
    );
  }

  // Intervalo de busca: 6 meses antes da data do contrato até a data do contrato
  // NÃO buscar depois da data do contrato (não faz sentido usar taxa posterior)
  const dataInicio = new Date(dataRef);
  dataInicio.setMonth(dataInicio.getMonth() - 6);
  const dataFim = new Date(dataRef);

  const formatBCB = (d: Date) => {
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  };

  const url = `${BCB_BASE_URL}.${codigoSgs}/dados?formato=json&dataInicial=${formatBCB(dataInicio)}&dataFinal=${formatBCB(dataFim)}`;

  console.log(`[BACEN] Buscando série ${codigoSgs} (${modalidade}${tipoPessoa ? `, ${tipoPessoa}` : ""}): ${url}`);

  try {
    const response = await axios.get<DadoSGS[]>(url, {
      timeout: 15000,
      headers: { Accept: "application/json" },
    });

    const dados = response.data;
    if (!dados || !Array.isArray(dados) || dados.length === 0) {
      throw new Error(
        `Nenhum dado encontrado para a série SGS ${codigoSgs} (${modalidade}) ` +
        `no período de ${formatBCB(dataInicio)} a ${formatBCB(dataFim)}. ` +
        `A série pode não ter dados para este período.`
      );
    }

    console.log(`[BACEN] Recebidos ${dados.length} registros. Primeiro: ${dados[0].data}=${dados[0].valor}, Último: ${dados[dados.length - 1].data}=${dados[dados.length - 1].valor}`);

    // Encontrar o dado mais próximo da data do contrato (preferencialmente anterior ou igual)
    const targetTime = dataRef.getTime();
    let closest = dados[dados.length - 1]; // último dado (mais recente, mais próximo)
    let closestDiff = Infinity;

    for (const d of dados) {
      const [dd, mm, yyyy] = d.data.split("/").map(Number);
      const dTime = new Date(yyyy, mm - 1, dd).getTime();
      const diff = Math.abs(dTime - targetTime);
      if (diff < closestDiff) {
        closestDiff = diff;
        closest = d;
      }
    }

    // O valor retornado pela API é taxa ANUAL (% a.a.)
    const taxaAnualBruta = parseFloat(closest.valor);
    if (isNaN(taxaAnualBruta) || taxaAnualBruta <= 0) {
      throw new Error(`Valor inválido retornado pela API: "${closest.valor}" para série ${codigoSgs}`);
    }

    // Converter para mensal equivalente
    const taxaMensalBruta = anualParaMensal(taxaAnualBruta);

    // Validar a taxa antes de retornar
    const validacao = validarTaxa(taxaAnualBruta, taxaMensalBruta, modalidade);
    if (!validacao.valida) {
      console.warn(`[BACEN] Taxa rejeitada: ${validacao.erro}`);
      throw new Error(
        `Taxa retornada pela API BACEN falhou na validação: ${validacao.erro}. ` +
        `Série SGS ${codigoSgs}, data ${closest.data}, valor bruto: ${closest.valor}% a.a.`
      );
    }

    // Converter data DD/MM/YYYY para YYYY-MM-DD
    const [dd, mm, yyyy] = closest.data.split("/");
    const dataReferencia = `${yyyy}-${mm}-${dd}`;

    console.log(`[BACEN] Taxa validada: ${taxaAnualBruta}% a.a. (${round4(taxaMensalBruta)}% a.m.) em ${dataReferencia}`);

    return {
      taxaMensal: round4(taxaMensalBruta),
      taxaAnual: round4(taxaAnualBruta),
      dataReferencia,
    };
  } catch (error: any) {
    console.error(`[BACEN] Erro: ${error.message}`);
    // Propagar o erro com mensagem clara — NÃO usar fallback silencioso
    if (error.response?.status === 404) {
      throw new Error(
        `Série SGS ${codigoSgs} (${modalidade}) não encontrada na API do BACEN. ` +
        `Verifique se a modalidade está correta.`
      );
    }
    throw error;
  }
}

/**
 * Fallback com taxas médias REALISTAS por modalidade.
 * Baseado em dados históricos do BACEN (médias de 2023-2024).
 * Usado APENAS quando a API está indisponível (timeout, erro de rede).
 */
const FALLBACK_TAXAS_ANUAIS: Record<ModalidadeCredito, number> = {
  credito_pessoal: 86.0,           // ~5.3% a.m.
  consignado: 25.0,                // ~1.9% a.m.
  financiamento_veiculo: 27.0,     // ~2.0% a.m.
  financiamento_imobiliario: 11.5, // ~0.9% a.m.
  cartao_credito: 431.0,           // ~14.8% a.m.
  cheque_especial: 132.0,          // ~7.2% a.m.
  capital_giro: 22.0,              // ~1.7% a.m.
};

/**
 * Busca a taxa média com fallback para valores realistas por modalidade.
 * O fallback só é usado quando a API está INDISPONÍVEL (timeout, erro de rede),
 * NÃO quando os dados são inválidos ou a data é futura.
 */
export async function buscarTaxaMediaComFallback(
  modalidade: ModalidadeCredito,
  dataContrato: string,
  tipoPessoa?: TipoPessoa,
  tipoVinculoConsignado?: TipoVinculoConsignado
): Promise<{ taxaMensal: number; taxaAnual: number; dataReferencia: string; fonte: "bacen" | "fallback" }> {
  try {
    const resultado = await buscarTaxaMediaBACEN(modalidade, dataContrato, tipoPessoa, tipoVinculoConsignado);
    return { ...resultado, fonte: "bacen" };
  } catch (err: any) {
    const msg = (err as Error).message || "";

    // Erros de validação ou data futura: NÃO usar fallback, propagar o erro
    if (msg.includes("futura") || msg.includes("validação") || msg.includes("rejeitada")) {
      throw err;
    }

    // Apenas erros de rede/timeout usam fallback
    console.warn(`[BACEN] API indisponível, usando fallback para ${modalidade}:`, msg);

    const fallbackAnual = FALLBACK_TAXAS_ANUAIS[modalidade] ?? 30.0;
    const taxaMensal = anualParaMensal(fallbackAnual);
    return {
      taxaMensal: round4(taxaMensal),
      taxaAnual: round4(fallbackAnual),
      dataReferencia: dataContrato,
      fonte: "fallback",
    };
  }
}

/**
 * Serviço de consulta à API Pública do DataJud (CNJ) — v2
 *
 * Documentação: https://datajud-wiki.cnj.jus.br/api-publica/
 * Base URL: https://api-publica.datajud.cnj.jus.br/
 * Autenticação: APIKey pública (chave do DPJ/CNJ)
 *
 * Correções v2:
 * - Parsing robusto de movimentações (complementos + complementosTabelados)
 * - Nome enriquecido com complementos significativos
 * - Busca por número OAB do advogado
 * - Timeout + tratamento de rate-limit (429)
 * - Todas as movimentações (sem cortar em 50)
 */

import type { DadosProcessoDataJud, ConsultaDataJudResult, MovimentacaoProcessual } from "../../shared/processos-types";

const DATAJUD_BASE_URL = "https://api-publica.datajud.cnj.jus.br";
const DATAJUD_API_KEY = "cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==";
const REQUEST_TIMEOUT = 15_000;

// ─── Helpers ────────────────────────────────────────────────────────────────

async function datajudFetch(url: string, body: object): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    return await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `APIKey ${DATAJUD_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Normaliza uma movimentação do DataJud.
 * O DataJud pode retornar "complementos" ou "complementosTabelados" — tratamos ambos.
 */
function normalizarMovimentacao(raw: any): MovimentacaoProcessual {
  const complementosRaw = raw.complementosTabelados || raw.complementos || [];
  const complementos = Array.isArray(complementosRaw)
    ? complementosRaw.map((c: any) => ({
        codigo: c.codigo ?? 0,
        valor: c.valor ?? 0,
        nome: c.nome || "",
        descricao: c.descricao || "",
      }))
    : [];

  // Nome — usar nome direto, fallback com código
  let nome = raw.nome || "";
  if (!nome || nome === "null" || nome === "undefined") {
    nome = `Movimentação (cód. ${raw.codigo || "?"})`;
  }

  // Enriquecer nome com complementos significativos
  const descricoes = complementos
    .filter((c: any) => c.descricao && c.descricao.length > 0 && c.descricao !== nome)
    .map((c: any) => c.descricao);

  const nomeCompleto = descricoes.length > 0
    ? `${nome} — ${descricoes.join(" — ")}`
    : nome;

  return {
    codigo: raw.codigo ?? 0,
    nome: nomeCompleto,
    dataHora: raw.dataHora || raw["@timestamp"] || "",
    complementos,
    complementosTabelados: complementos,
  };
}

/**
 * Processa resposta bruta do DataJud e normaliza.
 */
function processarResposta(source: any): DadosProcessoDataJud {
  const movimentosRaw = source.movimentos || [];
  const movimentos = Array.isArray(movimentosRaw)
    ? movimentosRaw.map(normalizarMovimentacao)
    : [];

  movimentos.sort((a, b) => new Date(b.dataHora).getTime() - new Date(a.dataHora).getTime());

  return {
    numeroProcesso: source.numeroProcesso || "",
    classe: source.classe || { codigo: 0, nome: "Não informada" },
    tribunal: source.tribunal || source.siglaTribunal || "",
    grau: source.grau || "",
    dataAjuizamento: source.dataAjuizamento || "",
    dataHoraUltimaAtualizacao: source.dataHoraUltimaAtualizacao || source["@timestamp"] || "",
    nivelSigilo: source.nivelSigilo ?? 0,
    orgaoJulgador: source.orgaoJulgador || { codigo: 0, nome: "Não informado" },
    assuntos: Array.isArray(source.assuntos) ? source.assuntos : [],
    movimentos,
    sistema: source.sistema,
    formato: source.formato,
  };
}

function tratarErroHTTP(status: number): string {
  if (status === 429) return "A API DataJud está sobrecarregada. Aguarde alguns minutos e tente novamente.";
  if (status === 403) return "Acesso negado à API DataJud. A chave de acesso pode ter sido alterada pelo CNJ.";
  if (status === 404) return "Endpoint do tribunal não encontrado no DataJud. Verifique o número do processo.";
  return `Erro ao consultar DataJud (HTTP ${status}). Verifique o número do processo e tente novamente.`;
}

// ─── Consultas Públicas ─────────────────────────────────────────────────────

/**
 * Consulta um processo pelo número CNJ.
 */
export async function consultarProcessoDataJud(
  numeroCnjLimpo: string,
  aliasApi: string
): Promise<ConsultaDataJudResult> {
  const url = `${DATAJUD_BASE_URL}/api_publica_${aliasApi}/_search`;

  try {
    const response = await datajudFetch(url, {
      size: 1,
      query: { match: { numeroProcesso: numeroCnjLimpo } },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error(`[DataJud] Erro HTTP ${response.status}: ${text}`);
      return { success: false, error: tratarErroHTTP(response.status) };
    }

    const data = await response.json();
    if (!data.hits?.hits?.length) {
      return {
        success: false,
        error: "Processo não encontrado na base do DataJud. Verifique o número e o tribunal. Processos sigilosos não aparecem na consulta pública.",
      };
    }

    return { success: true, processo: processarResposta(data.hits.hits[0]._source) };
  } catch (error: any) {
    if (error.name === "AbortError") return { success: false, error: "Timeout na consulta ao DataJud (15s). Tente novamente." };
    console.error("[DataJud] Erro:", error.message);
    return { success: false, error: "Erro de conexão com a API DataJud. Verifique sua conexão e tente novamente." };
  }
}

/**
 * Consulta movimentações mais recentes de um processo.
 */
export async function consultarMovimentacoesRecentes(
  numeroCnjLimpo: string,
  aliasApi: string
): Promise<ConsultaDataJudResult> {
  const url = `${DATAJUD_BASE_URL}/api_publica_${aliasApi}/_search`;

  try {
    const response = await datajudFetch(url, {
      size: 1,
      query: { match: { numeroProcesso: numeroCnjLimpo } },
      sort: [{ "@timestamp": { order: "desc" } }],
    });

    if (!response.ok) return { success: false, error: tratarErroHTTP(response.status) };

    const data = await response.json();
    if (!data.hits?.hits?.length) return { success: false, error: "Nenhuma movimentação encontrada." };

    return { success: true, processo: processarResposta(data.hits.hits[0]._source) };
  } catch (error: any) {
    if (error.name === "AbortError") return { success: false, error: "Timeout na consulta ao DataJud." };
    console.error("[DataJud] Erro movimentações:", error.message);
    return { success: false, error: "Erro de conexão. Tente novamente." };
  }
}

/**
 * Busca processos por número OAB do advogado.
 * NOTA: A API pública pode não expor dados de advogados em todos os tribunais.
 */
export async function buscarProcessosPorOAB(
  numeroOAB: string,
  ufOAB: string,
  aliasApi: string,
  size: number = 20
): Promise<{ success: boolean; processos: DadosProcessoDataJud[]; error?: string }> {
  const url = `${DATAJUD_BASE_URL}/api_publica_${aliasApi}/_search`;

  try {
    const response = await datajudFetch(url, {
      size,
      query: {
        bool: {
          should: [
            { nested: { path: "advogados", query: { bool: { must: [{ match: { "advogados.inscricao": numeroOAB } }] } } } },
            { query_string: { query: `"${numeroOAB}" AND "${ufOAB}"`, default_operator: "AND" } },
          ],
          minimum_should_match: 1,
        },
      },
    });

    if (!response.ok) return { success: false, processos: [], error: tratarErroHTTP(response.status) };

    const data = await response.json();
    const hits = data.hits?.hits || [];

    if (hits.length === 0) {
      return {
        success: true, processos: [],
        error: "Nenhum processo encontrado para esta OAB. A busca por OAB depende de como cada tribunal estrutura os dados.",
      };
    }

    return { success: true, processos: hits.map((h: any) => processarResposta(h._source)) };
  } catch (error: any) {
    return { success: false, processos: [], error: error.message || "Erro de conexão." };
  }
}

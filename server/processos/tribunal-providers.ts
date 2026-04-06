/**
 * Mapeamento de Tribunais × Fontes de Dados
 *
 * Define para cada tribunal:
 * - Qual fonte usar (DataJud, PJe Consulta Pública, E-SAJ, Eproc)
 * - Qualidade/frescor esperado dos dados
 * - URLs de consulta pública (quando existem)
 *
 * LEGENDA DE FONTES:
 * - DATAJUD: API Pública do CNJ. Cobre todos os tribunais.
 *   Atraso típico: 1-7 dias (depende do tribunal enviar os dados ao CNJ).
 *
 * - PJE_CONSULTA_PUBLICA: Todos os TRTs e vários TJs/TRFs expõem
 *   `pje.trtXX.jus.br/consultaprocessual/` com dados em tempo real.
 *   Porém é HTML (não API REST) — scraping frágil. Marcamos como
 *   "tempo real disponível" para o usuário saber.
 *
 * - ESAJ: TJSP, TJCE, TJAL, TJBA etc. Consulta pública existia sem login,
 *   mas agora exige autenticação 2FA. Inviável sem credenciais do usuário.
 *
 * - EPROC: TRF4, TRF2, e TJSP (migrando). Consulta pública aberta para
 *   decisões mas não para scraping automatizado em larga escala.
 */

// ─── Tipos ──────────────────────────────────────────────────────────────────

export type FonteDados = "DATAJUD" | "PJE_CONSULTA_PUBLICA" | "ESAJ" | "EPROC";

export type NivelFrescor =
  | "TEMPO_REAL"      // Dados lidos direto do sistema do tribunal
  | "QUASE_REAL"      // DataJud com atraso < 24h (tribunais que sincronizam rápido)
  | "ATRASO_MODERADO" // DataJud com atraso 1-3 dias
  | "ATRASO_LONGO";   // DataJud com atraso 3-7+ dias

export interface TribunalProvider {
  /** Alias DataJud (ex: "tjsp", "trt2") */
  alias: string;
  /** Nome completo do tribunal */
  nome: string;
  /** Sigla (ex: "TJSP", "TRT2") */
  sigla: string;
  /** Justiça: Estadual, Federal, Trabalho, Eleitoral, Militar, Superior */
  justica: string;
  /** Fonte primária dos dados */
  fontePrimaria: FonteDados;
  /** URL da consulta pública do tribunal (se existir) */
  consultaPublicaUrl: string | null;
  /** Se o tribunal tem consulta pública em tempo real acessível */
  temTempoReal: boolean;
  /** Nível de frescor estimado dos dados via DataJud */
  frescorDatajud: NivelFrescor;
  /** Descrição legível do nível de atualização */
  descricaoFrescor: string;
}

// ─── Mapeamento ─────────────────────────────────────────────────────────────

/**
 * Todos os 24 TRTs têm consulta pública PJe com dados em tempo real.
 * URLs: pje.trtXX.jus.br/consultaprocessual/
 */
function trt(num: number): TribunalProvider {
  const nn = String(num).padStart(2, "0");
  return {
    alias: `trt${num}`,
    nome: `Tribunal Regional do Trabalho da ${num}ª Região`,
    sigla: `TRT${num}`,
    justica: "Trabalho",
    fontePrimaria: "DATAJUD", // usamos DataJud como primário (API estável)
    consultaPublicaUrl: `https://pje.trt${num}.jus.br/consultaprocessual/`,
    temTempoReal: true, // TRTs sempre têm consulta pública PJe
    frescorDatajud: "QUASE_REAL", // JT sincroniza rápido com DataJud
    descricaoFrescor: "Justiça do Trabalho — atualização rápida via DataJud. Consulta pública PJe disponível em tempo real.",
  };
}

/** Tribunais de Justiça Estaduais */
const TJS_ESAJ = ["tjsp", "tjce", "tjal", "tjba", "tjms", "tjsc", "tjam", "tjac", "tjto"];
const TJS_PJE = ["tjmg", "tjdft", "tjpe", "tjpa", "tjpi", "tjma", "tjpb", "tjrn", "tjse", "tjap", "tjrr", "tjro", "tjes", "tjgo", "tjmt", "tjpr", "tjrj", "tjrs"];

function tjEstadual(alias: string, sigla: string, nome: string, sistema: "ESAJ" | "PJE"): TribunalProvider {
  const temPjePublico = sistema === "PJE";
  return {
    alias,
    nome,
    sigla: sigla.toUpperCase(),
    justica: "Estadual",
    fontePrimaria: "DATAJUD",
    consultaPublicaUrl: temPjePublico
      ? `https://pje-consulta-publica.${alias}.jus.br/`
      : `https://esaj.${alias}.jus.br/cpopg/open.do`,
    temTempoReal: false, // E-SAJ exige login; PJe consulta pública é HTML
    frescorDatajud: "ATRASO_MODERADO",
    descricaoFrescor: `Justiça Estadual (${sistema}) — dados via DataJud com atraso típico de 1-3 dias.`,
  };
}

/**
 * Mapeamento completo: alias DataJud → metadados do tribunal.
 * Usado para determinar fonte, frescor e badges no frontend.
 */
export const TRIBUNAL_PROVIDERS: Record<string, TribunalProvider> = {
  // ── Justiça do Trabalho (24 TRTs) — todos com PJe consulta pública ──
  ...Object.fromEntries(Array.from({ length: 24 }, (_, i) => {
    const t = trt(i + 1);
    return [t.alias, t];
  })),

  // ── Tribunais Superiores ──
  stf: { alias: "stf", nome: "Supremo Tribunal Federal", sigla: "STF", justica: "Superior", fontePrimaria: "DATAJUD", consultaPublicaUrl: "https://portal.stf.jus.br/processos/", temTempoReal: false, frescorDatajud: "QUASE_REAL", descricaoFrescor: "STF — dados rápidos via DataJud." },
  stj: { alias: "stj", nome: "Superior Tribunal de Justiça", sigla: "STJ", justica: "Superior", fontePrimaria: "DATAJUD", consultaPublicaUrl: "https://processo.stj.jus.br/processo/pesquisa/", temTempoReal: false, frescorDatajud: "QUASE_REAL", descricaoFrescor: "STJ — dados rápidos via DataJud." },
  tst: { alias: "tst", nome: "Tribunal Superior do Trabalho", sigla: "TST", justica: "Superior", fontePrimaria: "DATAJUD", consultaPublicaUrl: "https://pje.tst.jus.br/consultaprocessual/", temTempoReal: true, frescorDatajud: "QUASE_REAL", descricaoFrescor: "TST — PJe consulta pública disponível." },

  // ── Justiça Federal (TRFs) ──
  trf1: { alias: "trf1", nome: "TRF da 1ª Região", sigla: "TRF1", justica: "Federal", fontePrimaria: "DATAJUD", consultaPublicaUrl: "https://pje1g.trf1.jus.br/consultapublica/", temTempoReal: false, frescorDatajud: "ATRASO_MODERADO", descricaoFrescor: "TRF1 — PJe, atraso moderado no DataJud." },
  trf2: { alias: "trf2", nome: "TRF da 2ª Região", sigla: "TRF2", justica: "Federal", fontePrimaria: "DATAJUD", consultaPublicaUrl: "https://eproc.trf2.jus.br/eproc/externo_controlador.php?acao=processo_consulta_publica", temTempoReal: false, frescorDatajud: "ATRASO_MODERADO", descricaoFrescor: "TRF2 — Eproc, atraso moderado no DataJud." },
  trf3: { alias: "trf3", nome: "TRF da 3ª Região", sigla: "TRF3", justica: "Federal", fontePrimaria: "DATAJUD", consultaPublicaUrl: "https://pje1g.trf3.jus.br/pje/ConsultaPublica/listView.seam", temTempoReal: false, frescorDatajud: "ATRASO_MODERADO", descricaoFrescor: "TRF3 — PJe, atraso moderado no DataJud." },
  trf4: { alias: "trf4", nome: "TRF da 4ª Região", sigla: "TRF4", justica: "Federal", fontePrimaria: "DATAJUD", consultaPublicaUrl: "https://www.trf4.jus.br/eproc", temTempoReal: false, frescorDatajud: "QUASE_REAL", descricaoFrescor: "TRF4 — Eproc com consulta pública, DataJud rápido." },
  trf5: { alias: "trf5", nome: "TRF da 5ª Região", sigla: "TRF5", justica: "Federal", fontePrimaria: "DATAJUD", consultaPublicaUrl: "https://pje.trf5.jus.br/pje/ConsultaPublica/listView.seam", temTempoReal: false, frescorDatajud: "ATRASO_MODERADO", descricaoFrescor: "TRF5 — PJe, atraso moderado no DataJud." },
  trf6: { alias: "trf6", nome: "TRF da 6ª Região", sigla: "TRF6", justica: "Federal", fontePrimaria: "DATAJUD", consultaPublicaUrl: "https://pje2g.trf6.jus.br/consultapublica/", temTempoReal: false, frescorDatajud: "ATRASO_MODERADO", descricaoFrescor: "TRF6 — PJe, atraso moderado no DataJud." },

  // ── Justiça Estadual (TJs) ──
  tjsp: tjEstadual("tjsp", "TJSP", "Tribunal de Justiça de São Paulo", "ESAJ"),
  tjrj: tjEstadual("tjrj", "TJRJ", "Tribunal de Justiça do Rio de Janeiro", "PJE"),
  tjmg: tjEstadual("tjmg", "TJMG", "Tribunal de Justiça de Minas Gerais", "PJE"),
  tjrs: tjEstadual("tjrs", "TJRS", "Tribunal de Justiça do Rio Grande do Sul", "PJE"),
  tjpr: tjEstadual("tjpr", "TJPR", "Tribunal de Justiça do Paraná", "PJE"),
  tjsc: tjEstadual("tjsc", "TJSC", "Tribunal de Justiça de Santa Catarina", "ESAJ"),
  tjba: tjEstadual("tjba", "TJBA", "Tribunal de Justiça da Bahia", "ESAJ"),
  tjpe: tjEstadual("tjpe", "TJPE", "Tribunal de Justiça de Pernambuco", "PJE"),
  tjce: tjEstadual("tjce", "TJCE", "Tribunal de Justiça do Ceará", "ESAJ"),
  tjgo: tjEstadual("tjgo", "TJGO", "Tribunal de Justiça de Goiás", "PJE"),
  tjdft: tjEstadual("tjdft", "TJDFT", "TJ do Distrito Federal e Territórios", "PJE"),
  tjes: tjEstadual("tjes", "TJES", "Tribunal de Justiça do Espírito Santo", "PJE"),
  tjpa: tjEstadual("tjpa", "TJPA", "Tribunal de Justiça do Pará", "PJE"),
  tjma: tjEstadual("tjma", "TJMA", "Tribunal de Justiça do Maranhão", "PJE"),
  tjam: tjEstadual("tjam", "TJAM", "Tribunal de Justiça do Amazonas", "ESAJ"),
  tjmt: tjEstadual("tjmt", "TJMT", "Tribunal de Justiça de Mato Grosso", "PJE"),
  tjms: tjEstadual("tjms", "TJMS", "Tribunal de Justiça de Mato Grosso do Sul", "ESAJ"),
  tjpb: tjEstadual("tjpb", "TJPB", "Tribunal de Justiça da Paraíba", "PJE"),
  tjrn: tjEstadual("tjrn", "TJRN", "Tribunal de Justiça do Rio Grande do Norte", "PJE"),
  tjal: tjEstadual("tjal", "TJAL", "Tribunal de Justiça de Alagoas", "ESAJ"),
  tjse: tjEstadual("tjse", "TJSE", "Tribunal de Justiça de Sergipe", "PJE"),
  tjpi: tjEstadual("tjpi", "TJPI", "Tribunal de Justiça do Piauí", "PJE"),
  tjro: tjEstadual("tjro", "TJRO", "Tribunal de Justiça de Rondônia", "PJE"),
  tjac: tjEstadual("tjac", "TJAC", "Tribunal de Justiça do Acre", "ESAJ"),
  tjap: tjEstadual("tjap", "TJAP", "Tribunal de Justiça do Amapá", "PJE"),
  tjrr: tjEstadual("tjrr", "TJRR", "Tribunal de Justiça de Roraima", "PJE"),
  tjto: tjEstadual("tjto", "TJTO", "Tribunal de Justiça do Tocantins", "ESAJ"),
};

// ─── Funções de consulta ────────────────────────────────────────────────────

/**
 * Retorna metadados do tribunal a partir do alias DataJud.
 * Se não encontrado, retorna provider genérico com DataJud.
 */
export function getProviderByAlias(alias: string): TribunalProvider {
  return TRIBUNAL_PROVIDERS[alias] || {
    alias,
    nome: `Tribunal ${alias.toUpperCase()}`,
    sigla: alias.toUpperCase(),
    justica: "Desconhecido",
    fontePrimaria: "DATAJUD" as FonteDados,
    consultaPublicaUrl: null,
    temTempoReal: false,
    frescorDatajud: "ATRASO_MODERADO" as NivelFrescor,
    descricaoFrescor: "Dados via DataJud — atraso estimado de 1-3 dias.",
  };
}

/**
 * Analisa o frescor real dos dados com base na data da última movimentação
 * e na data da última atualização no DataJud.
 *
 * Retorna o nível de frescor REAL (não o estimado) comparando datas.
 */
export function analisarFrescorReal(
  ultimaMovimentacaoData: string | null,
  dataHoraUltimaAtualizacaoDatajud: string | null,
  aliasApi: string
): {
  nivel: NivelFrescor;
  label: string;
  cor: "emerald" | "blue" | "amber" | "red";
  descricao: string;
  horasAtraso: number | null;
} {
  const provider = getProviderByAlias(aliasApi);

  // Se não temos data da última movimentação, usar estimativa do provider
  if (!ultimaMovimentacaoData) {
    return fromNivel(provider.frescorDatajud, null, provider);
  }

  const agora = Date.now();
  const dataMov = new Date(ultimaMovimentacaoData).getTime();
  const diffHoras = Math.max(0, (agora - dataMov) / (1000 * 60 * 60));

  // Se a última movimentação foi há menos de 6h, considerar quase tempo real
  if (diffHoras < 6) {
    return {
      nivel: "QUASE_REAL",
      label: "Atualizado",
      cor: "emerald",
      descricao: `Última movimentação há ${Math.floor(diffHoras)}h. ${provider.temTempoReal ? "Consulta pública em tempo real disponível no tribunal." : ""}`,
      horasAtraso: Math.round(diffHoras),
    };
  }

  // Se a última movimentação foi há menos de 24h
  if (diffHoras < 24) {
    return {
      nivel: "QUASE_REAL",
      label: "Quase real",
      cor: "blue",
      descricao: `Última movimentação há ${Math.floor(diffHoras)}h.`,
      horasAtraso: Math.round(diffHoras),
    };
  }

  // 1-3 dias
  if (diffHoras < 72) {
    return {
      nivel: "ATRASO_MODERADO",
      label: `${Math.floor(diffHoras / 24)}d atrás`,
      cor: "amber",
      descricao: `Última movimentação há ${Math.floor(diffHoras / 24)} dia(s). DataJud pode ter atraso na sincronização.`,
      horasAtraso: Math.round(diffHoras),
    };
  }

  // 3+ dias
  return {
    nivel: "ATRASO_LONGO",
    label: `${Math.floor(diffHoras / 24)}d atrás`,
    cor: "red",
    descricao: `Última movimentação há ${Math.floor(diffHoras / 24)} dias. Dados podem estar desatualizados.${provider.consultaPublicaUrl ? " Verifique diretamente no tribunal." : ""}`,
    horasAtraso: Math.round(diffHoras),
  };
}

function fromNivel(nivel: NivelFrescor, horas: number | null, provider: TribunalProvider) {
  const map: Record<NivelFrescor, { label: string; cor: "emerald" | "blue" | "amber" | "red" }> = {
    TEMPO_REAL: { label: "Tempo real", cor: "emerald" },
    QUASE_REAL: { label: "Rápido", cor: "blue" },
    ATRASO_MODERADO: { label: "1-3 dias", cor: "amber" },
    ATRASO_LONGO: { label: "3-7+ dias", cor: "red" },
  };
  const info = map[nivel];
  return {
    nivel,
    label: info.label,
    cor: info.cor,
    descricao: provider.descricaoFrescor,
    horasAtraso: horas,
  };
}

/**
 * Retorna informações de fonte/frescor para exibição no frontend.
 * Usado pelo router ao retornar dados de processos.
 */
export function getFonteInfo(aliasApi: string, ultimaMovData: string | null, ultimaAtualizacao: string | null) {
  const provider = getProviderByAlias(aliasApi);
  const frescor = analisarFrescorReal(ultimaMovData, ultimaAtualizacao, aliasApi);

  return {
    fonte: provider.fontePrimaria,
    tribunal: provider.sigla,
    nomeCompleto: provider.nome,
    justica: provider.justica,
    temTempoReal: provider.temTempoReal,
    consultaPublicaUrl: provider.consultaPublicaUrl,
    frescor,
  };
}

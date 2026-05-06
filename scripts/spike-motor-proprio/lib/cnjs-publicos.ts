/**
 * CNJs de teste para os PoCs.
 *
 * São processos públicos (sem segredo de justiça) usados para validar
 * scrapers contra dados reais. Atualizar periodicamente — processos
 * arquivam, mudam de instância, etc.
 *
 * IMPORTANTE: respeitar termos de uso dos tribunais. Spike usa volume
 * baixo (3-5 consultas por tribunal × poucas vezes ao dia durante
 * validação). Em produção haverá rate limit e cache local.
 *
 * Sobreposição via env var:
 *   `SPIKE_CNJS_TRT2=cnj1,cnj2,cnj3 pnpm tsx scripts/.../poc-1-pje-scraper`
 * substitui a lista deste arquivo. Útil pra testar com processos
 * específicos sem mexer no código.
 */

export interface CnjTeste {
  cnj: string;
  /** Descrição livre do que esperamos encontrar (validação manual) */
  descricao: string;
  /** Se conhecemos pode estar arquivado / inativo (afeta validação de movimentações) */
  ativo?: boolean;
}

/**
 * Lê CNJs de uma env var no formato `cnj1,cnj2,cnj3` ou retorna fallback.
 */
function lerCnjsEnv(envName: string, fallback: CnjTeste[]): CnjTeste[] {
  const raw = process.env[envName];
  if (!raw) return fallback;

  return raw
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .map((cnj) => ({
      cnj,
      descricao: `CNJ via ${envName}`,
    }));
}

/**
 * TRT2 — Tribunal Regional do Trabalho da 2ª Região (São Paulo).
 *
 * O segmento J=5 indica Justiça do Trabalho; TR=02 indica TRT2.
 * Padrão CNJ: NNNNNNN-DD.AAAA.5.02.OOOO
 *
 * Os CNJs abaixo são templates — substitua por processos reais antes
 * de rodar o PoC, OU passe via env var SPIKE_CNJS_TRT2.
 *
 * Sugestões de fonte para CNJs públicos:
 *   - https://pje.trt2.jus.br/consultaprocessual/ (consulta livre)
 *   - Decisões públicas do TST citam CNJs do TRT2
 *   - DJEN do CNJ — capa de processos públicos
 */
const TRT2_FALLBACK: CnjTeste[] = [
  // PLACEHOLDER — substituir por CNJs reais antes de rodar
  // Exemplo de formato esperado:
  // { cnj: "1000123-45.2024.5.02.0001", descricao: "Reclamação trabalhista 1ª Vara SP" },
];

const TRT15_FALLBACK: CnjTeste[] = [];
const TJDFT_FALLBACK: CnjTeste[] = [];
const TJMG_FALLBACK: CnjTeste[] = [];
const TRF1_FALLBACK: CnjTeste[] = [];

export const CNJS_PUBLICOS = {
  get trt2() {
    return lerCnjsEnv("SPIKE_CNJS_TRT2", TRT2_FALLBACK);
  },
  get trt15() {
    return lerCnjsEnv("SPIKE_CNJS_TRT15", TRT15_FALLBACK);
  },
  get tjdft() {
    return lerCnjsEnv("SPIKE_CNJS_TJDFT", TJDFT_FALLBACK);
  },
  get tjmg() {
    return lerCnjsEnv("SPIKE_CNJS_TJMG", TJMG_FALLBACK);
  },
  get trf1() {
    return lerCnjsEnv("SPIKE_CNJS_TRF1", TRF1_FALLBACK);
  },
};

/**
 * Retorna CNJs do tribunal sem precisar saber a key estaticamente.
 * Útil pro orquestrador iterar sobre todos os tribunais cadastrados.
 */
export function cnjsDoTribunal(tribunal: keyof typeof CNJS_PUBLICOS): CnjTeste[] {
  return CNJS_PUBLICOS[tribunal];
}

export const TRIBUNAIS_DO_POC_1: Array<keyof typeof CNJS_PUBLICOS> = [
  "trt2",
  "trt15",
  "tjdft",
  "tjmg",
  "trf1",
];

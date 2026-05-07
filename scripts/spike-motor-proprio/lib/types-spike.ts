/**
 * Tipos comuns dos PoCs.
 *
 * Quando o Spike validar e virar produção, estes tipos serão
 * promovidos para `shared/processo-types.ts` e usados pelos
 * adapters reais. Por ora ficam isolados para não acoplar com o
 * código de produção antes da hora.
 */

/**
 * Capa do processo — dados estáticos (não mudam ao longo da vida útil).
 *
 * Mapeamento aproximado dos campos do `JuditLawsuit` (em judit-client.ts)
 * para que a migração futura seja trivial. Mas omitimos campos de
 * data lake que não fazem sentido em consulta direta a tribunal.
 */
export interface ProcessoCapa {
  /** Número do processo no formato CNJ */
  cnj: string;
  /** Classe processual (ex: "Reclamação Trabalhista") */
  classe: string | null;
  /** Assuntos / matérias (ex: ["Horas Extras", "Adicional Noturno"]) */
  assuntos: string[];
  /** Órgão julgador / vara */
  orgaoJulgador: string | null;
  /** Juiz responsável (quando público) */
  juiz: string | null;
  /** Comarca / município de jurisdição */
  comarca: string | null;
  /** UF (sigla) */
  uf: string | null;
  /** Valor da causa em centavos (BRL) */
  valorCausaCentavos: number | null;
  /** Data de distribuição (ISO 8601) */
  dataDistribuicao: string | null;
  /** Status do processo (ex: "ativo", "arquivado") */
  status: string | null;
  /** Partes do processo */
  partes: ParteProcesso[];
  /** Indica se o processo está em segredo de justiça */
  segredoJustica: boolean;
}

export interface ParteProcesso {
  /** Nome completo da parte (sem mascaramento) */
  nome: string;
  /** Polo: ativa (autor), passiva (réu), terceiro */
  polo: "ativo" | "passivo" | "terceiro";
  /** Tipo: pessoa física, jurídica, etc */
  tipo: "fisica" | "juridica" | "desconhecido";
  /** Documento principal (CPF/CNPJ) — pode estar mascarado pelo tribunal */
  documento: string | null;
  /** Advogados representantes */
  advogados: AdvogadoProcesso[];
}

export interface AdvogadoProcesso {
  nome: string;
  /** OAB no formato "UF NUMERO" (ex: "SP 123456") */
  oab: string | null;
}

/**
 * Movimentação processual (= step na linguagem da Judit).
 *
 * Cada movimentação vira 1 `evento_processo` quando promovido pra produção.
 */
export interface MovimentacaoProcesso {
  /** Data/hora da movimentação no tribunal (ISO 8601) */
  data: string;
  /** Texto livre da movimentação */
  texto: string;
  /** Tipo categorizado, quando o tribunal expõe (ex: "JUNTADA", "DESPACHO") */
  tipo: string | null;
  /** Documento anexado (id ou nome), quando há */
  documento: string | null;
}

/**
 * Resultado completo de uma raspagem de 1 processo em 1 tribunal.
 *
 * Padrão consistente entre todos os adapters (TRT2, TJSP, etc) para que
 * o orquestrador trate todos uniformemente.
 */
export interface ResultadoScraper {
  /** OK = scraping bem-sucedido com dados úteis */
  ok: boolean;
  /** Identificador do tribunal alvo (ex: "trt2", "tjsp") */
  tribunal: string;
  /** CNJ consultado */
  cnj: string;
  /** Latência total em ms (do enter no site até o fim da extração) */
  latenciaMs: number;
  /** Capa extraída — null se a raspagem falhou */
  capa: ProcessoCapa | null;
  /** Movimentações em ordem cronológica decrescente (mais recente primeiro) */
  movimentacoes: MovimentacaoProcesso[];
  /** Categoria do erro quando ok=false */
  categoriaErro: CategoriaErro | null;
  /** Mensagem técnica (vai pro Sentry) */
  mensagemErro: string | null;
  /** Caminho do screenshot capturado em caso de erro (debug) */
  screenshotPath: string | null;
  /** Quando a raspagem terminou (ISO 8601) */
  finalizadoEm: string;
}

/**
 * Categorias de falha — usadas pra agregar métricas no relatório do Spike.
 *
 *  - `cnj_nao_encontrado`: tribunal respondeu, mas processo não existe ou está em outro tribunal
 *  - `captcha_bloqueio`: captcha apareceu e não foi resolvido
 *  - `timeout`: tribunal não respondeu dentro do limite
 *  - `parse_falhou`: HTML carregou mas seletores não bateram
 *  - `tribunal_indisponivel`: HTTP 5xx ou erro de rede
 *  - `outro`: qualquer outra coisa não classificada
 */
export type CategoriaErro =
  | "cnj_nao_encontrado"
  | "captcha_bloqueio"
  | "timeout"
  | "parse_falhou"
  | "tribunal_indisponivel"
  | "outro";

/**
 * Estatísticas agregadas do PoC para o relatório final.
 */
export interface EstatisticasPoc {
  tribunal: string;
  totalTentativas: number;
  totalSucessos: number;
  totalFalhas: number;
  taxaSucessoPct: number;
  latenciaMediaMs: number;
  latenciaP50Ms: number;
  latenciaP95Ms: number;
  errosPorCategoria: Record<CategoriaErro, number>;
}

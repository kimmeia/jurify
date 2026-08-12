/**
 * Avaliação de desempenho.
 *
 * Uma nota só ("Thiago: 2,6") não diz o que fazer. Cinco critérios dizem: a
 * mesma média sai de "chega atrasado mas entrega" e de "chega na hora e não
 * entrega", e as duas conversas são opostas. Por isso a nota geral não é
 * digitada — ela é a média do que foi avaliado, e some se nada foi.
 *
 * O CICLO é o outro eixo. Avaliação sem periodicidade vira aquela que aconteceu
 * uma vez, em 2024, e ninguém repetiu; a tela precisa saber cobrar. Um ciclo é
 * identificado pelo mês em que aconteceu, e o próximo vence três meses depois.
 *
 * As notas são gravadas em JSON, e não em cinco colunas, de propósito: quais
 * critérios servem pra um estagiário e pra um sócio ainda é pergunta em aberto,
 * e critério novo não pode custar migration. A validação vive aqui, do mesmo
 * jeito que a da jornada — quem lê do banco passa por `normalizarNotas` e
 * recebe algo com forma garantida, ou nada.
 */

export type CriterioId =
  | "pontualidade"
  | "metas"
  | "tecnica"
  | "comunicacao"
  | "autonomia";

export interface Criterio {
  id: CriterioId;
  rotulo: string;
  /** O que a nota mede — some da tela e a régua vira a memória de quem avalia. */
  ajuda: string;
}

export const CRITERIOS: Criterio[] = [
  {
    id: "pontualidade",
    rotulo: "Pontualidade",
    ajuda: "Cumpre o horário combinado e avisa quando não vai dar.",
  },
  {
    id: "metas",
    rotulo: "Cumprimento de metas",
    ajuda: "Entrega o que foi acordado pro período, no prazo acordado.",
  },
  {
    id: "tecnica",
    rotulo: "Qualidade técnica",
    ajuda: "O trabalho volta pra correção? Precisa de revisão linha a linha?",
  },
  {
    id: "comunicacao",
    rotulo: "Comunicação",
    ajuda: "Responde, informa o que travou, escreve de um jeito que o outro entende.",
  },
  {
    id: "autonomia",
    rotulo: "Autonomia",
    ajuda: "Resolve sem precisar de acompanhamento a cada passo.",
  },
];

export const NOTA_MIN = 0;
export const NOTA_MAX = 5;

/** Nota por critério. Critério ausente é critério não avaliado. */
export type Notas = Partial<Record<CriterioId, number>>;

const IDS = new Set<string>(CRITERIOS.map((c) => c.id));

/**
 * Valida e normaliza o que veio da tela ou do banco.
 *
 * Critério que não existe mais é DESCARTADO em vez de mantido: ele entraria na
 * média de um jeito que ninguém consegue explicar olhando a tela, que só mostra
 * os critérios atuais.
 */
export function normalizarNotas(bruto: unknown): Notas {
  const obj = typeof bruto === "string" ? seguroJson(bruto) : bruto;
  if (!obj || typeof obj !== "object") return {};

  const saida: Notas = {};
  for (const [chave, valor] of Object.entries(obj as Record<string, unknown>)) {
    if (!IDS.has(chave)) continue;
    const n = Number(valor);
    if (!Number.isFinite(n) || n < NOTA_MIN || n > NOTA_MAX) continue;
    // Meio ponto é a menor divisão que a tela oferece; aceitar 3,7 daria uma
    // precisão que a régua não tem.
    saida[chave as CriterioId] = Math.round(n * 2) / 2;
  }
  return saida;
}

function seguroJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * A nota geral: média dos critérios avaliados, com uma casa.
 *
 * null quando nada foi avaliado — zero seria a pior nota possível, e "não
 * avaliei" não é "tirou zero".
 */
export function mediaDasNotas(notas: Notas): number | null {
  const valores = CRITERIOS.map((c) => notas[c.id]).filter(
    (n): n is number => typeof n === "number",
  );
  if (valores.length === 0) return null;
  const soma = valores.reduce((s, n) => s + n, 0);
  return Math.round((soma / valores.length) * 10) / 10;
}

/** De quantos em quantos meses a avaliação se repete. */
export const CICLO_MESES = 3;

const CICLO = /^(\d{4})-(\d{2})$/;

/** "2026-05" → 24317 (meses desde o ano 0). Serve pra subtrair ciclos. */
function emMeses(ciclo: string): number | null {
  const m = CICLO.exec(ciclo);
  if (!m) return null;
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) return null;
  return Number(m[1]) * 12 + (mes - 1);
}

/** Quantos meses separam dois ciclos. null quando algum não é ciclo. */
export function mesesEntre(de: string, ate: string): number | null {
  const a = emMeses(de);
  const b = emMeses(ate);
  return a == null || b == null ? null : b - a;
}

/** O ciclo em que a próxima avaliação vence. */
export function proximoCiclo(ciclo: string): string | null {
  const base = emMeses(ciclo);
  if (base == null) return null;
  const total = base + CICLO_MESES;
  return `${String(Math.floor(total / 12)).padStart(4, "0")}-${String((total % 12) + 1).padStart(2, "0")}`;
}

export type SituacaoCiclo =
  /** Avaliada dentro do prazo. */
  | "em_dia"
  /** O ciclo fecha neste mês — é a hora de avaliar. */
  | "vence_agora"
  /** Passou do prazo. */
  | "vencida"
  /** Nunca foi avaliada. */
  | "nunca";

/**
 * Onde o colaborador está no ciclo.
 *
 * Quem nunca foi avaliado sai como "nunca" e não como "vencida": a cobrança é
 * a mesma, mas a frase na tela é outra, e chamar de vencida uma avaliação que
 * nunca existiu faz o gestor procurar um histórico que não há.
 */
export function situacaoDoCiclo(
  ultimoCiclo: string | null | undefined,
  hoje: string,
): SituacaoCiclo {
  if (!ultimoCiclo) return "nunca";
  const meses = mesesEntre(ultimoCiclo, hoje);
  if (meses == null || meses < 0) return "em_dia";
  if (meses < CICLO_MESES) return "em_dia";
  if (meses === CICLO_MESES) return "vence_agora";
  return "vencida";
}

/** Se a situação pede ação do gestor agora. */
export function precisaAvaliar(s: SituacaoCiclo): boolean {
  return s !== "em_dia";
}

/** Quanto a nota andou desde a avaliação anterior. null sem comparação. */
export function deltaDeNota(atual: number | null, anterior: number | null): number | null {
  if (atual == null || anterior == null) return null;
  return Math.round((atual - anterior) * 10) / 10;
}

/** Um item do plano combinado no fim da avaliação. */
export interface AcaoCombinada {
  id: number;
  descricao: string;
  /** "YYYY-MM-DD". null quando não se combinou data. */
  prazo: string | null;
  /** Data em que foi dado por cumprido. null = em aberto. */
  concluidoEm: string | null;
}

export type SituacaoAcao = "concluida" | "atrasada" | "em_aberto";

/**
 * O estado de uma ação combinada.
 *
 * Atrasada exige prazo: sem data combinada não há como estar atrasado, e
 * marcar de vermelho tudo que está em aberto transformaria o plano numa lista
 * de acusações.
 */
export function situacaoDaAcao(a: AcaoCombinada, hoje: string): SituacaoAcao {
  if (a.concluidoEm) return "concluida";
  if (a.prazo && a.prazo < hoje) return "atrasada";
  return "em_aberto";
}

export interface AvaliacaoGravada {
  id: number;
  colaboradorId: number;
  /** "YYYY-MM" — o mês em que a avaliação aconteceu. */
  ciclo: string;
  notas: Notas;
  media: number | null;
  comentario: string | null;
  avaliadoPorNome: string | null;
  avaliadoEm: string | null;
  acoes: AcaoCombinada[];
}

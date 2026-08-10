/**
 * Normaliza um hit do DataJud (API Pública do CNJ) para o nosso formato.
 *
 * Duas responsabilidades, e a segunda é a que importa mais:
 *
 * 1. Traduzir o documento do Elasticsearch para linhas de banco, tolerando
 *    campo ausente — a base é alimentada por 90+ tribunais e o preenchimento
 *    varia entre eles.
 *
 * 2. BARRAR processo sigiloso. `nivelSigilo > 0` não entra no acervo, ponto.
 *    Foi a primeira objeção que levantei ao projeto e é a que não pode
 *    depender de ninguém lembrar de filtrar na hora certa.
 */

import { repararMojibake } from "./texto-mojibake";

export interface ProcessoDataJud {
  cnj: string;
  tribunal: string;
  grau: string | null;
  classeCodigo: number | null;
  classeNome: string | null;
  assuntoCodigo: number | null;
  assuntoNome: string | null;
  orgaoCodigo: number | null;
  orgaoNome: string | null;
  /** ISO ou null. */
  ajuizamentoEm: string | null;
  atualizadoEm: string | null;
}

export interface MovimentoDataJud {
  codigo: number | null;
  nome: string;
  /** ISO. */
  dataHora: string;
}

export type ResultadoNormalizacao =
  | { ok: true; processo: ProcessoDataJud; movimentos: MovimentoDataJud[] }
  | { ok: false; motivo: "sigiloso" | "sem_cnj" | "sem_tribunal" };

/**
 * Todo texto do DataJud passa por aqui — e é aqui que o mojibake morre.
 *
 * O CNJ entrega o defeito misturado no mesmo registro: `formato.nome` vem
 * "Eletrônico" e o nome do órgão vem com o acento destruído. Reparar no funil
 * garante que nada entre torto no acervo, em vez de depender de alguém lembrar
 * de tratar campo por campo.
 */
const texto = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = repararMojibake(v).trim();
  return t.length > 0 ? t : null;
};

const inteiro = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) : null;
};

/** Aceita ISO ou "YYYY-MM-DD"; devolve ISO ou null. Data inválida não vira Invalid Date no banco. */
const iso = (v: unknown): string | null => {
  const t = texto(v);
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Só dígitos — é como o CNJ é comparado entre fontes diferentes. */
export function cnjNormalizado(v: unknown): string | null {
  const t = texto(v);
  if (!t) return null;
  const d = t.replace(/\D/g, "");
  return d.length === 20 ? d : null;
}

export function normalizarHit(hit: unknown): ResultadoNormalizacao {
  const src: any = (hit as any)?._source ?? hit;
  if (!src || typeof src !== "object") return { ok: false, motivo: "sem_cnj" };

  // Sigilo primeiro: nada abaixo importa se o processo não pode entrar.
  // Campo ausente é tratado como sigiloso — na dúvida, fica de fora.
  const sigilo = inteiro(src.nivelSigilo);
  if (sigilo === null || sigilo > 0) return { ok: false, motivo: "sigiloso" };

  const cnj = cnjNormalizado(src.numeroProcesso);
  if (!cnj) return { ok: false, motivo: "sem_cnj" };

  const tribunal = texto(src.tribunal);
  if (!tribunal) return { ok: false, motivo: "sem_tribunal" };

  // Um processo pode ter vários assuntos; guardamos o primeiro, que é o
  // principal na convenção da TPU. Os demais não mudam a estatística que a
  // gente quer ("revisional contra banco costuma dar quanto").
  const assunto = Array.isArray(src.assuntos) ? src.assuntos[0] : null;

  const movimentos: MovimentoDataJud[] = (Array.isArray(src.movimentos) ? src.movimentos : [])
    .map((m: any) => {
      const nome = texto(m?.nome);
      const dataHora = iso(m?.dataHora);
      if (!nome || !dataHora) return null;
      return { codigo: inteiro(m?.codigo), nome, dataHora };
    })
    .filter((m: MovimentoDataJud | null): m is MovimentoDataJud => m !== null)
    .sort((a: MovimentoDataJud, b: MovimentoDataJud) => a.dataHora.localeCompare(b.dataHora));

  return {
    ok: true,
    processo: {
      cnj,
      tribunal: tribunal.toUpperCase(),
      grau: texto(src.grau),
      classeCodigo: inteiro(src.classe?.codigo),
      classeNome: texto(src.classe?.nome),
      assuntoCodigo: inteiro(assunto?.codigo),
      assuntoNome: texto(assunto?.nome),
      orgaoCodigo: inteiro(src.orgaoJulgador?.codigo),
      orgaoNome: texto(src.orgaoJulgador?.nome),
      ajuizamentoEm: iso(src.dataAjuizamento),
      atualizadoEm: iso(src.dataHoraUltimaAtualizacao),
    },
    movimentos,
  };
}

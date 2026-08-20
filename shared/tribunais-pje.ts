/**
 * Tribunais PJe que o motor próprio sabe acessar com o login nacional (PDPJ).
 *
 * Compartilhado client/server porque as duas pontas precisam da MESMA lista:
 * o seletor de estados do monitoramento por CPF (client) e a validação do que
 * pode ser vigiado (server). Duas listas divergindo = estado selecionável que
 * o robô não varre — a falha silenciosa clássica.
 */

export const TRIBUNAIS_PJE = [
  { codigo: "tjce", uf: "CE", sigla: "TJCE" },
  { codigo: "tjpe", uf: "PE", sigla: "TJPE" },
  { codigo: "tjdf", uf: "DF", sigla: "TJDFT" },
  { codigo: "tjrj", uf: "RJ", sigla: "TJRJ" },
  { codigo: "tjmg", uf: "MG", sigla: "TJMG" },
  { codigo: "tjrn", uf: "RN", sigla: "TJRN" },
  { codigo: "tjma", uf: "MA", sigla: "TJMA" },
  { codigo: "tjpa", uf: "PA", sigla: "TJPA" },
  { codigo: "tjro", uf: "RO", sigla: "TJRO" },
  { codigo: "tjpb", uf: "PB", sigla: "TJPB" },
  { codigo: "tjmt", uf: "MT", sigla: "TJMT" },
  { codigo: "tjrr", uf: "RR", sigla: "TJRR" },
] as const;

export type CodigoTribunalPje = (typeof TRIBUNAIS_PJE)[number]["codigo"];

/** Sede do escritório — sempre vigiada, não dá pra desmarcar. */
export const TRIBUNAL_SEDE: CodigoTribunalPje = "tjce";

export const CODIGOS_TRIBUNAIS_PJE: string[] = TRIBUNAIS_PJE.map((t) => t.codigo);

export function siglaDoTribunal(codigo: string): string {
  return TRIBUNAIS_PJE.find((t) => t.codigo === codigo)?.sigla ?? codigo.toUpperCase();
}

/**
 * Normaliza a lista escolhida pelo usuário: só códigos conhecidos, sem
 * duplicata, e a sede sempre presente (o monitoramento nasceu pra ela).
 */
export function normalizarTribunais(escolhidos: unknown): string[] {
  const lista = Array.isArray(escolhidos) ? escolhidos : [];
  const validos = lista.filter(
    (t): t is string => typeof t === "string" && CODIGOS_TRIBUNAIS_PJE.includes(t),
  );
  return [...new Set([TRIBUNAL_SEDE, ...validos])];
}

// Segmento TR do CNJ (NNNNNNN-DD.AAAA.8.TR.OOOO) → tribunal estadual.
const TR_PARA_TRIBUNAL: Record<string, string> = {
  "06": "tjce", "17": "tjpe", "07": "tjdf", "19": "tjrj", "13": "tjmg",
  "20": "tjrn", "10": "tjma", "14": "tjpa", "22": "tjro", "15": "tjpb",
  "11": "tjmt", "23": "tjrr",
};

/**
 * Tribunal de origem de um CNJ estadual (J=8). O CNJ carrega a origem no
 * próprio número — é o que permite etiquetar achados antigos sem migração.
 */
export function tribunalDoCnj(cnj: string | null | undefined): string | null {
  if (!cnj) return null;
  const m = /\.8\.(\d{2})\./.exec(cnj);
  if (!m) return null;
  return TR_PARA_TRIBUNAL[m[1]] ?? null;
}

/**
 * Gavetas da aba Novas Ações, pelo lado em que o cliente está.
 *
 * Uma lista só misturava a ação movida CONTRA o cliente (o alerta) com a
 * ação que o próprio escritório ajuizou — e o alerta vermelho tocava nas
 * duas. Aqui o polo vira três gavetas: passivo (é o alerta), ativo (só
 * consulta) e não identificado (o robô não achou o cliente entre as partes;
 * alguém decide com um clique).
 */

import type { PoloParte } from "./polo-parte";

export type GavetaPolo = "passivo" | "ativo" | "desconhecido";

/**
 * Terceiro interessado fica com o passivo: não é o autor, e o robô sempre o
 * tratou como alerta — mover pra gaveta do autor silenciaria um caso.
 */
export const POLOS_DA_GAVETA: Record<GavetaPolo, PoloParte[]> = {
  passivo: ["passivo", "terceiro"],
  ativo: ["ativo"],
  desconhecido: ["desconhecido"],
};

export function gavetaDoPolo(polo: PoloParte): GavetaPolo {
  if (polo === "ativo") return "ativo";
  if (polo === "desconhecido") return "desconhecido";
  return "passivo";
}

/** Só o autor confirmado fica fora do alerta. "Não sei" alerta de propósito. */
export function contaComoAlerta(polo: PoloParte): boolean {
  return polo !== "ativo";
}

export const GAVETAS: Array<{ id: GavetaPolo; rotulo: string; curto: string; explicacao: string }> = [
  {
    id: "passivo",
    rotulo: "Contra o cliente · Polo passivo",
    curto: "Polo passivo",
    explicacao: "Alguém entrou com uma ação contra o seu cliente. É aqui que o alerta toca.",
  },
  {
    id: "ativo",
    rotulo: "Movidas pelo cliente · Polo ativo",
    curto: "Polo ativo",
    explicacao: "Ações que o seu cliente moveu. Só consulta — sem alerta, sem sino.",
  },
  {
    id: "desconhecido",
    rotulo: "Não identificado",
    curto: "Não identificado",
    explicacao: "O robô não achou o cliente entre as partes. Diga de que lado ele está.",
  },
];

/**
 * Documentos (CPF/CNPJ) escritos dentro de um texto livre, só com dígitos.
 *
 * O TJCE escreve a parte como "NOME - CPF: 810.665.623-34 (AUTOR)", tudo
 * numa célula; comparar só o campo de documento deixava o cliente sem polo.
 * Procurar o padrão de documento (e não qualquer sequência de dígitos)
 * evita casar um CPF dentro de um CNPJ ou de um número de OAB.
 */
export function documentosNoTexto(texto: string | null | undefined): string[] {
  if (!texto) return [];
  const achados = new Set<string>();
  const cnpj = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
  const cpf = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
  for (const re of [cnpj, cpf]) {
    for (const m of texto.match(re) ?? []) achados.add(m.replace(/\D/g, ""));
  }
  return [...achados];
}

/** "OAB/CE 38.828", "OAB CE38828", "ce 38828" → "CE38828". Vazio quando não há UF + número. */
export function normalizarOab(bruto: string | null | undefined): string {
  const s = (bruto ?? "").toUpperCase().replace(/OAB/g, " ");
  const m = /([A-Z]{2})[\s\/:.\-]*(\d[\d.]*)/.exec(s);
  if (!m) return "";
  const numero = m[2].replace(/\D/g, "").replace(/^0+/, "");
  return numero ? `${m[1]}${numero}` : "";
}

/** O texto de uma parte (advogado listado pelo tribunal) menciona esta OAB? */
export function textoMencionaOab(texto: string | null | undefined, oabEscritorio: string | null | undefined): boolean {
  const alvo = normalizarOab(oabEscritorio);
  if (!alvo || !texto) return false;
  const re = /OAB[\s\/:.\-]*([A-Z]{2})[\s\/:.\-]*(\d[\d.]*)/gi;
  for (const m of texto.matchAll(re)) {
    const numero = m[2].replace(/\D/g, "").replace(/^0+/, "");
    if (`${m[1].toUpperCase()}${numero}` === alvo) return true;
  }
  return false;
}

/**
 * Polo de uma parte no processo — e o que fazer quando não dá pra saber.
 *
 * Havia três leituras diferentes espalhadas pelo código, cada uma com um
 * default silencioso e nenhuma igual à outra:
 *
 *   `p.polo === "passivo" ? "Passive" : "Active"`            (duas cópias)
 *   `p.polo.startsWith("ativ") ? "Active" : "Passive"`       (a terceira)
 *   `polo === "passivo" ? ... : polo === "terceiro" ? ... : "ativo"`
 *
 * Nenhuma delas tem um valor pra "não sei". Parte sem polo reconhecido,
 * capa que o tribunal devolveu vazia, tabela do PJe fora do formato
 * esperado — tudo caía no `else`. E o `else` de duas dessas é ATIVO, que
 * é justamente o rótulo que faz o robô de novas ações silenciar o alerta:
 * "o cliente é o autor, ninguém processou ele". Uma falha de leitura
 * escolhia o lado que esconde o caso.
 *
 * Aqui "desconhecido" é um valor de primeira classe. Quem consome decide
 * o que fazer com ele — mas ninguém mais decide por omissão.
 */

export type PoloParte = "ativo" | "passivo" | "terceiro" | "desconhecido";

/** Lado no shape legado que o frontend de processos ainda consome. */
export type LadoJudit = "Active" | "Passive" | "Unknown";

export const POLO_LABEL: Record<PoloParte, string> = {
  ativo: "Autor",
  passivo: "Réu",
  terceiro: "Terceiro",
  desconhecido: "Não identificado",
};

/**
 * Interpreta o campo `polo` vindo do scraper, do banco ou de JSON antigo.
 *
 * Aceita as variações que já circularam ("ativa"/"ativo", caixa alta, com
 * espaço em volta). O que não for reconhecido vira "desconhecido" — nunca
 * um dos lados.
 */
export function lerPolo(bruto: unknown): PoloParte {
  const s = typeof bruto === "string" ? bruto.trim().toLowerCase() : "";
  if (!s) return "desconhecido";
  if (s.startsWith("ativ")) return "ativo";
  if (s.startsWith("passiv")) return "passivo";
  if (s.startsWith("terceir") || s.startsWith("outro") || s.startsWith("interessad")) {
    return "terceiro";
  }
  return "desconhecido";
}

/**
 * `side` é o campo legado; só distingue os dois polos. Terceiro e
 * desconhecido caem os dois em "Unknown" porque nenhum dos dois é autor
 * nem réu — chamar um terceiro interessado de "Passive" colocaria ele na
 * coluna dos adversários e faria o card mentir sobre quem está sendo
 * processado. Quem precisa separar terceiro de desconhecido lê `polo`.
 */
export function paraLadoJudit(polo: unknown): LadoJudit {
  switch (lerPolo(polo)) {
    case "ativo": return "Active";
    case "passivo": return "Passive";
    default: return "Unknown";
  }
}

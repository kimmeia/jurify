/**
 * Detecta variáveis [snake_case] no prompt de um agente — as anotações que o
 * SDR usa pra marcar "isto deve virar campo personalizado no cadastro do
 * cliente" (ex: [valor_financiado], [parcelas_atrasadas]). Compara com o
 * catálogo existente do escritório e devolve a lista do que falta criar, já
 * com label e tipo inferidos (editáveis na UI antes de criar).
 *
 * Pensado pro fluxo do editor de agente: usuário cola o prompt, clica
 * "Analisar campos do prompt", revisa no modal e cria tudo de uma vez.
 */

export type TipoCampoCaptura = "texto" | "numero" | "data" | "select" | "textarea" | "boolean";

export interface SugestaoCampo {
  chave: string;
  label: string;
  tipo: TipoCampoCaptura;
  opcoes?: string[];
}

/**
 * Extrai chaves [snake_case] do prompt. Case-insensitive na detecção; resultado
 * em minúscula. Dedupica. Ignora markdown links `[texto](url)` (lookahead `(`).
 */
export function detectarChavesNoPrompt(prompt: string): string[] {
  if (!prompt) return [];
  const unicas = new Set<string>();
  for (const m of prompt.matchAll(/\[([a-z][a-z0-9_]*)\](?!\()/gi)) {
    unicas.add(m[1].toLowerCase());
  }
  return [...unicas];
}

/**
 * Heurística do tipo do campo a partir da chave. Default conservador = "texto"
 * — o usuário ajusta no modal antes de criar. Pra `select`, devolve opções
 * padrão SIM/NAO.
 */
export function inferirTipoCampo(chave: string): { tipo: TipoCampoCaptura; opcoes?: string[] } {
  const c = chave.toLowerCase();
  // Sim/Não conhecidos
  if (
    c === "conteudo_sexual" ||
    c.startsWith("confirmacao_") ||
    c.startsWith("aceita_") ||
    c.startsWith("tem_") ||
    c.startsWith("ja_")
  ) {
    return { tipo: "select", opcoes: ["SIM", "NAO"] };
  }
  // Data
  if (c.startsWith("data_") || c.endsWith("_data") || c.startsWith("dia_")) return { tipo: "data" };
  // Número (prefixos comuns + sufixos)
  if (/^(valor|renda|fatura|parcela|numero|qtd|total|remuneracao)/.test(c)) return { tipo: "numero" };
  if (/_(valor|total|quantidade|numero|parcelas?)$/.test(c)) return { tipo: "numero" };
  return { tipo: "texto" };
}

/**
 * "valor_financiado" → "Valor financiado". Mantém minúsculas exceto a 1ª letra.
 */
export function chaveParaLabel(chave: string): string {
  const sem_ = chave.replace(/_+/g, " ").trim();
  if (!sem_) return chave;
  return sem_[0].toUpperCase() + sem_.slice(1);
}

/**
 * Calcula quais chaves do prompt ainda não existem no catálogo do escritório.
 * Retorna sugestões já com label e tipo inferidos. Comparação case-insensitive.
 */
export function chavesFaltantes(
  prompt: string,
  existentes: ReadonlyArray<{ chave: string }>,
): SugestaoCampo[] {
  const existentesSet = new Set(existentes.map((c) => c.chave.toLowerCase()));
  return detectarChavesNoPrompt(prompt)
    .filter((c) => !existentesSet.has(c))
    .map((chave) => ({
      chave,
      label: chaveParaLabel(chave),
      ...inferirTipoCampo(chave),
    }));
}

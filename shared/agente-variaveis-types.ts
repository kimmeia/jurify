/**
 * Variáveis personalizadas de captura por agente IA.
 *
 * Define o que o agente deve extrair de uma conversa e onde guardar.
 * Cada variável conecta 3 conceitos:
 *   - atributo: nome técnico usado no JSON pedido à IA
 *   - descricao: orientação contextual pra IA (formato, restrições)
 *   - campoChave: chave de `campos_personalizados_cliente` onde o
 *     valor extraído será persistido em `contatos.camposPersonalizados`
 *
 * Persistido em `agentes_ia.camposCaptura` como JSON. Aceita o formato
 * legado (array de strings) onde atributo = campoChave = chave do campo.
 */

export interface AgenteVariavel {
  atributo: string;
  descricao: string;
  campoChave: string;
}

export function parseAgenteVariaveis(
  raw: string | null | undefined,
): AgenteVariavel[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const result: AgenteVariavel[] = [];
  for (const item of parsed) {
    if (typeof item === "string") {
      if (!item) continue;
      result.push({ atributo: item, descricao: "", campoChave: item });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const campoChave = typeof o.campoChave === "string" ? o.campoChave.trim() : "";
    if (!campoChave) continue;
    const atributoRaw = typeof o.atributo === "string" ? o.atributo.trim() : "";
    const atributo = atributoRaw || campoChave;
    const descricao = typeof o.descricao === "string" ? o.descricao.trim() : "";
    result.push({ atributo, descricao, campoChave });
  }
  return result;
}

export function serializarAgenteVariaveis(
  vars: AgenteVariavel[] | null | undefined,
): string | null {
  if (!vars || vars.length === 0) return null;
  const limpos = vars
    .map((v) => ({
      atributo: (v.atributo || "").trim(),
      descricao: (v.descricao || "").trim(),
      campoChave: (v.campoChave || "").trim(),
    }))
    .filter((v) => v.campoChave && v.atributo);
  if (limpos.length === 0) return null;
  return JSON.stringify(limpos);
}

/**
 * Garante atributos únicos dentro do conjunto. Útil pra validar
 * antes de salvar — IA precisa de chaves únicas no JSON pedido.
 */
export function temAtributosDuplicados(vars: AgenteVariavel[]): boolean {
  const seen = new Set<string>();
  for (const v of vars) {
    const k = v.atributo.toLowerCase();
    if (seen.has(k)) return true;
    seen.add(k);
  }
  return false;
}

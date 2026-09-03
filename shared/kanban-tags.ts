/**
 * Tags vivem como texto separado por vírgula ("Trabalhista, VIP") em
 * `contatos.tags` e `kanban_cards.tags`. Quem escreve por cima precisa unir
 * com o que já estava lá — o cadastro do cliente é a fonte da verdade e os
 * outros cards dele leem dali.
 */

export function listarTags(texto: string | null | undefined): string[] {
  return (texto ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/** As gravadas ficam na frente; as novas entram sem repetir. `null` quando vazio. */
export function unirTags(gravadas: string | null | undefined, novas: string | null | undefined): string | null {
  const vistas = new Set<string>();
  const saida: string[] = [];
  for (const t of [...listarTags(gravadas), ...listarTags(novas)]) {
    if (vistas.has(t)) continue;
    vistas.add(t);
    saida.push(t);
  }
  return saida.length ? saida.join(", ") : null;
}

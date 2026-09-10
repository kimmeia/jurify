/**
 * `<Link>` do wouter v3 já é a âncora — não embrulhe outra.
 *
 * No wouter v2 o idioma era `<Link href="..."><a>...</a></Link>`: o Link
 * não renderizava nada, só clonava o filho. Na v3 (que é a do projeto)
 * ele renderiza o `<a>` sozinho, e o filho vira `<a>` dentro de `<a>` —
 * HTML inválido. O React reclama com "In HTML, <a> cannot be a
 * descendant of <a>. This will cause a hydration error."
 *
 * O sobrevivente da migração era o card do Agente Jurídico em
 * `AgentesIA.tsx`, que aparece em /agentes-ia, /automacoes e /smartflow
 * (a mesma página é montada nas três). Quem achou foi o robô de ação:
 * clicar na aba "Agentes" disparava o erro no console.
 *
 * Este teste é de texto porque o defeito é de estrutura de JSX, não de
 * tipo — `tsc` aceita `<Link><a>` sem reclamar, e foi por isso que ele
 * sobreviveu à atualização do wouter.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const RAIZ_REPO = join(__dirname, "..", "..");
const RAIZ_CLIENT = join(RAIZ_REPO, "client", "src");

/** `<Link ...>` seguido de `<a` com só espaço/quebra no meio. */
const PADRAO = /<Link\b[^>]*>\s*<a\b/g;

function arquivosTsx(dir: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) saida.push(...arquivosTsx(caminho));
    else if (nome.endsWith(".tsx")) saida.push(caminho);
  }
  return saida;
}

describe("Link do wouter não embrulha âncora", () => {
  it("nenhum <Ink><a> sobrou no client", () => {
    const encontrados: string[] = [];
    for (const caminho of arquivosTsx(RAIZ_CLIENT)) {
      const fonte = readFileSync(caminho, "utf8");
      const quantos = fonte.match(PADRAO)?.length ?? 0;
      if (quantos > 0) {
        encontrados.push(`${relative(RAIZ_REPO, caminho).replace(/\\/g, "/")}: ${quantos}`);
      }
    }

    expect(
      encontrados,
      "o Link do wouter v3 já renderiza <a>; envolver outra produz <a> dentro " +
        "de <a> e o React derruba a hidratação. Ponha a className no próprio Link",
    ).toEqual([]);
  });
});

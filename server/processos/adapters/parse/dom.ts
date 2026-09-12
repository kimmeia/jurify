/**
 * HTML → Document fora do navegador (linkedom).
 *
 * Toda extração do motor vive em `page.evaluate`, e por isso nenhuma tem
 * teste com HTML de verdade: só dá pra conferir com um portal no ar. Este é
 * o primeiro passo pra tirar a extração de dentro do Playwright — o parser
 * recebe um Document e não sabe de onde ele veio.
 */

import { parseHTML } from "linkedom";

export function parseHtml(html: string): Document {
  return parseHTML(html).document as unknown as Document;
}

/**
 * Adapter PJe TRF-5 (Justiça Federal 5ª Região) — caminho de PRODUÇÃO.
 *
 * Wrapper fino sobre `TRF5Scraper` do spike. Diferente do TJCE:
 *  - Sem credencial, sem cofre, sem sessão — consulta pública aberta
 *  - Bate direto em pje.trf5.jus.br, sem login PDPJ
 *  - Latência alvo similar (10-25s) — usa Playwright pra renderizar JSF
 *
 * Pattern espelhado em adapters/pje-tjce.ts pra manter consistência.
 */

import { TRF5Scraper } from "../../../scripts/spike-motor-proprio/poc-1-pje-scraper/adapters/trf5";
import type { ResultadoScraper } from "../../../scripts/spike-motor-proprio/lib/types-spike";

export async function consultarTrf5(cnj: string): Promise<ResultadoScraper> {
  const scraper = new TRF5Scraper();
  return scraper.consultarPorCnj(cnj);
}

export { TRF5Scraper };

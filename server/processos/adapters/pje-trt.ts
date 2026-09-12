/**
 * Adapters PJe da Justiça do Trabalho por CONSULTA PÚBLICA — caminho de
 * produção, no molde de `pje-trf5.ts`.
 *
 * Sem credencial, sem cofre, sem sessão: o portal do TRT responde aberto.
 * `TRT15Scraper` só troca a URL do `TRT2Scraper`; os dois saem do spike, que
 * nunca rodou contra o portal de verdade — o desenho é o do TRF5, a
 * comprovação em campo é do dono.
 */

import { TRT2Scraper } from "../../../scripts/spike-motor-proprio/poc-1-pje-scraper/adapters/trt2";
import { TRT15Scraper } from "../../../scripts/spike-motor-proprio/poc-1-pje-scraper/adapters/trt15";
import type { ResultadoScraper } from "../../../scripts/spike-motor-proprio/lib/types-spike";

export async function consultarTrt2(cnj: string): Promise<ResultadoScraper> {
  const scraper = new TRT2Scraper();
  return scraper.consultarPorCnj(cnj);
}

export async function consultarTrt15(cnj: string): Promise<ResultadoScraper> {
  const scraper = new TRT15Scraper();
  return scraper.consultarPorCnj(cnj);
}

export { TRT2Scraper, TRT15Scraper };

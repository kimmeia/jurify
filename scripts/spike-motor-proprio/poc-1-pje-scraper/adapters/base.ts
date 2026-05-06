/**
 * Interface comum a todos os adapters de tribunal do PoC 1.
 *
 * Quando o Spike validar e virar produção, esta interface migra para
 * `server/processos/adapters/` e cada implementação concreta vira um
 * adapter de produção. Por ora vive isolada nos PoCs.
 */

import type { ResultadoScraper } from "../../lib/types-spike";

export interface ScraperTribunalAdapter {
  /** Alias DataJud do tribunal (ex: "trt2", "tjsp", "trf1") */
  readonly tribunal: string;

  /** Nome legível do tribunal (pra logs e relatório) */
  readonly nome: string;

  /**
   * Consulta um processo pelo CNJ.
   *
   * Contrato: NUNCA lança exceção — capturar erros internamente e
   * retornar `ResultadoScraper { ok: false, categoriaErro, ... }`.
   * Isso permite ao orquestrador agregar estatísticas sem precisar
   * try/catch em cada consulta.
   *
   * Latência alvo: <10s. Se exceder, retornar com categoriaErro="timeout".
   */
  consultarPorCnj(cnj: string): Promise<ResultadoScraper>;
}

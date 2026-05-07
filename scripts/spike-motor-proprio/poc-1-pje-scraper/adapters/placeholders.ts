/**
 * Adapters placeholder para tribunais a serem implementados no Dia 3 do Spike.
 *
 * Retornam ResultadoScraper com `categoriaErro="outro"` e mensagem clara —
 * permite que o orquestrador rode end-to-end mesmo antes da implementação
 * concreta, exibindo no relatório quais tribunais ainda estão pendentes.
 */

import { mascararCnj } from "../../lib/parser-utils";
import type { ResultadoScraper } from "../../lib/types-spike";
import type { ScraperTribunalAdapter } from "./base";

class PlaceholderScraper implements ScraperTribunalAdapter {
  constructor(public readonly tribunal: string, public readonly nome: string) {}

  async consultarPorCnj(cnj: string): Promise<ResultadoScraper> {
    return {
      ok: false,
      tribunal: this.tribunal,
      cnj: mascararCnj(cnj),
      latenciaMs: 0,
      capa: null,
      movimentacoes: [],
      categoriaErro: "outro",
      mensagemErro: `Adapter ${this.tribunal} ainda não implementado (placeholder do Spike Dia 3)`,
      screenshotPath: null,
      finalizadoEm: new Date().toISOString(),
    };
  }
}

export class TJDFTScraper extends PlaceholderScraper {
  constructor() {
    super("tjdft", "Tribunal de Justiça do Distrito Federal e Territórios");
  }
}

export class TJMGScraper extends PlaceholderScraper {
  constructor() {
    super("tjmg", "Tribunal de Justiça de Minas Gerais");
  }
}

export class TRF1Scraper extends PlaceholderScraper {
  constructor() {
    super("trf1", "Tribunal Regional Federal da 1ª Região");
  }
}

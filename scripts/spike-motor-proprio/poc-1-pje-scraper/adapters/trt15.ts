/**
 * Adapter PJe TRT-15 (Tribunal Regional do Trabalho da 15ª Região — Campinas).
 *
 * O PJe-TRT15 usa o mesmo framework JSF do TRT2 — só muda o domínio.
 * Por isso herdamos da implementação TRT2 e sobrescrevemos apenas a URL.
 *
 * Se o Dia 2 do Spike provar que esta estratégia funciona pros dois,
 * temos forte evidência de que um adapter PJe genérico parametrizado
 * por URL cobre todos os 24 TRTs com pequenos ajustes.
 */

import { TRT2Scraper } from "./trt2";

export class TRT15Scraper extends TRT2Scraper {
  override readonly tribunal: string = "trt15";
  override readonly nome: string = "Tribunal Regional do Trabalho — 15ª Região (Campinas)";

  protected override getUrlConsulta(): string {
    return "https://pje.trt15.jus.br/consultaprocessual/";
  }
}

/**
 * Adapter PJe TRT-7 (Tribunal Regional do Trabalho da 7ª Região — Ceará).
 *
 * Mesmo padrão do TRT-2 e TRT-15 — herda a implementação base e
 * sobrescreve apenas a URL. Justiça do Trabalho em todo Brasil usa o
 * mesmo PJe institucional, então selectors e fluxo de busca tendem
 * a ser idênticos.
 *
 * Se algum selector específico do TRT-7 divergir, será detectado nas
 * primeiras consultas e podemos fazer override pontual aqui.
 */

import { TRT2Scraper } from "./trt2";

export class TRT7Scraper extends TRT2Scraper {
  override readonly tribunal: string = "trt7";
  override readonly nome: string = "Tribunal Regional do Trabalho — 7ª Região (Ceará)";

  protected override getUrlConsulta(): string {
    return "https://pje.trt7.jus.br/consultaprocessual/";
  }
}

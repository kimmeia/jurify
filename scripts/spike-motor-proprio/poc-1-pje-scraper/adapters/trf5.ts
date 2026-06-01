/**
 * Adapter PJe TRF-5 (Tribunal Regional Federal da 5ª Região).
 *
 * Jurisdição: PE, RN, CE, PB, AL, SE (sede em Recife).
 * Fonte: consulta pública em https://pje.trf5.jus.br/pje/ConsultaPublica/listView.seam
 *
 * Reaproveita 100% do fluxo do TRT-2 (PJe consulta pública sem login).
 * Diferenças:
 *  - URL da página de consulta
 *  - UF padrão = "PE" (sede; processo individual pode estar em outra UF
 *    da 5ª Região, mas a coluna `uf` no schema é meta do tribunal, não
 *    da comarca específica do processo)
 *
 * Por que herdar TRT-2: ambos rodam o mesmo framework (PJe JSF/RichFaces
 * consulta pública) com mesmos seletores resilientes. Quando algum dos
 * dois divergir o suficiente, especializar.
 */

import { TRT2Scraper } from "./trt2";

export class TRF5Scraper extends TRT2Scraper {
  readonly tribunal: string = "trf5";
  readonly nome: string = "TRF da 5ª Região (PE/RN/CE/PB/AL/SE) — PJe consulta pública";

  protected getUrlConsulta(): string {
    return "https://pje.trf5.jus.br/pje/ConsultaPublica/listView.seam";
  }

  protected getUf(): string {
    return "PE";
  }
}

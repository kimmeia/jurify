/**
 * Testes do adapter PJe TRF-5 — parte determinística.
 *
 * Fluxo de consulta real (Playwright + URL ao vivo) é validado em smoke
 * separado; aqui só cobre overrides do TRT2Scraper (URL, UF, tribunal id).
 */

import { describe, it, expect } from "vitest";
import { TRF5Scraper } from "./pje-trf5";
import { TRT2Scraper } from "../../../scripts/spike-motor-proprio/poc-1-pje-scraper/adapters/trt2";

describe("TRF5Scraper — overrides do TRT-2", () => {
  it("identifica tribunal como trf5", () => {
    const s = new TRF5Scraper();
    expect(s.tribunal).toBe("trf5");
  });

  it("nome legível menciona 5ª Região", () => {
    const s = new TRF5Scraper();
    expect(s.nome).toMatch(/5ª Região/);
  });

  it("herda corretamente do TRT-2 (mesmo fluxo de consulta pública)", () => {
    const s = new TRF5Scraper();
    expect(s).toBeInstanceOf(TRT2Scraper);
  });

  it("URL aponta pra portal TRF-5, não TRT-2", () => {
    const s = new TRF5Scraper();
    // Acesso ao protected via cast: vale pro teste unit
    const url = (s as unknown as { getUrlConsulta(): string }).getUrlConsulta();
    expect(url).toBe("https://pje.trf5.jus.br/pje/ConsultaPublica/listView.seam");
    expect(url).not.toMatch(/trt2/);
  });

  it("UF default é PE (sede em Recife)", () => {
    const s = new TRF5Scraper();
    const uf = (s as unknown as { getUf(): string }).getUf();
    expect(uf).toBe("PE");
  });
});

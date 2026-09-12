/**
 * Adapters PJe TRT-2 e TRT-15 — parte determinística, no molde de
 * `pje-trf5.test.ts`. O fluxo real (Playwright + portal) só o dono valida.
 */
import { describe, expect, it } from "vitest";
import { TRT15Scraper, TRT2Scraper, consultarTrt15, consultarTrt2 } from "./pje-trt";
import { TRT2Scraper as TRT2DoSpike } from "../../../scripts/spike-motor-proprio/poc-1-pje-scraper/adapters/trt2";

type Privado = { getUrlConsulta(): string; getUf(): string };

describe("TRT2Scraper — consulta pública", () => {
  it("identifica tribunal como trt2 e é o scraper do spike", () => {
    const s = new TRT2Scraper();
    expect(s.tribunal).toBe("trt2");
    expect(s).toBeInstanceOf(TRT2DoSpike);
    expect(s.nome).toMatch(/2ª Região/);
  });

  it("URL aponta pra consulta pública do TRT-2 e a UF é SP", () => {
    const s = new TRT2Scraper() as unknown as Privado;
    expect(s.getUrlConsulta()).toBe("https://pje.trt2.jus.br/consultaprocessual/");
    expect(s.getUf()).toBe("SP");
  });
});

describe("TRT15Scraper — só troca a URL do TRT-2", () => {
  it("herda do TRT-2 (mesmo fluxo de consulta pública) e identifica trt15", () => {
    const s = new TRT15Scraper();
    expect(s).toBeInstanceOf(TRT2Scraper);
    expect(s.tribunal).toBe("trt15");
    expect(s.nome).toMatch(/15ª Região/);
  });

  it("URL aponta pro TRT-15, não pro TRT-2; UF continua SP (Campinas)", () => {
    const s = new TRT15Scraper() as unknown as Privado;
    expect(s.getUrlConsulta()).toBe("https://pje.trt15.jus.br/consultaprocessual/");
    expect(s.getUrlConsulta()).not.toMatch(/trt2\./);
    expect(s.getUf()).toBe("SP");
  });
});

describe("wrappers de produção", () => {
  it("existem um por tribunal, com a mesma assinatura do TRF5 (só o CNJ)", () => {
    expect(typeof consultarTrt2).toBe("function");
    expect(typeof consultarTrt15).toBe("function");
    expect(consultarTrt2.length).toBe(1);
    expect(consultarTrt15.length).toBe(1);
  });
});

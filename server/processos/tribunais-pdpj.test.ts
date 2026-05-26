import { describe, it, expect } from "vitest";
import {
  pdpjTjConfig,
  getConfigTribunal,
  tribunalTemMotorProprio,
  configPorSistema,
} from "./tribunais-pdpj";

describe("tribunais-pdpj (registro central)", () => {
  it("TJCE 1º grau bate com a config validada (comportamento preservado)", () => {
    const c = getConfigTribunal("tjce");
    expect(c).not.toBeNull();
    expect(c!.urlEntrada).toBe("https://pje.tjce.jus.br/");
    expect(c!.urlBusca).toBe(
      "https://pje.tjce.jus.br/pje1grau/Processo/ConsultaProcesso/listView.seam",
    );
    expect(c!.grau).toBe(1);
  });

  it("TJCE 2º grau usa o portal pje2grau", () => {
    const c = getConfigTribunal("tjce", 2);
    expect(c).not.toBeNull();
    expect(c!.urlEntrada).toBe("https://pje.tjce.jus.br/pje2grau/");
    expect(c!.urlBusca).toBe(
      "https://pje.tjce.jus.br/pje2grau/Processo/ConsultaProcesso/listView.seam",
    );
    expect(c!.grau).toBe(2);
  });

  it("tribunal não registrado → null / sem motor próprio", () => {
    expect(getConfigTribunal("tjsp")).toBeNull();
    expect(tribunalTemMotorProprio("tjce")).toBe(true);
    expect(tribunalTemMotorProprio("tjsp")).toBe(false);
  });

  it("pdpjTjConfig gera o padrão PJe a partir da UF (adicionar estado = 1 linha)", () => {
    const mg = pdpjTjConfig("mg");
    expect(mg.tribunal).toBe("tjmg");
    expect(mg.urlEntrada).toBe("https://pje.tjmg.jus.br/");
    expect(mg.urlBusca).toBe(
      "https://pje.tjmg.jus.br/pje1grau/Processo/ConsultaProcesso/listView.seam",
    );
  });
});

describe("configPorSistema (login tribunal-aware)", () => {
  it("pje_tjce → config do TJCE (login no portal certo)", () => {
    const c = configPorSistema("pje_tjce");
    expect(c).not.toBeNull();
    expect(c!.urlEntrada).toBe("https://pje.tjce.jus.br/");
  });

  it("PJe-TJ não registrado → null (não cai no portal do TJCE)", () => {
    expect(configPorSistema("pje_tjmg")).toBeNull();
    expect(configPorSistema("pje_tjdft")).toBeNull();
  });

  it("sistemas não-PJe-TJ → null (e-SAJ, e-Proc, TRT, wildcard)", () => {
    expect(configPorSistema("esaj_tjsp")).toBeNull();
    expect(configPorSistema("eproc_trf2")).toBeNull();
    expect(configPorSistema("pje_restrito_trt7")).toBeNull();
    expect(configPorSistema("pje_*")).toBeNull();
  });
});

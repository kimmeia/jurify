import { describe, it, expect } from "vitest";
import { pdpjTjConfig, getConfigTribunal, tribunalTemMotorProprio } from "./tribunais-pdpj";

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

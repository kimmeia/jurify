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
    // TJSP usa E-SAJ — não tem adapter PDPJ
    expect(getConfigTribunal("tjsp")).toBeNull();
    expect(tribunalTemMotorProprio("tjce")).toBe(true);
    expect(tribunalTemMotorProprio("tjsp")).toBe(false);
  });

  it("Lote 1 (PJe-PDPJ multi-estado) gera URLs no padrão do estado", () => {
    // Smoke: cada TJ habilitado aponta pro próprio portal — não pode
    // cair em pje.tjce.jus.br por engano.
    const casos: [string, string][] = [
      ["tjrj", "https://pje.tjrj.jus.br/"],
      ["tjmg", "https://pje.tjmg.jus.br/"],
      ["tjrn", "https://pje.tjrn.jus.br/"],
      ["tjma", "https://pje.tjma.jus.br/"],
      ["tjpa", "https://pje.tjpa.jus.br/"],
      ["tjro", "https://pje.tjro.jus.br/"],
      ["tjpe", "https://pje.tjpe.jus.br/"],
      ["tjpb", "https://pje.tjpb.jus.br/"],
      ["tjmt", "https://pje.tjmt.jus.br/"],
      ["tjrr", "https://pje.tjrr.jus.br/"],
    ];
    for (const [trib, esperado] of casos) {
      const c = getConfigTribunal(trib);
      expect(c, `${trib} deve estar habilitado`).not.toBeNull();
      expect(c!.urlEntrada).toBe(esperado);
      expect(tribunalTemMotorProprio(trib)).toBe(true);
    }
  });

  it("TJDF é exceção: id 'tjdf' mas portal vive em pje.tjdft.jus.br", () => {
    const c = getConfigTribunal("tjdf");
    expect(c).not.toBeNull();
    expect(c!.tribunal).toBe("tjdf");
    expect(c!.urlEntrada).toBe("https://pje.tjdft.jus.br/");
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

  it("Lote 1: cada sistema cofre PJe-TJ leva ao portal correto", () => {
    // Garante que cred "pje_tjmg" não cai no portal TJCE
    expect(configPorSistema("pje_tjmg")?.urlEntrada).toBe("https://pje.tjmg.jus.br/");
    expect(configPorSistema("pje_tjrj")?.urlEntrada).toBe("https://pje.tjrj.jus.br/");
    expect(configPorSistema("pje_tjrn")?.urlEntrada).toBe("https://pje.tjrn.jus.br/");
    expect(configPorSistema("pje_tjpe")?.urlEntrada).toBe("https://pje.tjpe.jus.br/");
  });

  it("pje_tjdft (cofre) resolve via alias pra config do TJDF", () => {
    // No CNJ o código é tjdf (DF), mas no cofre é pje_tjdft (sigla
    // histórica DFT). Alias garante que login vai pro portal certo.
    const c = configPorSistema("pje_tjdft");
    expect(c).not.toBeNull();
    expect(c!.urlEntrada).toBe("https://pje.tjdft.jus.br/");
  });

  it("PJe-TJ ainda não habilitado → null (não cai no portal do TJCE)", () => {
    // TJES, TJPR, TJRS, TJGO ainda não estão no REGISTRO
    expect(configPorSistema("pje_tjes")).toBeNull();
    expect(configPorSistema("pje_tjpr")).toBeNull();
  });

  it("sistemas não-PJe-TJ → null (e-SAJ, e-Proc, TRT, wildcard)", () => {
    expect(configPorSistema("esaj_tjsp")).toBeNull();
    expect(configPorSistema("eproc_trf2")).toBeNull();
    expect(configPorSistema("pje_restrito_trt7")).toBeNull();
    expect(configPorSistema("pje_*")).toBeNull();
  });
});

/**
 * Tests — `cnj-parser.ts`.
 *
 * Função crítica que decide se um CNJ vai pro motor próprio ou pra
 * fallback Judit. Erro aqui = consulta cobrada do escritório errado
 * (motor: 1 cred; Judit: 5+ cred) ou processo "tribunal desconhecido"
 * pra usuário.
 *
 * Casos cobertos: TJ todos os 27 estados, TRT 1-24, TRF 1-6, segmentos
 * superiores/eleitoral/militar, formato com e sem máscara, entrada
 * inválida, mapeamento sistema cofre.
 */

import { describe, it, expect } from "vitest";
import {
  parseCnjTribunal,
  sistemaCofrePorTribunal,
  extrairCodigoTribunal,
  temAdapterMotorProprio,
} from "../processos/cnj-parser";

describe("parseCnjTribunal — Justiça Estadual (TJ)", () => {
  it("TJCE — único com motor próprio hoje", () => {
    const r = parseCnjTribunal("3024938-55.2026.8.06.0001");
    expect(r).toMatchObject({
      codigoTribunal: "tjce",
      siglaTribunal: "TJCE",
      segmento: "estadual",
      uf: "CE",
      temMotorProprio: true,
    });
  });

  it("TJSP — sem motor próprio (fallback)", () => {
    const r = parseCnjTribunal("1000123-45.2024.8.26.0100");
    expect(r).toMatchObject({
      codigoTribunal: "tjsp",
      siglaTribunal: "TJSP",
      segmento: "estadual",
      uf: "SP",
      temMotorProprio: false,
    });
  });

  it("TJRJ", () => {
    const r = parseCnjTribunal("0001234-12.2023.8.19.0001");
    expect(r?.codigoTribunal).toBe("tjrj");
    expect(r?.uf).toBe("RJ");
  });

  it("TJMG", () => {
    expect(parseCnjTribunal("0001234-12.2024.8.13.0001")?.uf).toBe("MG");
  });

  it("TJRS", () => {
    expect(parseCnjTribunal("0001234-12.2024.8.23.0001")?.uf).toBe("RS");
  });

  it("TJDF", () => {
    expect(parseCnjTribunal("0001234-12.2024.8.07.0001")?.uf).toBe("DF");
  });

  it("código de TJ inexistente (28) retorna null", () => {
    expect(parseCnjTribunal("0001234-12.2024.8.28.0001")).toBeNull();
  });

  it("cobre todos os 27 TJs (AC..TO)", () => {
    const ufs = [
      ["01", "AC"], ["02", "AL"], ["03", "AP"], ["04", "AM"], ["05", "BA"],
      ["06", "CE"], ["07", "DF"], ["08", "ES"], ["09", "GO"], ["10", "MA"],
      ["11", "MT"], ["12", "MS"], ["13", "MG"], ["14", "PA"], ["15", "PB"],
      ["16", "PR"], ["17", "PE"], ["18", "PI"], ["19", "RJ"], ["20", "RN"],
      ["21", "RO"], ["22", "RR"], ["23", "RS"], ["24", "SC"], ["25", "SE"],
      ["26", "SP"], ["27", "TO"],
    ];
    for (const [code, uf] of ufs) {
      const cnj = `0001234-12.2024.8.${code}.0001`;
      const r = parseCnjTribunal(cnj);
      expect(r, `CNJ ${cnj} (esperava UF=${uf})`).not.toBeNull();
      expect(r?.uf).toBe(uf);
      expect(r?.segmento).toBe("estadual");
    }
  });
});

describe("parseCnjTribunal — Justiça do Trabalho (TRT)", () => {
  it("TRT-7 (CE)", () => {
    const r = parseCnjTribunal("0001234-12.2024.5.07.0001");
    expect(r).toMatchObject({
      codigoTribunal: "trt7",
      siglaTribunal: "TRT-7",
      segmento: "trabalhista",
      uf: null, // TRT não mapeia UF (cobre múltiplos estados)
      temMotorProprio: false,
    });
  });

  it("TRT-2 (SP capital)", () => {
    expect(parseCnjTribunal("0001234-12.2024.5.02.0001")?.codigoTribunal).toBe("trt2");
  });

  it("TRT-24 (MS) — último válido", () => {
    expect(parseCnjTribunal("0001234-12.2024.5.24.0001")?.codigoTribunal).toBe("trt24");
  });

  it("TRT 00 e 25+ retornam shape genérico (sem mapping)", () => {
    // J=5, TR=25 não é TRT válido (1-24). Cai no fallback genérico.
    const r = parseCnjTribunal("0001234-12.2024.5.25.0001");
    expect(r?.codigoTribunal).toBe("j5_tr25");
    expect(r?.temMotorProprio).toBe(false);
  });
});

describe("parseCnjTribunal — Justiça Federal (TRF)", () => {
  it("TRF-5 (NE)", () => {
    const r = parseCnjTribunal("0001234-12.2024.4.05.0001");
    expect(r).toMatchObject({
      codigoTribunal: "trf5",
      siglaTribunal: "TRF-5",
      segmento: "federal",
      uf: null,
    });
  });

  it("TRF-1 (DF e norte)", () => {
    expect(parseCnjTribunal("0001234-12.2024.4.01.0001")?.codigoTribunal).toBe("trf1");
  });

  it("TRF-6 (MG — criado em 2022)", () => {
    expect(parseCnjTribunal("0001234-12.2024.4.06.0001")?.codigoTribunal).toBe("trf6");
  });

  it("TRF-7 não existe (cai genérico)", () => {
    expect(parseCnjTribunal("0001234-12.2024.4.07.0001")?.codigoTribunal).toBe("j4_tr07");
  });
});

describe("parseCnjTribunal — outros segmentos (sem motor próprio)", () => {
  it("STF (J=1)", () => {
    const r = parseCnjTribunal("0001234-12.2024.1.00.0001");
    expect(r?.segmento).toBe("superior");
    expect(r?.temMotorProprio).toBe(false);
  });

  it("STJ (J=3)", () => {
    expect(parseCnjTribunal("0001234-12.2024.3.00.0001")?.segmento).toBe("superior");
  });

  it("Justiça Eleitoral (J=6)", () => {
    expect(parseCnjTribunal("0001234-12.2024.6.07.0001")?.segmento).toBe("eleitoral");
  });

  it("Justiça Militar União (J=7)", () => {
    expect(parseCnjTribunal("0001234-12.2024.7.00.0001")?.segmento).toBe("militar");
  });

  it("Justiça Militar Estadual (J=9)", () => {
    expect(parseCnjTribunal("0001234-12.2024.9.13.0001")?.segmento).toBe("militar_estadual");
  });
});

describe("parseCnjTribunal — formato de entrada", () => {
  it("aceita CNJ com máscara", () => {
    expect(parseCnjTribunal("3024938-55.2026.8.06.0001")?.codigoTribunal).toBe("tjce");
  });

  it("aceita CNJ só dígitos", () => {
    expect(parseCnjTribunal("30249385520268060001")?.codigoTribunal).toBe("tjce");
  });

  it("aceita CNJ com espaços e máscara mista", () => {
    expect(parseCnjTribunal(" 3024938-55.2026.8.06.0001 ")?.codigoTribunal).toBe("tjce");
  });

  it("rejeita CNJ com menos de 20 dígitos", () => {
    expect(parseCnjTribunal("123")).toBeNull();
    expect(parseCnjTribunal("123456789012345678")).toBeNull();
  });

  it("rejeita CNJ com mais de 20 dígitos", () => {
    expect(parseCnjTribunal("302493855202680600015")).toBeNull();
  });

  it("rejeita string vazia", () => {
    expect(parseCnjTribunal("")).toBeNull();
  });

  it("rejeita só caracteres não-numéricos (vira string vazia)", () => {
    expect(parseCnjTribunal("---...")).toBeNull();
  });
});

describe("sistemaCofrePorTribunal", () => {
  it("TJCE → pje_tjce", () => {
    expect(sistemaCofrePorTribunal("tjce")).toBe("pje_tjce");
  });

  it("TJSP → esaj_tjsp (sistema ESAJ, não PJe)", () => {
    expect(sistemaCofrePorTribunal("tjsp")).toBe("esaj_tjsp");
  });

  it("TJRJ → pje_tjrj", () => {
    expect(sistemaCofrePorTribunal("tjrj")).toBe("pje_tjrj");
  });

  it("TJMG → pje_tjmg", () => {
    expect(sistemaCofrePorTribunal("tjmg")).toBe("pje_tjmg");
  });

  it("Lote 1 (TJs PJe-PDPJ) mapeia cada estado pro próprio sistema cofre", () => {
    // Garantia anti-regressão: nunca pode cair em pje_tjce ou wildcard.
    expect(sistemaCofrePorTribunal("tjrn")).toBe("pje_tjrn");
    expect(sistemaCofrePorTribunal("tjma")).toBe("pje_tjma");
    expect(sistemaCofrePorTribunal("tjpa")).toBe("pje_tjpa");
    expect(sistemaCofrePorTribunal("tjro")).toBe("pje_tjro");
    expect(sistemaCofrePorTribunal("tjpe")).toBe("pje_tjpe");
    expect(sistemaCofrePorTribunal("tjpb")).toBe("pje_tjpb");
    expect(sistemaCofrePorTribunal("tjmt")).toBe("pje_tjmt");
    expect(sistemaCofrePorTribunal("tjrr")).toBe("pje_tjrr");
  });

  it("TJDF (CNJ) → pje_tjdft (cofre tem sigla histórica com T)", () => {
    expect(sistemaCofrePorTribunal("tjdf")).toBe("pje_tjdft");
  });

  it("Tribunal sem mapping retorna null", () => {
    expect(sistemaCofrePorTribunal("trt7")).toBeNull();
    expect(sistemaCofrePorTribunal("desconhecido")).toBeNull();
  });
});

describe("conveniences", () => {
  it("extrairCodigoTribunal devolve string ou null", () => {
    expect(extrairCodigoTribunal("3024938-55.2026.8.06.0001")).toBe("tjce");
    expect(extrairCodigoTribunal("invalido")).toBeNull();
  });

  it("temAdapterMotorProprio é true só pra tribunais implementados", () => {
    expect(temAdapterMotorProprio("3024938-55.2026.8.06.0001")).toBe(true); // TJCE
    expect(temAdapterMotorProprio("1000123-45.2024.8.26.0100")).toBe(false); // TJSP
    expect(temAdapterMotorProprio("0001234-12.2024.5.07.0001")).toBe(false); // TRT-7
    expect(temAdapterMotorProprio("invalido")).toBe(false);
  });
});

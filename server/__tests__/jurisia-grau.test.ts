import { describe, expect, it } from "vitest";
import {
  avisoDeNatureza,
  contarNatureza,
  naturezaDoGrau,
  type ComposicaoNatureza,
} from "../../shared/jurisia-grau";

describe("naturezaDoGrau", () => {
  it("trata colegiado como jurisprudência", () => {
    expect(naturezaDoGrau("G2")).toBe("jurisprudencia");
    expect(naturezaDoGrau("2")).toBe("jurisprudencia");
    expect(naturezaDoGrau("SUP")).toBe("jurisprudencia");
    expect(naturezaDoGrau("STJ")).toBe("jurisprudencia");
    expect(naturezaDoGrau("TR")).toBe("jurisprudencia");
  });

  it("trata juiz singular como estatística", () => {
    expect(naturezaDoGrau("G1")).toBe("estatistica");
    expect(naturezaDoGrau("1")).toBe("estatistica");
    expect(naturezaDoGrau("JE")).toBe("estatistica");
  });

  it("aceita a forma descritiva além do código", () => {
    expect(naturezaDoGrau("Segundo Grau")).toBe("jurisprudencia");
    expect(naturezaDoGrau("2º grau")).toBe("jurisprudencia");
    expect(naturezaDoGrau("Tribunal Superior")).toBe("jurisprudencia");
    expect(naturezaDoGrau("Primeiro Grau")).toBe("estatistica");
    expect(naturezaDoGrau("Juizado Especial")).toBe("estatistica");
  });

  it("não confunde turma recursal numerada com primeiro grau", () => {
    // O "1" de "1ª Turma Recursal" cairia como G1 se o teste de colegiado não
    // viesse antes — e turma recursal é acórdão.
    expect(naturezaDoGrau("1ª Turma Recursal")).toBe("jurisprudencia");
    expect(naturezaDoGrau("2ª Turma Recursal")).toBe("jurisprudencia");
  });

  it("devolve null pro que não reconhece, em vez de chutar", () => {
    expect(naturezaDoGrau(null)).toBeNull();
    expect(naturezaDoGrau(undefined)).toBeNull();
    expect(naturezaDoGrau("")).toBeNull();
    expect(naturezaDoGrau("   ")).toBeNull();
    expect(naturezaDoGrau("XYZ")).toBeNull();
  });
});

describe("contarNatureza", () => {
  it("soma cada grau no balde certo", () => {
    const c = contarNatureza([
      { grau: "G1", quantidade: 100 },
      { grau: "G2", quantidade: 30 },
      { grau: "TR", quantidade: 5 },
      { grau: "ZZZ", quantidade: 7 },
      { grau: null, quantidade: 3 },
    ]);
    expect(c).toEqual({ jurisprudencia: 35, estatistica: 100, indefinido: 10 });
  });

  it("ignora quantidade inválida em vez de propagar NaN", () => {
    const c = contarNatureza([
      { grau: "G2", quantidade: Number.NaN },
      { grau: "G1", quantidade: -5 },
      { grau: "G1", quantidade: 4.7 },
    ]);
    expect(c).toEqual({ jurisprudencia: 0, estatistica: 4, indefinido: 0 });
  });

  it("devolve tudo zerado pra lista vazia", () => {
    expect(contarNatureza([])).toEqual({ jurisprudencia: 0, estatistica: 0, indefinido: 0 });
  });
});

describe("avisoDeNatureza", () => {
  const c = (p: Partial<ComposicaoNatureza>): ComposicaoNatureza => ({
    jurisprudencia: 0,
    estatistica: 0,
    indefinido: 0,
    ...p,
  });

  it("cala a boca quando o recorte é todo de colegiado", () => {
    expect(avisoDeNatureza(c({ jurisprudencia: 40 }))).toBeNull();
  });

  it("cala a boca pro recorte vazio", () => {
    expect(avisoDeNatureza(c({}))).toBeNull();
  });

  it("avisa quando não há uma linha de jurisprudência", () => {
    const aviso = avisoDeNatureza(c({ estatistica: 200 }));
    expect(aviso).toContain("1º grau");
    expect(aviso).toContain("não é jurisprudência");
  });

  it("avisa quando o 1º grau domina mas não é tudo", () => {
    const aviso = avisoDeNatureza(c({ estatistica: 180, jurisprudencia: 20 }));
    expect(aviso).toBeTruthy();
    expect(aviso).toContain("maior parte");
  });

  it("não avisa de dominância quando o colegiado é maioria", () => {
    expect(avisoDeNatureza(c({ estatistica: 20, jurisprudencia: 180 }))).toBeNull();
  });

  it("avisa quando metade ou mais veio sem grau", () => {
    const aviso = avisoDeNatureza(c({ jurisprudencia: 10, indefinido: 10 }));
    expect(aviso).toContain("sem o grau informado");
  });
});

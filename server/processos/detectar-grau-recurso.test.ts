import { describe, it, expect } from "vitest";
import { detectarSubiuParaSegundoGrau } from "./detectar-grau-recurso";

const mov = (texto: string) => ({ texto });

describe("detectarSubiuParaSegundoGrau", () => {
  it("detecta remessa dos autos ao tribunal", () => {
    const r = detectarSubiuParaSegundoGrau([
      mov("Juntada de petição"),
      mov("Remetidos os autos ao Tribunal de Justiça"),
    ]);
    expect(r.subiu).toBe(true);
    expect(r.indicios.length).toBe(1);
  });

  it("detecta recurso de apelação (com acento — prova a normalização)", () => {
    expect(detectarSubiuParaSegundoGrau([mov("Interposto Recurso de Apelação")]).subiu).toBe(true);
  });

  it("detecta agravo de instrumento", () => {
    expect(detectarSubiuParaSegundoGrau([mov("Agravo de Instrumento nº 0000-00")]).subiu).toBe(true);
  });

  it("detecta relator/desembargador (sinais de 2º grau)", () => {
    expect(detectarSubiuParaSegundoGrau([mov("Conclusos ao Relator")]).subiu).toBe(true);
    expect(detectarSubiuParaSegundoGrau([mov("Decisão do Desembargador João")]).subiu).toBe(true);
  });

  it("NÃO dispara só com movimentações de 1º grau", () => {
    const r = detectarSubiuParaSegundoGrau([
      mov("Juntada de petição"),
      mov("Despacho"),
      mov("Decisão interlocutória"),
      mov("Audiência designada"),
      mov("Distribuído por sorteio à 3ª Vara Cível"),
    ]);
    expect(r.subiu).toBe(false);
    expect(r.indicios).toEqual([]);
  });

  it("lista vazia → não subiu", () => {
    expect(detectarSubiuParaSegundoGrau([]).subiu).toBe(false);
  });

  it("captura cada trecho como indício", () => {
    const r = detectarSubiuParaSegundoGrau([
      mov("Remessa dos autos ao Tribunal"),
      mov("Conclusos ao Relator"),
    ]);
    expect(r.subiu).toBe(true);
    expect(r.indicios.length).toBe(2);
  });

  it("ignora movimentações sem texto", () => {
    expect(detectarSubiuParaSegundoGrau([mov(""), mov("   ")]).subiu).toBe(false);
  });
});

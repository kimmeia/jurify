import { describe, expect, it } from "vitest";
import { detectarTransito } from "../../shared/datajud-transito";

const mov = (nome: string, dia: string) => ({ nome, dataHora: `${dia}T12:00:00.000Z` });

describe("detectarTransito", () => {
  it("acha o trânsito em julgado", () => {
    expect(
      detectarTransito([mov("Distribuição", "2022-01-10"), mov("Trânsito em julgado", "2024-05-20")]),
    ).toBe("2024-05-20T12:00:00.000Z");
  });

  it("aceita a grafia sem acento e em caixa alta", () => {
    expect(detectarTransito([mov("TRANSITO EM JULGADO", "2024-01-01")])).toBeTruthy();
    expect(detectarTransito([mov("Trânsito em Julgado", "2024-01-01")])).toBeTruthy();
  });

  it("fica com o último quando o processo transitou duas vezes", () => {
    // Rescisória reabre e transita de novo. A marca que vale é a recente.
    expect(
      detectarTransito([
        mov("Trânsito em julgado", "2020-03-01"),
        mov("Trânsito em julgado", "2024-09-15"),
      ]),
    ).toBe("2024-09-15T12:00:00.000Z");
  });

  it("não confunde movimentação de cartório com trânsito", () => {
    // "Baixa Definitiva" e "Definitivo" acontecem também em processo que não
    // transitou — são 3 milhões de ocorrências no STJ e virariam falso
    // positivo em massa.
    expect(
      detectarTransito([
        mov("Baixa Definitiva", "2024-01-01"),
        mov("Definitivo", "2024-02-01"),
        mov("Arquivado Definitivamente", "2024-03-01"),
        mov("Remessa", "2024-04-01"),
      ]),
    ).toBeNull();
  });

  it("devolve null quando não há trânsito", () => {
    expect(detectarTransito([mov("Distribuição", "2024-01-01")])).toBeNull();
    expect(detectarTransito([])).toBeNull();
  });

  it("aguenta movimento malformado", () => {
    const sujo = [
      { nome: null, dataHora: "2024-01-01T00:00:00.000Z" },
      { nome: "Trânsito em julgado", dataHora: null },
      { nome: "Trânsito em julgado", dataHora: "2024-06-01T00:00:00.000Z" },
    ] as never;
    expect(detectarTransito(sujo)).toBe("2024-06-01T00:00:00.000Z");
  });
});

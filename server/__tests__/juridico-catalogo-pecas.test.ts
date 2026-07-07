import { describe, it, expect } from "vitest";
import { CATALOGO_PECAS, formatarCatalogoParaPrompt } from "../juridico/catalogo-pecas";

describe("catálogo de peças", () => {
  it("cobre os tipos essenciais com estrutura e requisitos", () => {
    const ids = CATALOGO_PECAS.map((p) => p.id);
    for (const id of ["peticao_inicial", "contestacao", "embargos_declaracao", "apelacao", "agravo_instrumento", "agravo_interno"]) {
      expect(ids).toContain(id);
    }
    for (const p of CATALOGO_PECAS) {
      expect(p.estrutura.length).toBeGreaterThan(0);
      expect(p.requisitos.length).toBeGreaterThan(0);
    }
  });

  it("formata pro prompt com fundamento, estrutura e requisitos", () => {
    const txt = formatarCatalogoParaPrompt();
    expect(txt).toContain("Embargos de Declaração");
    expect(txt).toContain("art. 1.022 do CPC");
    expect(txt).toContain("Estrutura:");
    expect(txt).toContain("Exige:");
    expect(txt).toContain("prazo 5 dias úteis");
  });
});

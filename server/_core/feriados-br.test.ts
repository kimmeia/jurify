import { describe, expect, it } from "vitest";
import { calcularPascoa, feriadosNacionaisBR } from "./feriados-br";

// Datas conferidas com calendário litúrgico — se o Computus quebrar (typo
// em constante, off-by-one em mês), esses asserts dão luz vermelha
// imediatamente em vez de oferecer dia de feriado pro cliente.
describe("calcularPascoa", () => {
  const casos: Array<[number, string]> = [
    [2024, "2024-03-31"],
    [2025, "2025-04-20"],
    [2026, "2026-04-05"],
    [2027, "2027-03-28"],
    [2030, "2030-04-21"],
  ];
  for (const [ano, esperado] of casos) {
    it(`${ano} → ${esperado}`, () => {
      const p = calcularPascoa(ano);
      const iso = `${p.getUTCFullYear()}-${String(p.getUTCMonth() + 1).padStart(2, "0")}-${String(p.getUTCDate()).padStart(2, "0")}`;
      expect(iso).toBe(esperado);
    });
  }
});

describe("feriadosNacionaisBR", () => {
  it("retorna os 12 feriados nacionais com Carnaval/Sexta Santa/Corpus derivados", () => {
    // Em 2026: Páscoa 05/04 → Carnaval 17/02, Sexta Santa 03/04, Corpus 04/06
    const f = feriadosNacionaisBR(2026);
    expect(f).toHaveLength(12);
    const map = new Map(f.map((x) => [x.motivo, x.data]));
    expect(map.get("Confraternização Universal")).toBe("2026-01-01");
    expect(map.get("Carnaval")).toBe("2026-02-17");
    expect(map.get("Sexta-feira Santa")).toBe("2026-04-03");
    expect(map.get("Tiradentes")).toBe("2026-04-21");
    expect(map.get("Corpus Christi")).toBe("2026-06-04");
    expect(map.get("Consciência Negra")).toBe("2026-11-20");
    expect(map.get("Natal")).toBe("2026-12-25");
  });
});

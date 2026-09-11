/**
 * Trava o formato brasileiro de dinheiro.
 *
 * O caso real: o Dashboard mostrava `R$ 10.700,00` e o Financeiro mostrava
 * `R$ 10.7k` para o MESMO valor — com ponto decimal inglês, num produto
 * brasileiro. A causa era `(v / 1_000).toFixed(1)`, e `toFixed` sempre usa
 * ponto. A função estava copiada idêntica em dois arquivos, então o defeito
 * também estava.
 *
 * O teste existe para que a próxima pessoa que precisar abreviar dinheiro
 * não escreva `toFixed` de novo: o `Intl` já sabe fazer isso em pt-BR.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { moedaBR, moedaCurtaBR, numeroBR } from "../../shared/formato-numero";

/** O Node às vezes usa espaço estreito (U+202F/U+00A0) depois do "R$". */
const normal = (s: string) => s.replace(/ | /g, " ");

describe("formato de dinheiro em pt-BR", () => {
  it("escreve o valor cheio com vírgula decimal e ponto de milhar", () => {
    expect(normal(moedaBR(10700))).toBe("R$ 10.700,00");
    expect(normal(moedaBR(1234.5))).toBe("R$ 1.234,50");
    expect(normal(moedaBR(0))).toBe("R$ 0,00");
  });

  it("abrevia com VÍRGULA, nunca com ponto", () => {
    const curto = normal(moedaCurtaBR(10700));
    expect(curto).toContain("10,7");
    expect(curto, "ponto decimal é inglês — foi o defeito original").not.toContain("10.7");
    expect(curto).not.toMatch(/\dk\b/);
  });

  it("não abrevia abaixo de mil — esconderia os centavos sem economizar espaço", () => {
    expect(normal(moedaCurtaBR(840.5))).toBe("R$ 840,50");
    expect(normal(moedaCurtaBR(-999))).toBe("-R$ 999,00");
  });

  it("abrevia milhão também pelo Intl", () => {
    const m = normal(moedaCurtaBR(2_400_000));
    expect(m).toContain("2,4");
    expect(m).not.toContain("2.4");
  });

  it("aguenta valor inválido sem quebrar a tela", () => {
    expect(normal(moedaBR(NaN))).toBe("R$ 0,00");
    expect(normal(moedaCurtaBR(Infinity))).toBe("R$ 0,00");
  });

  it("numeroBR sai sem símbolo, para tabela que já tem coluna R$", () => {
    expect(numeroBR(1234.5)).toBe("1.234,50");
    expect(numeroBR(1234.5, 0)).toBe("1.235");
  });

  it("as telas não voltam a dividir por mil na mão", () => {
    // Era assim que nascia o "R$ 10.7k". Se reaparecer, é aqui que acusa.
    const raiz = join(__dirname, "..", "..", "client", "src");
    for (const rel of ["pages/financeiro/helpers.tsx", "pages/dashboards/common.tsx"]) {
      const src = readFileSync(join(raiz, rel), "utf8");
      expect(src, `${rel} voltou a abreviar dinheiro na mão`).not.toMatch(/\/ *1_?000\)[^)]*toFixed/);
      expect(src, `${rel} precisa usar o formatador compartilhado`).toContain("@shared/formato-numero");
    }
  });
});

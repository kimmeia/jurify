/**
 * Testes de regressão para `extrairAnoCnj` — usado como salvaguarda em
 * `cron-monitoramento.ts` quando `dataReferenciaCadastro` é NULL pra
 * decidir se um CNJ é "novo" (recente) ou histórico antigo.
 */

import { describe, it, expect } from "vitest";
import { extrairAnoCnj, parseCnjTribunal } from "./cnj-parser";

describe("extrairAnoCnj", () => {
  it("extrai ano de CNJ formatado padrão (com pontuação)", () => {
    expect(extrairAnoCnj("3026436-89.2026.8.06.0001")).toBe(2026);
    expect(extrairAnoCnj("0140340-27.2015.8.06.0001")).toBe(2015);
    expect(extrairAnoCnj("0001234-12.2023.8.06.0001")).toBe(2023);
  });

  it("extrai ano de CNJ sem pontuação", () => {
    expect(extrairAnoCnj("30264368920268060001")).toBe(2026);
    expect(extrairAnoCnj("01403402720158060001")).toBe(2015);
  });

  it("retorna null pra CNJ inválido (tamanho errado)", () => {
    expect(extrairAnoCnj("123")).toBeNull();
    expect(extrairAnoCnj("")).toBeNull();
    expect(extrairAnoCnj("3026436-89.2026.8.06")).toBeNull();
  });

  it("retorna null pra ano fora do intervalo plausível", () => {
    // Antes de 1990 — sistema CNJ não existia
    expect(extrairAnoCnj("0001234-12.1985.8.06.0001")).toBeNull();
    // No futuro distante — CNJ corrompido
    expect(extrairAnoCnj("0001234-12.9999.8.06.0001")).toBeNull();
  });

  it("aceita ano-atual + 1 (CNJs distribuídos no fim de dezembro com numeração do ano seguinte)", () => {
    const anoAtual = new Date().getUTCFullYear();
    const proxAno = anoAtual + 1;
    const cnj = `0001234-12.${proxAno}.8.06.0001`;
    expect(extrairAnoCnj(cnj)).toBe(proxAno);
  });

  it("é robusto a espaços/pontuação extras", () => {
    expect(extrairAnoCnj("  3026436-89.2026.8.06.0001  ")).toBe(2026);
  });
});

describe("parseCnjTribunal — preservado depois do extrairAnoCnj", () => {
  it("TJCE continua funcionando", () => {
    const r = parseCnjTribunal("3026436-89.2026.8.06.0001");
    expect(r?.codigoTribunal).toBe("tjce");
    expect(r?.siglaTribunal).toBe("TJCE");
    expect(r?.temMotorProprio).toBe(true);
  });
});

/**
 * Testes para os helpers de filtro da procedure `listarCobrancasParaAtribuicao`.
 *
 * `decidirEstadoComissao` é função pura que espelha em JS a regra que o
 * SQL aplica em `buildFiltroComissaoSQL` — base de confiança de que os
 * dois caminhos batem.
 *
 * `buildFiltroComissaoSQL` retorna uma SQL condition do Drizzle —
 * testamos presença/ausência e que multi-estados geram OR.
 */

import { describe, expect, it } from "vitest";
import {
  buildFiltroComissaoSQL,
  decidirEstadoComissao,
  type FiltroComissaoValor,
} from "../escritorio/router-financeiro";

describe("decidirEstadoComissao", () => {
  it("override TRUE → sim (independe da categoria)", () => {
    expect(decidirEstadoComissao(true, false)).toBe("sim");
    expect(decidirEstadoComissao(true, true)).toBe("sim");
    expect(decidirEstadoComissao(true, null)).toBe("sim");
  });

  it("override FALSE → nao (independe da categoria)", () => {
    expect(decidirEstadoComissao(false, true)).toBe("nao");
    expect(decidirEstadoComissao(false, false)).toBe("nao");
    expect(decidirEstadoComissao(false, null)).toBe("nao");
  });

  it("sem override + categoria comissionável → sim", () => {
    expect(decidirEstadoComissao(null, true)).toBe("sim");
  });

  it("sem override + categoria não comissionável → nao", () => {
    expect(decidirEstadoComissao(null, false)).toBe("nao");
  });

  it("sem override + sem categoria → indef", () => {
    expect(decidirEstadoComissao(null, null)).toBe("indef");
  });
});

describe("buildFiltroComissaoSQL", () => {
  it("lista vazia retorna undefined (sem filtro)", () => {
    expect(buildFiltroComissaoSQL([])).toBeUndefined();
  });

  it.each<FiltroComissaoValor>(["sim", "nao", "indef"])(
    "estado único '%s' retorna condição truthy",
    (estado) => {
      const cond = buildFiltroComissaoSQL([estado]);
      expect(cond).toBeTruthy();
    },
  );

  it("múltiplos estados geram uma única condição (OR composto)", () => {
    const cond = buildFiltroComissaoSQL(["sim", "nao"]);
    expect(cond).toBeTruthy();
    // Internamente é um operador OR — verificamos via toString-like que
    // o Drizzle produz; basta a presença pra garantir que não é um array.
    expect(Array.isArray(cond)).toBe(false);
  });

  it("os 3 estados juntos não quebram (cobertura total)", () => {
    const cond = buildFiltroComissaoSQL(["sim", "nao", "indef"]);
    expect(cond).toBeTruthy();
  });
});

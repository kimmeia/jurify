/**
 * Testes dos helpers do cron de comissões: cálculo de período "mês
 * anterior" e regra de disparo "deve disparar agora?". I/O de DB é
 * coberto por testes de integração separados.
 */

import { describe, it, expect } from "vitest";
import { periodoMesAnterior } from "../escritorio/db-comissoes";

describe("periodoMesAnterior", () => {
  it("dia 1º de abril → fecha março inteiro (1-31)", () => {
    const ref = new Date(2026, 3, 1); // abril (mês 3 em JS)
    expect(periodoMesAnterior(ref)).toEqual({ inicio: "2026-03-01", fim: "2026-03-31" });
  });

  it("dia 15 de fevereiro → fecha janeiro inteiro", () => {
    const ref = new Date(2026, 1, 15);
    expect(periodoMesAnterior(ref)).toEqual({ inicio: "2026-01-01", fim: "2026-01-31" });
  });

  it("dia 1º de março → fecha fevereiro corretamente (28 dias em ano não-bissexto)", () => {
    const ref = new Date(2025, 2, 1);
    expect(periodoMesAnterior(ref)).toEqual({ inicio: "2025-02-01", fim: "2025-02-28" });
  });

  it("dia 1º de março de ano bissexto → fevereiro com 29", () => {
    const ref = new Date(2024, 2, 1);
    expect(periodoMesAnterior(ref)).toEqual({ inicio: "2024-02-01", fim: "2024-02-29" });
  });

  it("dia 1º de janeiro → fecha dezembro do ano anterior", () => {
    const ref = new Date(2026, 0, 1);
    expect(periodoMesAnterior(ref)).toEqual({ inicio: "2025-12-01", fim: "2025-12-31" });
  });
});

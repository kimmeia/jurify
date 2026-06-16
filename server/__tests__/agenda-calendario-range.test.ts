/**
 * Testes — intervalo da grade do calendário (rangeGradeCalendario).
 * Garante que o range cobre o mês inteiro (incl. dias futuros), evitando o bug
 * em que o calendário escondia eventos futuros por estourar o teto da query.
 */
import { describe, it, expect } from "vitest";
import { rangeGradeCalendario } from "../../shared/escritorio-types";

describe("rangeGradeCalendario", () => {
  it("junho/2026 (1ª = segunda) vai do domingo anterior ao sábado seguinte", () => {
    const r = rangeGradeCalendario(new Date(2026, 5, 1));
    expect(r.inicio).toBe("2026-05-31");
    expect(r.fim).toBe("2026-07-04");
  });

  it("inclui dias futuros do mês (ex.: 17/06) — o que sumia no bug", () => {
    const r = rangeGradeCalendario(new Date(2026, 5, 1));
    expect(r.inicio <= "2026-06-17" && "2026-06-17" <= r.fim).toBe(true);
  });

  it("mês que começa no domingo (março/2026) começa no próprio dia 1", () => {
    const r = rangeGradeCalendario(new Date(2026, 2, 1));
    expect(r.inicio).toBe("2026-03-01");
    expect(r.fim).toBe("2026-04-04");
  });

  it("o range sempre cobre o mês inteiro, independente do dia passado", () => {
    const r = rangeGradeCalendario(new Date(2026, 5, 15));
    expect(r.inicio <= "2026-06-01").toBe(true);
    expect("2026-06-30" <= r.fim).toBe(true);
  });
});

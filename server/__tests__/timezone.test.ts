import { describe, it, expect } from "vitest";
import {
  partsInTz,
  zonedWallTimeToUtc,
  diaCivilNoTz,
  inicioDoDiaNoTz,
  diasCivisEntre,
  FUSOS_BR,
} from "../../shared/timezone";

// ─── partsInTz ───────────────────────────────────────────────────────────────

describe("partsInTz", () => {
  it("lê componentes civis em America/Sao_Paulo (GMT-3)", () => {
    // 2026-04-22 02:30:00 UTC = 2026-04-21 23:30:00 em Sao_Paulo
    const dt = new Date("2026-04-22T02:30:00Z");
    expect(partsInTz(dt, "America/Sao_Paulo")).toEqual({
      y: 2026, mo: 4, d: 21, h: 23, mi: 30, s: 0,
    });
  });

  it("lê componentes civis em UTC (identidade)", () => {
    const dt = new Date("2026-04-22T00:01:00Z");
    expect(partsInTz(dt, "UTC")).toEqual({
      y: 2026, mo: 4, d: 22, h: 0, mi: 1, s: 0,
    });
  });

  it("normaliza meia-noite quando runtime devolve '24' como hour", () => {
    // 2026-04-22 00:00:00 UTC = 2026-04-21 21:00:00 Sao_Paulo — só valida
    // que não há hour=24 no resultado.
    const dt = new Date("2026-04-22T00:00:00Z");
    const p = partsInTz(dt, "America/Sao_Paulo");
    expect(p.h).toBeGreaterThanOrEqual(0);
    expect(p.h).toBeLessThan(24);
  });

  it("America/Noronha é GMT-2 — 02:30 UTC = 00:30 local", () => {
    const dt = new Date("2026-04-22T02:30:00Z");
    expect(partsInTz(dt, "America/Noronha")).toEqual({
      y: 2026, mo: 4, d: 22, h: 0, mi: 30, s: 0,
    });
  });
});

// ─── zonedWallTimeToUtc ──────────────────────────────────────────────────────

describe("zonedWallTimeToUtc", () => {
  it("00:01 em Sao_Paulo (GMT-3) vira 03:01 UTC", () => {
    const dt = zonedWallTimeToUtc(2026, 4, 22, 0, 1, 0, "America/Sao_Paulo");
    expect(dt.toISOString()).toBe("2026-04-22T03:01:00.000Z");
  });

  it("09:00 em Manaus (GMT-4) vira 13:00 UTC", () => {
    const dt = zonedWallTimeToUtc(2026, 4, 22, 9, 0, 0, "America/Manaus");
    expect(dt.toISOString()).toBe("2026-04-22T13:00:00.000Z");
  });

  it("00:01 em UTC vira 00:01 UTC (identidade)", () => {
    const dt = zonedWallTimeToUtc(2026, 4, 22, 0, 1, 0, "UTC");
    expect(dt.toISOString()).toBe("2026-04-22T00:01:00.000Z");
  });

  it("sobrevive a fuso com DST (America/New_York fora do horário de verão, GMT-5)", () => {
    // 2026-02-01 10:00 Nova York (inverno, EST) = 15:00 UTC.
    const dt = zonedWallTimeToUtc(2026, 2, 1, 10, 0, 0, "America/New_York");
    expect(dt.toISOString()).toBe("2026-02-01T15:00:00.000Z");
  });

  it("sobrevive a DST (America/New_York durante horário de verão, GMT-4)", () => {
    // 2026-07-15 10:00 Nova York (verão, EDT) = 14:00 UTC.
    const dt = zonedWallTimeToUtc(2026, 7, 15, 10, 0, 0, "America/New_York");
    expect(dt.toISOString()).toBe("2026-07-15T14:00:00.000Z");
  });

  it("ida e volta: partsInTz ∘ zonedWallTimeToUtc = identidade", () => {
    const tz = "America/Sao_Paulo";
    const utc = zonedWallTimeToUtc(2026, 4, 22, 14, 35, 0, tz);
    const parts = partsInTz(utc, tz);
    expect(parts).toEqual({ y: 2026, mo: 4, d: 22, h: 14, mi: 35, s: 0 });
  });
});

// ─── diaCivilNoTz ────────────────────────────────────────────────────────────

describe("diaCivilNoTz", () => {
  it("01:30 UTC é véspera em Sao_Paulo (GMT-3)", () => {
    const dt = new Date("2026-04-22T01:30:00Z");
    expect(diaCivilNoTz(dt, "America/Sao_Paulo")).toBe("2026-04-21");
  });

  it("04:00 UTC já virou o dia em Sao_Paulo (01:00 local)", () => {
    const dt = new Date("2026-04-22T04:00:00Z");
    expect(diaCivilNoTz(dt, "America/Sao_Paulo")).toBe("2026-04-22");
  });

  it("em UTC, 01:30 Z segue sendo o dia 22", () => {
    const dt = new Date("2026-04-22T01:30:00Z");
    expect(diaCivilNoTz(dt, "UTC")).toBe("2026-04-22");
  });
});

// ─── inicioDoDiaNoTz ─────────────────────────────────────────────────────────

describe("inicioDoDiaNoTz", () => {
  it("meia-noite de Sao_Paulo (22-abr) é 03:00 UTC", () => {
    // Qualquer instante do dia 22 em BRT deve retornar o mesmo 03:00 UTC.
    const meioDiaBrt = new Date("2026-04-22T15:00:00Z"); // 12:00 BRT
    expect(inicioDoDiaNoTz(meioDiaBrt, "America/Sao_Paulo").toISOString()).toBe(
      "2026-04-22T03:00:00.000Z",
    );
  });

  it("meia-noite UTC de 22-abr é a própria data em UTC", () => {
    const dt = new Date("2026-04-22T15:00:00Z");
    expect(inicioDoDiaNoTz(dt, "UTC").toISOString()).toBe("2026-04-22T00:00:00.000Z");
  });
});

// ─── diasCivisEntre ──────────────────────────────────────────────────────────

describe("diasCivisEntre", () => {
  it("22 abr 01:00 UTC - 21 abr (venc) = 0 dias em Sao_Paulo (ambos dia 21 local)", () => {
    const a = new Date("2026-04-22T01:00:00Z");
    const b = new Date("2026-04-21T03:00:00Z"); // meia-noite BRT de 21-abr
    expect(diasCivisEntre(a, b, "America/Sao_Paulo")).toBe(0);
  });

  it("22 abr 04:00 UTC (01:00 BRT de 22) - 21 abr (venc) = 1 dia em Sao_Paulo", () => {
    const a = new Date("2026-04-22T04:00:00Z");
    const b = new Date("2026-04-21T03:00:00Z");
    expect(diasCivisEntre(a, b, "America/Sao_Paulo")).toBe(1);
  });

  it("em UTC, 22 abr 01:00 - 21 abr 00:00 = 1 dia", () => {
    const a = new Date("2026-04-22T01:00:00Z");
    const b = new Date("2026-04-21T00:00:00Z");
    expect(diasCivisEntre(a, b, "UTC")).toBe(1);
  });
});

// ─── FUSOS_BR ────────────────────────────────────────────────────────────────

describe("FUSOS_BR", () => {
  it("contém Sao_Paulo, Fortaleza e Manaus", () => {
    const values = FUSOS_BR.map((f) => f.value);
    expect(values).toContain("America/Sao_Paulo");
    expect(values).toContain("America/Fortaleza");
    expect(values).toContain("America/Manaus");
  });

  it("todos os fusos são válidos em Intl", () => {
    for (const f of FUSOS_BR) {
      expect(() => new Intl.DateTimeFormat("en-CA", { timeZone: f.value })).not.toThrow();
    }
  });
});

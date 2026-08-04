import { describe, it, expect } from "vitest";
import { horaLocalEm, diaRefEmTz } from "./cron-resumo-diario";

describe("horaLocalEm", () => {
  it("converte UTC para a hora local do escritório", () => {
    // 10:00 UTC = 07:00 em São Paulo (UTC-3)
    const t = new Date("2026-08-04T10:00:00Z");
    expect(horaLocalEm("America/Sao_Paulo", t)).toBe(7);
    // Manaus é UTC-4 — é exatamente o caso que um cron fixo em UTC erraria
    expect(horaLocalEm("America/Manaus", t)).toBe(6);
    expect(horaLocalEm("UTC", t)).toBe(10);
  });

  it("meia-noite local não vira 24", () => {
    // 03:00 UTC = 00:00 em São Paulo
    expect(horaLocalEm("America/Sao_Paulo", new Date("2026-08-04T03:00:00Z"))).toBe(0);
  });

  it("fuso inválido no cadastro não derruba o cron dos outros", () => {
    const t = new Date("2026-08-04T10:00:00Z");
    expect(horaLocalEm("Fuso/Inexistente", t)).toBe(10);
  });
});

describe("diaRefEmTz", () => {
  it("usa o dia local, não o do servidor", () => {
    // 02:00 UTC do dia 5 ainda é dia 4 em São Paulo
    expect(diaRefEmTz("America/Sao_Paulo", new Date("2026-08-05T02:00:00Z"))).toBe("2026-08-04");
    expect(diaRefEmTz("UTC", new Date("2026-08-05T02:00:00Z"))).toBe("2026-08-05");
  });

  it("fuso inválido cai no dia UTC em vez de quebrar", () => {
    expect(diaRefEmTz("Fuso/Inexistente", new Date("2026-08-05T02:00:00Z"))).toBe("2026-08-05");
  });
});

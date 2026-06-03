/**
 * Testes do helper `rotuloDataConversa()` — rótulo de separador de data no
 * chat, observado no fuso do escritório.
 *
 * O ponto sensível é a virada de dia: ela tem que seguir o relógio do
 * operador no fuso configurado, não o UTC do server (Railway roda em UTC).
 * Uma mensagem das 23h BRT é "Ontem", não "Hoje", só porque já passou da
 * meia-noite em UTC. `agora` é injetado pra deixar o teste determinístico.
 */

import { describe, it, expect } from "vitest";
import { rotuloDataConversa } from "../../shared/escritorio-types";

const SP = "America/Sao_Paulo";

describe("rotuloDataConversa", () => {
  it("mesmo dia civil no fuso → 'Hoje'", () => {
    const agora = new Date("2026-06-03T12:00:00Z"); // 09h BRT, dia 3
    expect(rotuloDataConversa("2026-06-03T13:30:00Z", SP, agora)).toBe("Hoje");
  });

  it("dia civil anterior → 'Ontem'", () => {
    const agora = new Date("2026-06-03T12:00:00Z");
    expect(rotuloDataConversa("2026-06-02T18:00:00Z", SP, agora)).toBe("Ontem");
  });

  it("23h BRT que já virou em UTC continua 'Ontem' (não 'Hoje')", () => {
    // 03 jun 02:00 UTC = 02 jun 23:00 BRT. Visto do dia 3 → "Ontem".
    const agora = new Date("2026-06-03T12:00:00Z"); // dia 3 em BRT
    expect(rotuloDataConversa("2026-06-03T02:00:00Z", SP, agora)).toBe("Ontem");
  });

  it("mensagem das 23h BRT vista ainda no mesmo dia → 'Hoje'", () => {
    // Mesmo instante UTC, mas 'agora' também no dia 2 em BRT.
    const agora = new Date("2026-06-03T01:00:00Z"); // 02 jun 22h BRT
    expect(rotuloDataConversa("2026-06-03T02:00:00Z", SP, agora)).toBe("Hoje");
  });

  it("dias mais antigos no mesmo ano → data por extenso, capitalizada e sem ano", () => {
    const agora = new Date("2026-06-03T12:00:00Z");
    const r = rotuloDataConversa("2026-05-20T15:00:00Z", SP, agora); // qua, 20 mai
    expect(r.startsWith("Quarta-feira")).toBe(true); // capitalizado
    expect(r).toContain("20 de maio");
    expect(r).not.toContain("2026"); // ano corrente omitido
  });

  it("ano diferente → inclui o ano", () => {
    const agora = new Date("2026-06-03T12:00:00Z");
    const r = rotuloDataConversa("2025-12-10T15:00:00Z", SP, agora);
    expect(r).toContain("10 de dezembro");
    expect(r).toContain("2025");
  });

  it("respeita fuso custom (Manaus, UTC-4)", () => {
    // 03 jun 02:00 UTC = 02 jun 22:00 em Manaus → "Ontem" visto do dia 3.
    const agora = new Date("2026-06-03T12:00:00Z");
    expect(rotuloDataConversa("2026-06-03T02:00:00Z", "America/Manaus", agora)).toBe("Ontem");
  });
});

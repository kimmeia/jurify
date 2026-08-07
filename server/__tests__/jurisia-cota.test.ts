import { describe, it, expect } from "vitest";
import { avaliarCota, competenciaDe } from "../../shared/jurisia-cota";

describe("competenciaDe", () => {
  it("usa o fuso do escritório, não UTC", () => {
    // 31/08 às 22h em Fortaleza (UTC-3) já é 01/09 em UTC. Se a competência
    // saísse de UTC, a cota do escritório viraria um dia antes.
    const virada = new Date("2026-09-01T01:00:00Z");
    expect(competenciaDe(virada, "America/Fortaleza")).toBe("2026-08");
    expect(competenciaDe(virada, "UTC")).toBe("2026-09");
  });

  it("meio do mês é trivial e continua trivial", () => {
    expect(competenciaDe(new Date("2026-08-15T12:00:00Z"), "America/Sao_Paulo")).toBe("2026-08");
  });

  it("virada de ano não vira '2026-13'", () => {
    expect(competenciaDe(new Date("2027-01-01T05:00:00Z"), "America/Sao_Paulo")).toBe("2027-01");
  });
});

describe("avaliarCota", () => {
  it("plano sem JurisIA é 'semPlano', não 'acabou'", () => {
    // A tela oferece upgrade num caso e espera o mês virar no outro — não
    // dá pra tratar os dois como o mesmo bloqueio.
    const c = avaliarCota({ limite: 0, usadas: 0 });
    expect(c.pode).toBe(false);
    expect(c.semPlano).toBe(true);
  });

  it("cota disponível libera", () => {
    const c = avaliarCota({ limite: 40, usadas: 24 });
    expect(c).toMatchObject({ pode: true, restantes: 16, semPlano: false });
  });

  it("cota no limite bloqueia sem virar negativo", () => {
    expect(avaliarCota({ limite: 40, usadas: 40 })).toMatchObject({ pode: false, restantes: 0 });
  });

  it("uso acima do limite não devolve restante negativo", () => {
    // Acontece quando o plano é rebaixado no meio do mês.
    expect(avaliarCota({ limite: 10, usadas: 25 })).toMatchObject({ pode: false, restantes: 0 });
  });

  it("valor sujo no banco não vira cota infinita", () => {
    expect(avaliarCota({ limite: NaN, usadas: 3 }).limite).toBe(0);
    expect(avaliarCota({ limite: 10, usadas: NaN }).usadas).toBe(0);
    expect(avaliarCota({ limite: -5, usadas: 0 }).limite).toBe(0);
  });
});

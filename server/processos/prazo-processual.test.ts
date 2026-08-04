import { describe, it, expect } from "vitest";
import {
  contarPrazoProcessual,
  ehDiaUtil,
  emRecessoForense,
  diasUteisAte,
} from "./prazo-processual";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (x: Date) => x.toISOString().slice(0, 10);

describe("ehDiaUtil", () => {
  it("sábado e domingo não são úteis", () => {
    expect(ehDiaUtil(d("2026-08-08"))).toBe(false); // sábado
    expect(ehDiaUtil(d("2026-08-09"))).toBe(false); // domingo
    expect(ehDiaUtil(d("2026-08-10"))).toBe(true); // segunda
  });

  it("feriado nacional fixo não é útil", () => {
    expect(ehDiaUtil(d("2026-09-07"))).toBe(false); // Independência (segunda)
    expect(ehDiaUtil(d("2026-05-01"))).toBe(false); // Dia do Trabalho (sexta)
  });

  it("feriado móvel derivado da Páscoa não é útil", () => {
    // Páscoa 2026 = 05/04 → Sexta-feira Santa = 03/04
    expect(ehDiaUtil(d("2026-04-03"))).toBe(false);
  });

  it("feriado local extra é respeitado", () => {
    const extras = new Set(["2026-08-15"]);
    expect(ehDiaUtil(d("2026-08-14"), extras)).toBe(true);
    // 15/08/2026 é sábado; usa uma data útil pra provar o efeito do extra
    expect(ehDiaUtil(d("2026-08-14"), new Set(["2026-08-14"]))).toBe(false);
  });
});

describe("emRecessoForense", () => {
  it("cobre 20/12 a 20/01 inclusive nas duas pontas", () => {
    expect(emRecessoForense(d("2026-12-19"))).toBe(false);
    expect(emRecessoForense(d("2026-12-20"))).toBe(true);
    expect(emRecessoForense(d("2026-12-31"))).toBe(true);
    expect(emRecessoForense(d("2027-01-01"))).toBe(true);
    expect(emRecessoForense(d("2027-01-20"))).toBe(true);
    expect(emRecessoForense(d("2027-01-21"))).toBe(false);
  });
});

describe("contarPrazoProcessual", () => {
  it("15 dias úteis a partir de intimação numa segunda", () => {
    // Caso real do painel: intimação 27/07/2026 (segunda).
    const r = contarPrazoProcessual(d("2026-07-27"), 15, true);
    expect(iso(r.inicio)).toBe("2026-07-28");
    expect(iso(r.vencimento)).toBe("2026-08-17");
    expect(r.fundamentos).toContain("art. 219 do CPC (dias úteis)");
  });

  it("exclui o dia do começo", () => {
    // 1 dia útil a partir de segunda vence na própria terça, não na segunda.
    const r = contarPrazoProcessual(d("2026-08-10"), 1, true);
    expect(iso(r.vencimento)).toBe("2026-08-11");
  });

  it("intimação na sexta começa a contar na segunda", () => {
    const r = contarPrazoProcessual(d("2026-08-07"), 5, true);
    expect(iso(r.inicio)).toBe("2026-08-10");
    expect(iso(r.vencimento)).toBe("2026-08-14");
  });

  it("intimação no sábado é considerada feita na segunda (art. 224, §1º)", () => {
    const r = contarPrazoProcessual(d("2026-08-08"), 5, true);
    expect(r.fundamentos).toContain("art. 224, §1º, do CPC");
    expect(r.observacoes.some((o) => o.includes("sem expediente"))).toBe(true);
    // Intimação eficaz 10/08 (seg) → início 11/08 → 5 úteis → 17/08
    expect(iso(r.inicio)).toBe("2026-08-11");
    expect(iso(r.vencimento)).toBe("2026-08-17");
  });

  it("pula feriado nacional no meio da contagem", () => {
    // 07/09/2026 (Independência) cai numa segunda.
    const r = contarPrazoProcessual(d("2026-09-02"), 5, true);
    // início 03/09(1), 04(2), 07 é feriado, 08(3), 09(4), 10(5)
    expect(iso(r.vencimento)).toBe("2026-09-10");
  });

  it("prazo em dias corridos conta fim de semana mas prorroga o vencimento", () => {
    // 5 corridos a partir de 05/08/2026 (quarta): início 06, vence 10 (segunda)
    const r = contarPrazoProcessual(d("2026-08-05"), 5, false);
    expect(iso(r.inicio)).toBe("2026-08-06");
    // 06(1) 07(2) 08sáb(3) 09dom(4) 10(5) → 10/08 é segunda, dia útil
    expect(iso(r.vencimento)).toBe("2026-08-10");
    expect(r.fundamentos).not.toContain("art. 219 do CPC (dias úteis)");
  });

  it("vencimento em dia sem expediente é prorrogado", () => {
    // 2 corridos a partir de 06/08/2026 (quinta): 07(1) 08sáb(2) → prorroga p/ 10
    const r = contarPrazoProcessual(d("2026-08-06"), 2, false);
    expect(iso(r.vencimento)).toBe("2026-08-10");
    expect(r.observacoes.some((o) => o.includes("prorrogado"))).toBe(true);
  });

  it("recesso forense suspende a contagem", () => {
    // Intimação 15/12/2026 (terça): início 16/12. 10 úteis atravessando o recesso.
    const r = contarPrazoProcessual(d("2026-12-15"), 10, true);
    expect(r.fundamentos).toContain("art. 220 do CPC");
    expect(r.observacoes.some((o) => o.includes("recesso"))).toBe(true);
    // 16,17,18 = 3 dias; recesso engole 20/12–20/01; retoma em 21/01/2027 (qui)
    // 21(4) 22(5) 25(6) 26(7) 27(8) 28(9) 29(10)
    expect(iso(r.vencimento)).toBe("2027-01-29");
  });

  it("intimação dentro do recesso só começa a contar depois dele", () => {
    const r = contarPrazoProcessual(d("2026-12-28"), 5, true);
    expect(r.inicio.getTime()).toBeGreaterThan(d("2027-01-20").getTime());
  });

  it("feriado local extra entra na conta", () => {
    const semExtra = contarPrazoProcessual(d("2026-08-10"), 3, true);
    const comExtra = contarPrazoProcessual(d("2026-08-10"), 3, true, ["2026-08-12"]);
    expect(iso(semExtra.vencimento)).toBe("2026-08-13");
    expect(iso(comExtra.vencimento)).toBe("2026-08-14");
  });

  it("sempre avisa que feriado local e suspensão não estão cobertos", () => {
    const r = contarPrazoProcessual(d("2026-08-10"), 5, true);
    expect(r.observacoes.some((o) => o.includes("confira antes de peticionar"))).toBe(true);
  });
});

describe("diasUteisAte", () => {
  it("conta os dias úteis que faltam", () => {
    // de 04/08/2026 (ter) até 17/08 (seg)
    expect(diasUteisAte(d("2026-08-17"), d("2026-08-04"))).toBe(9);
  });

  it("mesmo dia é zero", () => {
    expect(diasUteisAte(d("2026-08-04"), d("2026-08-04"))).toBe(0);
  });

  it("prazo vencido devolve negativo", () => {
    expect(diasUteisAte(d("2026-07-30"), d("2026-08-04"))).toBeLessThan(0);
  });

  it("não conta feriado no intervalo", () => {
    // 04/09/2026 (sex) → 08/09 (ter), com 07/09 feriado: sáb, dom e feriado fora
    expect(diasUteisAte(d("2026-09-08"), d("2026-09-04"))).toBe(1);
  });
});

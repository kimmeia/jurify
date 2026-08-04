import { describe, it, expect } from "vitest";
import { montarPrazoSugerido } from "./aplicar-analise";
import type { AnaliseMovimentacao } from "./resumir-movimentacao";

const base: AnaliseMovimentacao = {
  titulo: "Tutela deferida em parte",
  pontos: [],
  ato: "decisao",
  desfecho: "parcial",
  relevancia: "relevante",
  providencia: {
    exigida: true,
    descricao: "Juntar extrato do benefício (5 anos)",
    prazoDias: 15,
    prazoUteis: true,
    dataExplicita: null,
    consequencia: "preclusão",
    citacao: "Junte a parte autora, no prazo de 15 (quinze) dias úteis, o extrato integral.",
  },
};

const comProvidencia = (p: Partial<AnaliseMovimentacao["providencia"]>): AnaliseMovimentacao => ({
  ...base,
  providencia: { ...base.providencia, ...p },
});

const intimacao = new Date("2026-07-27T00:00:00Z");
const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("montarPrazoSugerido", () => {
  it("calcula o vencimento pelo CPC e explica a conta", () => {
    const p = montarPrazoSugerido(base, intimacao)!;
    expect(p.tipo).toBe("prazo_processual");
    expect(iso(p.dataSugerida)).toBe("2026-08-17");
    expect(p.prazoDias).toBe(15);
    expect(p.prazoUteis).toBe(true);
    expect(p.motivo).toContain("15 dias úteis");
    expect(p.motivo).toContain("sob pena de preclusão");
    expect(p.motivo).toContain("art. 219");
    expect(p.trechoOrigem).toContain("Junte a parte autora");
  });

  it("não sugere nada quando o prazo não é nosso", () => {
    expect(montarPrazoSugerido(comProvidencia({ exigida: false }), intimacao)).toBeNull();
  });

  it("não inventa data quando não há prazo nem data no documento", () => {
    expect(
      montarPrazoSugerido(comProvidencia({ prazoDias: null, dataExplicita: null }), intimacao),
    ).toBeNull();
  });

  it("data explícita manda e vira audiência quando o ato é audiência", () => {
    const analise: AnaliseMovimentacao = {
      ...base,
      ato: "audiencia",
      providencia: {
        ...base.providencia,
        descricao: "Audiência de conciliação por videoconferência",
        prazoDias: null,
        dataExplicita: "2026-09-09",
        consequencia: "ato atentatório à dignidade da justiça",
      },
    };
    const p = montarPrazoSugerido(analise, intimacao)!;
    expect(p.tipo).toBe("audiencia");
    expect(iso(p.dataSugerida)).toBe("2026-09-09");
    expect(p.prazoDias).toBeNull();
    expect(p.motivo).toContain("Data designada");
    expect(p.motivo).toContain("ato atentatório");
  });

  it("data explícita num ato que não é audiência vira prazo processual", () => {
    const p = montarPrazoSugerido(
      { ...base, ato: "despacho", providencia: { ...base.providencia, prazoDias: null, dataExplicita: "2026-09-09" } },
      intimacao,
    )!;
    expect(p.tipo).toBe("prazo_processual");
  });

  it("prazo em dias corridos usa a contagem corrida", () => {
    const p = montarPrazoSugerido(
      comProvidencia({ prazoDias: 5, prazoUteis: false }),
      new Date("2026-08-05T00:00:00Z"),
    )!;
    expect(iso(p.dataSugerida)).toBe("2026-08-10");
    expect(p.motivo).toContain("5 dias corridos");
  });

  it("feriado local do escritório entra na conta", () => {
    const sem = montarPrazoSugerido(comProvidencia({ prazoDias: 3 }), new Date("2026-08-10T00:00:00Z"))!;
    const com = montarPrazoSugerido(comProvidencia({ prazoDias: 3 }), new Date("2026-08-10T00:00:00Z"), [
      "2026-08-12",
    ])!;
    expect(iso(sem.dataSugerida)).toBe("2026-08-13");
    expect(iso(com.dataSugerida)).toBe("2026-08-14");
  });

  it("recesso forense aparece no motivo pro advogado conferir", () => {
    const p = montarPrazoSugerido(comProvidencia({ prazoDias: 10 }), new Date("2026-12-15T00:00:00Z"))!;
    expect(p.motivo).toContain("recesso");
    expect(p.motivo).toContain("art. 220");
  });

  it("usa o título da análise quando a providência não tem descrição", () => {
    const p = montarPrazoSugerido(comProvidencia({ descricao: null }), intimacao)!;
    expect(p.titulo).toBe("Tutela deferida em parte");
  });

  it("data explícita malformada não vira prazo", () => {
    expect(
      montarPrazoSugerido(
        comProvidencia({ prazoDias: null, dataExplicita: "09/09/2026" }),
        intimacao,
      ),
    ).toBeNull();
  });

  it("motivo é truncado para caber na coluna", () => {
    const p = montarPrazoSugerido(
      comProvidencia({ consequencia: "x".repeat(2000) }),
      intimacao,
    )!;
    expect(p.motivo.length).toBeLessThanOrEqual(1000);
  });
});

import { describe, it, expect } from "vitest";
import { parseAnalise } from "./resumir-movimentacao";

const completo = {
  titulo: "Tutela deferida em parte — e o juiz mandou você juntar os extratos",
  pontos: [
    "Deferiu a suspensão dos descontos, com multa de R$ 200/dia.",
    "Indeferiu por ora a devolução em dobro, por falta de prova.",
  ],
  ato: "decisao",
  desfecho: "parcial",
  relevancia: "relevante",
  providencia: {
    exigida: true,
    descricao: "Juntar extrato integral do benefício dos últimos 5 anos",
    prazoDias: 15,
    prazoUteis: true,
    dataExplicita: null,
    consequencia: "preclusão",
    citacao: "Junte a parte autora, no prazo de 15 (quinze) dias úteis, o extrato integral do benefício.",
  },
};

describe("parseAnalise", () => {
  it("lê o JSON completo", () => {
    const a = parseAnalise(JSON.stringify(completo))!;
    expect(a.titulo).toContain("Tutela deferida");
    expect(a.pontos).toHaveLength(2);
    expect(a.ato).toBe("decisao");
    expect(a.desfecho).toBe("parcial");
    expect(a.providencia.exigida).toBe(true);
    expect(a.providencia.prazoDias).toBe(15);
    expect(a.providencia.citacao).toContain("Junte a parte autora");
  });

  it("tolera crases e texto ao redor", () => {
    const raw = "Claro! Aqui está:\n```json\n" + JSON.stringify(completo) + "\n```";
    expect(parseAnalise(raw)?.titulo).toContain("Tutela deferida");
  });

  it("devolve null quando não há JSON", () => {
    expect(parseAnalise("desculpe, não consegui analisar")).toBeNull();
  });

  it("devolve null com JSON quebrado", () => {
    expect(parseAnalise('{"titulo": "x", "pontos": [}')).toBeNull();
  });

  it("devolve null sem título — sem manchete o card não tem o que mostrar", () => {
    expect(parseAnalise(JSON.stringify({ ...completo, titulo: "   " }))).toBeNull();
  });

  it("ato desconhecido vira 'outro' em vez de vazar pro banco", () => {
    expect(parseAnalise(JSON.stringify({ ...completo, ato: "penhora" }))!.ato).toBe("outro");
  });

  it("desfecho inválido vira null", () => {
    expect(parseAnalise(JSON.stringify({ ...completo, desfecho: "ótimo" }))!.desfecho).toBeNull();
  });

  it("relevância só é rotina quando dito explicitamente", () => {
    expect(parseAnalise(JSON.stringify({ ...completo, relevancia: "rotina" }))!.relevancia).toBe("rotina");
    expect(parseAnalise(JSON.stringify({ ...completo, relevancia: "meio" }))!.relevancia).toBe("relevante");
  });

  it("limita a 4 pontos e descarta entrada não-texto", () => {
    const a = parseAnalise(
      JSON.stringify({ ...completo, pontos: ["a", "b", "c", "d", "e", 42, null, "  "] }),
    )!;
    expect(a.pontos).toEqual(["a", "b", "c", "d"]);
  });

  it("pontos ausente vira lista vazia", () => {
    expect(parseAnalise(JSON.stringify({ ...completo, pontos: undefined }))!.pontos).toEqual([]);
  });

  describe("providência — o campo que não pode errar", () => {
    it("prazo em dias úteis é o default do CPC quando a IA não afirma o contrário", () => {
      const a = parseAnalise(
        JSON.stringify({ ...completo, providencia: { ...completo.providencia, prazoUteis: undefined } }),
      )!;
      expect(a.providencia.prazoUteis).toBe(true);
    });

    it("respeita dias corridos quando afirmado", () => {
      const a = parseAnalise(
        JSON.stringify({ ...completo, providencia: { ...completo.providencia, prazoUteis: false } }),
      )!;
      expect(a.providencia.prazoUteis).toBe(false);
    });

    it("exigida só é true com true literal", () => {
      for (const v of ["true", 1, "sim", null, undefined]) {
        const a = parseAnalise(
          JSON.stringify({ ...completo, providencia: { ...completo.providencia, exigida: v } }),
        )!;
        expect(a.providencia.exigida, String(v)).toBe(false);
      }
    });

    it("providência sem prazo, sem data e sem descrição é desligada", () => {
      const a = parseAnalise(
        JSON.stringify({
          ...completo,
          providencia: { exigida: true, descricao: null, prazoDias: null, dataExplicita: null },
        }),
      )!;
      // Acenderia a faixa "você tem prazo" sem ter o que fazer.
      expect(a.providencia.exigida).toBe(false);
    });

    it("providência com só a data explícita continua valendo (audiência)", () => {
      const a = parseAnalise(
        JSON.stringify({
          ...completo,
          providencia: {
            exigida: true,
            descricao: null,
            prazoDias: null,
            dataExplicita: "2026-09-09",
            citacao: null,
          },
        }),
      )!;
      expect(a.providencia.exigida).toBe(true);
      expect(a.providencia.dataExplicita).toBe("2026-09-09");
    });

    it("prazo fora de faixa plausível é descartado", () => {
      for (const v of [0, -5, 900, 3.7e3, "15", null]) {
        const a = parseAnalise(
          JSON.stringify({ ...completo, providencia: { ...completo.providencia, prazoDias: v } }),
        )!;
        expect(a.providencia.prazoDias, String(v)).toBeNull();
      }
    });

    it("prazo fracionário é arredondado", () => {
      const a = parseAnalise(
        JSON.stringify({ ...completo, providencia: { ...completo.providencia, prazoDias: 14.6 } }),
      )!;
      expect(a.providencia.prazoDias).toBe(15);
    });

    it("data inexistente no calendário é rejeitada", () => {
      for (const v of ["2026-02-30", "2026-13-01", "09/09/2026", "amanhã", ""]) {
        const a = parseAnalise(
          JSON.stringify({ ...completo, providencia: { ...completo.providencia, dataExplicita: v } }),
        )!;
        expect(a.providencia.dataExplicita, v).toBeNull();
      }
    });

    it("citação curta demais é descartada — não dá pra grifar 3 letras", () => {
      const a = parseAnalise(
        JSON.stringify({ ...completo, providencia: { ...completo.providencia, citacao: "Junte." } }),
      )!;
      expect(a.providencia.citacao).toBeNull();
    });

    it("providência ausente não quebra o parse", () => {
      const a = parseAnalise(JSON.stringify({ ...completo, providencia: undefined }))!;
      expect(a.providencia.exigida).toBe(false);
      expect(a.providencia.prazoDias).toBeNull();
    });
  });
});

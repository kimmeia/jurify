import { describe, expect, it } from "vitest";
import {
  detectarMarcadores,
  duracaoDias,
  formatarDuracao,
  mediana,
  montarPerfil,
  type EntradaPerfil,
} from "../../shared/jurisia-perfil";

const dia = (iso: string) => `${iso}T00:00:00.000Z`;

describe("duracaoDias", () => {
  it("conta os dias entre ajuizamento e desfecho", () => {
    expect(duracaoDias(dia("2023-01-01"), dia("2023-01-31"))).toBe(30);
    expect(duracaoDias(dia("2022-01-01"), dia("2023-01-01"))).toBe(365);
  });

  it("devolve null quando falta uma ponta", () => {
    expect(duracaoDias(null, dia("2023-01-01"))).toBeNull();
    expect(duracaoDias(dia("2023-01-01"), null)).toBeNull();
  });

  // Sentença antes do ajuizamento aparece em base de tribunal e não é duração
  // negativa — é dado sujo, e entrar na mediana como 0 já distorceria.
  it("descarta ordem impossível em vez de virar número negativo", () => {
    expect(duracaoDias(dia("2023-06-01"), dia("2023-01-01"))).toBeNull();
  });

  it("aguenta data inválida", () => {
    expect(duracaoDias("não é data", dia("2023-01-01"))).toBeNull();
  });
});

describe("mediana", () => {
  it("é o do meio no ímpar", () => {
    expect(mediana([10, 1, 5])).toBe(5);
  });

  it("interpola no par", () => {
    expect(mediana([10, 20, 30, 40])).toBe(25);
  });

  it("não se deixa levar pela cauda longa — que é o motivo de não usar média", () => {
    const valores = [300, 320, 340, 360, 20000];
    expect(mediana(valores)).toBe(340);
    const media = valores.reduce((s, n) => s + n, 0) / valores.length;
    expect(Math.round(media)).toBe(4264);
  });

  it("lista vazia não vira zero", () => {
    expect(mediana([])).toBeNull();
  });
});

describe("detectarMarcadores", () => {
  it("acha liminar e tutela nas várias formas", () => {
    expect(detectarMarcadores(["Concedida a Antecipação de tutela"]).has("liminar")).toBe(true);
    expect(detectarMarcadores(["Deferido pedido liminar"]).has("liminar")).toBe(true);
    expect(detectarMarcadores(["Tutela de urgência deferida"]).has("liminar")).toBe(true);
  });

  it("acha recurso nas espécies mais comuns", () => {
    expect(detectarMarcadores(["Interposta Apelação Cível"]).has("recurso")).toBe(true);
    expect(detectarMarcadores(["Agravo de Instrumento"]).has("recurso")).toBe(true);
    expect(detectarMarcadores(["Embargos de Declaração opostos"]).has("recurso")).toBe(true);
    expect(detectarMarcadores(["Recurso Especial admitido"]).has("recurso")).toBe(true);
  });

  it("acha perícia e audiência", () => {
    expect(detectarMarcadores(["Juntada de laudo pericial"]).has("pericia")).toBe(true);
    expect(detectarMarcadores(["Audiência de conciliação designada"]).has("audiencia")).toBe(true);
  });

  it("não marca o que não tem", () => {
    const m = detectarMarcadores(["Distribuído por sorteio", "Juntada de petição"]);
    expect(m.size).toBe(0);
  });

  it("conta um marcador uma vez só por processo, mesmo repetido", () => {
    const m = detectarMarcadores([
      "Interposta Apelação",
      "Apelação recebida",
      "Contrarrazões à Apelação",
    ]);
    expect([...m]).toEqual(["recurso"]);
  });
});

describe("montarPerfil", () => {
  const entrada = (over: Partial<EntradaPerfil> = {}): EntradaPerfil => ({
    ajuizamentoEm: dia("2022-01-01"),
    resultadoEm: dia("2023-01-01"),
    movimentos: [],
    ...over,
  });

  it("mede a mediana e a faixa central", () => {
    const p = montarPerfil(
      [
        entrada({ resultadoEm: dia("2022-04-01") }),
        entrada({ resultadoEm: dia("2022-07-01") }),
        entrada({ resultadoEm: dia("2022-10-01") }),
      ],
      500,
    );
    expect(p.medianaDias).toBe(181);
    expect(p.p25Dias).toBeLessThan(p.medianaDias!);
    expect(p.p75Dias).toBeGreaterThan(p.medianaDias!);
  });

  it("conta marcadores em percentual da amostra", () => {
    const p = montarPerfil(
      [
        entrada({ movimentos: ["Interposta Apelação"] }),
        entrada({ movimentos: ["Interposta Apelação", "Audiência realizada"] }),
        entrada({ movimentos: ["Juntada de petição"] }),
        entrada({ movimentos: ["Distribuído"] }),
      ],
      500,
    );
    const recurso = p.marcadores.find((m) => m.chave === "recurso")!;
    expect(recurso.quantidade).toBe(2);
    expect(recurso.percentual).toBe(50);
    const pericia = p.marcadores.find((m) => m.chave === "pericia")!;
    expect(pericia.quantidade).toBe(0);
    expect(pericia.percentual).toBe(0);
  });

  it("sempre devolve os quatro marcadores, mesmo zerados", () => {
    const p = montarPerfil([entrada()], 500);
    expect(p.marcadores.map((m) => m.chave)).toEqual([
      "liminar",
      "recurso",
      "pericia",
      "audiencia",
    ]);
  });

  // Um processo sem data de ajuizamento não pode sumir da contagem de
  // marcadores só porque não deu pra medir o tempo dele.
  it("separa o que não dá pra medir do que dá pra contar", () => {
    const p = montarPerfil(
      [
        entrada({ ajuizamentoEm: null, movimentos: ["Interposta Apelação"] }),
        entrada({ movimentos: ["Interposta Apelação"] }),
      ],
      500,
    );
    expect(p.amostra).toBe(2);
    expect(p.marcadores.find((m) => m.chave === "recurso")!.quantidade).toBe(2);
    expect(p.medianaDias).toBe(365);
  });

  it("amostra vazia não inventa mediana nem percentual", () => {
    const p = montarPerfil([], 500);
    expect(p.amostra).toBe(0);
    expect(p.medianaDias).toBeNull();
    expect(p.marcadores.every((m) => m.percentual === 0)).toBe(true);
  });
});

describe("formatarDuracao", () => {
  it("fala na unidade em que se pensa prazo de processo", () => {
    expect(formatarDuracao(580)).toBe("1 ano e 7 meses");
    expect(formatarDuracao(365)).toBe("1 ano");
    expect(formatarDuracao(200)).toBe("7 meses");
    expect(formatarDuracao(1100)).toBe("3 anos");
    expect(formatarDuracao(30)).toBe("30 dias");
    expect(formatarDuracao(1)).toBe("1 dia");
  });

  it("não finge duração quando não há", () => {
    expect(formatarDuracao(null)).toBe("—");
  });
});

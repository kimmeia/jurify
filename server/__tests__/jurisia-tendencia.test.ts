/**
 * O painel de tendência responde à pergunta que a média histórica não
 * responde: o que este recorte decide HOJE, e isso é o mesmo de antes?
 *
 * Os testes daqui protegem sobretudo os casos em que a resposta certa é
 * "não sei" — janela sem amostra, período anterior vazio. Afirmar virada de
 * entendimento em cima de três julgados é o erro que estraga o conselho.
 */

import { describe, it, expect } from "vitest";
import {
  corteDaJanela,
  frasearTendencia,
  montarTendencia,
  JANELA_RECENTE_MESES,
  MIN_AMOSTRA_TENDENCIA,
  PISO_MASSIVO,
} from "../../shared/jurisia-tendencia";

const DESDE = new Date("2024-08-10T00:00:00.000Z");

const entradas = (o: Record<string, number>) =>
  Object.entries(o).map(([rotulo, quantidade]) => ({ rotulo, quantidade }));

describe("corteDaJanela", () => {
  it("recua a quantidade de meses pedida", () => {
    const c = corteDaJanela(new Date("2026-08-10T00:00:00.000Z"), 24);
    expect(c.toISOString().slice(0, 10)).toBe("2024-08-10");
  });

  it("usa 24 meses por padrão", () => {
    const c = corteDaJanela(new Date("2026-08-10T00:00:00.000Z"));
    expect(c.toISOString().slice(0, 7)).toBe("2024-08");
    expect(JANELA_RECENTE_MESES).toBe(24);
  });
});

describe("montarTendencia — dominante", () => {
  it("elege o desfecho mais frequente da janela", () => {
    const t = montarTendencia({
      desde: DESDE,
      recente: entradas({ Provido: 10, "Não provido": 40, "Não conhecido": 50 }),
      anterior: entradas({ Provido: 5, "Não provido": 10, "Não conhecido": 60 }),
    });
    expect(t.dominanteRecente?.rotulo).toBe("Não conhecido");
    expect(t.dominanteRecente?.percentual).toBe(50);
    expect(t.recentes).toBe(100);
  });

  it("recorte sem nada decidido não tem dominante", () => {
    const t = montarTendencia({ desde: DESDE, recente: entradas({ Provido: 0 }), anterior: [] });
    expect(t.dominanteRecente).toBeNull();
    expect(t.amostraPequena).toBe(true);
  });

  it("empate resolve pela ordem canônica recebida, não por sorteio", () => {
    const a = montarTendencia({
      desde: DESDE,
      recente: entradas({ Provido: 20, "Não provido": 20 }),
      anterior: [],
    });
    const b = montarTendencia({
      desde: DESDE,
      recente: entradas({ Provido: 20, "Não provido": 20 }),
      anterior: [],
    });
    expect(a.dominanteRecente?.rotulo).toBe("Provido");
    expect(b.dominanteRecente?.rotulo).toBe(a.dominanteRecente?.rotulo);
  });
});

describe("montarTendencia — virada de entendimento", () => {
  it("acusa quando o dominante de hoje é outro", () => {
    const t = montarTendencia({
      desde: DESDE,
      recente: entradas({ Provido: 60, "Não provido": 40 }),
      anterior: entradas({ Provido: 20, "Não provido": 80 }),
    });
    expect(t.virou).toBe(true);
    expect(t.dominanteAnterior?.rotulo).toBe("Não provido");
    // "Provido" era 20% antes e é 60% agora.
    expect(t.deltaPp).toBe(40);
  });

  it("não acusa virada quando o dominante continua o mesmo", () => {
    const t = montarTendencia({
      desde: DESDE,
      recente: entradas({ Provido: 70, "Não provido": 30 }),
      anterior: entradas({ Provido: 55, "Não provido": 45 }),
    });
    expect(t.virou).toBe(false);
    expect(t.deltaPp).toBe(15);
  });

  it("período anterior sem base não vira virada — é estreia", () => {
    const t = montarTendencia({
      desde: DESDE,
      recente: entradas({ Provido: 30, "Não provido": 5 }),
      anterior: entradas({ "Não provido": 3 }),
    });
    expect(t.anteriores).toBeLessThan(MIN_AMOSTRA_TENDENCIA);
    expect(t.virou).toBe(false);
    expect(t.deltaPp).toBeNull();
  });

  it("janela recente vazia não afirma nada sobre hoje", () => {
    const t = montarTendencia({
      desde: DESDE,
      recente: [],
      anterior: entradas({ Provido: 80, "Não provido": 20 }),
    });
    expect(t.dominanteRecente).toBeNull();
    expect(t.virou).toBe(false);
    expect(t.massivo).toBe(false);
  });
});

describe("montarTendencia — massivo", () => {
  it("dominante acima do piso, com amostra, é massivo", () => {
    const t = montarTendencia({
      desde: DESDE,
      recente: entradas({ "Não conhecido": 80, Provido: 20 }),
      anterior: [],
    });
    expect(t.dominanteRecente?.percentual).toBeGreaterThanOrEqual(PISO_MASSIVO);
    expect(t.massivo).toBe(true);
  });

  it("maioria apertada não é massivo", () => {
    const t = montarTendencia({
      desde: DESDE,
      recente: entradas({ Provido: 52, "Não provido": 48 }),
      anterior: [],
    });
    expect(t.massivo).toBe(false);
  });

  it("percentual alto sobre punhado de casos não é massivo", () => {
    const t = montarTendencia({
      desde: DESDE,
      recente: entradas({ Provido: 4, "Não provido": 1 }),
      anterior: [],
    });
    expect(t.dominanteRecente?.percentual).toBe(80);
    expect(t.amostraPequena).toBe(true);
    expect(t.massivo).toBe(false);
  });
});

describe("frasearTendencia", () => {
  it("amostra pequena avisa em vez de afirmar tendência", () => {
    const t = montarTendencia({
      desde: DESDE,
      recente: entradas({ Provido: 3 }),
      anterior: entradas({ "Não provido": 50 }),
    });
    expect(frasearTendencia(t)).toMatch(/ainda não sustenta/i);
  });

  it("virada aparece na frase com o desfecho anterior", () => {
    const t = montarTendencia({
      desde: DESDE,
      recente: entradas({ Provido: 60, "Não provido": 40 }),
      anterior: entradas({ Provido: 20, "Não provido": 80 }),
    });
    const f = frasearTendencia(t)!;
    expect(f).toMatch(/virou/i);
    expect(f).toContain("provido");
  });

  it("recorte sem dominante não produz frase", () => {
    const t = montarTendencia({ desde: DESDE, recente: [], anterior: [] });
    expect(frasearTendencia(t)).toBeNull();
  });

  it("nenhuma frase carrega número — a trava do modelo recusaria", () => {
    const casos = [
      montarTendencia({
        desde: DESDE,
        recente: entradas({ "Não conhecido": 80, Provido: 20 }),
        anterior: entradas({ "Não conhecido": 70, Provido: 30 }),
      }),
      montarTendencia({
        desde: DESDE,
        recente: entradas({ Provido: 60, "Não provido": 40 }),
        anterior: entradas({ Provido: 20, "Não provido": 80 }),
      }),
      montarTendencia({
        desde: DESDE,
        recente: entradas({ Provido: 52, "Não provido": 48 }),
        anterior: [],
      }),
    ];
    for (const t of casos) {
      const f = frasearTendencia(t)!;
      // "últimos 24 meses" é o único número tolerado: descreve a janela, não
      // mede o acervo.
      expect(f.replace(/últimos \d+ meses/g, "")).not.toMatch(/\d/);
    }
  });
});

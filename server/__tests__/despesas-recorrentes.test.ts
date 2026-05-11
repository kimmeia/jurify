/**
 * Testes da geração automática de despesas recorrentes.
 *
 * Foco:
 *  - `avancarRecorrencia` puro: semanal/mensal/anual, casos de borda
 *    (fim de mês, ano bissexto, virada de ano)
 *  - `gerarFilhasDeModelo` com mock de DB: idempotência (não duplica),
 *    catch-up (gera múltiplas se cron ficou parado), limite de segurança
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { avancarRecorrencia } from "../escritorio/despesas-recorrentes";

describe("avancarRecorrencia — semanal", () => {
  it("avança 7 dias dentro do mesmo mês", () => {
    expect(avancarRecorrencia("2026-05-01", "semanal")).toBe("2026-05-08");
    expect(avancarRecorrencia("2026-05-10", "semanal")).toBe("2026-05-17");
  });

  it("atravessa fronteira de mês", () => {
    expect(avancarRecorrencia("2026-04-28", "semanal")).toBe("2026-05-05");
  });

  it("atravessa fronteira de ano", () => {
    expect(avancarRecorrencia("2025-12-28", "semanal")).toBe("2026-01-04");
  });
});

describe("avancarRecorrencia — mensal", () => {
  it("avança 1 mês dentro do ano", () => {
    expect(avancarRecorrencia("2026-05-15", "mensal")).toBe("2026-06-15");
  });

  it("preserva o dia exato quando possível", () => {
    expect(avancarRecorrencia("2026-03-01", "mensal")).toBe("2026-04-01");
    expect(avancarRecorrencia("2026-03-31", "mensal")).toBe("2026-04-30");
  });

  it("clamp pro último dia do mês: 31-jan vira 28-fev em ano não-bissexto", () => {
    expect(avancarRecorrencia("2025-01-31", "mensal")).toBe("2025-02-28");
  });

  it("clamp pro último dia do mês: 31-jan vira 29-fev em ano bissexto", () => {
    expect(avancarRecorrencia("2024-01-31", "mensal")).toBe("2024-02-29");
  });

  it("clamp 31-mar → 30-abr (abril não tem 31)", () => {
    expect(avancarRecorrencia("2026-03-31", "mensal")).toBe("2026-04-30");
  });

  it("atravessa virada de ano dezembro → janeiro", () => {
    expect(avancarRecorrencia("2025-12-15", "mensal")).toBe("2026-01-15");
  });

  it("dezembro → janeiro preservando dia limite", () => {
    expect(avancarRecorrencia("2025-12-31", "mensal")).toBe("2026-01-31");
  });
});

describe("avancarRecorrencia — anual", () => {
  it("avança 1 ano mantendo mês e dia", () => {
    expect(avancarRecorrencia("2026-05-15", "anual")).toBe("2027-05-15");
  });

  it("clamp: 29-fev em ano bissexto vira 28-fev no ano seguinte", () => {
    expect(avancarRecorrencia("2024-02-29", "anual")).toBe("2025-02-28");
  });

  it("não-bissexto → bissexto preserva 28-fev", () => {
    expect(avancarRecorrencia("2023-02-28", "anual")).toBe("2024-02-28");
  });

  it("avança várias vezes consistente com calendário", () => {
    let d = "2026-01-15";
    for (let i = 0; i < 5; i++) {
      d = avancarRecorrencia(d, "anual");
    }
    expect(d).toBe("2031-01-15");
  });
});

// ─── Testes de gerarFilhasDeModelo com mock de DB ─────────────────────────────

type Captured = {
  op: "select" | "insert";
  values?: any;
  where?: unknown;
};

let captured: Captured[] = [];
let selectQueue: unknown[][] = [];

function makeSelectBuilder() {
  const builder: any = {
    from() {
      return builder;
    },
    where(w: unknown) {
      captured.push({ op: "select", where: w });
      return builder;
    },
    orderBy() {
      return builder;
    },
    limit() {
      return Promise.resolve(selectQueue.shift() ?? []);
    },
    then: (r: (v: unknown) => unknown) => r(selectQueue.shift() ?? []),
  };
  return builder;
}

function makeInsertBuilder() {
  return {
    values(values: any) {
      captured.push({ op: "insert", values });
      return Promise.resolve([{ affectedRows: 1, insertId: 999 }]);
    },
  };
}

const mockDb = {
  select: () => ({ from: () => makeSelectBuilder() }),
  insert: () => makeInsertBuilder(),
};

vi.mock("../db", () => ({
  getDb: vi.fn(async () => mockDb),
}));

// Mock data: hoje fixo pra teste reprodutível
const HOJE_REAL = Date;
vi.useFakeTimers();
vi.setSystemTime(new Date("2026-05-11T12:00:00Z"));

import { gerarFilhasDeModelo } from "../escritorio/despesas-recorrentes";

const modeloMensal = {
  id: 1,
  escritorioId: 100,
  categoriaId: 5,
  descricao: "Aluguel",
  valor: "3000.00",
  vencimento: "2026-01-10",
  recorrencia: "mensal" as const,
  observacoes: null,
  criadoPorUserId: 7,
};

beforeEach(() => {
  captured = [];
  selectQueue = [];
});

describe("gerarFilhasDeModelo — catch-up", () => {
  it("gera filhas até alcançar hoje (modelo de janeiro, hoje em maio)", async () => {
    selectQueue.push([]); // SELECT filhas: nenhuma ainda

    const n = await gerarFilhasDeModelo(modeloMensal);

    // De 2026-01-10 → próximas: 02-10, 03-10, 04-10, 05-10 (todas <= hoje 2026-05-11)
    expect(n).toBe(4);
    const insertedDates = captured
      .filter((c) => c.op === "insert")
      .map((c) => c.values.vencimento);
    expect(insertedDates).toEqual([
      "2026-02-10",
      "2026-03-10",
      "2026-04-10",
      "2026-05-10",
    ]);
  });

  it("idempotência: filhas existentes não são recriadas", async () => {
    // Já existe filha de 2026-02-10 e 2026-03-10
    selectQueue.push([
      { id: 11, vencimento: "2026-02-10" },
      { id: 12, vencimento: "2026-03-10" },
    ]);

    const n = await gerarFilhasDeModelo(modeloMensal);

    // Deve continuar a partir da última (03-10) → 04-10 e 05-10
    expect(n).toBe(2);
    const inserted = captured.filter((c) => c.op === "insert");
    expect(inserted.map((c) => c.values.vencimento)).toEqual([
      "2026-04-10",
      "2026-05-10",
    ]);
  });

  it("nenhuma filha pendente: retorna 0", async () => {
    // Última filha em 2026-05-10 (já gerada). Próxima seria 06-10 (> hoje).
    selectQueue.push([{ id: 99, vencimento: "2026-05-10" }]);

    const n = await gerarFilhasDeModelo(modeloMensal);
    expect(n).toBe(0);
    expect(captured.filter((c) => c.op === "insert").length).toBe(0);
  });

  it("valores corretos nas filhas: status, origem, recorrenciaDeOrigemId", async () => {
    selectQueue.push([]);

    await gerarFilhasDeModelo(modeloMensal);

    const inserts = captured.filter((c) => c.op === "insert");
    for (const ins of inserts) {
      expect(ins.values.escritorioId).toBe(100);
      expect(ins.values.categoriaId).toBe(5);
      expect(ins.values.descricao).toBe("Aluguel");
      expect(ins.values.valor).toBe("3000.00");
      expect(ins.values.valorPago).toBe("0.00");
      expect(ins.values.status).toBe("pendente");
      expect(ins.values.recorrencia).toBe("mensal");
      expect(ins.values.recorrenciaAtiva).toBe(false); // filhas não disparam cron
      expect(ins.values.recorrenciaDeOrigemId).toBe(1);
      expect(ins.values.origem).toBe("recorrencia");
    }
  });
});

describe("gerarFilhasDeModelo — semanal", () => {
  it("modelo semanal gera múltiplas filhas em catch-up", async () => {
    selectQueue.push([]);
    const modelo = {
      ...modeloMensal,
      recorrencia: "semanal" as const,
      vencimento: "2026-05-01", // hoje = 2026-05-11
    };

    const n = await gerarFilhasDeModelo(modelo);

    // 05-01 → 05-08 (<=hoje) → 05-15 (>hoje, para)
    expect(n).toBe(1);
    expect(
      captured.filter((c) => c.op === "insert").map((c) => c.values.vencimento),
    ).toEqual(["2026-05-08"]);
  });
});

describe("gerarFilhasDeModelo — anual", () => {
  it("modelo anual com 3 anos passados gera 3 filhas", async () => {
    selectQueue.push([]);
    const modelo = {
      ...modeloMensal,
      recorrencia: "anual" as const,
      vencimento: "2023-05-01",
    };

    const n = await gerarFilhasDeModelo(modelo);

    // 2023-05-01 → 2024-05-01, 2025-05-01, 2026-05-01 (todas <= hoje 2026-05-11)
    expect(n).toBe(3);
  });
});

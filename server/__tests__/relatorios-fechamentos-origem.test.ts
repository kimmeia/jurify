/**
 * Testes — agruparFechamentosPorOrigem (drill-down de "Fechamentos por
 * origem" na tela de Relatórios + subtabelas do PDF comercial).
 */

import { describe, it, expect } from "vitest";
import { agruparFechamentosPorOrigem } from "../escritorio/router-relatorios";

const D1 = new Date("2026-06-01T12:00:00Z");
const D2 = new Date("2026-06-05T12:00:00Z");
const D3 = new Date("2026-06-09T12:00:00Z");

describe("agruparFechamentosPorOrigem", () => {
  it("agrupa por origem com total, soma e lista de fechamentos", () => {
    const out = agruparFechamentosPorOrigem([
      { origem: "Google (Revisional)", contatoId: 1, cliente: "Francisco", fechadoEm: D3, criadoEm: D1, valor: 7250, responsavel: "Vitória" },
      { origem: "Google (Revisional)", contatoId: 2, cliente: "Marly", fechadoEm: D2, criadoEm: D1, valor: 6000, responsavel: "Beatriz" },
      { origem: "Indicação", contatoId: 3, cliente: "Renan", fechadoEm: D1, criadoEm: D1, valor: 3000, responsavel: null },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ origem: "Google (Revisional)", total: 2, valorTotal: 13250 });
    expect(out[0].fechamentos).toHaveLength(2);
    expect(out[1]).toMatchObject({ origem: "Indicação", total: 1, valorTotal: 3000 });
  });

  it("ordena origens por total desc e fechamentos do mais recente pro mais antigo", () => {
    const out = agruparFechamentosPorOrigem([
      { origem: "A", contatoId: 1, cliente: "X", fechadoEm: D1, criadoEm: D1, valor: 1, responsavel: null },
      { origem: "B", contatoId: 2, cliente: "Y1", fechadoEm: D1, criadoEm: D1, valor: 1, responsavel: null },
      { origem: "B", contatoId: 3, cliente: "Y2", fechadoEm: D3, criadoEm: D1, valor: 1, responsavel: null },
    ]);
    expect(out.map((o) => o.origem)).toEqual(["B", "A"]);
    expect(out[0].fechamentos.map((f) => f.cliente)).toEqual(["Y2", "Y1"]);
  });

  it("fechadoEm nulo cai no criadoEm (leads pré-backfill 0134)", () => {
    const out = agruparFechamentosPorOrigem([
      { origem: "BNI", contatoId: 1, cliente: "Z", fechadoEm: null, criadoEm: D2, valor: 500, responsavel: "Pablo" },
    ]);
    expect(out[0].fechamentos[0].fechadoEm).toBe(D2.toISOString());
  });

  it("origem vazia/whitespace vira 'Sem origem'; valor string/nulo é tolerado", () => {
    const out = agruparFechamentosPorOrigem([
      { origem: "  ", contatoId: 1, cliente: "A", fechadoEm: D1, criadoEm: D1, valor: "1500" as any, responsavel: null },
      { origem: null, contatoId: 2, cliente: "B", fechadoEm: D1, criadoEm: D1, valor: null, responsavel: null },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ origem: "Sem origem", total: 2, valorTotal: 1500 });
  });

  it("lista vazia → []", () => {
    expect(agruparFechamentosPorOrigem([])).toEqual([]);
  });
});

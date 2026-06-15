/**
 * Testes — agregação de ligações pro relatório de atendimentos (puro).
 */
import { describe, it, expect } from "vitest";
import {
  agregarLigacoes,
  agregarLigacoesPorAtendente,
  agregarLigacoesPorDia,
} from "../escritorio/relatorio-ligacoes";

describe("agregarLigacoes", () => {
  it("classifica feitas/recebidas/perdidas/recusadas + duração e taxa", () => {
    const r = agregarLigacoes([
      { direcao: "saida", status: "encerrada", total: 100, durTotal: 18000 },
      { direcao: "saida", status: "perdida", total: 28, durTotal: 0 },
      { direcao: "entrada", status: "encerrada", total: 80, durTotal: 9600 },
      { direcao: "entrada", status: "perdida", total: 12, durTotal: 0 },
      { direcao: "entrada", status: "rejeitada", total: 2, durTotal: 0 },
    ]);
    expect(r.feitas).toBe(128);
    expect(r.feitasAtendidas).toBe(100);
    expect(r.recebidas).toBe(80);
    expect(r.perdidas).toBe(12);
    expect(r.recusadas).toBe(2);
    expect(r.taxaAtendimento).toBe(85); // 80 / 94
    expect(r.duracaoTotalSeg).toBe(27600); // 18000 + 9600
    expect(r.duracaoMediaSeg).toBe(153); // 27600 / 180 atendidas
  });

  it("sem ligações → taxa e média nulas", () => {
    const r = agregarLigacoes([]);
    expect(r.feitas).toBe(0);
    expect(r.taxaAtendimento).toBeNull();
    expect(r.duracaoMediaSeg).toBeNull();
  });

  it("em curso (em_andamento) não conta como resultado", () => {
    const r = agregarLigacoes([{ direcao: "entrada", status: "em_andamento", total: 3, durTotal: 0 }]);
    expect(r.recebidas).toBe(0);
    expect(r.perdidas).toBe(0);
    expect(r.taxaAtendimento).toBeNull();
  });
});

describe("agregarLigacoesPorAtendente", () => {
  it("agrupa por colaborador, ordena por volume e ignora chamadas sem atendente", () => {
    const linhas = agregarLigacoesPorAtendente(
      [
        { colabId: 1, direcao: "saida", status: "encerrada", total: 10, durTotal: 600 },
        { colabId: 1, direcao: "entrada", status: "encerrada", total: 5, durTotal: 300 },
        { colabId: 1, direcao: "entrada", status: "perdida", total: 1, durTotal: 0 },
        { colabId: 2, direcao: "saida", status: "encerrada", total: 40, durTotal: 2400 },
        { colabId: null, direcao: "entrada", status: "perdida", total: 9, durTotal: 0 },
      ],
      (id) => (id === 1 ? "Ana" : "Bruno"),
    );
    expect(linhas).toHaveLength(2);
    expect(linhas[0].nome).toBe("Bruno"); // 40 > 16
    expect(linhas[0].feitas).toBe(40);
    const ana = linhas.find((l) => l.colabId === 1)!;
    expect(ana.recebidas).toBe(5);
    expect(ana.perdidas).toBe(1);
    expect(ana.duracaoTotalSeg).toBe(900);
    expect(ana.taxaAtendimento).toBe(83); // 5 / 6
  });
});

describe("agregarLigacoesPorDia", () => {
  it("soma por dia (feitas/recebidas/perdidas) e ordena cronologicamente", () => {
    const dias = agregarLigacoesPorDia([
      { dia: "2026-06-02", direcao: "saida", status: "encerrada", total: 3 },
      { dia: "2026-06-01", direcao: "entrada", status: "encerrada", total: 2 },
      { dia: "2026-06-01", direcao: "entrada", status: "perdida", total: 1 },
      { dia: "2026-06-01", direcao: "saida", status: "perdida", total: 4 },
    ]);
    expect(dias.map((d) => d.dia)).toEqual(["2026-06-01", "2026-06-02"]);
    expect(dias[0]).toEqual({ dia: "2026-06-01", feitas: 4, recebidas: 2, perdidas: 1 });
    expect(dias[1]).toEqual({ dia: "2026-06-02", feitas: 3, recebidas: 0, perdidas: 0 });
  });
});

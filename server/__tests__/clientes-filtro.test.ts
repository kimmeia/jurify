/**
 * Testes — filtro/ordenação compartilhado da lista de Clientes do Financeiro.
 *
 * Esta lógica é a fonte única usada pela tela (client) e pelo PDF (server);
 * estes testes travam o contrato pra que o relatório reflita exatamente o
 * recorte exibido.
 */

import { describe, it, expect } from "vitest";
import {
  filtrarClientes,
  ordenarClientes,
  aplicarFiltrosClientes,
  defaultSortPorChip,
  type ClienteParaFiltro,
} from "../../shared/clientes-filtro";

function cli(p: Partial<ClienteParaFiltro> & { contatoNome: string }): ClienteParaFiltro {
  return {
    contatoNome: p.contatoNome,
    totalCobrancas: p.totalCobrancas ?? 0,
    pendente: p.pendente ?? 0,
    vencido: p.vencido ?? 0,
    pago: p.pago ?? 0,
    diasAtrasoMax: p.diasAtrasoMax ?? null,
  };
}

const lista: ClienteParaFiltro[] = [
  cli({ contatoNome: "Ana", totalCobrancas: 3, pendente: 100, vencido: 0, pago: 500, diasAtrasoMax: null }),
  cli({ contatoNome: "Bruno", totalCobrancas: 5, pendente: 0, vencido: 300, pago: 0, diasAtrasoMax: 40 }),
  cli({ contatoNome: "Carla", totalCobrancas: 2, pendente: 50, vencido: 200, pago: 0, diasAtrasoMax: 10 }),
  cli({ contatoNome: "Diego", totalCobrancas: 0, pendente: 0, vencido: 0, pago: 0, diasAtrasoMax: null }),
  cli({ contatoNome: "Elisa", totalCobrancas: 4, pendente: 0, vencido: 0, pago: 900, diasAtrasoMax: null }),
];

describe("filtrarClientes", () => {
  it("chip 'todos' não filtra", () => {
    expect(filtrarClientes(lista, { chip: "todos" })).toHaveLength(5);
  });

  it("chip 'inadimplentes' = só quem tem vencido > 0", () => {
    const r = filtrarClientes(lista, { chip: "inadimplentes" }).map((c) => c.contatoNome);
    expect(r.sort()).toEqual(["Bruno", "Carla"]);
  });

  it("chip 'pendente' = só quem tem pendente > 0", () => {
    const r = filtrarClientes(lista, { chip: "pendente" }).map((c) => c.contatoNome);
    expect(r.sort()).toEqual(["Ana", "Carla"]);
  });

  it("chip 'bons' = pago > 0 e sem vencido", () => {
    const r = filtrarClientes(lista, { chip: "bons" }).map((c) => c.contatoNome);
    expect(r.sort()).toEqual(["Ana", "Elisa"]);
  });

  it("chip 'sem_cobranca' = totalCobrancas === 0", () => {
    const r = filtrarClientes(lista, { chip: "sem_cobranca" }).map((c) => c.contatoNome);
    expect(r).toEqual(["Diego"]);
  });

  it("diasAtrasoMin filtra por atraso mínimo (ignora null)", () => {
    const r = filtrarClientes(lista, { chip: "todos", diasAtrasoMin: 30 }).map((c) => c.contatoNome);
    expect(r).toEqual(["Bruno"]);
  });

  it("diasAtrasoMin <= 0 ou nulo não filtra", () => {
    expect(filtrarClientes(lista, { chip: "todos", diasAtrasoMin: 0 })).toHaveLength(5);
    expect(filtrarClientes(lista, { chip: "todos", diasAtrasoMin: null })).toHaveLength(5);
  });

  it("combina chip + dias de atraso", () => {
    const r = filtrarClientes(lista, { chip: "inadimplentes", diasAtrasoMin: 30 }).map((c) => c.contatoNome);
    expect(r).toEqual(["Bruno"]);
  });
});

describe("defaultSortPorChip", () => {
  it("inadimplentes → atraso desc", () => {
    expect(defaultSortPorChip("inadimplentes")).toEqual({ col: "atraso", dir: "desc" });
  });
  it("pendente → pendente desc", () => {
    expect(defaultSortPorChip("pendente")).toEqual({ col: "pendente", dir: "desc" });
  });
  it("bons → pago desc", () => {
    expect(defaultSortPorChip("bons")).toEqual({ col: "pago", dir: "desc" });
  });
  it("todos/sem_cobranca → nome asc", () => {
    expect(defaultSortPorChip("todos")).toEqual({ col: "nome", dir: "asc" });
    expect(defaultSortPorChip("sem_cobranca")).toEqual({ col: "nome", dir: "asc" });
  });
});

describe("ordenarClientes", () => {
  it("sort=null usa o default do chip (inadimplentes = atraso desc)", () => {
    const venc = filtrarClientes(lista, { chip: "inadimplentes" });
    const r = ordenarClientes(venc, null, "inadimplentes").map((c) => c.contatoNome);
    expect(r).toEqual(["Bruno", "Carla"]); // 40 antes de 10
  });

  it("sort=null com chip 'todos' ordena por nome asc", () => {
    const r = ordenarClientes(lista, null, "todos").map((c) => c.contatoNome);
    expect(r).toEqual(["Ana", "Bruno", "Carla", "Diego", "Elisa"]);
  });

  it("sort explícito sobrepõe o default", () => {
    const r = ordenarClientes(lista, { col: "pago", dir: "desc" }, "todos").map((c) => c.contatoNome);
    expect(r[0]).toBe("Elisa"); // maior pago
  });

  it("não muta a lista original", () => {
    const copia = [...lista];
    ordenarClientes(lista, { col: "nome", dir: "desc" }, "todos");
    expect(lista).toEqual(copia);
  });
});

describe("aplicarFiltrosClientes (filtro + ordenação juntos)", () => {
  it("inadimplentes ordenado por atraso desc por default", () => {
    const r = aplicarFiltrosClientes(lista, { chip: "inadimplentes" }).map((c) => c.contatoNome);
    expect(r).toEqual(["Bruno", "Carla"]);
  });

  it("respeita atraso mínimo + sort explícito", () => {
    const r = aplicarFiltrosClientes(lista, {
      chip: "todos",
      diasAtrasoMin: 5,
      sort: { col: "atraso", dir: "asc" },
    }).map((c) => c.contatoNome);
    expect(r).toEqual(["Carla", "Bruno"]); // 10 antes de 40
  });
});

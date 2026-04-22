/**
 * Testes — Configurações do Escritório: proteções críticas
 *
 * Cobre comportamento de:
 *   - db-escritorio.atualizarColaborador: dono não pode ser rebaixado nem
 *     desativado via esse endpoint (gestor malicioso não consegue remover
 *     o dono mudando cargo/ativo).
 *   - db-canais.listarCanais: não executa DELETE (listagem é read-only);
 *     canais órfãos são filtrados da resposta mas permanecem no banco.
 *   - db-canais.removerCanaisOrfaos: limpeza explícita quando chamada.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

type Captured = {
  op: "select" | "insert" | "update" | "delete";
  table: string;
  set?: Record<string, unknown>;
};

let captured: Captured[] = [];
let selectQueue: unknown[][] = [];

function tableName(t: unknown): string {
  const anyT = t as any;
  return (
    anyT?._?.name ||
    anyT?.[Symbol.for("drizzle:Name")] ||
    "unknown"
  );
}

const nextSelect = () => selectQueue.shift() ?? [];

function makeSelectBuilder(table: unknown) {
  const builder: any = {
    from(_t: unknown) {
      return builder;
    },
    innerJoin: () => builder,
    leftJoin: () => builder,
    where(_w: unknown) {
      captured.push({ op: "select", table: tableName(table) });
      return builder;
    },
    orderBy: () => builder,
    limit: () => Promise.resolve(nextSelect()),
    then: (r: (v: unknown) => unknown) => r(nextSelect()),
  };
  return builder;
}

const mockDb = {
  select: (_cols?: unknown) => ({ from: (t: unknown) => makeSelectBuilder(t) }),
  insert: (t: unknown) => ({
    values(_v: unknown) {
      captured.push({ op: "insert", table: tableName(t) });
      return Promise.resolve([{ insertId: 999, affectedRows: 1 }]);
    },
  }),
  update: (t: unknown) => ({
    set(set: Record<string, unknown>) {
      return {
        where(_w: unknown) {
          captured.push({ op: "update", table: tableName(t), set });
          return Promise.resolve([{ affectedRows: 1 }]);
        },
      };
    },
  }),
  delete: (t: unknown) => ({
    where(_w: unknown) {
      captured.push({ op: "delete", table: tableName(t) });
      return Promise.resolve([{ affectedRows: 1 }]);
    },
  }),
};

vi.mock("../db", () => ({
  getDb: vi.fn(async () => mockDb),
}));

const { atualizarColaborador } = await import("../escritorio/db-escritorio");
const { listarCanais, removerCanaisOrfaos } = await import("../escritorio/db-canais");

beforeEach(() => {
  captured = [];
  selectQueue = [];
});

describe("db-escritorio.atualizarColaborador — proteção do dono", () => {
  it("lança erro ao tentar mudar cargo do dono para gestor", async () => {
    selectQueue.push([{ cargo: "dono" }]); // SELECT do alvo

    await expect(
      atualizarColaborador(10, 1, { cargo: "gestor" }),
    ).rejects.toThrow(/dono/i);

    const updates = captured.filter((c) => c.op === "update");
    expect(updates).toHaveLength(0);
  });

  it("lança erro ao tentar desativar o dono", async () => {
    selectQueue.push([{ cargo: "dono" }]);

    await expect(
      atualizarColaborador(10, 1, { ativo: false }),
    ).rejects.toThrow(/desativ/i);

    const updates = captured.filter((c) => c.op === "update");
    expect(updates).toHaveLength(0);
  });

  it("permite mexer em campos neutros do dono (departamento)", async () => {
    selectQueue.push([{ cargo: "dono" }]);

    await atualizarColaborador(10, 1, { departamento: "Direção" });

    const updates = captured.filter((c) => c.op === "update" && c.table.includes("colab"));
    expect(updates).toHaveLength(1);
    expect(updates[0].set).toMatchObject({ departamento: "Direção" });
  });

  it("permite rebaixar gestor para atendente", async () => {
    selectQueue.push([{ cargo: "gestor" }]);

    await atualizarColaborador(20, 1, { cargo: "atendente" });

    const updates = captured.filter((c) => c.op === "update" && c.table.includes("colab"));
    expect(updates).toHaveLength(1);
    expect(updates[0].set).toMatchObject({ cargo: "atendente" });
  });

  it("lança erro quando colaborador não existe", async () => {
    selectQueue.push([]); // sem registro

    await expect(
      atualizarColaborador(999, 1, { cargo: "gestor" }),
    ).rejects.toThrow(/não encontrado/i);
  });
});

describe("db-canais.listarCanais — sem efeitos destrutivos", () => {
  it("não chama delete mesmo quando há canais órfãos (whatsapp_api sem telefone)", async () => {
    selectQueue.push([
      { id: 1, escritorioId: 1, tipo: "whatsapp_api", nome: "", status: "conectado", telefone: null },
      { id: 2, escritorioId: 1, tipo: "whatsapp_qr", nome: "QR", status: "conectado", telefone: "5585..." },
    ]);

    await listarCanais(1);

    const deletes = captured.filter((c) => c.op === "delete");
    expect(deletes).toHaveLength(0);
  });

  it("filtra órfãos do retorno (não aparecem na UI) mas não os remove do banco", async () => {
    selectQueue.push([
      { id: 1, escritorioId: 1, tipo: "whatsapp_api", nome: "", status: "conectado", telefone: "" },
      { id: 2, escritorioId: 1, tipo: "whatsapp_qr", nome: "QR", status: "conectado", telefone: "5585..." },
      { id: 3, escritorioId: 1, tipo: "whatsapp_api", nome: "OK", status: "conectado", telefone: "5511..." },
    ]);

    const out = await listarCanais(1);

    expect(out.map((c) => c.id).sort()).toEqual([2, 3]);
    expect(captured.filter((c) => c.op === "delete")).toHaveLength(0);
  });
});

describe("db-canais.removerCanaisOrfaos — limpeza explícita", () => {
  it("remove apenas canais whatsapp_api sem telefone", async () => {
    selectQueue.push([
      { id: 1, tipo: "whatsapp_api", telefone: null },
      { id: 2, tipo: "whatsapp_qr", telefone: null }, // QR sem telefone é válido
      { id: 3, tipo: "whatsapp_api", telefone: "" },
      { id: 4, tipo: "whatsapp_api", telefone: "5511..." },
    ]);

    const removidos = await removerCanaisOrfaos(1);

    expect(removidos).toBe(2);
    expect(captured.filter((c) => c.op === "delete")).toHaveLength(2);
  });

  it("retorna 0 quando não há órfãos", async () => {
    selectQueue.push([
      { id: 1, tipo: "whatsapp_qr", telefone: "5511..." },
      { id: 2, tipo: "whatsapp_api", telefone: "5511..." },
    ]);

    const removidos = await removerCanaisOrfaos(1);
    expect(removidos).toBe(0);
    expect(captured.filter((c) => c.op === "delete")).toHaveLength(0);
  });
});

/**
 * Testes — exclusão de conversa realmente exclui.
 *
 * Sintoma: excluir a conversa e, quando o contato fala de novo, o bot volta
 * "de onde parou". Causa: `excluirConversa` apagava só mensagens + conversa.
 * A execução de SmartFlow continuava `rodando` com
 * `aguardandoMensagemContatoId` apontando pro contato, e
 * `acharExecucaoAguardando` casa por CONTATO — não por conversa. A próxima
 * mensagem retomava o fluxo antigo com todo o contexto acumulado.
 *
 * Contrato coberto aqui:
 *  - cancela execuções `rodando` DAQUELA conversa (status + retomarEm +
 *    aguardandoMensagemContatoId zerados);
 *  - desvincula (não apaga) o lead do pipeline;
 *  - solta as chamadas que apontavam pra conversa;
 *  - só então apaga mensagens e a conversa;
 *  - conversa de outra empresa não é encontrada → lança e não deleta nada.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

type Captured = {
  op: "select" | "update" | "delete";
  table: string;
  set?: any;
};

let captured: Captured[] = [];
let selectQueue: unknown[][] = [];

function tableName(t: unknown): string {
  return (t as any)?.[Symbol.for("drizzle:Name")] || "unknown";
}

const nextSelect = () => selectQueue.shift() ?? [];

function makeSelectBuilder(table: unknown) {
  const b: any = {
    from: () => b,
    where: () => {
      captured.push({ op: "select", table: tableName(table) });
      return b;
    },
    limit: () => Promise.resolve(nextSelect()),
    then: (r: (v: unknown) => unknown) => r(nextSelect()),
  };
  return b;
}

const mockDb = {
  select: () => ({ from: (t: unknown) => makeSelectBuilder(t) }),
  update: (t: unknown) => ({
    set: (set: any) => ({
      where: () => {
        captured.push({ op: "update", table: tableName(t), set });
        return Promise.resolve([{ affectedRows: 1 }]);
      },
    }),
  }),
  delete: (t: unknown) => ({
    where: () => {
      captured.push({ op: "delete", table: tableName(t) });
      return Promise.resolve([{ affectedRows: 1 }]);
    },
  }),
};

vi.mock("../db", () => ({ getDb: async () => mockDb }));

import { excluirConversa } from "../escritorio/db-crm";

beforeEach(() => {
  captured = [];
  selectQueue = [];
});

const acharUpdate = (table: string) =>
  captured.find((c) => c.op === "update" && c.table === table);
const ordem = () => captured.filter((c) => c.op !== "select").map((c) => `${c.op}:${c.table}`);

describe("excluirConversa", () => {
  it("cancela a execução de fluxo da conversa e solta o gancho no contato", async () => {
    selectQueue.push([{ id: 42 }]);
    await excluirConversa(42, 1);

    const up = acharUpdate("smartflow_execucoes");
    expect(up).toBeDefined();
    expect(up!.set).toMatchObject({
      status: "cancelado",
      retomarEm: null,
      aguardandoMensagemContatoId: null,
    });
  });

  it("desvincula o lead em vez de apagá-lo (negociação pode ter valor)", async () => {
    selectQueue.push([{ id: 42 }]);
    await excluirConversa(42, 1);

    expect(acharUpdate("leads")!.set).toEqual({ conversaId: null });
    expect(captured.some((c) => c.op === "delete" && c.table === "leads")).toBe(false);
  });

  it("solta as chamadas e apaga mensagens antes da conversa", async () => {
    selectQueue.push([{ id: 42 }]);
    await excluirConversa(42, 1);

    expect(acharUpdate("chamadas")!.set).toEqual({ conversaId: null });
    const seq = ordem();
    expect(seq).toContain("delete:mensagens");
    expect(seq.indexOf("delete:mensagens")).toBeLessThan(seq.indexOf("delete:conversas"));
    expect(seq.indexOf("update:smartflow_execucoes")).toBeLessThan(seq.indexOf("delete:conversas"));
  });

  it("conversa de outra empresa: lança e não apaga nada", async () => {
    selectQueue.push([]);
    await expect(excluirConversa(42, 999)).rejects.toThrow("Conversa não encontrada.");
    expect(ordem()).toHaveLength(0);
  });
});

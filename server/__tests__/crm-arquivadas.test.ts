/**
 * Testes — pasta Arquivadas do Atendimento.
 *
 * Contrato:
 *  - Vistas padrão (lista/contagem) excluem arquivadas; arquivadas=true
 *    lista SÓ elas (condição isNull/isNotNull em conversas.arquivadaEm).
 *  - desarquivarSeArquivada limpa arquivadaEm (mensagem nova volta pro inbox)
 *    e nunca lança (best-effort na ingestão).
 *  - Bulk: arquiva só conversas ATIVAS de canais com status != conectado.
 *  - resumoArquivadas reporta canais desativados com conversas fora do arquivo.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

type Captured = { op: "select" | "update"; table: string; set?: any; where?: unknown };
let captured: Captured[] = [];
let selectQueue: unknown[][] = [];

function tableName(t: unknown): string {
  return (t as any)?.[Symbol.for("drizzle:Name")] || "unknown";
}

const nextSelect = () => selectQueue.shift() ?? [];

function makeSelectBuilder(table: unknown) {
  const b: any = {
    from: () => b,
    where: (w: unknown) => {
      captured.push({ op: "select", table: tableName(table), where: w });
      return b;
    },
    groupBy: () => b,
    orderBy: () => b,
    innerJoin: () => b,
    limit: () => Promise.resolve(nextSelect()),
    then: (r: (v: unknown) => unknown) => r(nextSelect()),
  };
  return b;
}

const mockDb = {
  select: () => ({ from: (t: unknown) => makeSelectBuilder(t) }),
  update: (t: unknown) => ({
    set: (set: any) => ({
      where: (where: unknown) => {
        captured.push({ op: "update", table: tableName(t), set, where });
        return Promise.resolve([{ affectedRows: 7 }]);
      },
    }),
  }),
};

let dbDisponivel = true;
vi.mock("../db", () => ({ getDb: async () => (dbDisponivel ? mockDb : null) }));

import {
  definirArquivada,
  desarquivarSeArquivada,
  arquivarConversasDeCanaisDesativados,
  resumoArquivadas,
} from "../escritorio/db-crm";

beforeEach(() => {
  captured = [];
  selectQueue = [];
  dbDisponivel = true;
});

const updatesConversas = () => captured.filter((c) => c.op === "update" && c.table === "conversas");

describe("definirArquivada", () => {
  it("arquivar=true seta arquivadaEm com timestamp", async () => {
    await definirArquivada(10, 1, true);
    const up = updatesConversas()[0];
    expect(up.set.arquivadaEm).toBeInstanceOf(Date);
  });

  it("arquivar=false limpa arquivadaEm", async () => {
    await definirArquivada(10, 1, false);
    const up = updatesConversas()[0];
    expect(up.set.arquivadaEm).toBeNull();
  });
});

describe("desarquivarSeArquivada", () => {
  it("limpa arquivadaEm da conversa", async () => {
    await desarquivarSeArquivada(33);
    const up = updatesConversas()[0];
    expect(up.set.arquivadaEm).toBeNull();
  });

  it("nunca lança — DB indisponível vira no-op (best-effort na ingestão)", async () => {
    dbDisponivel = false;
    await expect(desarquivarSeArquivada(33)).resolves.toBeUndefined();
    expect(updatesConversas()).toHaveLength(0);
  });
});

describe("arquivarConversasDeCanaisDesativados", () => {
  it("sem canal desativado → 0, sem UPDATE", async () => {
    selectQueue.push([]); // canais mortos
    const n = await arquivarConversasDeCanaisDesativados(1);
    expect(n).toBe(0);
    expect(updatesConversas()).toHaveLength(0);
  });

  it("com canais desativados → arquiva as ativas deles e retorna a contagem", async () => {
    selectQueue.push([{ id: 5 }, { id: 6 }]); // canais mortos
    const n = await arquivarConversasDeCanaisDesativados(1);
    expect(n).toBe(7); // affectedRows do mock
    const up = updatesConversas()[0];
    expect(up.set.arquivadaEm).toBeInstanceOf(Date);
  });
});

describe("resumoArquivadas", () => {
  it("reporta total e canais desativados com conversas fora do arquivo", async () => {
    selectQueue.push([{ n: 2381 }]); // total arquivadas
    selectQueue.push([
      { id: 5, nome: "Escritório Boyadjian Advogados", telefone: "+55 85 8847-5555" },
      { id: 6, nome: "Escritório Boyadjian Advogados", telefone: "+55 85 9141-2282" },
    ]); // canais mortos
    selectQueue.push([{ canalId: 5, n: 2000 }, { canalId: 6, n: 351 }]); // contagens

    const r = await resumoArquivadas(1);
    expect(r.total).toBe(2381);
    expect(r.canaisDesativados).toHaveLength(2);
    expect(r.canaisDesativados[0]).toMatchObject({ canalId: 5, foraDoArquivo: 2000 });
  });

  it("canal desativado SEM conversa ativa não aparece no resumo", async () => {
    selectQueue.push([{ n: 100 }]);
    selectQueue.push([{ id: 5, nome: "Morto", telefone: "" }]);
    selectQueue.push([]); // nenhuma conversa fora do arquivo
    const r = await resumoArquivadas(1);
    expect(r.canaisDesativados).toHaveLength(0);
  });
});

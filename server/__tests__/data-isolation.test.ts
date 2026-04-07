/**
 * Testes — Isolamento de dados entre escritórios
 *
 * Verificam que as funções de acesso ao CRM:
 *  1. Exigem `escritorioId` em TODAS as operações de leitura/escrita/exclusão
 *  2. Incluem `escritorioId` na cláusula WHERE para evitar vazamento entre escritórios
 *  3. Validam enums de entrada (origem, prioridade, status, tipo, etapa) para
 *     prevenir SQL injection / valores inesperados
 *
 * NÃO usa banco real — mocka `getDb` e captura as chamadas para inspecionar
 * que cada operação aplica o filtro de escritório correto.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock do drizzle e do getDb ──────────────────────────────────────────────

type CapturedCall = {
  op: "select" | "insert" | "update" | "delete";
  table?: unknown;
  values?: unknown;
  where?: unknown;
  set?: unknown;
};

let captured: CapturedCall[] = [];

function makeMockDb() {
  const select = vi.fn((..._args: unknown[]) => {
    const builder: any = {
      from(table: unknown) {
        captured.push({ op: "select", table });
        return builder;
      },
      innerJoin: () => builder,
      leftJoin: () => builder,
      where(w: unknown) {
        captured[captured.length - 1].where = w;
        return builder;
      },
      orderBy: () => builder,
      groupBy: () => builder,
      limit: () => Promise.resolve([]),
      then: (resolve: (v: unknown) => unknown) => resolve([]),
    };
    return builder;
  });

  const insert = vi.fn((table: unknown) => ({
    values(values: unknown) {
      captured.push({ op: "insert", table, values });
      return Promise.resolve([{ insertId: 999 }]);
    },
  }));

  const update = vi.fn((table: unknown) => ({
    set(set: unknown) {
      return {
        where(w: unknown) {
          captured.push({ op: "update", table, set, where: w });
          return Promise.resolve([{ affectedRows: 1 }]);
        },
      };
    },
  }));

  const del = vi.fn((table: unknown) => ({
    where(w: unknown) {
      captured.push({ op: "delete", table, where: w });
      return Promise.resolve([{ affectedRows: 1 }]);
    },
  }));

  return { select, insert, update, delete: del } as const;
}

const mockDb = makeMockDb();

vi.mock("../db", () => ({
  getDb: vi.fn(async () => mockDb),
}));

// Importa APÓS o mock estar definido
const crm = await import("../escritorio/db-crm");

// ─── Helper: extrai os valores dos parâmetros da cláusula WHERE ──────────────
// Drizzle constrói SQL como uma árvore com `queryChunks[]` contendo strings
// e objetos `Param` (que envolvem o valor real). Aqui caminhamos a árvore
// coletando os valores embrulhados em Param.
function whereParams(w: unknown): unknown[] {
  const params: unknown[] = [];
  const seen = new WeakSet<object>();
  function walk(v: unknown, depth = 0) {
    if (depth > 12 || v === null || v === undefined) return;
    if (typeof v !== "object") return;
    if (seen.has(v as object)) return;
    seen.add(v as object);

    // Param do drizzle expõe `value` (o valor real ligado à coluna)
    const ctorName = (v as { constructor?: { name?: string } }).constructor?.name;
    if (ctorName === "Param" && "value" in (v as object)) {
      params.push((v as { value: unknown }).value);
      return;
    }

    if (Array.isArray(v)) {
      v.forEach((x) => walk(x, depth + 1));
      return;
    }
    for (const k of Object.keys(v as object)) {
      if (k === "table") continue; // referência circular coluna→tabela
      walk((v as Record<string, unknown>)[k], depth + 1);
    }
  }
  walk(w);
  return params;
}

function whereContains(w: unknown, value: unknown): boolean {
  return whereParams(w).some((p) => p === value);
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  captured = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── Testes — Contatos ───────────────────────────────────────────────────────

describe("Isolamento de Contatos", () => {
  it("criarContato grava o escritorioId fornecido", async () => {
    const id = await crm.criarContato({
      escritorioId: 42,
      nome: "João",
    });
    expect(id).toBe(999);
    const insert = captured.find((c) => c.op === "insert");
    expect(insert).toBeDefined();
    const values = insert!.values as { escritorioId: number };
    expect(values.escritorioId).toBe(42);
  });

  it("listarContatos filtra por escritorioId", async () => {
    await crm.listarContatos(7);
    const sel = captured.find((c) => c.op === "select");
    expect(sel).toBeDefined();
    expect(whereContains(sel!.where, 7)).toBe(true);
  });

  it("atualizarContato exige escritorioId no WHERE (não consegue editar de outro escritório)", async () => {
    await crm.atualizarContato(100, 42, { nome: "Novo" });
    const upd = captured.find((c) => c.op === "update");
    expect(upd).toBeDefined();
    expect(whereContains(upd!.where, 42)).toBe(true); // escritorioId
    expect(whereContains(upd!.where, 100)).toBe(true); // id do contato
  });

  it("excluirContato exige escritorioId (não consegue excluir contato alheio)", async () => {
    await crm.excluirContato(55, 42);
    const del = captured.find((c) => c.op === "delete");
    expect(del).toBeDefined();
    expect(whereContains(del!.where, 42)).toBe(true);
    expect(whereContains(del!.where, 55)).toBe(true);
  });
});

// ─── Testes — Conversas ──────────────────────────────────────────────────────

describe("Isolamento de Conversas", () => {
  it("criarConversa grava escritorioId", async () => {
    await crm.criarConversa({
      escritorioId: 11,
      contatoId: 1,
      canalId: 1,
    });
    const insert = captured.find((c) => c.op === "insert");
    const values = insert!.values as { escritorioId: number };
    expect(values.escritorioId).toBe(11);
  });

  it("listarConversas filtra por escritorioId", async () => {
    await crm.listarConversas(11);
    const sel = captured.find((c) => c.op === "select");
    expect(whereContains(sel!.where, 11)).toBe(true);
  });

  it("atualizarConversa exige escritorioId", async () => {
    await crm.atualizarConversa(50, 11, { status: "resolvido" });
    const upd = captured.find((c) => c.op === "update");
    expect(upd).toBeDefined();
    expect(whereContains(upd!.where, 11)).toBe(true);
    expect(whereContains(upd!.where, 50)).toBe(true);
  });
});

// ─── Testes — Leads ──────────────────────────────────────────────────────────

describe("Isolamento de Leads", () => {
  it("criarLead grava escritorioId", async () => {
    await crm.criarLead({
      escritorioId: 9,
      contatoId: 1,
    });
    const insert = captured.find((c) => c.op === "insert");
    const values = insert!.values as { escritorioId: number };
    expect(values.escritorioId).toBe(9);
  });

  it("listarLeads filtra por escritorioId", async () => {
    await crm.listarLeads(9);
    const sel = captured.find((c) => c.op === "select");
    expect(whereContains(sel!.where, 9)).toBe(true);
  });

  it("excluirLead exige escritorioId", async () => {
    await crm.excluirLead(77, 9);
    const del = captured.find((c) => c.op === "delete");
    expect(whereContains(del!.where, 9)).toBe(true);
    expect(whereContains(del!.where, 77)).toBe(true);
  });
});

// ─── Testes — Validação de entrada (anti-SQL injection / valores inesperados) ─

describe("Validação de inputs (CRM)", () => {
  it("origem inválida vira 'manual' (default seguro)", async () => {
    await crm.criarContato({
      escritorioId: 1,
      nome: "X",
      origem: "DROP TABLE contatos;",
    });
    const insert = captured.find((c) => c.op === "insert");
    const values = insert!.values as { origem: string };
    expect(values.origem).toBe("manual");
  });

  it("prioridade inválida vira 'normal' (default seguro)", async () => {
    await crm.criarConversa({
      escritorioId: 1,
      contatoId: 1,
      canalId: 1,
      prioridade: "<script>alert(1)</script>",
    });
    const insert = captured.find((c) => c.op === "insert");
    const values = insert!.values as { prioridade: string };
    expect(values.prioridade).toBe("normal");
  });

  it("origem válida é aceita", async () => {
    await crm.criarContato({
      escritorioId: 1,
      nome: "X",
      origem: "whatsapp",
    });
    const insert = captured.find((c) => c.op === "insert");
    const values = insert!.values as { origem: string };
    expect(values.origem).toBe("whatsapp");
  });

  it("prioridade válida é aceita", async () => {
    await crm.criarConversa({
      escritorioId: 1,
      contatoId: 1,
      canalId: 1,
      prioridade: "alta",
    });
    const insert = captured.find((c) => c.op === "insert");
    const values = insert!.values as { prioridade: string };
    expect(values.prioridade).toBe("alta");
  });

  it("enviarMensagem rejeita direção inválida", async () => {
    await expect(
      crm.enviarMensagem({
        conversaId: 1,
        direcao: "x; DROP TABLE mensagens;",
        conteudo: "oi",
      }),
    ).rejects.toThrow(/Direção inválida/);
  });

  it("enviarMensagem aceita direção válida", async () => {
    const id = await crm.enviarMensagem({
      conversaId: 1,
      direcao: "saida",
      conteudo: "olá",
    });
    expect(id).toBe(999);
  });

  it("tipo de mensagem inválido vira 'texto' (default seguro)", async () => {
    await crm.enviarMensagem({
      conversaId: 1,
      direcao: "saida",
      tipo: "evil_type",
      conteudo: "msg",
    });
    const insert = captured.find((c) => c.op === "insert");
    const values = insert!.values as { tipo: string };
    expect(values.tipo).toBe("texto");
  });
});

// ─── Smoke test — função distribuirLead retorna null sem dados ────────────────

describe("distribuirLead", () => {
  it("retorna null quando não há atendentes ativos", async () => {
    const result = await crm.distribuirLead(1);
    // Sem DB real, o mock retorna [] em selects → cai no fallback null
    expect(result).toBeNull();
  });
});

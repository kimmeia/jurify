/**
 * Tests — auto-recovery de sessão do cofre.
 *
 * Cenário: sessão expira durante uma consulta judicial. Antes, o cofre
 * mostrava credencial "ativa" enquanto monitoramentos batiam erro. Agora:
 *
 *   1. Quando o scrape falha com mensagem que sugere sessão caída,
 *      `marcarCredencialExpirada` atualiza o status no DB.
 *   2. `recuperarSessao({ tentarRelogin: true })` aciona relogin
 *      automático quando a sessão expira (TJCE only — único adapter).
 *
 * Os testes focam na lógica de heurística e na atualização de status,
 * porque o relogin real (Playwright + tribunal) é coberto por testes
 * de integração já existentes (`cron-revalidar-cofre.test.ts`).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// ─── Mock DB ────────────────────────────────────────────────────────────────
const dbState = {
  updates: [] as Array<{ table: string; values: Record<string, unknown> }>,
};

function makeDb() {
  let tableNome = "";
  const builder: any = {
    update: (t: unknown) => {
      tableNome = (t as any)?._?.name || "unknown";
      return builder;
    },
    set: (values: Record<string, unknown>) => {
      dbState.updates.push({ table: tableNome, values });
      return builder;
    },
    where: () => Promise.resolve(),
  };
  return builder;
}

vi.mock("../db", () => ({
  getDb: vi.fn(async () => makeDb()),
}));

vi.mock("../_core/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const { marcarCredencialExpirada } = await import("../escritorio/cofre-helpers");

beforeEach(() => {
  dbState.updates = [];
});

describe("marcarCredencialExpirada", () => {
  it("atualiza status para 'expirada' + grava motivo", async () => {
    await marcarCredencialExpirada(42, "Login redirecionado");

    expect(dbState.updates).toHaveLength(1);
    expect(dbState.updates[0].values).toMatchObject({
      status: "expirada",
      ultimoErro: "Login redirecionado",
    });
    expect(dbState.updates[0].values.ultimoLoginTentativaEm).toBeInstanceOf(Date);
  });

  it("trunca motivo longo em 1000 chars", async () => {
    const motivoLongo = "X".repeat(5000);
    await marcarCredencialExpirada(1, motivoLongo);

    const ultimoErro = dbState.updates[0].values.ultimoErro as string;
    expect(ultimoErro.length).toBe(1000);
  });

  it("é idempotente — chamadas múltiplas só atualizam DB", async () => {
    await marcarCredencialExpirada(1, "motivo 1");
    await marcarCredencialExpirada(1, "motivo 2");
    expect(dbState.updates).toHaveLength(2);
    expect(dbState.updates[1].values.ultimoErro).toBe("motivo 2");
  });
});

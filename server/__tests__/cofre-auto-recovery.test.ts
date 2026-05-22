/**
 * Tests — auto-recovery de sessão do cofre.
 *
 * Cenário: sessão expira durante uma consulta judicial. Antes, o cofre
 * mostrava credencial "ativa" enquanto monitoramentos batiam erro. Agora:
 *
 *   1. Quando o scrape falha com mensagem que sugere sessão caída,
 *      `marcarCredencialExpirada` atualiza o status no DB E notifica o user
 *      (via notificacoes + SSE) se a credencial estava "ativa" antes.
 *   2. `recuperarSessao({ tentarRelogin: true })` aciona relogin
 *      automático quando a sessão expira (TJCE only — único adapter).
 *
 * Os testes focam na lógica de heurística, atualização de status, E
 * disparo de notificação na transição "saudável" → "caída", porque o
 * relogin real (Playwright + tribunal) é coberto por testes de integração
 * já existentes (`cron-revalidar-cofre.test.ts`).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// ─── Mock DB ────────────────────────────────────────────────────────────────
const dbState = {
  updates: [] as Array<{ table: string; values: Record<string, unknown> }>,
  inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
  // Resposta do próximo SELECT — controlada por cada teste pra simular
  // estado anterior da credencial (status "ativa" vs "expirada" etc).
  proximoSelect: [] as Array<Record<string, unknown>>,
};

function tableName(t: unknown): string {
  const anyT = t as any;
  return anyT?._?.name || anyT?.[Symbol.for("drizzle:Name")] || "unknown";
}

function makeDb() {
  return {
    select: (_cols?: unknown) => {
      const builder: any = {
        from: () => builder,
        where: () => builder,
        limit: () => Promise.resolve(dbState.proximoSelect),
      };
      return builder;
    },
    update: (t: unknown) => {
      const nome = tableName(t);
      return {
        set: (values: Record<string, unknown>) => {
          dbState.updates.push({ table: nome, values });
          return { where: () => Promise.resolve() };
        },
      };
    },
    insert: (t: unknown) => {
      const nome = tableName(t);
      return {
        values: (values: Record<string, unknown>) => {
          dbState.inserts.push({ table: nome, values });
          return Promise.resolve([{ insertId: 1 }]);
        },
      };
    },
  };
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

// Mock SSE pra capturar emissão sem precisar de servidor real.
const emitirNotificacao = vi.fn();
vi.mock("../_core/sse-notifications", () => ({ emitirNotificacao }));

const { marcarCredencialExpirada } = await import("../escritorio/cofre-helpers");

beforeEach(() => {
  dbState.updates = [];
  dbState.inserts = [];
  dbState.proximoSelect = [];
  emitirNotificacao.mockReset();
});

describe("marcarCredencialExpirada — atualização de status", () => {
  it("atualiza status para 'expirada' + grava motivo", async () => {
    dbState.proximoSelect = [
      { status: "ativa", apelido: "OAB-CE 12345", sistema: "pje_tjce", criadoPor: 7 },
    ];

    await marcarCredencialExpirada(42, "Login redirecionado");

    const upd = dbState.updates.find((u) => u.table === "cofre_credenciais");
    expect(upd).toBeDefined();
    expect(upd!.values).toMatchObject({
      status: "expirada",
      ultimoErro: "Login redirecionado",
    });
    expect(upd!.values.ultimoLoginTentativaEm).toBeInstanceOf(Date);
  });

  it("trunca motivo longo em 1000 chars", async () => {
    dbState.proximoSelect = [
      { status: "ativa", apelido: "C1", sistema: "pje_tjce", criadoPor: 1 },
    ];
    const motivoLongo = "X".repeat(5000);
    await marcarCredencialExpirada(1, motivoLongo);

    const upd = dbState.updates.find((u) => u.table === "cofre_credenciais");
    const ultimoErro = upd!.values.ultimoErro as string;
    expect(ultimoErro.length).toBe(1000);
  });

  it("é idempotente — chamadas múltiplas só atualizam DB", async () => {
    dbState.proximoSelect = [
      { status: "ativa", apelido: "C1", sistema: "pje_tjce", criadoPor: 1 },
    ];
    await marcarCredencialExpirada(1, "motivo 1");

    dbState.proximoSelect = [
      { status: "expirada", apelido: "C1", sistema: "pje_tjce", criadoPor: 1 },
    ];
    await marcarCredencialExpirada(1, "motivo 2");

    const ups = dbState.updates.filter((u) => u.table === "cofre_credenciais");
    expect(ups).toHaveLength(2);
    expect(ups[1].values.ultimoErro).toBe("motivo 2");
  });
});

describe("marcarCredencialExpirada — notificação ao user", () => {
  it("notifica (DB + SSE) quando credencial transita de 'ativa' → 'expirada'", async () => {
    dbState.proximoSelect = [
      { status: "ativa", apelido: "OAB-CE 12345", sistema: "pje_tjce", criadoPor: 7 },
    ];

    await marcarCredencialExpirada(42, "Sessão expirou — PDPJ-cloud redirecionou");

    // Notificação persistida no sino
    const notif = dbState.inserts.find((i) => i.table === "notificacoes");
    expect(notif).toBeDefined();
    expect(notif!.values).toMatchObject({
      userId: 7,
      tipo: "sistema",
    });
    expect((notif!.values.titulo as string)).toMatch(/caiu|expirou/i);

    // SSE emitido com tipo correto
    expect(emitirNotificacao).toHaveBeenCalledOnce();
    expect(emitirNotificacao).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        tipo: "credencial_erro",
        dados: expect.objectContaining({
          credencialId: 42,
          sistema: "pje_tjce",
          novoStatus: "expirada",
        }),
      }),
    );
  });

  it("notifica também quando credencial transita de 'validando' → 'expirada'", async () => {
    dbState.proximoSelect = [
      { status: "validando", apelido: "C1", sistema: "pje_tjce", criadoPor: 11 },
    ];

    await marcarCredencialExpirada(50, "Login falhou");

    expect(emitirNotificacao).toHaveBeenCalledOnce();
    const notif = dbState.inserts.find((i) => i.table === "notificacoes");
    expect(notif).toBeDefined();
    expect(notif!.values.userId).toBe(11);
  });

  it("NÃO notifica quando credencial já estava 'expirada' (evita spam)", async () => {
    dbState.proximoSelect = [
      { status: "expirada", apelido: "C1", sistema: "pje_tjce", criadoPor: 7 },
    ];

    await marcarCredencialExpirada(42, "outro erro");

    // Atualiza DB sim
    const upd = dbState.updates.find((u) => u.table === "cofre_credenciais");
    expect(upd).toBeDefined();
    // Mas não notifica de novo
    expect(emitirNotificacao).not.toHaveBeenCalled();
    expect(dbState.inserts.find((i) => i.table === "notificacoes")).toBeUndefined();
  });

  it("NÃO notifica quando credencial estava em 'erro' (já tinha avisado antes)", async () => {
    dbState.proximoSelect = [
      { status: "erro", apelido: "C1", sistema: "pje_tjce", criadoPor: 7 },
    ];

    await marcarCredencialExpirada(42, "ainda errado");

    expect(emitirNotificacao).not.toHaveBeenCalled();
  });

  it("NÃO crasha quando SELECT retorna vazio (credencial não existe mais)", async () => {
    dbState.proximoSelect = [];

    await expect(marcarCredencialExpirada(999, "tentativa em ghost")).resolves.toBeUndefined();
    // Update ainda roda (best-effort)
    const upd = dbState.updates.find((u) => u.table === "cofre_credenciais");
    expect(upd).toBeDefined();
    expect(emitirNotificacao).not.toHaveBeenCalled();
  });
});

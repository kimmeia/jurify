/**
 * Testes — validação de URL em `salvarArquivo`.
 *
 * Antes do fix, o schema aceitava `z.string()` puro pra `url`. Um operador
 * malicioso (ou cliente externo do tRPC) podia gravar `javascript:alert(1)`
 * como URL de arquivo. O frontend renderiza `<a href={url}>` no card de
 * arquivo — clicar disparava XSS na sessão da vítima.
 *
 * Pós-fix:
 *  - URL deve passar `z.string().url()` (formato válido)
 *  - protocol restrito a http: ou https: (rejeita javascript:, data:, file:)
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "../_core/context";

const permState = {
  result: {
    allowed: true, verTodos: true, verProprios: true,
    criar: true, editar: true, excluir: true,
    colaboradorId: 10, escritorioId: 1, cargo: "dono",
  },
};

vi.mock("../escritorio/check-permission", () => ({
  checkPermission: vi.fn(async () => permState.result),
}));

vi.mock("../escritorio/db-escritorio", () => ({
  getEscritorioPorUsuario: vi.fn(async () => ({
    escritorio: { id: 1, nome: "Esc" },
    colaborador: { id: 10, cargo: "dono" },
  })),
}));

// Stub thenable do drizzle — devolve [contato] válido pra passar pelo
// podeVerCliente, e [pasta] vazio quando consultado.
const dbStub = {
  select: () => {
    const builder: any = {
      from: () => builder,
      where: () => builder,
      orderBy: () => builder,
      limit: () => Promise.resolve([{ responsavelId: 10, id: 1 }]),
      then: (resolve: (v: unknown) => unknown) => resolve([]),
    };
    return builder;
  },
  insert: () => ({ values: () => Promise.resolve([{ insertId: 1 }]) }),
};

vi.mock("../db", () => ({
  getDb: vi.fn(async () => dbStub),
}));

const { appRouter } = await import("../routers");

function fakeCtx(): TrpcContext {
  return {
    user: {
      id: 100, openId: "x", email: "x@y.z", name: "X",
      loginMethod: "google", role: "user", asaasCustomerId: null,
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    } as any,
    req: { protocol: "https", headers: {} } as any,
    res: { clearCookie: () => {} } as any,
  };
}

beforeEach(() => {
  permState.result = {
    allowed: true, verTodos: true, verProprios: true,
    criar: true, editar: true, excluir: true,
    colaboradorId: 10, escritorioId: 1, cargo: "dono",
  };
});

describe("clientes.salvarArquivo — validação de URL", () => {
  it("rejeita URL javascript: (XSS)", async () => {
    const caller = appRouter.createCaller(fakeCtx());
    await expect(
      caller.clientes.salvarArquivo({
        contatoId: 50, nome: "x.pdf",
        url: "javascript:alert(1)",
      }),
    ).rejects.toThrow();
  });

  it("rejeita URL data: (XSS via base64)", async () => {
    const caller = appRouter.createCaller(fakeCtx());
    await expect(
      caller.clientes.salvarArquivo({
        contatoId: 50, nome: "x.html",
        url: "data:text/html,<script>alert(1)</script>",
      }),
    ).rejects.toThrow();
  });

  it("rejeita URL file:// (local file access)", async () => {
    const caller = appRouter.createCaller(fakeCtx());
    await expect(
      caller.clientes.salvarArquivo({
        contatoId: 50, nome: "x.pdf",
        url: "file:///etc/passwd",
      }),
    ).rejects.toThrow();
  });

  it("rejeita strings que não são URL", async () => {
    const caller = appRouter.createCaller(fakeCtx());
    await expect(
      caller.clientes.salvarArquivo({
        contatoId: 50, nome: "x.pdf",
        url: "blah",
      }),
    ).rejects.toThrow();
  });

  it("aceita https:// (caso comum: blob storage)", async () => {
    const caller = appRouter.createCaller(fakeCtx());
    const result = await caller.clientes.salvarArquivo({
      contatoId: 50, nome: "doc.pdf",
      url: "https://storage.example.com/file/abc.pdf",
    });
    expect(result.id).toBe(1);
  });

  it("aceita http:// (legacy / dev local)", async () => {
    const caller = appRouter.createCaller(fakeCtx());
    const result = await caller.clientes.salvarArquivo({
      contatoId: 50, nome: "doc.pdf",
      url: "http://localhost:9000/file.pdf",
    });
    expect(result.id).toBe(1);
  });
});

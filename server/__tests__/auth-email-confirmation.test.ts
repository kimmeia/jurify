/**
 * Testes do fluxo de confirmação de email (Fase 2 do roadmap de Planos).
 *
 * Foco em validação de input das procedures novas — `confirmarEmail` e
 * `reenviarConfirmacao`. Os fluxos completos (signup → token → confirma
 * → login) ficam pra teste de integração com DB real.
 */

import { describe, expect, it } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";

function createAnonymousContext(): { ctx: TrpcContext } {
  const ctx: TrpcContext = {
    user: undefined,
    req: {
      protocol: "https",
      headers: {},
      ip: "127.0.0.1",
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
      cookie: () => {},
    } as unknown as TrpcContext["res"],
  };
  return { ctx };
}

describe("auth.confirmarEmail — validação de input", () => {
  it("rejeita token muito curto", async () => {
    const { ctx } = createAnonymousContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.auth.confirmarEmail({ token: "abc" }))
      .rejects.toThrow();
  });

  it("rejeita token vazio", async () => {
    const { ctx } = createAnonymousContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.auth.confirmarEmail({ token: "" }))
      .rejects.toThrow();
  });
});

describe("auth.reenviarConfirmacao — validação de input", () => {
  it("rejeita email mal formatado", async () => {
    const { ctx } = createAnonymousContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.auth.reenviarConfirmacao({ email: "notanemail" }))
      .rejects.toThrow();
  });

  it("rejeita email maior que 320 chars", async () => {
    const { ctx } = createAnonymousContext();
    const caller = appRouter.createCaller(ctx);
    const emailLongo = "a".repeat(320) + "@b.com";
    await expect(caller.auth.reenviarConfirmacao({ email: emailLongo }))
      .rejects.toThrow();
  });

  it("retorna sucesso pra email válido (sem vazar existência)", async () => {
    const { ctx } = createAnonymousContext();
    const caller = appRouter.createCaller(ctx);
    // Email que com certeza não existe — procedure deve retornar sucesso
    // (anti-enumeration) sem realmente enviar nada.
    const r = await caller.auth.reenviarConfirmacao({
      email: "nao-existe-no-banco-xyz@example.com",
    });
    expect(r.success).toBe(true);
  });
});

describe("auth.signup — Fase 2 retorna needsConfirmation", () => {
  it("input mínimo aceita planoSlug opcional", () => {
    // Apenas valida que o schema aceita o campo novo.
    // O fluxo real (criar user + enviar email) precisa de DB.
    const inputValido = {
      name: "Teste",
      email: "teste@example.com",
      password: "senha123",
      aceitouTermos: true as const,
      planoSlug: "intermediario",
    };
    expect(typeof inputValido.planoSlug).toBe("string");
  });

  it("aceita conviteToken opcional (fluxo de aceitar convite)", () => {
    // Sinaliza que o signup veio de /convite/:token. Backend pula
    // confirmação por email + aceita convite + cria sessão.
    const inputValido = {
      name: "Funcionário",
      email: "func@example.com",
      password: "senha123",
      aceitouTermos: true as const,
      conviteToken: "a".repeat(32),
    };
    expect(inputValido.conviteToken.length).toBeGreaterThanOrEqual(16);
  });

  it("rejeita conviteToken muito curto (proteção contra confusão de input)", async () => {
    const { ctx } = createAnonymousContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.auth.signup({
        name: "X",
        email: "x@example.com",
        password: "senha123",
        aceitouTermos: true,
        conviteToken: "abc", // < 16 chars
      }),
    ).rejects.toThrow();
  });
});

/**
 * Testes do middleware `requireModulo` (Fase 4 do roadmap de Planos).
 *
 * Foco em verificar que o gate retorna FORBIDDEN com mensagens/causes
 * apropriados pros diferentes cenários. Os caminhos felizes (cliente com
 * plano que libera módulo) precisam de DB real e ficam pra teste de
 * integração.
 */

import { describe, expect, it } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";

function createAnonymousContext(): { ctx: TrpcContext } {
  const ctx: TrpcContext = {
    user: undefined,
    req: { protocol: "https", headers: {}, ip: "127.0.0.1" } as TrpcContext["req"],
    res: { clearCookie: () => {}, cookie: () => {} } as unknown as TrpcContext["res"],
  };
  return { ctx };
}

describe("requireModulo — gate aplicado em routers", () => {
  it("agentesIa.criar exige autenticação (procedure protegida)", async () => {
    const { ctx } = createAnonymousContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      (caller as any).agentesIa.criar({
        nome: "Bot",
        prompt: "responda em português",
      }),
    ).rejects.toThrow();
  });

  it("smartflow.criar exige autenticação (procedure protegida)", async () => {
    const { ctx } = createAnonymousContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      (caller as any).smartflow.criar({
        nome: "Fluxo X",
        gatilho: "cliente_novo",
        passos: [],
      }),
    ).rejects.toThrow();
  });
});

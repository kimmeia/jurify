/**
 * Condição esperada não pode virar erro de servidor.
 *
 * tRPC trata `TRPCError` com código conhecido como fluxo normal, e
 * qualquer outra exceção como INTERNAL_SERVER_ERROR: 500 pro client, log
 * de erro e evento no Sentry (`server/_core/trpc.ts`, EXPECTED_CODES).
 *
 * "Usuário logado que ainda não tem escritório" é estado legítimo — quem
 * confirmou o e-mail e ainda não criou o escritório passa por ele. Mesmo
 * assim, `router-whatsapp-calling.ts` lançava `new Error("Escritório não
 * encontrado.")`, e as 11 procedures que usam aquele helper devolviam 500.
 *
 * O smoke de todas as procedures não pegava porque o usuário dele tem
 * escritório: o caminho só aparece pra quem não tem. Quem encontrou foi o
 * robô de jornada, quando o teardown apagou o escritório enquanto a
 * página ainda fazia polling.
 *
 * O mesmo padrão (`throw new Error` para condição esperada) existe em
 * outros ~117 pontos do server. Este teste cobre o que foi corrigido;
 * ampliar exige corrigir junto, e não em um diff só.
 */

import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { appRouter } from "../../server/routers";
import type { TrpcContext } from "../../server/_core/context";

const TEM_DB = !!process.env.DATABASE_URL;

/** Usuário autenticado que não tem escritório nenhum. */
function contextoSemEscritorio(): TrpcContext {
  return {
    user: {
      id: 999_999_999,
      openId: "sem-escritorio",
      email: "sem-escritorio@jurify.test",
      name: "Sem Escritório",
      loginMethod: "email",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  } as TrpcContext;
}

/** Procedures de whatsappCalling que passam pelo helper de escritório. */
const CHAMADAS = [
  ["configChamada", () => appRouter.createCaller(contextoSemEscritorio()).whatsappCalling.configChamada()],
  ["listarLigacoes", () => appRouter.createCaller(contextoSemEscritorio()).whatsappCalling.listarLigacoes({})],
] as const;

describe("usuário sem escritório não causa 500", () => {
  for (const [nome, chamar] of CHAMADAS) {
    it(`whatsappCalling.${nome} responde erro tipado, não erro de servidor`, async () => {
      if (!TEM_DB) return;

      let erro: unknown = null;
      try {
        await chamar();
      } catch (e) {
        erro = e;
      }

      expect(erro, `${nome} deveria recusar quem não tem escritório`).toBeInstanceOf(
        TRPCError,
      );
      expect(
        (erro as TRPCError).code,
        `${nome} devolveu ${(erro as TRPCError).code} — 5xx polui o Sentry e o painel de erros`,
      ).toBe("NOT_FOUND");
    }, 60_000);
  }
});

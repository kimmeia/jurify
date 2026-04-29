/**
 * Smoke automático: chama TODAS as procedures tRPC com input mínimo
 * gerado da Zod schema, e confere que nenhuma retorna 5xx.
 *
 * O que CONTA como falha:
 *   - INTERNAL_SERVER_ERROR (5xx)
 *   - Throw inesperado fora do envelope tRPC
 *   - Timeout
 *
 * O que NÃO conta como falha (esperado):
 *   - UNAUTHORIZED, FORBIDDEN (auth/permissão)
 *   - BAD_REQUEST (input gerado é mínimo, valida custom pode falhar)
 *   - NOT_FOUND (id 0/inválido frequentemente)
 *   - CONFLICT, PRECONDITION_FAILED (estado específico)
 *   - TOO_MANY_REQUESTS
 *   - UNPROCESSABLE_CONTENT
 *
 * Pré-requisito: DATABASE_URL configurada apontando pra DB de teste/staging
 * com seed rodado. Sem DB, o teste é skipado com aviso.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { appRouter } from "../../server/routers";
import type { TrpcContext } from "../../server/_core/context";
import { gerarInputMinimo } from "./zod-min-sample";
import { isSkipped } from "./skip-list";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

const ERROS_ACEITOS = new Set([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "BAD_REQUEST",
  "NOT_FOUND",
  "CONFLICT",
  "PRECONDITION_FAILED",
  "TOO_MANY_REQUESTS",
  "UNPROCESSABLE_CONTENT",
  "PAYLOAD_TOO_LARGE",
  "METHOD_NOT_SUPPORTED",
]);

function adminContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "smoke-admin",
    email: "admin-smoke@jurify.com.br",
    name: "Admin Smoke",
    loginMethod: "email",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

interface ProcedureRef {
  path: string;
  type: "query" | "mutation" | "subscription";
  inputSchema: any;
}

/** Navega no `appRouter._def.record` recursivamente coletando procedures. */
function coletar(node: any, prefix: string, out: ProcedureRef[]): void {
  // tRPC v11: cada item é router (tem `_def.record`) ou procedure (tem `_def`)
  for (const [key, value] of Object.entries<any>(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!value?._def) continue;

    const def = value._def;
    if (def.record) {
      // Sub-router
      coletar(def.record, path, out);
      continue;
    }

    // É procedure. tRPC v11 usa `def.type` ("query" | "mutation").
    const type = def.type as ProcedureRef["type"];
    if (!type) continue;

    // Input schema: pode estar em `def.inputs` (array) ou `def.input`.
    const inputSchema = (def.inputs && def.inputs[0]) || def.input;
    out.push({ path, type, inputSchema });
  }
}

describe("Smoke: todas as procedures tRPC", () => {
  let procedures: ProcedureRef[] = [];

  beforeAll(() => {
    if (!process.env.DATABASE_URL) {
      console.log("[smoke] DATABASE_URL não configurada — testes serão skipados.");
      return;
    }
    coletar((appRouter as any)._def.record, "", procedures);
    console.log(`[smoke] ${procedures.length} procedures coletadas.`);
  });

  it("descobriu pelo menos 100 procedures", () => {
    if (!process.env.DATABASE_URL) return;
    expect(procedures.length).toBeGreaterThan(100);
  });

  it("smoke: nenhuma procedure retorna 5xx", async () => {
    if (!process.env.DATABASE_URL) {
      console.log("[smoke] skipado.");
      return;
    }

    const ctx = adminContext();
    const caller = appRouter.createCaller(ctx);
    const falhas: { path: string; tipo: string; erro: string }[] = [];
    const skipados: string[] = [];

    for (const p of procedures) {
      if (isSkipped(p.path)) {
        skipados.push(p.path);
        continue;
      }

      const input = gerarInputMinimo(p.inputSchema);

      // Resolve a função: caller.<router>.<sub>...<proc>
      const partes = p.path.split(".");
      let fn: any = caller;
      for (const parte of partes) fn = fn?.[parte];
      if (typeof fn !== "function") {
        // Procedure inacessível pelo caller (não é função final) — anotamos.
        falhas.push({ path: p.path, tipo: p.type, erro: "não é função no caller" });
        continue;
      }

      try {
        await Promise.race([
          fn(input),
          new Promise((_, rej) => setTimeout(() => rej(new Error("timeout 5s")), 5000)),
        ]);
        // Sucesso é OK
      } catch (err: any) {
        const code = err?.code || err?.data?.code;
        if (code && ERROS_ACEITOS.has(code)) {
          // Erro esperado — não conta como falha
          continue;
        }
        if (err?.message?.includes("timeout 5s")) {
          falhas.push({ path: p.path, tipo: p.type, erro: "timeout 5s" });
          continue;
        }
        // Outros erros: 5xx ou throw bruto = falha
        falhas.push({
          path: p.path,
          tipo: p.type,
          erro: code || err?.message || String(err),
        });
      }
    }

    console.log(`[smoke] testadas: ${procedures.length - skipados.length}`);
    console.log(`[smoke] skipadas:  ${skipados.length}`);
    console.log(`[smoke] falhas:    ${falhas.length}`);
    if (falhas.length > 0) {
      console.log("[smoke] FALHAS DETALHADAS:");
      for (const f of falhas.slice(0, 50)) {
        console.log(`   ${f.path} (${f.tipo}): ${f.erro}`);
      }
    }
    expect(falhas, `${falhas.length} procedures falharam com 5xx ou throw`).toHaveLength(0);
  }, 120_000); // 2min timeout pro teste inteiro
});

/**
 * Limpeza pós-run. Apaga artefatos criados pelos specs (que usaram o
 * prefixo `[E2E]`). Roda uma vez no final, não entre specs.
 *
 * Se algum spec criar dado SEM o prefixo, esse dado fica. Por isso a
 * convenção: TODO dado mutável de teste usa prefixo `[E2E]` no nome.
 *
 * Sem-op se não tem `DATABASE_URL` (rodando contra remote sem credencial
 * direta — limpeza fica pra próxima run via UPSERT idempotente).
 */

import { eq, like } from "drizzle-orm";

async function teardown() {
  if (!process.env.DATABASE_URL) {
    console.log("[teardown] DATABASE_URL ausente — pulando limpeza.");
    return;
  }

  try {
    const { getDb } = await import("../../../server/db");
    const { contatos } = await import("../../../drizzle/schema");
    const db = await getDb();
    if (!db) {
      console.log("[teardown] DB indisponível — pulando.");
      return;
    }

    const result = await db.delete(contatos).where(like(contatos.nome, "[E2E]%"));
    console.log(`[teardown] removidos contatos [E2E]:`, result);
  } catch (err: any) {
    console.warn("[teardown] erro (não-fatal):", err.message);
  }
}

export default teardown;

/**
 * Idempotência do webhook Asaas.
 *
 * O Asaas faz retry quando a resposta HTTP demora ou falha por rede — o mesmo
 * evento (ex. PAYMENT_RECEIVED de uma cobrança X) pode chegar 2-3 vezes.
 * Sem proteção, o SmartFlow dispara WhatsApp/e-mail duplicado pro cliente.
 *
 * `marcarEventoProcessado` usa a constraint UNIQUE da `asaas_webhook_eventos`
 * via `INSERT ... ON DUPLICATE KEY UPDATE`:
 *   - Se o evento é NOVO → insere linha, MySQL retorna affectedRows=1 → true.
 *   - Se JÁ processado → UPDATE no-op, affectedRows=0 → false.
 *
 * O caller usa o boolean pra decidir se dispara ou pula o side-effect.
 */

import { sql } from "drizzle-orm";
import { asaasWebhookEventos } from "../../drizzle/schema";
import { getDb } from "../db";

export async function marcarEventoProcessado(
  escritorioId: number,
  asaasPaymentId: string,
  eventType: string,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  try {
    const res = await db
      .insert(asaasWebhookEventos)
      .values({ escritorioId, asaasPaymentId, eventType })
      // No-op em caso de duplicata: preserva o processedAt original.
      .onDuplicateKeyUpdate({ set: { processedAt: sql`processedAtWhEv` } });

    // mysql2 retorna [{ affectedRows, insertId, ... }, undefined];
    // drizzle retorna só o primeiro item já. Cobrimos as duas shapes.
    const row = Array.isArray(res) ? (res[0] as { affectedRows?: number }) : (res as { affectedRows?: number });
    return (row?.affectedRows ?? 0) === 1;
  } catch {
    // Em caso de erro (ex.: tabela ainda não existe num ambiente antigo),
    // NÃO bloqueamos o fluxo — retorna true para o dispatcher rodar. A
    // migration em auto-migrate cria a tabela, então isso é transitório.
    return true;
  }
}

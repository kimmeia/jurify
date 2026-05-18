/**
 * Verificação de assinatura HMAC do webhook Cal.com.
 *
 * Cal.com assina cada webhook com o `webhookSecret` configurado no painel
 * (Settings → Webhooks → Webhook Secret). O header `X-Cal-Signature-256`
 * contém o hex SHA-256 HMAC do body raw da request.
 *
 * Política do Jurify:
 *  - canal Cal.com COM `webhookSecret` configurado → header obrigatório,
 *    HMAC tem que bater (timing-safe). Inválido = 401.
 *  - canal Cal.com SEM `webhookSecret` (legado) → aceita sem validar mas
 *    loga warn. Operador deve cadastrar o secret pra ativar proteção.
 *
 * Por que timing-safe?
 *  Comparação `!==` em strings pode vazar bytes do segredo via medição
 *  de tempo de resposta (atacante mede latência por byte). `timingSafeEqual`
 *  do `node:crypto` percorre todos os bytes mesmo após match parcial.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Calcula HMAC SHA-256 hex do `payload` (Buffer raw da request) usando o
 * `secret`. Idempotente — não tem estado.
 */
export function calcularHmacSha256Hex(payload: Buffer, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Compara duas strings hex em tempo constante. Retorna `false` quando
 * comprimentos diferem (caso comum: header ausente vira "", esperado tem
 * 64 chars do SHA-256 hex). Usado pra comparar `X-Cal-Signature-256`
 * com o HMAC calculado localmente.
 */
export function compararHexConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf-8"), Buffer.from(b, "utf-8"));
  } catch {
    return false;
  }
}

/**
 * Valida assinatura do webhook Cal.com.
 *  - `secret` vazio/null → retorna `{ok: true, mode: "no-secret"}` (gracioso).
 *  - `secret` setado + header ausente → `{ok: false, mode: "missing-header"}`.
 *  - `secret` setado + header não bate → `{ok: false, mode: "mismatch"}`.
 *  - `secret` setado + bate → `{ok: true, mode: "verified"}`.
 *
 * Nunca lança — sempre retorna estado, pra caller decidir status HTTP.
 */
export type VerificacaoAssinaturaCalcom =
  | { ok: true; mode: "no-secret" | "verified" }
  | { ok: false; mode: "missing-header" | "mismatch"; motivo: string };

export function verificarAssinaturaCalcom(
  rawBody: Buffer | undefined,
  signatureHeader: string | undefined,
  secret: string | undefined,
): VerificacaoAssinaturaCalcom {
  // Sem secret cadastrado: aceita por compat (legado), caller loga warn.
  if (!secret || secret.length === 0) {
    return { ok: true, mode: "no-secret" };
  }
  // Secret cadastrado mas header ausente: rejeita.
  if (!signatureHeader) {
    return {
      ok: false,
      mode: "missing-header",
      motivo: "X-Cal-Signature-256 ausente e canal configurou webhookSecret",
    };
  }
  // Sem body raw (middleware não capturou): rejeita pra evitar bypass.
  if (!rawBody) {
    return {
      ok: false,
      mode: "mismatch",
      motivo: "rawBody indisponível — middleware verify do express.json não foi aplicado",
    };
  }
  const esperado = calcularHmacSha256Hex(rawBody, secret);
  if (!compararHexConstante(esperado, signatureHeader)) {
    return { ok: false, mode: "mismatch", motivo: "HMAC não bate" };
  }
  return { ok: true, mode: "verified" };
}

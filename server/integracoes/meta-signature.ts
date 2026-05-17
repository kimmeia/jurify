/**
 * Verificação de assinatura HMAC do webhook WhatsApp Cloud (Meta).
 *
 * A Meta assina cada webhook com o `appSecret` do App Facebook configurado
 * em `admin_integracoes` (provedor='whatsapp_cloud'). O header
 * `X-Hub-Signature-256` contém `sha256=<hex>` — o hash SHA-256 HMAC do
 * body raw da request.
 *
 * Diferenças vs Cal.com (`./calcom-signature.ts`):
 *  - Header com prefixo `sha256=` (Meta) vs hex puro (Cal.com).
 *  - Secret é GLOBAL no Jurify: vem da config admin
 *    (`admin_integracoes.config.appSecret`), não por canal — Meta App
 *    é único pro tenant e atende todos os escritórios.
 *
 * Política do Jurify:
 *  - `appSecret` configurado em admin_integracoes → header obrigatório,
 *    HMAC tem que bater (timing-safe). Inválido = 401.
 *  - `appSecret` ausente (legado, integração ainda não foi configurada)
 *    → aceita sem validar mas loga warn. Quando admin cadastrar o
 *    appSecret, validação passa a ser obrigatória.
 *
 * Por que timing-safe?
 *  Comparação `!==` em strings pode vazar bytes do segredo via medição
 *  de tempo de resposta (atacante mede latência por byte). `timingSafeEqual`
 *  do `node:crypto` percorre todos os bytes mesmo após match parcial.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PREFIXO_META = "sha256=";

/**
 * Calcula `sha256=<hex>` (formato Meta) do `payload` (Buffer raw) usando
 * o `secret`. Idempotente — não tem estado.
 */
export function calcularAssinaturaMeta(payload: Buffer, secret: string): string {
  const hex = createHmac("sha256", secret).update(payload).digest("hex");
  return `${PREFIXO_META}${hex}`;
}

/**
 * Compara duas strings em tempo constante. Retorna `false` quando
 * comprimentos diferem. Usado pra comparar `X-Hub-Signature-256`
 * com a assinatura calculada localmente.
 */
export function compararStringConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf-8"), Buffer.from(b, "utf-8"));
  } catch {
    return false;
  }
}

/**
 * Valida assinatura do webhook WhatsApp Cloud (Meta).
 *  - `secret` vazio/null → `{ok: true, mode: "no-secret"}` (gracioso).
 *  - `secret` setado + header ausente → `{ok: false, mode: "missing-header"}`.
 *  - `secret` setado + header sem prefixo correto → `{ok: false, mode: "bad-format"}`.
 *  - `secret` setado + rawBody ausente → `{ok: false, mode: "mismatch"}`.
 *  - `secret` setado + HMAC não bate → `{ok: false, mode: "mismatch"}`.
 *  - `secret` setado + bate → `{ok: true, mode: "verified"}`.
 *
 * Nunca lança — sempre retorna estado, pra caller decidir status HTTP.
 */
export type VerificacaoAssinaturaMeta =
  | { ok: true; mode: "no-secret" | "verified" }
  | {
      ok: false;
      mode: "missing-header" | "bad-format" | "mismatch";
      motivo: string;
    };

export function verificarAssinaturaMeta(
  rawBody: Buffer | undefined,
  signatureHeader: string | undefined,
  secret: string | undefined,
): VerificacaoAssinaturaMeta {
  if (!secret || secret.length === 0) {
    return { ok: true, mode: "no-secret" };
  }
  if (!signatureHeader) {
    return {
      ok: false,
      mode: "missing-header",
      motivo: "X-Hub-Signature-256 ausente e appSecret configurado",
    };
  }
  if (!signatureHeader.startsWith(PREFIXO_META)) {
    return {
      ok: false,
      mode: "bad-format",
      motivo: `assinatura sem prefixo 'sha256=' (recebida: '${signatureHeader.slice(0, 20)}...')`,
    };
  }
  if (!rawBody) {
    return {
      ok: false,
      mode: "mismatch",
      motivo: "rawBody indisponível — middleware verify do express.json não foi aplicado",
    };
  }
  const esperado = calcularAssinaturaMeta(rawBody, secret);
  if (!compararStringConstante(esperado, signatureHeader)) {
    return { ok: false, mode: "mismatch", motivo: "HMAC não bate" };
  }
  return { ok: true, mode: "verified" };
}

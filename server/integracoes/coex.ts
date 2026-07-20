/**
 * Coexistência (CoEx) — número WhatsApp usado no app WhatsApp Business do
 * celular E na Cloud API ao mesmo tempo (Embedded Signup com pareamento QR).
 *
 * Ground truth vem da Meta no momento da conexão: `is_on_biz_app` do
 * GET /{phone_number_id}. Persistido na config criptografada do canal como
 * `isOnBizApp` — o antigo `coexMode` era hardcoded "true" pra toda conexão
 * e por isso NÃO serve de sinal (canais legados o carregam mesmo dedicados).
 */

/** Lê a config decriptada do canal e diz se o número está em coexistência. */
export function canalEhCoex(config: unknown): boolean {
  const c = config as { isOnBizApp?: unknown } | null | undefined;
  return c?.isOnBizApp === true || c?.isOnBizApp === "true";
}

/**
 * Decide, a partir da resposta do GET /{phone_number_id} na conexão, se o
 * canal é CoEx e se já sai registrado na Cloud API (dispensa o passo de PIN):
 *  - CoEx: pareamento por QR já registra — PIN não se aplica (e desfaria o CoEx).
 *  - Dedicado com platform_type CLOUD_API: a Meta já reporta registrado.
 */
export function decidirRegistroConexao(info: {
  isOnBizApp?: unknown;
  platformType?: unknown;
}): { coex: boolean; platformType: string; jaRegistrado: boolean } {
  const coex = info?.isOnBizApp === true;
  const platformType = typeof info?.platformType === "string" ? info.platformType : "";
  return { coex, platformType, jaRegistrado: coex || platformType === "CLOUD_API" };
}

/**
 * Cloudflare Turnstile — proteção anti-robô do cadastro.
 *
 * Fail-open por CONFIGURAÇÃO: sem TURNSTILE_SECRET_KEY no ambiente, o
 * signup segue como sempre (o dono liga colando as chaves no Railway +
 * VITE_TURNSTILE_SITE_KEY no build). Com a chave presente, token ausente
 * ou recusado barra o cadastro — é a única defesa real contra bot de
 * anúncio enchendo o banco e queimando a cota diária do Resend.
 *
 * Cloudflare fora do ar NÃO derruba o cadastro (fail-open de runtime):
 * melhor deixar passar um bot do que travar todo visitante legítimo.
 */

import { createLogger } from "./logger";

const log = createLogger("turnstile");

export function turnstileAtivo(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY);
}

export async function verificarTurnstile(
  token: string | undefined,
  ip: string,
): Promise<{ ok: boolean; motivo?: string }> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true };
  if (!token) return { ok: false, motivo: "token_ausente" };

  try {
    const resp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret, response: token, remoteip: ip }),
    });
    const data = (await resp.json()) as { success?: boolean; "error-codes"?: string[] };
    if (data.success) return { ok: true };
    const motivo = (data["error-codes"] ?? []).join(",") || "recusado";
    log.warn({ motivo, ip }, "Turnstile recusou o cadastro");
    return { ok: false, motivo };
  } catch (err: any) {
    log.warn({ err: err?.message }, "Turnstile indisponível — cadastro segue sem verificação");
    return { ok: true, motivo: "verificacao_indisponivel" };
  }
}

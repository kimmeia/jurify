import type { CookieOptions, Request } from "express";

/**
 * Detecta se a request veio por HTTPS, levando em conta proxies reversos.
 *
 * Lê tanto `req.protocol` (que respeita `app.set('trust proxy', ...)`) quanto
 * o header `X-Forwarded-Proto` diretamente, como fallback de defesa.
 */
function isSecureRequest(req: Request): boolean {
  if (req.protocol === "https") return true;

  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;

  const protoList = Array.isArray(forwardedProto)
    ? forwardedProto
    : forwardedProto.split(",");

  return protoList.some((proto) => proto.trim().toLowerCase() === "https");
}

/**
 * Opções do cookie de sessão.
 *
 * Em produção, sempre força `secure: true` — caso contrário o navegador
 * REJEITA cookies com `sameSite=none` (combinação ilegal). Isso fazia o
 * login retornar 200 mas o cookie não persistir, e o usuário ficar preso
 * na tela inicial.
 *
 * Em dev local (HTTP), `secure: false` é permitido com `sameSite: lax`.
 */
export function getSessionCookieOptions(
  req: Request,
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  const isProd = process.env.NODE_ENV === "production";
  const secure = isProd || isSecureRequest(req);

  return {
    httpOnly: true,
    path: "/",
    // Em prod (HTTPS), usa `none` pra permitir popup do Google/Facebook.
    // Em dev local (HTTP), `none` é proibido sem secure=true, então cai pra `lax`.
    sameSite: secure ? "none" : "lax",
    secure,
  };
}

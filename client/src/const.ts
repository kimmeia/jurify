export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

/**
 * Gera a URL de login do portal OAuth (Manus) em runtime.
 *
 * Tolerante a configuração ausente: se `VITE_OAUTH_PORTAL_URL` ou
 * `VITE_APP_ID` não estiverem definidos (ex: em ambientes de
 * desenvolvimento sem OAuth configurado), retorna "/" para
 * redirecionar à home em vez de quebrar a página com `new URL("undefined")`.
 */
export const getLoginUrl = () => {
  const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL;
  const appId = import.meta.env.VITE_APP_ID;

  // Sem OAuth configurado: não tenta construir URL — devolve "/" como fallback
  if (!oauthPortalUrl || !appId) {
    if (typeof console !== "undefined") {
      // eslint-disable-next-line no-console
      console.warn(
        "[auth] VITE_OAUTH_PORTAL_URL ou VITE_APP_ID ausentes — login OAuth desabilitado.",
      );
    }
    return "/";
  }

  try {
    const redirectUri = `${window.location.origin}/api/oauth/callback`;
    const state = btoa(redirectUri);

    const url = new URL(`${oauthPortalUrl}/app-auth`);
    url.searchParams.set("appId", appId);
    url.searchParams.set("redirectUri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("type", "signIn");

    return url.toString();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[auth] Falha ao montar URL de login:", err);
    return "/";
  }
};

/** Indica se o OAuth está configurado (útil para mostrar/esconder botão de login). */
export const isOAuthConfigured = (): boolean => {
  return Boolean(
    import.meta.env.VITE_OAUTH_PORTAL_URL && import.meta.env.VITE_APP_ID,
  );
};


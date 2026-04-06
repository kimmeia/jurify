export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
/** Duração padrão de sessão (7 dias) — usar em vez de ONE_YEAR_MS para novos tokens. */
export const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 7;
/** Janela para renovação automática de sessão (1 dia antes de expirar). */
export const SESSION_REFRESH_WINDOW_MS = 1000 * 60 * 60 * 24;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = 'Please login (10001)';
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';

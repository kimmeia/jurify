/**
 * Helpers de autenticação pra specs E2E.
 *
 * `loginAs(page, role)` faz login programático via UI — mais lento que
 * fazer POST direto no tRPC, mas captura regressões na própria tela
 * de login. Os testes que estão testando outra coisa que não login
 * podem usar `loginViaTrpc(request, role)` pra setar o cookie sem UI.
 */

import { Page, APIRequestContext, expect } from "@playwright/test";
import { SEED_USERS, SEED_PASSWORD, type SeedRole } from "./users";

/**
 * Login completo pela UI. Usa quando você QUER validar a página de
 * login no caminho do teste. Caso contrário, prefira `loginViaTrpc`.
 *
 * Fluxo: home tem Navbar com CTA "Entrar" que abre um Dialog com
 * A tela de login é a rota `/login` (`AuthSplitPage`), com o formulário
 * de e-mail/senha visível de saída. O fixture vai direto nela.
 */
export async function loginAs(page: Page, role: SeedRole): Promise<void> {
  const user = SEED_USERS[role];

  // Login virou página (`/login`), não mais diálogo com tabs. Ir direto na
  // rota também elimina a strict-mode violation que existia entre o botão
  // "Entrar" da navbar e o do formulário.
  await page.goto("/login");

  await page.locator("#login-email").fill(user.email);
  await page.locator("#login-password").fill(SEED_PASSWORD);
  await page.getByRole("button", { name: /^entrar$/i }).click();

  await expect(page).toHaveURL(
    user.role === "admin" ? /\/admin\b/ : /\/(dashboard|configuracoes)\b/,
    { timeout: 20_000 },
  );
}

/**
 * Login via tRPC. Faz POST direto na rota, recebe o cookie de sessão
 * e injeta no contexto da página. Pula UI por completo. Use quando
 * o teste não está testando login em si.
 */
export async function loginViaTrpc(
  page: Page,
  request: APIRequestContext,
  role: SeedRole,
): Promise<void> {
  const user = SEED_USERS[role];
  const baseURL = page.context().options.baseURL || "http://localhost:3000";

  const resp = await request.post(`${baseURL}/api/trpc/auth.loginEmail`, {
    data: {
      json: { email: user.email, password: SEED_PASSWORD },
    },
    headers: { "content-type": "application/json" },
  });
  if (!resp.ok()) {
    throw new Error(`loginViaTrpc falhou (HTTP ${resp.status()}): ${await resp.text()}`);
  }
  // Cookie já vem na resposta — Playwright propaga automaticamente
  // pro `page.context()` desde que a request use o mesmo storageState.
  // Pra garantir, copiamos explicitamente.
  const cookies = (await request.storageState()).cookies;
  await page.context().addCookies(cookies);
}

/** Faz logout (limpa cookies). Usar entre cenários quando necessário. */
export async function logout(page: Page): Promise<void> {
  await page.context().clearCookies();
}

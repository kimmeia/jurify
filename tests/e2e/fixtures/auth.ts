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
 * tabs Entrar/Criar conta + form de email/senha. O fixture clica no
 * CTA, garante que a tab Entrar está ativa, preenche e submete
 * **dentro do dialog** pra evitar strict-mode violation com o CTA da
 * navbar (mesmo nome "Entrar").
 */
export async function loginAs(page: Page, role: SeedRole): Promise<void> {
  const user = SEED_USERS[role];
  await page.goto("/");

  // CTA da navbar abre o dialog. Se já estiver aberto (ex: rota direta
  // futura /auth), pula.
  const dialog = page.getByRole("dialog");
  if (!(await dialog.isVisible({ timeout: 800 }).catch(() => false))) {
    await page.getByRole("button", { name: /^entrar$/i }).first().click();
    await expect(dialog).toBeVisible({ timeout: 5000 });
  }

  // Garante a tab "Entrar" ativa (default já é login, mas robustez)
  const tabEntrar = dialog.getByRole("tab", { name: /^entrar$/i });
  if (await tabEntrar.isVisible({ timeout: 1000 }).catch(() => false)) {
    await tabEntrar.click();
  }

  await dialog.getByLabel(/^e-?mail$/i).fill(user.email);
  await dialog.getByLabel(/^senha$/i).fill(SEED_PASSWORD);
  await dialog.getByRole("button", { name: /^entrar$/i }).click();

  // Espera a navegação pra dashboard (ou /admin pro role admin).
  await expect(page).toHaveURL(
    user.role === "admin" ? /\/admin\b/ : /\/dashboard\b/,
    { timeout: 15_000 },
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

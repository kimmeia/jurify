/**
 * `loginAs(page, user)` — login pela UI usando um user dinâmico (criado
 * por `seedTestEscritorio`). Espelha o fluxo do fixture original em
 * `fixtures/auth.ts` mas aceita qualquer email/senha em vez do
 * `SEED_USERS` fixo.
 *
 * `seedAndLogin(page, role, runId?)` é o combo mais usado pelos testes:
 * cria escritório isolado, escolhe o user com o cargo pedido, loga, e
 * devolve referências pra limpeza.
 */

import { expect, type Page } from "@playwright/test";
import { seedTestEscritorio, TEST_PASSWORD } from "./seed-escritorio";
import type { TestEscritorio, TestRole, TestUser } from "./types";

/**
 * O login deixou de ser diálogo e virou página própria (`/login`,
 * `AuthSplitPage` com `hideTabs`). Os helpers continuavam procurando
 * `getByRole("dialog")` e a tab "Entrar", então falhavam no `beforeEach`
 * de metade dos specs — que ficaram `fixme` em vez de consertados.
 *
 * Aqui vamos direto na rota: sem CTA de navbar, sem tab, sem
 * strict-mode violation entre o botão do topo e o do formulário.
 */
export async function loginAs(page: Page, user: TestUser): Promise<void> {
  await page.goto("/login");

  await page.locator("#login-email").fill(user.email);
  await page.locator("#login-password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /^entrar$/i }).click();

  // Pós-login o destino é decidido em duas navegações (Home.tsx), então
  // esperar por /dashboard direto é corrida. Basta ter saído do /login.
  await expect(page).not.toHaveURL(/\/login\b/, { timeout: 20_000 });
}

export interface SeedAndLoginResult {
  escritorio: TestEscritorio;
  user: TestUser;
  runId: string;
}

export async function seedAndLogin(
  page: Page,
  role: TestRole,
  runId?: string,
): Promise<SeedAndLoginResult> {
  const escritorio = await seedTestEscritorio(runId);
  const user = escritorio.users[role];
  await loginAs(page, user);
  return { escritorio, user, runId: escritorio.runId };
}

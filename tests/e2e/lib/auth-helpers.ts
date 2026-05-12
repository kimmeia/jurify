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

export async function loginAs(page: Page, user: TestUser): Promise<void> {
  await page.goto("/");

  const dialog = page.getByRole("dialog");
  if (!(await dialog.isVisible({ timeout: 800 }).catch(() => false))) {
    await page.getByRole("button", { name: /^entrar$/i }).first().click();
    await expect(dialog).toBeVisible({ timeout: 5000 });
  }

  const tabEntrar = dialog.getByRole("tab", { name: /^entrar$/i });
  if (await tabEntrar.isVisible({ timeout: 1000 }).catch(() => false)) {
    await tabEntrar.click();
  }

  await dialog.getByLabel(/^e-?mail$/i).fill(user.email);
  await dialog.getByLabel(/^senha$/i).fill(TEST_PASSWORD);
  await dialog.getByRole("button", { name: /^entrar$/i }).click();

  await expect(page).toHaveURL(/\/dashboard\b/, { timeout: 15_000 });
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

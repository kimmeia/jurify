import { test, expect } from "@playwright/test";
import { E2E_PREFIX } from "./fixtures/users";

test("cadastro de nova conta cria user e leva pro onboarding", async ({ page }) => {
  // Email único por run — evita colisão.
  const email = `${E2E_PREFIX.replace(/[\[\]]/g, "")}-${Date.now()}@jurify.com.br`.toLowerCase();

  await page.goto("/");
  // Vai pra tab "Criar conta"
  await page.getByRole("tab", { name: /criar conta/i }).click();

  await page.getByLabel(/nome/i).fill(`${E2E_PREFIX} User`);
  await page.getByLabel(/^e-?mail$/i).fill(email);
  await page.getByLabel(/^senha$/i).fill("Smoke123!");

  await page.getByRole("button", { name: /criar conta|cadastrar/i }).click();

  // Após signup, app vai pro dashboard ou pro onboarding (depende do
  // estado do escritório). Espera URL contendo dashboard|onboarding|plans.
  await expect(page).toHaveURL(/dashboard|onboarding|plans/, { timeout: 15_000 });
});

import { test, expect } from "@playwright/test";
import { E2E_PREFIX } from "./fixtures/users";

test("cadastro de nova conta cria user e leva pro onboarding", async ({ page }) => {
  // Email único por run — evita colisão.
  const email = `${E2E_PREFIX.replace(/[\[\]]/g, "")}-${Date.now()}@jurify.com.br`.toLowerCase();
  const senha = "Smoke123!";

  await page.goto("/");
  // CTA "Começar grátis" abre o dialog já na tab Cadastro.
  await page.getByRole("button", { name: /come[cç]ar gr[aá]tis|criar conta|cadastrar/i }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 5000 });

  // Garante tab "Criar conta" ativa (caso o CTA tenha aberto em login).
  const tabSignup = dialog.getByRole("tab", { name: /criar conta/i });
  if (await tabSignup.isVisible({ timeout: 1000 }).catch(() => false)) {
    await tabSignup.click();
  }

  // Form completo — botão fica disabled enquanto faltar campo, senhas
  // não conferem ou checkbox de termos não está marcado.
  await dialog.getByLabel(/nome completo|^nome$/i).fill(`${E2E_PREFIX} User`);
  await dialog.getByLabel(/^e-?mail$/i).fill(email);
  await dialog.getByLabel(/^senha \(/i).fill(senha);
  await dialog.getByLabel(/confirmar senha/i).fill(senha);
  // Checkbox de termos
  await dialog.getByRole("checkbox").check();

  await dialog.getByRole("button", { name: /^criar conta$/i }).click();

  // Após signup, app vai pro dashboard ou pro onboarding (depende do
  // estado do escritório). Espera URL contendo dashboard|onboarding|plans.
  await expect(page).toHaveURL(/dashboard|onboarding|plans/, { timeout: 15_000 });
});

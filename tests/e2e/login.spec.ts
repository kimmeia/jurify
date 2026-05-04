import { test, expect } from "@playwright/test";
import { SEED_USERS, SEED_PASSWORD } from "./fixtures/users";

test.describe("Login com email e senha", () => {
  test("dono consegue entrar e cair no dashboard", async ({ page }) => {
    await page.goto("/");
    // Abre o dialog de auth via CTA "Entrar" da navbar.
    await page.getByRole("button", { name: /^entrar$/i }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Tab "Entrar" já é default; clicar é idempotente.
    await dialog.getByRole("tab", { name: /^entrar$/i }).click();
    await dialog.getByLabel(/^e-?mail$/i).fill(SEED_USERS.dono.email);
    await dialog.getByLabel(/^senha$/i).fill(SEED_PASSWORD);
    await dialog.getByRole("button", { name: /^entrar$/i }).click();

    await expect(page).toHaveURL(/\/dashboard\b/, { timeout: 15_000 });
  });

  test("senha errada mostra mensagem genérica (não vaza email)", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /^entrar$/i }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });

    await dialog.getByRole("tab", { name: /^entrar$/i }).click();
    await dialog.getByLabel(/^e-?mail$/i).fill(SEED_USERS.dono.email);
    await dialog.getByLabel(/^senha$/i).fill("senha-errada-xpto");
    await dialog.getByRole("button", { name: /^entrar$/i }).click();

    // Mensagem (toast do sonner ou inline) deve ser genérica. O sonner
    // renderiza via portal — usa getByText().waitFor() pra esperar
    // explicitamente o toast aparecer (5s pode ser curto pra body.toContainText
    // que retesta sem aguardar mutation acabar).
    await expect(page.getByText(/incorretos|inv[aá]lid/i).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator("body")).not.toContainText(
      /n[aã]o encontrado|usu[aá]rio inexistente/i,
    );
  });

  test("11 logins errados ativam rate limit", async ({ page, request }) => {
    // Usa um email único pra não interferir com outros testes em paralelo
    const fakeEmail = `noexists-${Date.now()}@jurify.com.br`;
    let blocked = false;

    for (let i = 0; i < 12; i++) {
      const resp = await request.post("/api/trpc/auth.loginEmail?batch=1", {
        data: { "0": { json: { email: fakeEmail, password: "x" } } },
        headers: { "content-type": "application/json" },
      });
      const text = await resp.text();
      if (text.includes("Muitas tentativas") || resp.status() === 429) {
        blocked = true;
        break;
      }
    }
    expect(blocked, "rate limit deveria ativar antes da 12ª tentativa").toBe(true);
  });
});

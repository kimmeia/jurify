import { test, expect } from "@playwright/test";
import { SEED_USERS, SEED_PASSWORD } from "./fixtures/users";

test.describe("Login com email e senha", () => {
  test("dono consegue entrar e cair no dashboard", async ({ page }) => {
    await page.goto("/");
    // A landing tem tabs "Entrar"/"Criar conta" — clica "Entrar" se não vier
    // já com login. Usa getByLabel pra ser resistente a refactor visual.
    const tabEntrar = page.getByRole("tab", { name: /^entrar$/i });
    if (await tabEntrar.isVisible({ timeout: 1500 }).catch(() => false)) {
      await tabEntrar.click();
    }
    await page.getByLabel(/^e-?mail$/i).fill(SEED_USERS.dono.email);
    await page.getByLabel(/^senha$/i).fill(SEED_PASSWORD);
    await page.getByRole("button", { name: /^entrar$/i }).click();

    await expect(page).toHaveURL(/\/dashboard\b/, { timeout: 15_000 });
  });

  test("senha errada mostra mensagem genérica (não vaza email)", async ({ page }) => {
    await page.goto("/");
    const tabEntrar = page.getByRole("tab", { name: /^entrar$/i });
    if (await tabEntrar.isVisible({ timeout: 1500 }).catch(() => false)) {
      await tabEntrar.click();
    }
    await page.getByLabel(/^e-?mail$/i).fill(SEED_USERS.dono.email);
    await page.getByLabel(/^senha$/i).fill("senha-errada-xpto");
    await page.getByRole("button", { name: /^entrar$/i }).click();

    // Mensagem deve ser genérica e NÃO conter "email não encontrado" ou similar
    const body = page.locator("body");
    await expect(body).toContainText(/incorretos|inválido/i, { timeout: 5000 });
    await expect(body).not.toContainText(/não encontrado|usuário inexistente/i);
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

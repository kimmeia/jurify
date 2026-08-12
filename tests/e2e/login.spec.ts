/**
 * Login por email e senha, contra staging, a cada 15 minutos.
 *
 * O login já foi um dialog aberto pela landing. Virou rota — `/login`, com
 * layout split, pra campanha apontar direto pra URL — e este arquivo continuou
 * esperando `getByRole("dialog")`. Ficou vermelho a cada rodada por horas sem
 * que nada estivesse quebrado, e smoke sempre vermelho não avisa mais nada
 * quando o login cair de verdade.
 *
 * Por isso os dois primeiros testes entram por caminhos diferentes de
 * propósito: o primeiro clica no CTA da landing (é essa fiação que mudou em
 * silêncio e derrubou o alarme), o segundo vai direto na rota. Se o CTA
 * quebrar de novo, só um dos dois cai — e a mensagem diz qual metade quebrou.
 */

import { test, expect } from "@playwright/test";
import { SEED_USERS, SEED_PASSWORD } from "./fixtures/users";

test.describe("Login com email e senha", () => {
  test("dono consegue entrar e cair no dashboard", async ({ page }) => {
    await page.goto("/");
    // O CTA "Entrar" da navbar navega pra rota de login; não abre modal.
    await page.getByRole("button", { name: /^entrar$/i }).first().click();
    await expect(page).toHaveURL(/\/login\b/, { timeout: 10_000 });

    await page.getByLabel(/^e-?mail$/i).fill(SEED_USERS.dono.email);
    await page.getByLabel(/^senha$/i).fill(SEED_PASSWORD);
    await page.getByRole("button", { name: /^entrar$/i }).click();

    // Pós-sucesso a página manda pra "/" e o Home é quem decide o destino
    // (admin → /admin, com assinatura → /dashboard, sem → /plans). Por isso a
    // espera é generosa: são duas navegações, não uma.
    await expect(page).toHaveURL(/\/dashboard\b/, { timeout: 15_000 });
  });

  test("senha errada mostra mensagem genérica (não vaza email)", async ({ page }) => {
    await page.goto("/login");

    await page.getByLabel(/^e-?mail$/i).fill(SEED_USERS.dono.email);
    await page.getByLabel(/^senha$/i).fill("senha-errada-xpto");
    await page.getByRole("button", { name: /^entrar$/i }).click();

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
    const fakeEmail = `noexists-${Date.now()}@juridflow.com.br`;
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

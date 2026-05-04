import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures/auth";

test.describe("Admin > Erros", () => {
  test("admin abre /admin/erros sem crash", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/admin/erros");
    await expect(page).toHaveURL(/\/admin\/erros/);

    // Sem Sentry configurado: deve aparecer card de CTA pra configurar.
    // Com Sentry configurado: deve listar issues OU mostrar empty state.
    // Em qualquer caso: a página renderiza e não quebra.
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(
      /erro 5\d\d|internal server error|cannot read property/i,
    );

    // Header da página deve aparecer
    await expect(page.getByRole("heading", { name: /erros/i }).first()).toBeVisible();
  });

  test("não-admin tem 403 ou redirect ao tentar /admin/erros", async ({ page }) => {
    await loginAs(page, "dono"); // dono não é admin do sistema
    await page.goto("/admin/erros");

    // AdminLayout faz <Redirect to="/dashboard" /> via React, que é
    // client-side e leva uns ms — espera o redirect resolver antes de
    // assertir. Em vez de aguardar URL específica (pode ser /dashboard,
    // /plans, /configuracoes...), espera só sair de /admin/erros OU
    // aparecer mensagem de bloqueio.
    await page.waitForFunction(
      () => !window.location.pathname.startsWith("/admin/erros") ||
        /sem permiss|acesso negado|forbidden/i.test(document.body.innerText),
      undefined,
      { timeout: 10_000 },
    );

    const url = page.url();
    if (url.includes("/admin/erros")) {
      await expect(page.locator("body")).toContainText(/sem permiss|acesso negado|forbidden/i);
    } else {
      expect(url).not.toMatch(/\/admin\/erros$/);
    }
  });
});

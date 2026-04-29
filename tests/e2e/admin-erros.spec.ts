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
    const resp = await page.goto("/admin/erros");
    // Espera ou redirect (não fica em /admin/erros) ou aviso visível
    const url = page.url();
    if (url.includes("/admin/erros")) {
      // Se renderizou a página, deve mostrar mensagem de permissão
      await expect(page.locator("body")).toContainText(/sem permiss|acesso negado|forbidden/i);
    } else {
      // Redirecionou — qualquer destino que não seja /admin/erros é OK
      expect(url).not.toMatch(/\/admin\/erros$/);
    }
  });
});

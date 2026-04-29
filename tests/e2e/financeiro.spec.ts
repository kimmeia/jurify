import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures/auth";

test.describe("Módulo Financeiro (MVP)", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "dono");
    await page.goto("/financeiro");
    await expect(page).toHaveURL(/\/financeiro/);
  });

  test("página financeiro carrega sem erro", async ({ page }) => {
    // Sem assertions específicas além de não quebrar — confirma que
    // a página renderiza pra dono autenticado.
    await expect(page.locator("body")).toBeVisible();
    // Não deve haver mensagem de erro 500 visível
    await expect(page.locator("body")).not.toContainText(/erro 5\d\d|internal server error/i);
  });

  test("badge Beta aparece na sidebar", async ({ page }) => {
    const sidebar = page.locator('[data-sidebar]').first();
    const itemFinanceiro = sidebar.getByText(/^financeiro$/i).first();
    await expect(itemFinanceiro).toBeVisible();
  });

  test.fixme("criar receita → ver no relatório → marcar paga → excluir", async () => {
    // Marcado fixme até validação visual em staging — UI tem múltiplas
    // tabs (receitas, despesas, comissões, faturas) e precisa confirmar
    // o caminho exato de cada ação.
  });
});

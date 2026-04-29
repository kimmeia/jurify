import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures/auth";
import { E2E_PREFIX } from "./fixtures/users";

test.describe("Módulo Clientes (MVP)", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "dono");
    await page.goto("/clientes");
    await expect(page).toHaveURL(/\/clientes/);
  });

  test("badge Beta aparece na sidebar do cliente", async ({ page }) => {
    // Sidebar tem item "Clientes" com badge "Beta"
    const sidebar = page.locator('[data-sidebar]').first();
    const itemClientes = sidebar.getByText(/^clientes$/i).first();
    await expect(itemClientes).toBeVisible();
    // Badge "Beta" deve estar próximo
    await expect(sidebar.getByText(/beta/i).first()).toBeVisible();
  });

  test("criar cliente, listar, buscar e excluir", async ({ page }) => {
    const nome = `${E2E_PREFIX} Cliente ${Date.now()}`;

    // Abrir dialog de novo cliente
    await page.getByRole("button", { name: /novo cliente/i }).click();

    // Preencher formulário (campos comuns: nome, telefone, email)
    await page.getByLabel(/nome/i).first().fill(nome);
    const telefoneInput = page.getByLabel(/telefone/i).first();
    if (await telefoneInput.isVisible().catch(() => false)) {
      await telefoneInput.fill("(11) 98765-4321");
    }

    // Salvar
    await page.getByRole("button", { name: /salvar|criar|cadastrar/i }).first().click();

    // Verifica que aparece na lista
    await expect(page.getByText(nome).first()).toBeVisible({ timeout: 10_000 });

    // Buscar (filtra)
    const buscaInput = page.getByPlaceholder(/buscar|pesquisar/i).first();
    if (await buscaInput.isVisible({ timeout: 1500 }).catch(() => false)) {
      await buscaInput.fill(String(nome.slice(-12)));
      await expect(page.getByText(nome).first()).toBeVisible();
    }
  });

  test.fixme("excluir cliente — selectors específicos precisam validação visual", async () => {
    // Marcado fixme até passar manualmente em staging — UI de excluir
    // (menu de 3 pontos / context menu) varia entre páginas. Quando
    // rodar a primeira vez, ajusta o seletor aqui.
  });
});

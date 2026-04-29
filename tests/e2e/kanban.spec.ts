import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures/auth";

test.describe("Módulo Kanban (MVP)", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "dono");
    await page.goto("/kanban");
    await expect(page).toHaveURL(/\/kanban/);
  });

  test("página Kanban carrega sem erro", async ({ page }) => {
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/erro 5\d\d|internal server error/i);
  });

  test("badge Beta aparece na sidebar", async ({ page }) => {
    const sidebar = page.locator('[data-sidebar]').first();
    await expect(sidebar.getByText(/^kanban$/i).first()).toBeVisible();
  });

  test.fixme("criar tarefa → mover entre colunas → editar → concluir", async () => {
    // Drag-and-drop entre colunas precisa de page.dragAndDrop com
    // selectors exatos das colunas — inspeção em staging primeiro.
  });
});

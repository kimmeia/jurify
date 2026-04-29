import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures/auth";
import { E2E_PREFIX } from "./fixtures/users";

test.describe("Roadmap público", () => {
  test("dono cria sugestão e vê na lista", async ({ page }) => {
    await loginAs(page, "dono");
    await page.goto("/roadmap");
    await expect(page).toHaveURL(/\/roadmap/);

    const titulo = `${E2E_PREFIX} Sugestão ${Date.now()}`;
    await page.getByRole("button", { name: /sugerir melhoria/i }).click();
    await page.getByLabel(/t[ií]tulo/i).fill(titulo);
    await page.getByLabel(/descri[cç][aã]o/i).fill(
      "Descrição válida da sugestão automática gerada pelo robô E2E.",
    );
    await page.getByRole("button", { name: /enviar/i }).click();

    await expect(page.getByText(titulo).first()).toBeVisible({ timeout: 10_000 });
  });

  test.fixme("voto cruzado entre 2 contas + admin troca status", async () => {
    // Requer 2 sessões diferentes em paralelo + permissão admin.
    // Caminho de teste é mais elaborado — fixme até validação em staging.
  });
});

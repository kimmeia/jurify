import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures/auth";
import { E2E_PREFIX } from "./fixtures/users";

test.describe("Roadmap público", () => {
  test("dono cria sugestão e vê na lista", async ({ page }) => {
    await loginAs(page, "dono");
    await page.goto("/roadmap");
    await expect(page).toHaveURL(/\/roadmap/);

    const titulo = `${E2E_PREFIX} Sugestão ${Date.now()}`;
    await page.getByRole("button", { name: /sugerir melhoria/i }).first().click();

    // O Dialog de Roadmap usa <Label> sem htmlFor — getByLabel não
    // associa Label↔Input. Usa placeholder pra achar os campos.
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await dialog.getByPlaceholder(/permitir importar|funcionalidade|ex:/i).first().fill(titulo);
    await dialog.getByPlaceholder(/o qu[eê]\?|cen[aá]rio|por qu[eê]/i).first().fill(
      "Descrição válida da sugestão automática gerada pelo robô E2E para validar o fluxo.",
    );
    await dialog.getByRole("button", { name: /enviar|publicar|criar/i }).click();

    await expect(page.getByText(titulo).first()).toBeVisible({ timeout: 10_000 });
  });

  test.fixme("voto cruzado entre 2 contas + admin troca status", async () => {
    // Requer 2 sessões diferentes em paralelo + permissão admin.
    // Caminho de teste é mais elaborado — fixme até validação em staging.
  });
});

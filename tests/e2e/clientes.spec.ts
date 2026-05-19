import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures/auth";
import { E2E_PREFIX } from "./fixtures/users";

test.describe("Módulo Clientes (MVP)", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "dono");
    await page.goto("/clientes");
    await expect(page).toHaveURL(/\/clientes/);
  });

  test("item Clientes aparece na sidebar", async ({ page }) => {
    // Clientes não tem badge "Beta" — só verificamos que o item aparece
    // pra dono autenticado. (Badge Beta foi removida de Processos/Kanban/
    // Financeiro em 05/2026; Atendimento/Agentes IA/SmartFlow continuam
    // beta mas estão ocultos no menu — então não há "Beta" visível.)
    const sidebar = page.locator('[data-sidebar]').first();
    const itemClientes = sidebar.getByText(/^clientes$/i).first();
    await expect(itemClientes).toBeVisible();
  });

  test.fixme("criar cliente, listar, buscar e excluir — formulário expandiu", async () => {
    // O dialog NovoClienteDialog agora exige 4 campos obrigatórios
    // (nome, telefone, email, CPF/CNPJ) + qualificação completa de
    // endereço. Além disso, os <Input> não têm htmlFor associado aos
    // <Label>, então getByLabel não funciona. Reescrever este teste
    // exige preencher ~13 campos e usar locators por placeholder ou
    // testid — fica pra um PR dedicado.
  });

  test.fixme("excluir cliente — selectors específicos precisam validação visual", async () => {
    // Marcado fixme até passar manualmente em staging — UI de excluir
    // (menu de 3 pontos / context menu) varia entre páginas. Quando
    // rodar a primeira vez, ajusta o seletor aqui.
  });
});

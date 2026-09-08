/**
 * A descoberta é a peça de que todo o resto do robô depende.
 *
 * Se ela contar demais, o relatório enche de linha inútil (o menu
 * lateral recontado em 19 rotas) e o número de "ações mapeadas" perde o
 * sentido. Se contar de menos, o robô diz que cobriu um módulo que nem
 * enxergou — que é o pior dos dois, porque parece bom.
 *
 * Este spec roda contra HTML sintético: sem app no ar, sem banco, sem
 * login. É de propósito — as regras de contagem precisam de teste que
 * não dependa do estado do sistema, senão viram sabedoria oral.
 */

import { test, expect } from "@playwright/test";
import { descobrirAcoes } from "./descoberta";

const PAGINA = `
  <nav data-sidebar>
    <button>Clientes</button>
    <button>Processos</button>
  </nav>
  <header><button>Notificações</button></header>
  <main>
    <button>Novo cliente</button>
    <button disabled>Salvar</button>
    <button aria-disabled="true">Excluir</button>
    <button style="display:none">Invisível</button>
    <button aria-label="Abrir filtros"><svg></svg></button>
    <button>Editar</button>
    <button>Editar</button>
    <div role="menuitem">Duplicar</div>
    <div role="button">Um card inteiro que virou botão clicável com texto longo demais pra ser rótulo</div>
  </main>
`;

test.describe("descoberta de ações", () => {
  test.beforeEach(async ({ page }) => {
    await page.setContent(PAGINA);
  });

  test("conta o conteúdo e ignora navegação, desabilitado e invisível", async ({ page }) => {
    const acoes = await descobrirAcoes(page, "/clientes");

    expect(acoes.map((a) => a.nome)).toEqual([
      "Novo cliente",
      "Abrir filtros",
      "Editar",
      "Editar",
      "Duplicar",
    ]);
  });

  test("homônimos ganham identidade estável e distinta", async ({ page }) => {
    const acoes = await descobrirAcoes(page, "/clientes");
    const editar = acoes.filter((a) => a.nome === "Editar");

    expect(editar.map((a) => a.id)).toEqual([
      "/clientes::Editar::0",
      "/clientes::Editar::1",
    ]);
  });

  test("a identidade sobrevive a uma segunda passada", async ({ page }) => {
    const primeira = await descobrirAcoes(page, "/clientes");
    const segunda = await descobrirAcoes(page, "/clientes");

    // O executor recarrega a rota antes de cada clique e reencontra o
    // controle pelo `id`. Se ele mudasse entre passadas, toda ação viraria
    // "o controle não apareceu na segunda carga".
    expect(segunda.map((a) => a.id)).toEqual(primeira.map((a) => a.id));
  });

  test("a marcação endereça o controle certo", async ({ page }) => {
    const acoes = await descobrirAcoes(page, "/clientes");
    const segundoEditar = acoes.find((a) => a.id === "/clientes::Editar::1")!;

    const marcado = page.locator(`[data-robo-acao="${segundoEditar.ocorrenciaDom}"]`);
    await expect(marcado).toHaveText("Editar");

    // Endereço, não identidade: a marcação tem que apontar pro SEGUNDO
    // "Editar", não pro primeiro que casa com o texto.
    const todosEditar = page.locator("main button", { hasText: /^Editar$/ });
    await expect(marcado).toHaveAttribute(
      "data-robo-acao",
      String(segundoEditar.ocorrenciaDom),
    );
    expect(await todosEditar.nth(1).getAttribute("data-robo-acao")).toBe(
      String(segundoEditar.ocorrenciaDom),
    );
  });
});

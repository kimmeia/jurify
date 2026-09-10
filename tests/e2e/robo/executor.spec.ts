/**
 * As duas regras do robô, verificadas de verdade.
 *
 * "Nunca para na primeira falha" e "sem prova do efeito não é ok" são
 * fáceis de escrever num documento e fáceis de perder num refactor. Aqui
 * elas são exercitadas contra uma página sintética servida por
 * interceptação de rota — sem app no ar, sem banco, sem login.
 *
 * A página tem um exemplar de cada desfecho que o robô sabe emitir. Se
 * alguém quebrar a ordem de precedência do executor (prova passando na
 * frente de erro de JS, por exemplo), um destes casos vira o desfecho
 * errado e o teste diz qual.
 */

import { test, expect, type Page } from "@playwright/test";
import { watchConsoleErrors, watchNetwork5xx } from "../lib/page-helpers";
import { exercitarRota, instalarSonda } from "./executor";
import type { ResultadoAcao } from "./tipos";

const PAGINA = `<!doctype html><html><body>
  <nav data-sidebar><button>Clientes</button></nav>
  <main>
    <button onclick="document.getElementById('dlg').style.display='block'">Novo cliente</button>
    <button onclick="void 0">Nova tarefa</button>
    <button onclick="confirm('Excluir este item?')">Excluir item</button>
    <button onclick="window.naoExiste.explode()">Recalcular</button>
    <button onclick="void 0">Alternar visualização</button>
    <button onclick="void 0">Convidar colaborador</button>
    <div id="dlg" role="dialog" style="display:none">Formulário</div>
  </main>
</body></html>`;

async function varrer(page: Page): Promise<Map<string, ResultadoAcao>> {
  await page.route("**/*", (rota) =>
    rota.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: PAGINA,
    }),
  );
  const sonda = instalarSonda(page, watchConsoleErrors(page), watchNetwork5xx(page));
  const resultados = await exercitarRota(sonda, "/clientes");
  return new Map(resultados.map((r) => [r.nome, r]));
}

/**
 * Reproduz uma SPA: `domcontentloaded` dispara com o corpo vazio e os
 * controles só aparecem quando o JS monta. Sem spinner nenhum no meio —
 * que é justamente o que enganava a versão anterior da prontidão.
 */
const PAGINA_SPA_LENTA = `<!doctype html><html><body>
  <div id="root"></div>
  <script>
    setTimeout(function () {
      document.getElementById('root').innerHTML =
        '<main><button onclick="void 0">Alternar visualização</button></main>';
    }, 2500);
  </script>
</body></html>`;

test.describe("prontidão da tela", () => {
  test.setTimeout(60_000);

  test("espera a SPA montar antes de contar a superfície", async ({ page }) => {
    await page.route("**/*", (rota) =>
      rota.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: PAGINA_SPA_LENTA,
      }),
    );
    const sonda = instalarSonda(page, watchConsoleErrors(page), watchNetwork5xx(page));
    const resultados = await exercitarRota(sonda, "/clientes");

    // Medido contra o app real: no `domcontentloaded` a rota tinha 0
    // botões e 0 spinners, e o robô fechava a varredura com "0 de 0,
    // nenhum problema". Verde sem ter medido nada é o defeito que este
    // robô existe pra caçar — uma camada acima.
    expect(resultados.map((r) => r.nome)).toEqual(["Alternar visualização"]);
  });

  test("rota que não expõe nada vira linha, não silêncio", async ({ page }) => {
    await page.route("**/*", (rota) =>
      rota.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: '<!doctype html><html><body><main><button aria-label=""></button><p>Só texto</p></main></body></html>',
      }),
    );
    const sonda = instalarSonda(page, watchConsoleErrors(page), watchNetwork5xx(page));
    const resultados = await exercitarRota(sonda, "/relatorios");

    expect(resultados).toHaveLength(1);
    expect(resultados[0]!.veredito.estado).toBe("nao_verificada");
  });
});

test.describe("portão de produto na frente da rota", () => {
  test.setTimeout(60_000);

  test("vira uma linha, não uma por controle", async ({ page }) => {
    await page.route("**/*", (rota) =>
      rota.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: `<!doctype html><html><body>
          <main>
            <button>Novo cliente</button>
            <button>Editar</button>
            <button>Excluir</button>
          </main>
          <div role="dialog"><h2>Atualizamos os Termos de Uso</h2>
            <button>Aceitar e continuar</button></div>
        </body></html>`,
      }),
    );
    const sonda = instalarSonda(page, watchConsoleErrors(page), watchNetwork5xx(page));
    const resultados = await exercitarRota(sonda, "/dashboard");

    // Medido no app: o modal de re-aceite dos Termos fez 48 ações de 4
    // rotas voltarem como falha, todas a mesma coisa. Um problema
    // multiplicado por quarenta e oito é relatório que ninguém lê duas
    // vezes.
    expect(resultados).toHaveLength(1);
    expect(resultados[0]!.veredito.motivo).toBe("rota_bloqueada");
    expect(resultados[0]!.veredito.evidencia).toContain("Termos de Uso");
  });
});

test.describe("veredito do robô de ação", () => {
  // Um dos casos espera 4s pela prova que nunca chega, e outro espera o
  // ciclo de erro de JS; a varredura inteira recarrega a rota por ação.
  test.setTimeout(120_000);

  test("cada desfecho sai com o estado e o motivo certos", async ({ page }) => {
    const porNome = await varrer(page);

    // A regra que muda o produto: clique sem incidente NÃO é aprovação.
    expect(porNome.get("Alternar visualização")?.veredito).toMatchObject({
      estado: "nao_verificada",
      motivo: "sem_prova_registrada",
    });

    // Diálogo nativo: o robô dispensa, a ação não acontece, e por isso
    // não pode contar como testada. É o verde falso que a terceira cor
    // existe pra impedir.
    expect(porNome.get("Excluir item")?.veredito).toMatchObject({
      estado: "nao_verificada",
      motivo: "dialogo_nativo",
    });

    // Cerca: nem chega a clicar.
    expect(porNome.get("Convidar colaborador")?.veredito).toMatchObject({
      estado: "nao_verificada",
      motivo: "cerca_integracao_externa",
    });

    // Erro de JS é defeito, sempre.
    expect(porNome.get("Recalcular")?.veredito.estado).toBe("falhou");

    // Prova registrada que passa é a única forma de virar `ok`.
    expect(porNome.get("Novo cliente")?.veredito.estado).toBe("ok");

    // E a mesma prova reprovando vira falha, não "não verificada": a
    // tela prometeu um formulário e não entregou.
    expect(porNome.get("Nova tarefa")?.veredito.estado).toBe("falhou");
  });

  test("não para na primeira falha", async ({ page }) => {
    const porNome = await varrer(page);

    // "Recalcular" quebra no meio da página. Se o executor abortasse
    // ali, as ações seguintes sumiriam do relatório — foi exatamente o
    // defeito da primeira versão do robô de jornada, onde uma rota
    // travada escondia as outras 18.
    expect([...porNome.keys()]).toEqual(
      expect.arrayContaining(["Recalcular", "Alternar visualização", "Convidar colaborador"]),
    );
  });
});

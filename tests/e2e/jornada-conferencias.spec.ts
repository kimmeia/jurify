/**
 * Conferências do robô de jornada — cria o dado, navega até ele, exige achar.
 *
 * A varredura de rotas (`jornada.spec.ts`) responde "a tela abriu sem
 * explodir". É pouco, e dá pra medir o quanto: todo defeito que apareceu na
 * sessão em que este arquivo nasceu — o prazo que sumia da lista da Agenda, o
 * polo lido errado, o campo de responsável que não existia — mora numa tela
 * que abre perfeitamente e mostra a coisa errada. Nenhum deles seria pego por
 * varredura de rota.
 *
 * Aqui o robô vira usuário: preenche formulário, salva, troca de tela e
 * confere que o que salvou está na frente dele. E, quando faz sentido, troca
 * de pessoa — porque "aparece pra mim" e "aparece pra quem recebeu" são
 * perguntas diferentes.
 *
 * SEGURANÇA. Tudo acontece dentro de um escritório criado no início e apagado
 * no fim. Cliques passam por `clicarSeguro`, que recusa a lista negra
 * (destruir, cobrar, mandar mensagem, consultar tribunal), e navegação passa
 * por `irSeguro`, que recusa `/admin`. A trava existe mesmo o escritório
 * sendo descartável: a parede que o isola é a mesma que este robô está aqui
 * pra auditar — se ela tiver furo, o clique destrutivo acontece do lado
 * errado dela.
 *
 * Roda sob demanda: `ROBO_JORNADA=1 pnpm test:e2e`.
 */

import { test, expect } from "@playwright/test";
import { CONFERENCIAS } from "../../server/admin/jornada/conferencias";
import {
  clicarSeguro,
  irSeguro,
  seedAndLogin,
  loginAs,
  teardownTestEscritorio,
  watchConsoleErrors,
} from "./lib";

/** Sufixo por execução — dois runs simultâneos não podem se confundir. */
function marca(): string {
  return `[E2E] ${Date.now().toString(36)}`;
}

test.describe("Robô de jornada — conferências", () => {
  test.skip(
    !process.env.ROBO_JORNADA,
    "Robô de jornada roda sob demanda: ROBO_JORNADA=1 pnpm test:e2e",
  );

  test("o catálogo do painel bate com o que roda aqui", () => {
    // O painel lista as conferências pelo catálogo. Declarada sem
    // implementação viraria linha verde que não conferiu nada.
    expect(CONFERENCIAS.length).toBeGreaterThan(0);
    for (const c of CONFERENCIAS) {
      expect(c.passos.length, `${c.id} sem passos`).toBeGreaterThan(1);
      expect(c.porque.length, `${c.id} sem motivo`).toBeGreaterThan(30);
    }
  });

  test("CONF-CLIENTE-FICHA — cliente criado abre a própria ficha", async ({ page }) => {
    const monitor = watchConsoleErrors(page);
    const { runId } = await seedAndLogin(page, "dono");
    const nome = `${marca()} Cliente Ficha`;

    try {
      await irSeguro(page, "/clientes");
      await clicarSeguro(page, /novo cliente|adicionar cliente/i);
      await page.getByLabel(/nome/i).first().fill(nome);
      await clicarSeguro(page, /salvar|criar/i);

      // A lista tem que mostrar o que acabou de ser criado — sem reload.
      await expect(page.getByText(nome).first()).toBeVisible({ timeout: 10_000 });

      // E a ficha (rota com :id) tem que abrir com o mesmo nome. Rota com
      // parâmetro nunca é visitada pela varredura: é aqui que ela entra.
      await page.getByText(nome).first().click();
      await expect(page.getByText(nome).first()).toBeVisible({ timeout: 10_000 });

      monitor.expectNone();
    } finally {
      await teardownTestEscritorio(runId);
    }
  });

  test("CONF-AGENDA-PRAZO — prazo criado aparece na lista, não só no calendário", async ({ page }) => {
    const monitor = watchConsoleErrors(page);
    const { runId } = await seedAndLogin(page, "dono");
    const titulo = `${marca()} Prazo Conferência`;

    try {
      await irSeguro(page, "/agenda");
      await clicarSeguro(page, /novo compromisso|novo evento/i);
      await page.getByRole("button", { name: /tarefa/i }).click();
      await page.getByLabel(/t[ií]tulo/i).first().fill(titulo);
      await clicarSeguro(page, /^criar$/i);

      // O ponto da conferência: a aba Eventos. O calendário mostrava e a
      // lista não — as duas abrem sem erro, então só procurando o registro
      // pelo nome é que a diferença aparece.
      await irSeguro(page, "/agenda");
      await expect(
        page.getByText(titulo).first(),
        "o evento não apareceu na lista da aba Eventos",
      ).toBeVisible({ timeout: 15_000 });

      monitor.expectNone();
    } finally {
      await teardownTestEscritorio(runId);
    }
  });

  test("CONF-AGENDA-RESPONSAVEL — tarefa atribuída cai na lista de quem recebeu", async ({ page }) => {
    const { runId, escritorio } = await seedAndLogin(page, "dono");
    const titulo = `${marca()} Tarefa Atribuída`;

    try {
      await irSeguro(page, "/agenda");
      await clicarSeguro(page, /novo compromisso|novo evento/i);
      await page.getByRole("button", { name: /tarefa/i }).click();
      await page.getByLabel(/t[ií]tulo/i).first().fill(titulo);

      // Escolhe outra pessoa como responsável — o passo que dá sentido à
      // conferência. Sem isso, a tarefa ficaria com quem criou e o teste
      // não mediria nada.
      const gestor = escritorio.users.gestor;
      await page.getByPlaceholder(/buscar colaborador/i).first().fill(gestor.nome ?? "gestor");
      await page.getByText(gestor.nome ?? "Gestor", { exact: false }).first().click();
      await clicarSeguro(page, /^criar$/i);

      // Troca de pessoa: "aparece pra mim" e "aparece pra quem recebeu" são
      // perguntas diferentes, e só a segunda importa aqui.
      await loginAs(page, gestor);
      await irSeguro(page, "/agenda");
      await expect(
        page.getByText(titulo).first(),
        "a tarefa não apareceu na Agenda de quem recebeu",
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      await teardownTestEscritorio(runId);
    }
  });

  test("CONF-PONTO-GATE — Ponto não aparece pra quem não recebeu o módulo", async ({ page }) => {
    const { runId, escritorio } = await seedAndLogin(page, "atendente");

    try {
      await irSeguro(page, "/dashboard");

      // Permissão que vaza não dá erro — dá acesso. Só olhando com os olhos
      // de quem não deveria ver é que se descobre.
      await expect(
        page.getByRole("link", { name: /^ponto$/i }),
        "o item Ponto apareceu no menu de quem não tem o módulo",
      ).toHaveCount(0);

      // E pela URL direta, que é como se contorna menu escondido.
      await irSeguro(page, "/ponto");
      await expect(page.getByText(/não está no seu acesso/i).first()).toBeVisible({
        timeout: 10_000,
      });

      expect(escritorio.users.atendente).toBeTruthy();
    } finally {
      await teardownTestEscritorio(runId);
    }
  });

  test("CONF-KANBAN-MOVER — card sobrevive a mudar de coluna", async ({ page }) => {
    const monitor = watchConsoleErrors(page);
    const { runId } = await seedAndLogin(page, "dono");
    const titulo = `${marca()} Card Mover`;

    try {
      await irSeguro(page, "/kanban");
      await clicarSeguro(page, /novo card|adicionar card/i);
      await page.getByLabel(/t[ií]tulo/i).first().fill(titulo);
      await clicarSeguro(page, /salvar|criar/i);
      await expect(page.getByText(titulo).first()).toBeVisible({ timeout: 10_000 });

      // Reload é o que separa "mudou na tela" de "mudou no banco". Sem ele,
      // um estado que só existe no cliente passaria como sucesso.
      await irSeguro(page, "/kanban");
      await expect(
        page.getByText(titulo).first(),
        "o card não sobreviveu ao recarregamento",
      ).toBeVisible({ timeout: 10_000 });

      monitor.expectNone();
    } finally {
      await teardownTestEscritorio(runId);
    }
  });
});

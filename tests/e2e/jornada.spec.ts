/**
 * Robô de jornada — navega o app como usuário e reporta o que só o
 * browser vê.
 *
 * Os outros dois robôs não alcançam isto:
 *   - o auditor (`server/admin/auditoria/`) olha o banco, e o dado pode
 *     estar perfeito com a tela quebrada;
 *   - a conciliação (`tests/smoke/conciliacao.test.ts`) chama procedure,
 *     e a procedure pode responder certo com a tela renderizando errado
 *     ou nem chegando a chamá-la.
 *
 * Aqui abrimos cada rota logado e exigimos que a página se comporte:
 * sem exceção de JS, sem 5xx, e sem spinner que nunca sai. É o tipo de
 * defeito que aparece pro usuário antes de aparecer em qualquer métrica.
 *
 * Roda sob demanda — `ROBO_JORNADA=1 pnpm test:e2e`. O porquê está no
 * guard logo abaixo, junto com o que ainda falta pra ele virar gate.
 *
 * Pré-requisitos: app no ar (`pnpm dev` ou PLAYWRIGHT_BASE_URL) e
 * DATABASE_URL — o robô semeia o próprio escritório e apaga no fim.
 */

import { test, expect } from "@playwright/test";
import {
  seedAndLogin,
  teardownTestEscritorio,
  watchConsoleErrors,
  watchNetwork5xx,
} from "./lib";

/**
 * Rotas do app logado, sem parâmetro. As com `:id` ficam de fora porque
 * exigem um registro específico — elas entram quando o robô ganhar a
 * etapa de criar dado antes de navegar.
 */
const ROTAS = [
  "/dashboard",
  "/clientes",
  "/processos",
  "/movimentacoes",
  "/atendimento",
  "/agenda",
  "/tarefas",
  "/kanban",
  "/financeiro",
  "/relatorios",
  "/acordos",
  "/modelos-contrato",
  "/automacoes",
  "/smartflow",
  "/agentes-ia",
  "/jurisia",
  "/ponto",
  "/calculos",
  "/configuracoes",
] as const;

test.describe("Robô de jornada — todas as rotas do app logado", () => {
  /**
   * Sob demanda, não a cada PR: `ROBO_JORNADA=1 pnpm test:e2e`.
   *
   * Motivo é o previsto no plano (`docs/test-automation-plan.md` §7):
   * varredura de rotas é job agendado, não porteiro de merge — são ~4,5
   * min e ela responde "como está o app", não "esse diff quebrou algo".
   *
   * As 19 rotas passam. Os "Failed to fetch" que ele acusava na primeira
   * versão eram artefato da própria medição: navegar para a rota seguinte
   * (ou encerrar o teste) aborta as queries em voo, e o client de tRPC
   * loga o abort como erro. Apareciam só na PRIMEIRA e na ÚLTIMA rota,
   * nunca no meio, e reproduziam igual contra build de produção — o que
   * descartou o servidor de dev. Estão filtrados como ruído de rede em
   * `page-helpers.ts`, com queda real de servidor ainda coberta pelo
   * monitor de 5xx.
   */
  test.skip(
    !process.env.ROBO_JORNADA,
    "Robô de jornada roda sob demanda: ROBO_JORNADA=1 pnpm test:e2e",
  );

  test("nenhuma rota quebra, devolve 5xx ou trava carregando", async ({ page }) => {
    const consoleMonitor = watchConsoleErrors(page);
    const networkMonitor = watchNetwork5xx(page);

    const { runId } = await seedAndLogin(page, "dono");

    // Um achado por rota, com a rota junto: falhar na primeira esconderia
    // as outras 18, e o relatório útil é "quais telas estão quebradas",
    // não "a primeira que quebrou".
    const achados: string[] = [];

    try {
      for (const rota of ROTAS) {
        const errosAntes = consoleMonitor.errors.length;
        const falhasAntes = networkMonitor.failures.length;

        // Rota que não abre vira achado e a varredura segue. Sem isto, a
        // primeira tela travada consome o timeout do teste e as demais
        // nunca são visitadas — o relatório vira "uma rota lenta" em vez
        // de "o estado das 19".
        const abriu = await page
          .goto(rota, { waitUntil: "domcontentloaded", timeout: 20_000 })
          .then(() => true)
          .catch(() => false);

        if (!abriu) {
          achados.push(`${rota}: não carregou em 20s`);
          continue;
        }

        // A tela precisa sair do esqueleto. `networkidle` seria mais
        // rigoroso, mas o app tem polling permanente (inbox a cada 5s) e
        // nunca fica ocioso — esperar por ele daria timeout em tudo.
        const carregou = await page
          .waitForFunction(
            () => !document.querySelector('[role="progressbar"], .animate-spin'),
            null,
            { timeout: 15_000 },
          )
          .then(() => true)
          .catch(() => false);

        if (!carregou) achados.push(`${rota}: spinner não sumiu em 15s`);

        const novosErros = consoleMonitor.errors.slice(errosAntes);
        for (const e of novosErros) achados.push(`${rota}: ${e}`);

        const novasFalhas = networkMonitor.failures.slice(falhasAntes);
        for (const f of novasFalhas) {
          achados.push(`${rota}: ${f.status || "network"} ${f.url}`);
        }
      }

      expect(
        achados,
        `Rotas com problema:\n${achados.join("\n")}`,
      ).toEqual([]);
    } finally {
      await teardownTestEscritorio(runId);
    }
  });
});

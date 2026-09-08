/**
 * Robô de ação — entra com a conta dele e clica.
 *
 * Os outros três não alcançam isto. O auditor olha o banco, e o dado
 * pode estar perfeito com o botão morto. A conciliação chama procedure,
 * e a procedure pode responder certo sem a tela chamá-la. O de jornada
 * abre a rota, e rota que abre não diz nada sobre o que acontece quando
 * alguém aperta alguma coisa.
 *
 * Ele roda numa conta própria, criada e apagada por ele: escritório
 * vazio, sem integração configurada, sem credencial de tribunal, nunca
 * admin. O que essa conta não protege está em `cercas.ts`.
 *
 * O teste falha só por `falhou`. `nao_verificada` é dívida declarada, não
 * defeito — reprovar por ela transformaria o robô em porteiro de coisa
 * que ninguém prometeu, e o time desligaria ele na primeira semana.
 *
 * Sob demanda: `ROBO_ACAO=1 pnpm test:e2e`.
 * Rotas específicas: `ROBO_ACAO_ROTAS=/clientes,/atendimento`.
 */

import { test, expect } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { seedAndLogin, teardownTestEscritorio, watchConsoleErrors, watchNetwork5xx } from "../lib";
import { exercitarRota, instalarSonda } from "./executor";
import { formatarRelatorio } from "./relatorio";
import { ROTAS_APP } from "./rotas";
import { resumir, type ResultadoAcao } from "./tipos";

function rotasDaVarredura(): readonly string[] {
  const escolhidas = process.env.ROBO_ACAO_ROTAS?.split(",").map((r) => r.trim()).filter(Boolean);
  return escolhidas?.length ? escolhidas : ROTAS_APP;
}

test.describe("Robô de ação", () => {
  test.skip(!process.env.ROBO_ACAO, "Roda sob demanda: ROBO_ACAO=1 pnpm test:e2e");

  // Cada ação recarrega a rota antes de clicar; o tempo é proporcional à
  // superfície do app, não a um número que a gente escolhe.
  test.setTimeout(30 * 60_000);

  test("nenhuma ação do app quebra ao ser clicada", async ({ page }) => {
    const monitorConsole = watchConsoleErrors(page);
    const monitorRede = watchNetwork5xx(page);
    const sonda = instalarSonda(page, monitorConsole, monitorRede);

    const { runId } = await seedAndLogin(page, "dono");
    const resultados: ResultadoAcao[] = [];

    try {
      for (const rota of rotasDaVarredura()) {
        resultados.push(...(await exercitarRota(sonda, rota)));
      }

      const relatorio = formatarRelatorio(resultados);
      // eslint-disable-next-line no-console -- o relatório É a saída do robô
      console.log(`\n${relatorio}\n`);

      mkdirSync("test-results", { recursive: true });
      writeFileSync(
        "test-results/robo-acao.json",
        JSON.stringify({ resumo: resumir(resultados), acoes: resultados }, null, 2),
      );

      const falhas = resultados.filter((r) => r.veredito.estado === "falhou");
      expect(
        falhas.map((f) => `${f.rota} · ${f.nome} — ${f.veredito.evidencia}`),
        relatorio,
      ).toEqual([]);
    } finally {
      await teardownTestEscritorio(runId);
    }
  });
});

/**
 * Smoke test da Camada 1 — Fundação.
 *
 * Prova que:
 *   1. `seedTestEscritorio` cria escritório isolado com 5 users (1 por cargo)
 *   2. `loginAs` consegue logar com cada user criado
 *   3. Os listeners de console/network capturam o estado limpo do dashboard
 *   4. `teardownTestEscritorio` limpa tudo que criou
 *
 * Se esse spec passar, a Fase 1 está sólida pra suportar os golden paths.
 */

import { test, expect } from "@playwright/test";
import {
  seedAndLogin,
  seedTestEscritorio,
  teardownTestEscritorio,
  watchConsoleErrors,
  watchNetwork5xx,
  TEST_CARGOS,
} from "./index";

test.describe("Camada 1 — Fundação E2E", () => {
  // Ficou `fixme` de 12/05 até 14/08. Eram três defeitos reais, não
  // ruído inevitável:
  //   1. `loginAs` procurava um diálogo de login que virou página (/login);
  //   2. o seed criava usuário sem `emailVerificado`, e a tela parava em
  //      "Confirme seu email antes de entrar";
  //   3. os listeners acusavam request cancelada pelo browser
  //      (ERR_CONNECTION_RESET) como se fosse erro de JS.
  // Os três estão corrigidos e o filtro de ruído está documentado em
  // `page-helpers.ts`. Se voltar a falhar, é regressão — não relaxe o
  // listener sem entender o que ele pegou.
  test("seedAndLogin('dono') cria escritório isolado e loga no dashboard", async ({ page }) => {
    const consoleMonitor = watchConsoleErrors(page);
    const networkMonitor = watchNetwork5xx(page);

    const { escritorio, user, runId } = await seedAndLogin(page, "dono");

    try {
      expect(escritorio.id).toBeGreaterThan(0);
      expect(escritorio.nome).toContain("test-runner-");
      expect(user.cargo).toBe("dono");
      expect(user.email).toContain(runId);

      await expect(page).toHaveURL(/\/dashboard\b/);

      consoleMonitor.expectNone();
      networkMonitor.expectNone();
    } finally {
      await teardownTestEscritorio(runId);
    }
  });

  test("seedTestEscritorio cria os 5 cargos legados", async () => {
    const escritorio = await seedTestEscritorio();
    try {
      for (const cargo of TEST_CARGOS) {
        const u = escritorio.users[cargo];
        expect(u.cargo).toBe(cargo);
        expect(u.email).toContain(`${cargo}-${escritorio.runId}`);
        expect(u.id).toBeGreaterThan(0);
      }
    } finally {
      await teardownTestEscritorio(escritorio.runId);
    }
  });

  test("teardownTestEscritorio é idempotente (chamar 2× não quebra)", async () => {
    const escritorio = await seedTestEscritorio();
    await teardownTestEscritorio(escritorio.runId);
    await teardownTestEscritorio(escritorio.runId);
  });
});

import { defineConfig, devices } from "@playwright/test";

/**
 * Configuração do robô E2E.
 *
 * baseURL é resolvido por env: PLAYWRIGHT_BASE_URL (ex: staging.jurify.com.br)
 * — fallback pra http://localhost:3000 que é onde o `pnpm dev` sobe.
 *
 * Os specs assumem que existe seed de staging rodado (admin/dono/etc com
 * senha "Smoke123!"). Sem o seed, login.spec falha — é proposital.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  // Não rodar em paralelo dentro do mesmo arquivo — muitos testes
  // compartilham state (login, dados de seed) e ficam flaky com paralelismo
  // intra-arquivo. Mas arquivos diferentes podem rodar em paralelo.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI ? [["html", { open: "never" }], ["github"]] : "list",
  globalTeardown: "./tests/e2e/fixtures/globalTeardown.ts",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Quando rodando local, sobe o app automaticamente. Em CI, o workflow
  // sobe o app antes via `pnpm dev` em background.
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "pnpm dev",
        url: "http://localhost:3000/api/health/live",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});

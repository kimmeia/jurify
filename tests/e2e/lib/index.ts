/**
 * Lib pra testes E2E que precisam de escritório isolado por run.
 *
 * Uso típico:
 *
 *   import { seedAndLogin, teardownTestEscritorio, watchConsoleErrors }
 *     from "../lib";
 *
 *   test("...", async ({ page }) => {
 *     const monitor = watchConsoleErrors(page);
 *     const { runId } = await seedAndLogin(page, "dono");
 *     // ... interage com a página
 *     monitor.expectNone();
 *     await teardownTestEscritorio(runId);
 *   });
 *
 * Diferença pra `fixtures/auth.ts`: aqueles fixtures usam os 4 users seed
 * compartilhados (admin/dono/gestor/atendente). Esses helpers criam um
 * escritório novo a cada run, isolado, com 5 cargos. Use os fixtures pra
 * smoke tests já existentes; use a lib pra novos testes que mexam em
 * estado.
 */

export * from "./types";
export {
  seedTestEscritorio,
  teardownTestEscritorio,
  teardownStaleTestEscritorios,
  TEST_PASSWORD,
} from "./seed-escritorio";
export { loginAs, seedAndLogin } from "./auth-helpers";
export type { SeedAndLoginResult } from "./auth-helpers";
export {
  watchConsoleErrors,
  watchNetwork5xx,
  waitForToast,
  expectNoOrphanLoading,
} from "./page-helpers";
export type {
  ConsoleErrorMonitor,
  NetworkMonitor,
  NetworkFailure,
} from "./page-helpers";

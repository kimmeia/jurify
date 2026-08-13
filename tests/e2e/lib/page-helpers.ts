/**
 * Listeners de saúde de página. Use `watchConsoleErrors` / `watchNetwork5xx`
 * no início de cada teste e chame `.expectNone()` antes de finalizar pra
 * falhar o teste se a UI logou erro JS ou se algum endpoint retornou 5xx.
 *
 * Importante: anexar ANTES de qualquer `page.goto` — eventos disparados
 * antes do listener são perdidos.
 */

import { expect, type Page } from "@playwright/test";

/**
 * Ruído que NÃO é defeito do app — request cancelada pelo próprio browser.
 *
 * Acontece o tempo todo em SPA: componente desmonta e aborta o fetch em
 * voo, navegação corta polling, HMR derruba conexão. O console registra
 * como "error" mesmo sem nada quebrado.
 *
 * Esta lista é a diferença entre um listener que o time usa e um que fica
 * `fixme` — foi por acusar isso que o auto-teste da Camada 1 ficou
 * suspenso desde 12/05. Cada padrão novo aqui precisa de justificativa:
 * a régua é "o browser cancelou", não "esse erro incomoda".
 *
 * Erro de JS de verdade (`pageerror`) nunca é filtrado.
 */
const RUIDO_DE_REDE = [
  "net::ERR_CONNECTION_RESET",
  "net::ERR_ABORTED",
  "net::ERR_NETWORK_CHANGED",
  "net::ERR_INTERNET_DISCONNECTED",
];

function ehRuido(texto: string): boolean {
  return RUIDO_DE_REDE.some((p) => texto.includes(p));
}

export interface ConsoleErrorMonitor {
  errors: string[];
  /** O que foi filtrado — visível pra ninguém confundir filtro com ausência. */
  ignorados: string[];
  expectNone(): void;
}

export function watchConsoleErrors(page: Page): ConsoleErrorMonitor {
  const errors: string[] = [];
  const ignorados: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const texto = msg.text();
    if (ehRuido(texto)) ignorados.push(texto);
    else errors.push(texto);
  });
  // Exceção não capturada é sempre defeito, sem exceção de filtro.
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  return {
    errors,
    ignorados,
    expectNone() {
      expect(
        errors,
        `Erros JS no console detectados:\n${errors.join("\n")}` +
          (ignorados.length > 0
            ? `\n(${ignorados.length} ruído(s) de rede ignorado(s))`
            : ""),
      ).toEqual([]);
    },
  };
}

export interface NetworkFailure {
  url: string;
  status: number;
}

export interface NetworkMonitor {
  failures: NetworkFailure[];
  expectNone(): void;
}

export function watchNetwork5xx(page: Page): NetworkMonitor {
  const failures: NetworkFailure[] = [];
  page.on("response", (resp) => {
    if (resp.status() >= 500) {
      failures.push({ url: resp.url(), status: resp.status() });
    }
  });
  page.on("requestfailed", (req) => {
    // Request cancelada não é falha do servidor: navegar durante um fetch
    // em voo, ou desmontar componente com polling ativo, dispara isto sem
    // nada estar quebrado. 5xx de verdade chega pelo listener de response.
    const erro = req.failure()?.errorText ?? "";
    if (ehRuido(erro)) return;
    failures.push({ url: req.url(), status: 0 });
  });
  return {
    failures,
    expectNone() {
      const lines = failures.map((f) => `${f.status || "network"} ${f.url}`).join("\n");
      expect(failures, `Falhas de rede detectadas:\n${lines}`).toEqual([]);
    },
  };
}

export async function waitForToast(
  page: Page,
  textPattern?: RegExp,
  timeout: number = 5000,
): Promise<void> {
  const base = page.locator(
    '[data-sonner-toast], [data-radix-toast-root], [role="status"]',
  );
  const toast = textPattern ? base.filter({ hasText: textPattern }) : base;
  await expect(toast.first()).toBeVisible({ timeout });
}

export async function expectNoOrphanLoading(
  page: Page,
  timeout: number = 5000,
): Promise<void> {
  await page.waitForFunction(
    () => !document.querySelector('[role="progressbar"], .animate-spin'),
    null,
    { timeout },
  );
}

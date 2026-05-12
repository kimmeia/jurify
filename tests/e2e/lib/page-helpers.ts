/**
 * Listeners de saúde de página. Use `watchConsoleErrors` / `watchNetwork5xx`
 * no início de cada teste e chame `.expectNone()` antes de finalizar pra
 * falhar o teste se a UI logou erro JS ou se algum endpoint retornou 5xx.
 *
 * Importante: anexar ANTES de qualquer `page.goto` — eventos disparados
 * antes do listener são perdidos.
 */

import { expect, type Page } from "@playwright/test";

export interface ConsoleErrorMonitor {
  errors: string[];
  expectNone(): void;
}

export function watchConsoleErrors(page: Page): ConsoleErrorMonitor {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  return {
    errors,
    expectNone() {
      expect(
        errors,
        `Erros JS no console detectados:\n${errors.join("\n")}`,
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

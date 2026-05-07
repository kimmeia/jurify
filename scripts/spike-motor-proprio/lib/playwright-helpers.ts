/**
 * Helpers de Playwright compartilhados entre os PoCs.
 *
 * Responsabilidades:
 *   - Browser pool com lifecycle (launch, reuse, close)
 *   - Retry com backoff exponencial
 *   - Screenshot automático em erro (vai pra samples/screenshots/)
 *   - Detecção de captcha (heurística simples — busca elementos típicos)
 *   - User-Agent realista pra reduzir banimento
 *   - Logging estruturado
 *
 * NÃO inclui:
 *   - Pool de proxies (vem só se Spike provar necessidade — nem todo
 *     tribunal precisa)
 *   - Solver de captcha (mesmo motivo — começamos sem, decidimos pós-PoC)
 */

import { chromium } from "@playwright/test";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { sleep } from "./parser-utils";
import { captureSpikeError } from "./sentry-spike";

/**
 * User-Agent moderno mimetizando Chrome desktop. Tribunais que olham
 * UA bloqueiam UAs vazios ou óbvios de bot (curl, Python-requests).
 * Versão major mantida razoavelmente recente — atualizar
 * periodicamente conforme Chrome evolui.
 */
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const SCREENSHOT_DIR = path.resolve(
  process.cwd(),
  "scripts/spike-motor-proprio/samples/screenshots",
);

let sharedBrowser: Browser | null = null;

/**
 * Lança ou reusa um browser Chromium headless.
 *
 * Chromium escolhido por:
 *  - Melhor compatibilidade com sites .gov.br (testado em produção pela Judit)
 *  - Footprint menor que Firefox em headless
 *  - Suporte a CDN/captcha mais consistente que Webkit
 */
export async function getBrowser(): Promise<Browser> {
  if (sharedBrowser && sharedBrowser.isConnected()) return sharedBrowser;

  sharedBrowser = await chromium.launch({
    headless: true,
    // --no-sandbox necessário em containers Railway/Docker (sem userns).
    // --disable-dev-shm-usage evita /dev/shm cheio em workers de longa
    // duração — usa /tmp que tem mais espaço.
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  return sharedBrowser;
}

export async function closeBrowser(): Promise<void> {
  if (sharedBrowser) {
    await sharedBrowser.close().catch(() => {});
    sharedBrowser = null;
  }
}

/**
 * Cria um BrowserContext com config padrão (timezone, locale, UA, viewport).
 *
 * Cada raspagem usa context próprio pra isolamento de cookies — evita
 * que sessão de um tribunal vaze pra outro acidentalmente.
 *
 * `storageState` aceita o JSON de cookies+origins exportado por
 * `context.storageState()`. Usado para reusar sessão logada
 * (PoC 2 — E-SAJ logado).
 */
export interface NovoContextOpts {
  storageState?:
    | string
    | {
        cookies?: Array<Record<string, unknown>>;
        origins?: Array<Record<string, unknown>>;
      };
}

export async function novoContext(opts: NovoContextOpts = {}): Promise<BrowserContext> {
  const browser = await getBrowser();
  return browser.newContext({
    userAgent: USER_AGENT,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    viewport: { width: 1366, height: 768 },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    storageState: opts.storageState as any,
  });
}

/**
 * Heurística para detectar tela de captcha — busca seletores comuns
 * (hCaptcha, reCAPTCHA, captchas próprios de tribunal).
 *
 * Não tenta resolver — apenas reporta presença para o caller decidir
 * (cancelar, marcar como erro, ou em fase futura: chamar 2Captcha).
 */
export async function temCaptchaNaPagina(page: Page): Promise<boolean> {
  const seletores = [
    "iframe[src*='hcaptcha']",
    "iframe[src*='recaptcha']",
    "iframe[title*='captcha' i]",
    "input[name*='captcha' i]",
    "img[src*='captcha' i]",
    "div.g-recaptcha",
    "div[class*='captcha' i]",
  ];

  for (const sel of seletores) {
    const el = await page.locator(sel).first();
    const visible = await el.isVisible().catch(() => false);
    if (visible) return true;
  }
  return false;
}

/**
 * Retry com backoff exponencial. Primeira tentativa imediata, depois
 * cada falha aguarda 2x mais que a anterior até `tentativas`.
 *
 * Útil pra resolver flakiness de carregamento (tribunal lento) sem
 * desistir cedo demais. Não tenta indefinidamente — após `tentativas`
 * relança o último erro.
 */
export async function comRetry<T>(
  fn: () => Promise<T>,
  opts: { tentativas?: number; baseMs?: number; nome?: string } = {},
): Promise<T> {
  const tentativas = opts.tentativas ?? 3;
  const baseMs = opts.baseMs ?? 1000;
  const nome = opts.nome ?? "operação";

  let ultimoErro: unknown;

  for (let i = 0; i < tentativas; i++) {
    try {
      return await fn();
    } catch (err) {
      ultimoErro = err;
      if (i < tentativas - 1) {
        const delay = baseMs * Math.pow(2, i);
        await sleep(delay);
      }
    }
  }

  // Reporta ao Sentry só na falha final pra não inflar volume com retries.
  captureSpikeError(ultimoErro, { etapa: nome, tentativasGastas: tentativas });
  throw ultimoErro;
}

/**
 * Tira screenshot da página e salva em samples/screenshots/.
 * Retorna o caminho absoluto pra uso em logs/Sentry.
 *
 * Em caso de erro durante o screenshot (página fechou, browser morreu),
 * retorna null em vez de propagar — screenshot é debug, não pode
 * mascarar o erro original.
 */
export async function capturarScreenshot(
  page: Page,
  prefixo: string,
): Promise<string | null> {
  try {
    if (!fs.existsSync(SCREENSHOT_DIR)) {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const filepath = path.join(SCREENSHOT_DIR, `${prefixo}-${ts}.png`);
    await page.screenshot({ path: filepath, fullPage: true });
    return filepath;
  } catch {
    return null;
  }
}

/**
 * Calcula percentil de um array numérico ordenado.
 * Helper pra estatísticas do PoC (latência P50, P95, P99).
 */
export function percentil(valores: number[], p: number): number {
  if (valores.length === 0) return 0;
  const sorted = [...valores].sort((a, b) => a - b);
  const index = Math.min(Math.floor((p / 100) * sorted.length), sorted.length - 1);
  return sorted[index];
}

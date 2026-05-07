/**
 * Adapter PJe TJCE — login autenticado (advogado com OAB-CE).
 *
 * O TJCE migrou do E-SAJ pro PJe — diferente da maioria das outras
 * UFs. Sistema atual: PJe 2.x do TJCE em pje.tjce.jus.br.
 *
 * Caminho de acesso pro advogado:
 *   1. https://pje.tjce.jus.br/pje/login.seam (PJe 1.x JSF) OU
 *      https://pje.tjce.jus.br/jus/Processo/ConsultaProcesso/listView.seam
 *      (PJe 2.x Angular — exige login antes de consultar)
 *   2. Login com CPF/OAB + senha
 *   3. 2FA TOTP se habilitado
 *   4. Acesso ao painel + busca de processos
 *
 * Diferença vs consulta pública (TRT-7 no PoC 1):
 *   • Consulta pública: tem captcha
 *   • Acesso autenticado: SEM captcha (advogado tem credencial)
 *   • Acesso autenticado: vê processos onde tem permissão (segredo de justiça)
 *
 * STATUS: implementação inicial baseada em padrões conhecidos do PJe.
 * Diagnóstico forte habilitado — primeira validação real vai retornar
 * mensagem do tribunal + lista de inputs detectados pra calibrar.
 */

import type { Browser, Page } from "@playwright/test";
import { chromium } from "@playwright/test";
import { gerarCodigoTotp } from "./tjce-totp";
import type { ResultadoScraper } from "../../lib/types-spike";
import { mascararCnj, normalizarCnj } from "../../lib/parser-utils";

/**
 * URLs do PJe TJCE. Tenta múltiplas URLs porque o tribunal pode ter
 * mais de uma porta de entrada (1º grau, 2º grau, varas especiais).
 */
const URLS_LOGIN = [
  "https://pje.tjce.jus.br/pje/login.seam",
  "https://pje.tjce.jus.br/pje1grau/login.seam",
  "https://pje.tjce.jus.br/pje2grau/login.seam",
] as const;

const URL_PORTAL = "https://pje.tjce.jus.br/";

export interface CredencialPjeTjce {
  username: string;
  password: string;
  totpSecret: string | null;
}

export interface ResultadoLoginPjeTjce {
  ok: boolean;
  mensagem: string;
  detalhes?: string;
  storageStateJson?: string;
  latenciaMs: number;
  screenshotPath: string | null;
}

const TIMEOUT_LOGIN_MS = 60_000;
const TIMEOUT_NAV_MS = 25_000;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

let sharedBrowserPje: Browser | null = null;

async function getBrowserPje(): Promise<Browser> {
  if (sharedBrowserPje && sharedBrowserPje.isConnected()) return sharedBrowserPje;
  sharedBrowserPje = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
    ],
  });
  return sharedBrowserPje;
}

export async function fecharBrowserPjeTjce(): Promise<void> {
  if (sharedBrowserPje) {
    await sharedBrowserPje.close().catch(() => {});
    sharedBrowserPje = null;
  }
}

export class PjeTjceScraper {
  readonly tribunal = "tjce";
  readonly nome = "Tribunal de Justiça do Ceará — PJe (autenticado)";

  constructor(private credencial: CredencialPjeTjce) {}

  async testarLogin(): Promise<ResultadoLoginPjeTjce> {
    const inicio = Date.now();
    const browser = await getBrowserPje();
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      locale: "pt-BR",
      timezoneId: "America/Fortaleza",
      viewport: { width: 1366, height: 768 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(TIMEOUT_NAV_MS);

    let urlTentadaUltima = "";
    try {
      const operacao = this.executarLogin(page, (url) => {
        urlTentadaUltima = url;
      });
      const timer = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`timeout_login_${TIMEOUT_LOGIN_MS}ms`)),
          TIMEOUT_LOGIN_MS,
        ),
      );
      await Promise.race([operacao, timer]);

      const storage = await context.storageState();
      const storageStateJson = JSON.stringify(storage);

      return {
        ok: true,
        mensagem: "Login no PJe TJCE bem-sucedido",
        latenciaMs: Date.now() - inicio,
        storageStateJson,
        screenshotPath: null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const screenshotPath = await this.tirarScreenshotErro(page, "tjce-pje-erro");
      return {
        ok: false,
        mensagem: this.classificarErro(msg, page.url()),
        detalhes: `${msg} — URL final: ${page.url()} — última tentada: ${urlTentadaUltima || "?"}`,
        latenciaMs: Date.now() - inicio,
        screenshotPath,
      };
    } finally {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
    }
  }

  async consultarPorCnj(
    cnj: string,
    storageStateJson: string,
  ): Promise<ResultadoScraper> {
    const inicio = Date.now();
    const cnjMascarado = mascararCnj(cnj);
    const cnjLimpo = normalizarCnj(cnj);

    const baseResultado: ResultadoScraper = {
      ok: false,
      tribunal: this.tribunal,
      cnj: cnjMascarado,
      latenciaMs: 0,
      capa: null,
      movimentacoes: [],
      categoriaErro: null,
      mensagemErro: null,
      screenshotPath: null,
      finalizadoEm: new Date().toISOString(),
    };

    const browser = await getBrowserPje();
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      locale: "pt-BR",
      timezoneId: "America/Fortaleza",
      viewport: { width: 1366, height: 768 },
      storageState: JSON.parse(storageStateJson),
    });
    const page = await context.newPage();
    page.setDefaultTimeout(TIMEOUT_NAV_MS);

    try {
      // Vai pra portal — se sessão OK, abre painel; se expirou, redireciona pra login
      await page.goto(URL_PORTAL, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

      const urlAtual = page.url();
      if (urlAtual.includes("login.seam") || urlAtual.includes("/login")) {
        return {
          ...baseResultado,
          latenciaMs: Date.now() - inicio,
          categoriaErro: "tribunal_indisponivel",
          mensagemErro: "Sessão expirada — PJe TJCE redirecionou pra login",
          finalizadoEm: new Date().toISOString(),
        };
      }

      // Placeholder até calibrar com tela real do painel autenticado
      const screenshotPath = await this.tirarScreenshotErro(page, `tjce-pje-painel-${cnjLimpo}`);
      return {
        ...baseResultado,
        latenciaMs: Date.now() - inicio,
        categoriaErro: "parse_falhou",
        mensagemErro:
          `Login OK — chegamos no painel autenticado (${urlAtual}). ` +
          `Extração de processo por CNJ ainda não implementada — depende do layout ` +
          `real do painel (calibrar com screenshot capturado).`,
        screenshotPath,
        finalizadoEm: new Date().toISOString(),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const screenshotPath = await this.tirarScreenshotErro(
        page,
        `tjce-pje-consulta-erro-${cnjLimpo}`,
      );
      return {
        ...baseResultado,
        latenciaMs: Date.now() - inicio,
        categoriaErro: "outro",
        mensagemErro: msg,
        screenshotPath,
        finalizadoEm: new Date().toISOString(),
      };
    } finally {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
    }
  }

  /**
   * Tenta logar em cada URL_LOGIN candidata até uma funcionar.
   * Mantém diagnóstico estruturado pra cada falha.
   */
  private async executarLogin(
    page: Page,
    setUrl: (url: string) => void,
  ): Promise<void> {
    const erros: string[] = [];

    for (const url of URLS_LOGIN) {
      setUrl(url);
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 12_000 });
        await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

        // Detecta se é PJe 1.x (JSF) ou 2.x (Angular)
        const ehPje1 =
          (await page.locator("input[id*='username' i], input[name*='username' i]").count()) > 0 ||
          page.url().includes("login.seam");

        if (!ehPje1) {
          // PJe 2.x — pode ter SSO unificado, layout diferente, etc.
          // Por enquanto só loga indício; primeira tentativa válida sempre é PJe 1.x
          erros.push(`${url}: não parece PJe 1.x (sem inputs username) — pulando`);
          continue;
        }

        await this.preencherFormPje1(page);

        // Aguarda redirect pra painel ou erro
        await page.waitForTimeout(2000);

        const urlPosLogin = page.url();
        if (
          !urlPosLogin.includes("login.seam") &&
          !urlPosLogin.includes("/login")
        ) {
          // Login OK
          return;
        }

        // Capturou erro — coleta diagnóstico
        const diag = await this.coletarDiagnostico(page);
        const usernameMascarado =
          this.credencial.username.length > 4
            ? `${this.credencial.username.slice(0, 2)}***${this.credencial.username.slice(-2)}`
            : "***";
        erros.push(
          `${url}: rejeitado. Username: ${usernameMascarado}. ` +
            `Mensagem: ${diag.mensagemErro || "(sem mensagem)"}. ` +
            `Inputs: ${diag.inputs}. ` +
            `Title: ${diag.title}.`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        erros.push(`${url}: falhou na navegação — ${msg}`);
      }
    }

    throw new Error(
      `Nenhuma URL de login PJe TJCE funcionou. Tentativas:\n${erros.join("\n\n")}`,
    );
  }

  private async preencherFormPje1(page: Page): Promise<void> {
    // PJe 1.x usa JSF/RichFaces. IDs típicos:
    //   id="username" ou id="loginPanel:username"
    //   id="password" ou id="loginPanel:password"
    const inputUsuario = page
      .locator(
        [
          "input[id='username']",
          "input[id*='username' i]",
          "input[name='username']",
          "input[name*='username' i]",
          "input[type='text']:visible",
        ].join(", "),
      )
      .first();

    const inputSenha = page
      .locator(
        [
          "input[id='password']",
          "input[id*='password' i]",
          "input[name='password']",
          "input[name*='password' i]",
          "input[type='password']:visible",
        ].join(", "),
      )
      .first();

    await inputUsuario.click({ timeout: 5000 }).catch(() => {});
    await inputUsuario.fill("");
    await inputUsuario.fill(this.credencial.username);

    await inputSenha.click({ timeout: 3000 }).catch(() => {});
    await inputSenha.fill("");
    await inputSenha.fill(this.credencial.password);

    const botaoLogin = page
      .locator(
        [
          "input[type='submit'][value*='Entrar' i]",
          "input[type='submit'][value*='Acessar' i]",
          "button[type='submit']",
          "input[type='submit']",
        ].join(", "),
      )
      .first();

    await Promise.all([
      page.waitForLoadState("networkidle", { timeout: 18_000 }).catch(() => {}),
      botaoLogin.click({ timeout: 5000 }),
    ]);

    await page.waitForTimeout(1500);

    // Tratamento de 2FA
    const inputTotp = page
      .locator(
        [
          "input[name*='token' i]",
          "input[name*='codigo' i]",
          "input[placeholder*='código' i]",
          "input[placeholder*='token' i]",
          "input[maxlength='6']",
        ].join(", "),
      )
      .first();
    const tem2fa = await inputTotp.isVisible({ timeout: 2500 }).catch(() => false);
    if (tem2fa) {
      if (!this.credencial.totpSecret) {
        throw new Error(
          "PJe TJCE pediu 2FA mas credencial não tem TOTP secret cadastrado",
        );
      }
      const codigo = gerarCodigoTotp(this.credencial.totpSecret);
      await inputTotp.fill(codigo);

      const botaoValidar = page
        .locator(
          [
            "button[type='submit']",
            "input[type='submit']",
            "button:has-text('Validar')",
            "button:has-text('Confirmar')",
            "button:has-text('Entrar')",
          ].join(", "),
        )
        .first();
      await Promise.all([
        page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {}),
        botaoValidar.click({ timeout: 5000 }),
      ]);
      await page.waitForTimeout(1500);
    }
  }

  private async coletarDiagnostico(page: Page): Promise<{
    mensagemErro: string;
    inputs: string;
    title: string;
  }> {
    let mensagemErro = "";
    const candidatos = [
      ".rich-messages-summary",
      ".rich-messages-detail",
      ".alert",
      ".alert-danger",
      ".error",
      "[role='alert']",
      ".message",
      ".validation-summary",
    ];
    for (const sel of candidatos) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 200 })) {
          const t = (await el.innerText().catch(() => "")).trim();
          if (t && t.length < 500) {
            mensagemErro = t;
            break;
          }
        }
      } catch {
        // ignora
      }
    }
    if (!mensagemErro) {
      try {
        const t = await page
          .locator("text=/inv[áa]lid|incorret|n[ãa]o autoriz|falha|erro|rejeit/i")
          .first()
          .innerText()
          .catch(() => "");
        if (t && t.length < 500) mensagemErro = t.trim();
      } catch {
        // ignora
      }
    }

    const inputs = await page
      .locator("input:visible")
      .evaluateAll((nodes) =>
        (nodes as HTMLInputElement[])
          .slice(0, 15)
          .map((n) => `${n.name || n.id || "?"}:${n.type || "text"}`),
      )
      .catch(() => []);

    const title = await page.title().catch(() => "?");
    return { mensagemErro, inputs: JSON.stringify(inputs).slice(0, 400), title };
  }

  private classificarErro(mensagem: string, urlFinal: string): string {
    if (mensagem.startsWith("timeout_login")) {
      return "Timeout no login (60s) — tribunal lento ou rede indisponível";
    }
    if (mensagem.includes("2FA") || mensagem.includes("TOTP")) {
      return mensagem;
    }
    if (mensagem.includes("Nenhuma URL")) {
      // Mensagem detalhada já vem no `detalhes`
      return "Login PJe TJCE rejeitado em todas as URLs candidatas — ver detalhes";
    }
    if (urlFinal.includes("login")) {
      return `Login rejeitado pelo PJe TJCE: ${mensagem}`;
    }
    return `Falha inesperada no login: ${mensagem}`;
  }

  private async tirarScreenshotErro(page: Page, prefixo: string): Promise<string | null> {
    try {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const dir = path.resolve(
        process.cwd(),
        "scripts/spike-motor-proprio/samples/screenshots",
      );
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const filepath = path.join(dir, `${prefixo}-${ts}.png`);
      await page.screenshot({ path: filepath, fullPage: true });
      return filepath;
    } catch {
      return null;
    }
  }
}

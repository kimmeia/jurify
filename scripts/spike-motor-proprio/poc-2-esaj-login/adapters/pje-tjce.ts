/**
 * Adapter PJe TJCE — login via PDPJ-cloud (SSO unificado do CNJ).
 *
 * INSIGHT IMPORTANTE: o TJCE migrou pra Plataforma Digital do Poder
 * Judiciário (PDPJ-cloud), que usa Keycloak como servidor de identidade
 * em https://sso.cloud.pje.jus.br/auth/realms/pje/.
 *
 * URL real que o usuário acessa:
 *   https://sso.cloud.pje.jus.br/auth/realms/pje/login-actions/authenticate
 *     ?execution=<uuid>&client_id=pje-tjce-1g&tab_id=<id>
 *
 * Os parâmetros `execution` e `tab_id` são gerados pelo Keycloak a cada
 * acesso (não dá pra navegar direto pra essa URL — bate em sessão
 * inválida). Caminho correto:
 *
 *   1. Acessar https://pje.tjce.jus.br/ (porta de entrada do TJCE)
 *   2. Aguardar redirect AUTOMÁTICO pra sso.cloud.pje.jus.br/auth/...
 *   3. Form Keycloak padrão (id="username", id="password",
 *      id="kc-login")
 *   4. Submit → Keycloak valida → redirect de volta pra pje.tjce.jus.br
 *   5. Se 2FA: tela intermediária do Keycloak pede TOTP
 *
 * Vantagem do PDPJ-cloud: este MESMO adapter serve pros outros TJs que
 * migraram (TJRJ, TJMG, TJDFT, TJPE, etc) — só muda o client_id e a URL
 * de entrada. Quando atacarmos esses, refatoramos pra classe base
 * `PdpjCloudScraper` parametrizável.
 */

import type { Browser, Page } from "@playwright/test";
import { chromium } from "@playwright/test";
import { gerarCodigoTotp } from "./tjce-totp";
import type { ResultadoScraper } from "../../lib/types-spike";
import { mascararCnj, normalizarCnj } from "../../lib/parser-utils";

const URL_ENTRADA_TJCE = "https://pje.tjce.jus.br/";
const HOST_KEYCLOAK = "sso.cloud.pje.jus.br";

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
  readonly nome = "Tribunal de Justiça do Ceará — PJe via PDPJ-cloud";

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

    try {
      const operacao = this.executarLogin(page);
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
        mensagem: "Login no PJe TJCE via PDPJ-cloud bem-sucedido",
        latenciaMs: Date.now() - inicio,
        storageStateJson,
        screenshotPath: null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const screenshotPath = await this.tirarScreenshotErro(page, "pje-tjce-erro");
      return {
        ok: false,
        mensagem: this.classificarErro(msg, page.url()),
        detalhes: `${msg} — URL final: ${page.url()}`,
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
      await page.goto(URL_ENTRADA_TJCE, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

      // Se redirecionou pro SSO, sessão expirou
      if (page.url().includes(HOST_KEYCLOAK)) {
        return {
          ...baseResultado,
          latenciaMs: Date.now() - inicio,
          categoriaErro: "tribunal_indisponivel",
          mensagemErro: "Sessão expirada — PDPJ-cloud redirecionou pra login do Keycloak",
          finalizadoEm: new Date().toISOString(),
        };
      }

      // Placeholder até calibrar com tela real do painel autenticado
      const screenshotPath = await this.tirarScreenshotErro(page, `pje-tjce-painel-${cnjLimpo}`);
      return {
        ...baseResultado,
        latenciaMs: Date.now() - inicio,
        categoriaErro: "parse_falhou",
        mensagemErro:
          `Login OK e portal aberto (${page.url()}). ` +
          `Extração de processo por CNJ ainda não implementada — depende do layout ` +
          `real do painel PDPJ-cloud (calibrar com screenshot).`,
        screenshotPath,
        finalizadoEm: new Date().toISOString(),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const screenshotPath = await this.tirarScreenshotErro(
        page,
        `pje-tjce-consulta-erro-${cnjLimpo}`,
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
   * Fluxo de login PDPJ-cloud:
   *  1. Acessa pje.tjce.jus.br → tribunal redireciona pro SSO
   *  2. Aguarda chegar no Keycloak (host sso.cloud.pje.jus.br)
   *  3. Form padrão Keycloak: id="username", id="password", id="kc-login"
   *  4. Detecta 2FA na tela seguinte (id="otp" ou similar)
   *  5. Aguarda redirect de volta pra pje.tjce.jus.br
   */
  private async executarLogin(page: Page): Promise<void> {
    await page.goto(URL_ENTRADA_TJCE, { waitUntil: "domcontentloaded" });

    // Aguarda redirect pro Keycloak. Pode demorar — TJCE faz vários
    // bounces antes de cair no SSO.
    await page
      .waitForURL((url) => url.host.includes(HOST_KEYCLOAK), {
        timeout: 18_000,
      })
      .catch(() => {});

    if (!page.url().includes(HOST_KEYCLOAK)) {
      // Talvez já estava logado ou TJCE não redirecionou — tentamos
      // direto a URL de auth. Sem execution/tab_id frescos, vai pedir
      // pra reiniciar o login automaticamente.
      throw new Error(
        `TJCE não redirecionou pro PDPJ-cloud — URL atual: ${page.url()}. ` +
          `Title: ${await page.title().catch(() => "?")}`,
      );
    }

    await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});

    // ─── Form Keycloak ───
    // Selectors padrão do Keycloak: id="username", id="password", id="kc-login"
    const inputUsuario = page
      .locator(
        [
          "input#username",
          "input[name='username']",
          "input[autocomplete='username']",
          "input[type='text']:visible",
        ].join(", "),
      )
      .first();

    const inputSenha = page
      .locator(
        [
          "input#password",
          "input[name='password']",
          "input[autocomplete='current-password']",
          "input[type='password']:visible",
        ].join(", "),
      )
      .first();

    if (!(await inputUsuario.isVisible({ timeout: 5000 }).catch(() => false))) {
      const inputs = await this.listarInputsVisiveis(page);
      throw new Error(
        `Form Keycloak não encontrado em ${page.url()}. ` +
          `Inputs visíveis: ${JSON.stringify(inputs).slice(0, 600)}`,
      );
    }

    await inputUsuario.click({ timeout: 3000 }).catch(() => {});
    await inputUsuario.fill("");
    await inputUsuario.fill(this.credencial.username);

    await inputSenha.click({ timeout: 3000 }).catch(() => {});
    await inputSenha.fill("");
    await inputSenha.fill(this.credencial.password);

    const botaoLogin = page
      .locator(
        [
          "input#kc-login",
          "button[name='login']",
          "input[type='submit']",
          "button[type='submit']",
        ].join(", "),
      )
      .first();

    await Promise.all([
      page.waitForLoadState("networkidle", { timeout: 18_000 }).catch(() => {}),
      botaoLogin.click({ timeout: 5000 }),
    ]);

    await page.waitForTimeout(1500);

    // ─── DETECTA "CONFIGURE_TOTP" — primeira configuração de 2FA ───
    // Keycloak força configurar 2FA na primeira vez se ainda não tem.
    // Tela apresenta QR code + secret novo. O secret cadastrado pelo
    // usuário no cofre NÃO bate com esse que o Keycloak gerou agora.
    // Não tentamos auto-configurar — usuário precisa fazer manualmente
    // no navegador uma vez pra sincronizar o secret entre app e cofre.
    if (
      page.url().includes("CONFIGURE_TOTP") ||
      page.url().includes("execution=CONFIGURE")
    ) {
      throw new Error(
        "PDPJ_CONFIGURE_TOTP: sua conta no PDPJ-cloud ainda não tem 2FA configurado. " +
          "O Keycloak está forçando configuração antes do primeiro acesso. Resolva em 2 passos:\n" +
          "PASSO 1 (no navegador, 1 vez): acesse https://pje.tjce.jus.br/, faça login, " +
          "quando aparecer 'Configure Two-Factor' clique em 'Não consegue escanear?' " +
          "pra ver o secret em texto base32 (JBSWY3...). Anote. Escaneie o QR code com " +
          "Google Authenticator/Authy no celular. Confirme com o código de 6 dígitos.\n" +
          "PASSO 2 (no Jurify): remova esta credencial, cadastre de novo com o MESMO secret " +
          "que você anotou no Passo 1. Aí valida — o robô vai gerar o mesmo código que seu app.",
      );
    }

    // ─── 2FA TOTP normal (já configurado) ───
    // Keycloak mostra tela separada com input id="otp" ou "totp"
    const inputTotp = page
      .locator(
        [
          "input#otp",
          "input#totp",
          "input[name='otp']",
          "input[name='totp']",
          "input[name*='token' i]",
          "input[autocomplete='one-time-code']",
          "input[maxlength='6']",
        ].join(", "),
      )
      .first();
    const tem2fa = await inputTotp.isVisible({ timeout: 3000 }).catch(() => false);
    if (tem2fa) {
      if (!this.credencial.totpSecret) {
        throw new Error(
          "PDPJ-cloud pediu 2FA TOTP mas credencial não tem secret cadastrado. " +
            "Cadastre o secret base32 no cofre antes de validar.",
        );
      }
      const codigo = gerarCodigoTotp(this.credencial.totpSecret);
      await inputTotp.fill(codigo);

      const botaoValidar = page
        .locator(
          [
            "input#kc-login",
            "button[name='login']",
            "input[type='submit']",
            "button[type='submit']",
          ].join(", "),
        )
        .first();
      await Promise.all([
        page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {}),
        botaoValidar.click({ timeout: 5000 }),
      ]);
      await page.waitForTimeout(1500);
    }

    // ─── Validação de sucesso ───
    // Login OK quando redireciona DE VOLTA pra pje.tjce.jus.br
    // (Keycloak conclui o flow OAuth/OIDC e devolve o token).
    const urlFinal = page.url();
    if (urlFinal.includes(HOST_KEYCLOAK)) {
      const diag = await this.coletarDiagnosticoKeycloak(page);
      const usernameMascarado =
        this.credencial.username.length > 4
          ? `${this.credencial.username.slice(0, 2)}***${this.credencial.username.slice(-2)}`
          : "***";
      throw new Error(
        `Login rejeitado pelo Keycloak (PDPJ-cloud).\n` +
          `Username usado: "${usernameMascarado}" (${this.credencial.username.length} chars).\n` +
          `Mensagem do Keycloak: ${diag.mensagemErro || "(sem mensagem capturada)"}.\n` +
          `Inputs detectados: ${diag.inputs}.\n` +
          `URL: ${urlFinal}.\n` +
          `Title: ${diag.title}.`,
      );
    }
  }

  /**
   * Coleta mensagem de erro do Keycloak. Selectors específicos do KC.
   */
  private async coletarDiagnosticoKeycloak(page: Page): Promise<{
    mensagemErro: string;
    inputs: string;
    title: string;
  }> {
    const candidatos = [
      "#input-error",                   // erro de campo (Keycloak v18+)
      ".kc-feedback-text",              // feedback genérico
      ".alert-error",                   // alerta de erro
      ".pf-c-alert.pf-m-danger",        // PatternFly (Keycloak)
      "[role='alert']",
      "#input-error-username",
      "#input-error-password",
      "span.error",
      ".alert",
    ];
    let mensagemErro = "";
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
          .locator("text=/inv[áa]lid|incorret|bloqueado|disabled|n[ãa]o autoriz/i")
          .first()
          .innerText()
          .catch(() => "");
        if (t && t.length < 500) mensagemErro = t.trim();
      } catch {
        // ignora
      }
    }

    const inputs = await this.listarInputsVisiveis(page);
    const title = await page.title().catch(() => "?");
    return {
      mensagemErro,
      inputs: JSON.stringify(inputs).slice(0, 400),
      title,
    };
  }

  private async listarInputsVisiveis(
    page: Page,
  ): Promise<Array<{ name: string; id: string; type: string }>> {
    return page
      .locator("input:visible")
      .evaluateAll((nodes) =>
        (nodes as HTMLInputElement[]).slice(0, 15).map((n) => ({
          name: n.getAttribute("name") || "",
          id: n.getAttribute("id") || "",
          type: n.getAttribute("type") || "text",
        })),
      )
      .catch(() => []);
  }

  private classificarErro(mensagem: string, urlFinal: string): string {
    if (mensagem.startsWith("timeout_login")) {
      return "Timeout no login (60s) — PDPJ-cloud lento ou indisponível";
    }
    if (mensagem.startsWith("PDPJ_CONFIGURE_TOTP")) {
      // Mensagem já tem instruções completas — só remove o prefixo
      return mensagem.replace(/^PDPJ_CONFIGURE_TOTP:\s*/, "");
    }
    if (mensagem.includes("2FA") || mensagem.includes("TOTP")) {
      return mensagem;
    }
    if (mensagem.includes("Login rejeitado")) {
      return mensagem; // já tem detalhe
    }
    if (mensagem.includes("não redirecionou")) {
      return mensagem;
    }
    if (urlFinal.includes(HOST_KEYCLOAK)) {
      return `Falha no login Keycloak: ${mensagem}`;
    }
    return `Falha inesperada no login PDPJ-cloud: ${mensagem}`;
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

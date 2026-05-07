/**
 * Adapter E-SAJ TJ-CE (Tribunal de Justiça do Ceará — autenticado).
 *
 * Diferente do PJe público (TRT-2/TRT-15), o E-SAJ exige login com
 * CPF/OAB + senha + 2FA TOTP. A consulta pública foi descontinuada
 * em 2021 e não voltou.
 *
 * Fluxo:
 *   1. GET https://esaj.tjce.jus.br/sajcas/login (form de login)
 *   2. Preenche usuário + senha → submit
 *   3. Tela 2FA (se habilitado) → preenche código TOTP gerado a partir
 *      do secret armazenado → submit
 *   4. Após login → portal advogado (dashboard)
 *   5. Captura `storageState` (cookies + localStorage) pra reuso futuro
 *   6. Para consulta de processo: GET /cpopg/show.do?processo... ou
 *      via busca interna por CNJ
 *
 * Reuso de sessão:
 *   - Após login bem-sucedido, salvamos storageState em cofre_sessoes
 *   - Próximas consultas tentam reusar a sessão (sem relogar)
 *   - Se cookie expirou, refazemos login
 *
 * Rate limit:
 *   - Tribunais de Justiça brasileiros costumam tolerar bem requests
 *     legítimos durante horário comercial. Mantemos delays educados
 *     entre consultas (1-2s) pra não disparar bloqueio anti-bot.
 */

import type { Browser, BrowserContext, Page } from "@playwright/test";
import { chromium } from "@playwright/test";
import { gerarCodigoTotp } from "./tjce-totp";
import type { ResultadoScraper } from "../../lib/types-spike";
import { mascararCnj, normalizarCnj, parseDataBR } from "../../lib/parser-utils";

/**
 * URLs do E-SAJ TJ-CE. Centralizadas pra facilitar override em testes
 * ou se o tribunal mudar pra outro domínio (raro mas possível).
 */
const URLS = {
  login: "https://esaj.tjce.jus.br/sajcas/login",
  portalAdvogado: "https://esaj.tjce.jus.br/esaj/portal.do?servico=190090",
  consultaCpoPg: "https://esaj.tjce.jus.br/cpopg/open.do",
  consultaCnjPrefix: "https://esaj.tjce.jus.br/cpopg/search.do",
} as const;

/**
 * Credencial passada pro adapter no momento do uso. NUNCA loga ou
 * persiste — vem decriptada da memória, é descartada após uso.
 */
export interface CredencialEsaj {
  username: string;
  password: string;
  /** Secret base32 do TOTP (não o código de 6 dígitos) */
  totpSecret: string | null;
}

export interface ResultadoLoginEsaj {
  ok: boolean;
  mensagem: string;
  detalhes?: string;
  /** JSON do storageState do Playwright pra reuso (só presente se ok=true) */
  storageStateJson?: string;
  /** Latência em ms do login completo (boot do browser + navegação + auth) */
  latenciaMs: number;
  /** Caminho do screenshot capturado em caso de falha */
  screenshotPath: string | null;
}

const TIMEOUT_LOGIN_MS = 45_000;
const TIMEOUT_NAV_MS = 20_000;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

let sharedBrowser: Browser | null = null;

async function getBrowserEsaj(): Promise<Browser> {
  if (sharedBrowser && sharedBrowser.isConnected()) return sharedBrowser;
  sharedBrowser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
    ],
  });
  return sharedBrowser;
}

export async function fecharBrowserEsaj(): Promise<void> {
  if (sharedBrowser) {
    await sharedBrowser.close().catch(() => {});
    sharedBrowser = null;
  }
}

export class EsajTjceScraper {
  readonly tribunal = "tjce";
  readonly nome = "Tribunal de Justiça do Ceará — E-SAJ";

  constructor(private credencial: CredencialEsaj) {}

  /**
   * Tenta logar no E-SAJ TJ-CE com a credencial configurada.
   *
   * Retorna estruturado SEMPRE (não lança). Em caso de sucesso, inclui
   * `storageStateJson` que o caller deve persistir em cofre_sessoes
   * pra reuso. Em falha, inclui mensagem técnica e screenshot.
   */
  async testarLogin(): Promise<ResultadoLoginEsaj> {
    const inicio = Date.now();
    const browser = await getBrowserEsaj();
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      locale: "pt-BR",
      timezoneId: "America/Fortaleza",
      viewport: { width: 1366, height: 768 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(TIMEOUT_NAV_MS);

    let screenshotPath: string | null = null;
    try {
      const operacao = this.executarLogin(page);
      const timer = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`timeout_login_${TIMEOUT_LOGIN_MS}ms`)), TIMEOUT_LOGIN_MS),
      );
      await Promise.race([operacao, timer]);

      const storage = await context.storageState();
      const storageStateJson = JSON.stringify(storage);

      return {
        ok: true,
        mensagem: "Login no E-SAJ TJ-CE bem-sucedido",
        latenciaMs: Date.now() - inicio,
        storageStateJson,
        screenshotPath: null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      screenshotPath = await this.tirarScreenshotErro(page, "tjce-login-erro");
      return {
        ok: false,
        mensagem: this.classificarErroLogin(msg, page.url()),
        detalhes: `${msg} — URL final: ${page.url()}`,
        latenciaMs: Date.now() - inicio,
        screenshotPath,
      };
    } finally {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
    }
  }

  /**
   * Consulta um processo por CNJ usando uma sessão já estabelecida
   * (storageState passado como parâmetro).
   *
   * Caller deve obter o storageState via `recuperarSessao()` ou
   * `testarLogin()`. Se sessão expirou, retorna `categoriaErro:
   * "tribunal_indisponivel"` e caller deve relogar.
   */
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

    const browser = await getBrowserEsaj();
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
      // Tela de busca CPO-PG
      await page.goto(URLS.consultaCpoPg, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});

      // Detecta se a sessão expirou — ESAJ redireciona pra /sajcas/login
      // se o cookie tá inválido. Caller deve relogar.
      if (page.url().includes("/sajcas/login")) {
        return {
          ...baseResultado,
          latenciaMs: Date.now() - inicio,
          categoriaErro: "tribunal_indisponivel",
          mensagemErro:
            "Sessão expirada — E-SAJ redirecionou pra login. Cofre deve relogar e tentar novamente.",
          finalizadoEm: new Date().toISOString(),
        };
      }

      // Procura input de número único — ESAJ usa o seletor classe `numeroDigitoAnoUnificado`
      const inputCnj = page
        .locator(
          [
            "input[name='numeroDigitoAnoUnificado']",
            "input[id*='numero' i]:visible",
            "input[placeholder*='processo' i]:visible",
          ].join(", "),
        )
        .first();

      if (!(await inputCnj.isVisible({ timeout: 5000 }).catch(() => false))) {
        const screenshotPath = await this.tirarScreenshotErro(
          page,
          `tjce-no-input-${cnjLimpo}`,
        );
        return {
          ...baseResultado,
          latenciaMs: Date.now() - inicio,
          categoriaErro: "parse_falhou",
          mensagemErro: `Input de CNJ não encontrado em ${page.url()}`,
          screenshotPath,
          finalizadoEm: new Date().toISOString(),
        };
      }

      await inputCnj.fill(cnjMascarado);

      // ESAJ tem botão "Consultar" típico
      await Promise.all([
        page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {}),
        page
          .locator(
            [
              "input[type='submit'][value*='Consultar' i]",
              "button:has-text('Consultar')",
              "input[type='submit']",
            ].join(", "),
          )
          .first()
          .click({ timeout: 8000 }),
      ]);

      await page.waitForTimeout(800);

      // Page atual deve ser a tela de detalhes — extraímos placeholder por enquanto
      // (extração completa de capa+movimentações vem na próxima task)
      const screenshotPath = await this.tirarScreenshotErro(
        page,
        `tjce-detalhe-${cnjLimpo}`,
      );

      return {
        ...baseResultado,
        latenciaMs: Date.now() - inicio,
        categoriaErro: "parse_falhou",
        mensagemErro:
          `Login OK e busca submetida — extração de capa+movimentações ` +
          `do ESAJ TJ-CE chega na próxima iteração. URL atual: ${page.url()}, ` +
          `title: ${await page.title().catch(() => "?")}.`,
        screenshotPath,
        finalizadoEm: new Date().toISOString(),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const screenshotPath = await this.tirarScreenshotErro(
        page,
        `tjce-consulta-erro-${cnjLimpo}`,
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
   * Implementação concreta do fluxo de login. Se o ESAJ mudar a UI,
   * altera só aqui — `testarLogin()` continua sendo o ponto público.
   *
   * DIAGNÓSTICO: este método produz informação detalhada via campo
   * `diagnostico` da exceção (capturada em `testarLogin`) pra facilitar
   * calibração quando login rejeita por motivo desconhecido — vê HTML
   * dos erros, lista de inputs detectados, etc.
   */
  private async executarLogin(page: Page): Promise<void> {
    await page.goto(URLS.login, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});

    // O SAJCAS do TJ-CE pode ter abas ("Acesso Profissional" /
    // "Acesso Cidadão" / "Certificado Digital"). Tenta clicar em
    // "Profissional" antes de buscar o form — sem isso, o form
    // visível pode ser o de cidadão, que não aceita OAB.
    const tabsProfissional = [
      "a:has-text('Profissional')",
      "button:has-text('Profissional')",
      "[role='tab']:has-text('Profissional')",
      "li:has-text('Profissional') a",
    ];
    for (const sel of tabsProfissional) {
      try {
        const tab = page.locator(sel).first();
        if (await tab.isVisible({ timeout: 500 })) {
          await tab.click({ timeout: 1500 });
          await page.waitForTimeout(500);
          break;
        }
      } catch {
        // ignora
      }
    }

    // Form do SAJCAS — campos típicos: usernameForm, passwordForm.
    // Captura também CSRF token / hidden inputs pra log de diagnóstico.
    const inputUsuario = page
      .locator(
        [
          "input[name='username']",
          "input[id='usernameForm']",
          "input[name='usernameForm']",
          "input[id*='user' i]",
          "input[type='text']:visible",
        ].join(", "),
      )
      .first();

    const inputSenha = page
      .locator(
        [
          "input[name='password']",
          "input[id='passwordForm']",
          "input[name='passwordForm']",
          "input[type='password']:visible",
        ].join(", "),
      )
      .first();

    if (!(await inputUsuario.isVisible({ timeout: 5000 }).catch(() => false))) {
      const inputs = await this.listarInputsVisiveis(page);
      throw new Error(
        `Form de login não encontrado em ${page.url()}. ` +
          `Inputs visíveis na página: ${JSON.stringify(inputs).slice(0, 800)}`,
      );
    }

    // Limpa antes de preencher pra evitar acumular texto se houve retry
    await inputUsuario.click({ timeout: 3000 }).catch(() => {});
    await inputUsuario.fill("");
    await inputUsuario.fill(this.credencial.username);

    await inputSenha.click({ timeout: 3000 }).catch(() => {});
    await inputSenha.fill("");
    await inputSenha.fill(this.credencial.password);

    const botaoLogin = page
      .locator(
        [
          "button[type='submit']",
          "input[type='submit']",
          "button:has-text('Entrar')",
          "button:has-text('Acessar')",
        ].join(", "),
      )
      .first();

    await Promise.all([
      page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {}),
      botaoLogin.click({ timeout: 5000 }),
    ]);

    await page.waitForTimeout(1500);

    // ─── Tratamento de 2FA ───
    const indicadores2fa = [
      "input[name*='token' i]",
      "input[name*='codigo' i]",
      "input[placeholder*='código' i]",
      "input[placeholder*='token' i]",
      "input[maxlength='6']",
    ];
    const inputTotp = page.locator(indicadores2fa.join(", ")).first();
    const tem2fa = await inputTotp.isVisible({ timeout: 3000 }).catch(() => false);

    if (tem2fa) {
      if (!this.credencial.totpSecret) {
        throw new Error(
          "ESAJ pediu 2FA mas credencial cadastrada não tem TOTP secret. " +
            "Cadastre o secret base32 no cofre antes de validar.",
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

    // ─── Validação de sucesso ───
    // Login OK quando saímos da página de login E não há mensagem de
    // erro visível. ESAJ tipicamente redireciona pra /esaj/portal.do
    // ou /esaj/intra/index.do após login bem-sucedido.
    const urlFinal = page.url();
    if (urlFinal.includes("/sajcas/login")) {
      // Captura diagnóstico DETALHADO pra calibrar quando rejeição é
      // misteriosa. Pega TODA mensagem de alerta visível, lista
      // inputs encontrados, e trecho do HTML.
      const diagnostico = await this.coletarDiagnosticoLogin(page);
      const usernameDigitado = this.credencial.username;
      const usernameMascarado =
        usernameDigitado.length > 4
          ? `${usernameDigitado.slice(0, 2)}***${usernameDigitado.slice(-2)}`
          : "***";
      throw new Error(
        `Login rejeitado pelo ESAJ.\n` +
          `Username usado: "${usernameMascarado}" (${usernameDigitado.length} chars).\n` +
          `Mensagem do tribunal: ${diagnostico.mensagemErro || "(nenhuma mensagem capturada)"}.\n` +
          `Inputs detectados: ${diagnostico.inputs}.\n` +
          `URL final: ${urlFinal}.\n` +
          `Page title: ${diagnostico.title}.\n` +
          `Conteúdo (200 chars): ${diagnostico.htmlSnippet.slice(0, 200)}`,
      );
    }
  }

  /**
   * Coleta diagnóstico da página de login após rejeição. Sem isso,
   * a única mensagem é "credencial inválida" — que pode ser:
   *   • Senha mesmo errada
   *   • Username em formato errado (CPF vs OAB)
   *   • Aba de login errada (Cidadão em vez de Profissional)
   *   • CAPTCHA pulado
   *   • CSRF token ausente
   *   • Algum input hidden não preenchido
   *
   * Capturando a mensagem real do tribunal + lista de inputs
   * conseguimos diagnosticar sem ficar tentando às cegas.
   */
  private async coletarDiagnosticoLogin(page: Page): Promise<{
    mensagemErro: string;
    inputs: string;
    title: string;
    htmlSnippet: string;
  }> {
    const candidatosMsgErro = [
      ".alert",
      ".alert-danger",
      ".alert-warning",
      ".error",
      "[role='alert']",
      ".message",
      ".mensagem",
      ".feedback",
      ".validation-summary",
      "div.error-message",
      "span.error",
      "p.error",
    ];

    let mensagemErro = "";
    for (const sel of candidatosMsgErro) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 200 })) {
          const texto = (await el.innerText().catch(() => "")).trim();
          if (texto && texto.length < 500) {
            mensagemErro = texto;
            break;
          }
        }
      } catch {
        // ignora
      }
    }

    // Fallback: procura QUALQUER texto que pareça mensagem de erro
    if (!mensagemErro) {
      try {
        const texto = await page
          .locator("text=/inv[áa]lid|incorret|n[ãa]o autoriz|falha|erro|rejeit/i")
          .first()
          .innerText()
          .catch(() => "");
        if (texto && texto.length < 500) mensagemErro = texto.trim();
      } catch {
        // ignora
      }
    }

    const inputs = await this.listarInputsVisiveis(page);
    const title = await page.title().catch(() => "?");

    let htmlSnippet = "";
    try {
      // Pega só o conteúdo do <main> ou <body> pra evitar logar HEAD enorme
      htmlSnippet = await page
        .locator("main, body")
        .first()
        .innerText()
        .catch(() => "");
      htmlSnippet = htmlSnippet.replace(/\s+/g, " ").trim();
    } catch {
      // ignora
    }

    return {
      mensagemErro,
      inputs: JSON.stringify(inputs).slice(0, 500),
      title,
      htmlSnippet,
    };
  }

  /**
   * Lista inputs visíveis na página com nome/id/type/placeholder.
   * Útil em log de erro pra ver quais campos o adapter VIU vs quais
   * o tribunal de fato espera.
   */
  private async listarInputsVisiveis(
    page: Page,
  ): Promise<Array<{ name: string; id: string; type: string; placeholder: string }>> {
    return page
      .locator("input:visible")
      .evaluateAll((nodes) =>
        (nodes as HTMLInputElement[]).slice(0, 20).map((n) => ({
          name: n.getAttribute("name") || "",
          id: n.getAttribute("id") || "",
          type: n.getAttribute("type") || "text",
          placeholder: n.getAttribute("placeholder") || "",
        })),
      )
      .catch(() => []);
  }

  private classificarErroLogin(mensagem: string, urlFinal: string): string {
    if (mensagem.startsWith("timeout_login")) {
      return "Timeout no login (45s) — tribunal lento ou rede indisponível";
    }
    if (mensagem.includes("Login rejeitado")) {
      return mensagem; // já tem detalhes
    }
    if (mensagem.includes("2FA")) {
      return mensagem; // mensagem específica de TOTP
    }
    if (urlFinal.includes("/sajcas/login")) {
      return `Form de login carregou mas não conseguimos avançar — ${mensagem}`;
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

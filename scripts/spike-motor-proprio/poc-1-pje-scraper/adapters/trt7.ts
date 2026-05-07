/**
 * Adapter PJe TRT-7 (Tribunal Regional do Trabalho da 7ª Região — Ceará).
 *
 * IMPORTANTE: TRT-7 NÃO usa o mesmo PJe que TRT-2/TRT-15. Ele usa o
 * "PJe Consulta Processual" versão 2.x (mais moderno) — Angular Material,
 * com layout simplificado e captcha obrigatório antes de exibir detalhes.
 *
 * Por isso este adapter NÃO herda de TRT2Scraper — implementa lógica
 * própria adequada ao layout novo.
 *
 * Fluxo do PJe-novo (TRT-7):
 *   1. GET https://pje.trt7.jus.br/consultaprocessual/
 *   2. Página tem 1 input com label "Número do processo" + ícone lupa
 *   3. Preencher o input + Enter (ou clicar lupa)
 *   4. Tribunal redireciona pra `/captcha/detalhe-processo/{cnj}/1` com
 *      captcha visual (5 caracteres distorcidos)
 *   5. Após resolver captcha → `/detalhe-processo/{cnj}` com capa +
 *      movimentações
 *
 * STATUS NESTE ADAPTER: até integrar um solver de captcha (2Captcha
 * ~$2/1000 ou Whisper STT no captcha de áudio), retornamos
 * `captcha_bloqueio` com mensagem clara explicando o próximo passo.
 *
 * O fato de chegar até a tela de captcha (em vez de falhar antes)
 * confirma que a infra do motor próprio está funcionando — o que
 * falta é apenas o solver.
 */

import type { Page } from "@playwright/test";
import { capturarScreenshot, comRetry, novoContext } from "../../lib/playwright-helpers";
import { mascararCnj, normalizarCnj } from "../../lib/parser-utils";
import { withSpan } from "../../lib/sentry-spike";
import type { CategoriaErro, ResultadoScraper } from "../../lib/types-spike";
import type { ScraperTribunalAdapter } from "./base";

const URL_CONSULTA = "https://pje.trt7.jus.br/consultaprocessual/";
const TIMEOUT_TOTAL_MS = 35_000;
const TIMEOUT_SELETOR_MS = 15_000;

export class TRT7Scraper implements ScraperTribunalAdapter {
  readonly tribunal = "trt7";
  readonly nome = "Tribunal Regional do Trabalho — 7ª Região (Ceará)";

  async consultarPorCnj(cnj: string): Promise<ResultadoScraper> {
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

    if (cnjLimpo.length !== 20) {
      return {
        ...baseResultado,
        latenciaMs: Date.now() - inicio,
        categoriaErro: "outro",
        mensagemErro: "CNJ deve ter 20 dígitos (Resolução CNJ 65/2008)",
        finalizadoEm: new Date().toISOString(),
      };
    }

    const context = await novoContext();
    const page = await context.newPage();
    page.setDefaultTimeout(TIMEOUT_SELETOR_MS);

    try {
      return await withSpan(
        `${this.tribunal}.consultar_cnj`,
        { tribunal: this.tribunal, cnj: cnjMascarado },
        async () => {
          const operacao = this.executarConsulta(page, cnjMascarado);
          const timer = new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`timeout_total_${TIMEOUT_TOTAL_MS}ms`)),
              TIMEOUT_TOTAL_MS,
            ),
          );
          const resultado = await Promise.race([operacao, timer]);
          return {
            ...resultado,
            latenciaMs: Date.now() - inicio,
            finalizadoEm: new Date().toISOString(),
          };
        },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const categoriaErro: CategoriaErro = msg.startsWith("timeout_total")
        ? "timeout"
        : "outro";
      const screenshotPath = await capturarScreenshot(
        page,
        `${this.tribunal}-erro-${cnjLimpo}`,
      );
      return {
        ...baseResultado,
        latenciaMs: Date.now() - inicio,
        categoriaErro,
        mensagemErro: msg,
        screenshotPath,
        finalizadoEm: new Date().toISOString(),
      };
    } finally {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
    }
  }

  private async executarConsulta(
    page: Page,
    cnjMascarado: string,
  ): Promise<ResultadoScraper> {
    const cnjLimpo = normalizarCnj(cnjMascarado);
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

    await comRetry(
      () => page.goto(URL_CONSULTA, { waitUntil: "domcontentloaded" }),
      { tentativas: 3, baseMs: 1500, nome: `${this.tribunal}.goto` },
    );

    // PJe-novo é Angular — precisa esperar bootstrap. networkidle pega
    // melhor que domcontentloaded.
    await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
    await page.waitForTimeout(500);

    // Localiza o input. PJe-novo usa Material Design com floating label
    // "Número do processo". Estratégias múltiplas pra resiliência:
    //   1. getByLabel — Playwright trata label flutuante do MDC corretamente
    //   2. input[type="text"] dentro de mat-form-field
    //   3. Fallback genérico
    const inputCandidatos = [
      page.getByLabel(/n[úu]mero do processo/i, { exact: false }).first(),
      page.locator("mat-form-field input[type='text']").first(),
      page.locator("input[formcontrolname*='processo' i]").first(),
      page.locator("input[type='text']:visible").first(),
    ];

    let input: typeof inputCandidatos[number] | null = null;
    for (const candidato of inputCandidatos) {
      if (await candidato.isVisible({ timeout: 2000 }).catch(() => false)) {
        input = candidato;
        break;
      }
    }

    if (!input) {
      const screenshotPath = await capturarScreenshot(page, `${this.tribunal}-no-input-${cnjLimpo}`);
      return {
        ...baseResultado,
        categoriaErro: "parse_falhou",
        mensagemErro:
          `Input "Número do processo" não encontrado em ${URL_CONSULTA} — ` +
          `URL atual: ${page.url()}, title: ${await page.title().catch(() => "?")}`,
        screenshotPath,
      };
    }

    await input.click({ timeout: 5000 }).catch(() => {});
    await input.fill(cnjMascarado);

    // Submete via Enter (mais confiável que clicar a lupa-ícone, que
    // varia de implementação) e espera redirect pra detalhe ou captcha.
    await Promise.all([
      page
        .waitForURL(/detalhe-processo|captcha/i, { timeout: 15_000 })
        .catch(() => {}),
      input.press("Enter"),
    ]);
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});

    const urlAtual = page.url();

    // CAPTCHA: o PJe-novo redireciona pra `/captcha/detalhe-processo/{cnj}/1`
    // antes de exibir os dados do processo. Sem solver, paramos aqui com
    // mensagem clara explicando o próximo passo da implementação.
    if (urlAtual.includes("/captcha/")) {
      const screenshotPath = await capturarScreenshot(
        page,
        `${this.tribunal}-captcha-${cnjLimpo}`,
      );
      return {
        ...baseResultado,
        categoriaErro: "captcha_bloqueio",
        mensagemErro:
          `TRT-7 exige captcha visual pra exibir detalhes do processo. ` +
          `Backend já chegou na tela ${urlAtual} — falta integrar solver. ` +
          `Próximo passo do Spike: integrar 2Captcha (~$2/1000 captchas) ` +
          `OU usar Whisper STT no captcha de áudio (gratuito mas mais lento).`,
        screenshotPath,
      };
    }

    // Sem captcha: tenta extrair direto da página de detalhe.
    if (!urlAtual.includes("/detalhe-processo/")) {
      const screenshotPath = await capturarScreenshot(
        page,
        `${this.tribunal}-no-result-${cnjLimpo}`,
      );
      return {
        ...baseResultado,
        categoriaErro: "parse_falhou",
        mensagemErro:
          `Após submit, URL não é detalhe nem captcha. URL atual: ${urlAtual}. ` +
          `Title: ${await page.title().catch(() => "?")}.`,
        screenshotPath,
      };
    }

    // Fluxo de extração da página de detalhe — implementar quando captcha
    // estiver resolvido. Por ora, registra que cheguei na página correta.
    const screenshotPath = await capturarScreenshot(
      page,
      `${this.tribunal}-detalhe-pre-extracao-${cnjLimpo}`,
    );
    return {
      ...baseResultado,
      categoriaErro: "parse_falhou",
      mensagemErro:
        `Cheguei na página de detalhe (${urlAtual}) mas extração de capa+movimentações ` +
        `do PJe-novo ainda não implementada — depende de superar captcha primeiro ` +
        `pra ter dados consistentes pra calibrar selectors. Próximo passo do Spike.`,
      screenshotPath,
    };
  }
}

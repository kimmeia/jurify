/**
 * Adapter PJe TRT-2 (Tribunal Regional do Trabalho da 2ª Região — São Paulo).
 *
 * Fonte: consulta pública em https://pje.trt2.jus.br/consultaprocessual/
 *
 * Por que TRT2 primeiro:
 *  - Maior TRT do Brasil (cobre toda a Grande São Paulo)
 *  - PJe consulta pública aberta há anos, sem captcha relatado
 *  - Volume real de processos pra testar latência/estabilidade
 *
 * Estratégia:
 *  1. GET na página de consulta (carrega form JSF/RichFaces)
 *  2. POST simulado via Playwright preenchendo o input do CNJ
 *  3. Aguardar tabela de resultados ou mensagem "não encontrado"
 *  4. Clicar no link do processo encontrado pra abrir detalhe
 *  5. Extrair capa (partes, classes, valor) + movimentações
 *
 * Não usamos bare HTTP/Cheerio — o PJe tem JSF state e CSRF tokens
 * que mudam a cada request, então Playwright (que carrega JS) é
 * obrigatório.
 */

import { chromium } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import {
  capturarScreenshot,
  comRetry,
  novoContext,
  temCaptchaNaPagina,
} from "../../lib/playwright-helpers";
import { mascararCnj, normalizarCnj, parseDataBR, parseValorBRLCentavos } from "../../lib/parser-utils";
import { withSpan } from "../../lib/sentry-spike";
import type {
  CategoriaErro,
  MovimentacaoProcesso,
  ParteProcesso,
  ProcessoCapa,
  ResultadoScraper,
} from "../../lib/types-spike";
import type { ScraperTribunalAdapter } from "./base";

/**
 * Timeout total da consulta (navegação + busca + extração).
 * 25s cobre tribunal lento sem virar refém de página travada.
 */
const TIMEOUT_TOTAL_MS = 25_000;

/** Timeout de espera por seletor específico (mais generoso pra dar tempo do JSF renderizar) */
const TIMEOUT_SELETOR_MS = 15_000;

export class TRT2Scraper implements ScraperTribunalAdapter {
  readonly tribunal: string = "trt2";
  readonly nome: string = "Tribunal Regional do Trabalho — 2ª Região (SP)";

  /** Override em subclasses pra apontar pra outro TRT (TRT15, TRT3, etc) */
  protected getUrlConsulta(): string {
    return "https://pje.trt2.jus.br/consultaprocessual/";
  }

  async consultarPorCnj(cnj: string): Promise<ResultadoScraper> {
    const inicio = Date.now();
    const cnjMascarado = mascararCnj(cnj);
    const cnjLimpo = normalizarCnj(cnj);

    const resultadoBase: ResultadoScraper = {
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
        ...resultadoBase,
        latenciaMs: Date.now() - inicio,
        categoriaErro: "outro",
        mensagemErro: "CNJ deve ter 20 dígitos (segundo Resolução CNJ 65/2008)",
        finalizadoEm: new Date().toISOString(),
      };
    }

    // Aloca recursos antes do try/catch pra que o `finally` possa limpá-los
    // sem depender de control-flow analysis em closures (TS estreita pra
    // never quando atribuição mora dentro de async callback).
    const context = await novoContext();
    const page = await context.newPage();
    page.setDefaultTimeout(TIMEOUT_SELETOR_MS);

    try {
      return await withSpan(
        `${this.tribunal}.consultar_cnj`,
        { tribunal: this.tribunal, cnj: cnjMascarado },
        async () => {
          // Timeout global usando race entre operação real e timer.
          // Se a operação travar, abandona com erro categorizado.
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
        ...resultadoBase,
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

  /**
   * Fluxo principal de consulta — separado pra ser envolvido em
   * timeout/withSpan no caller. Também NUNCA lança exceção:
   * retorna ResultadoScraper parcial pra qualquer falha.
   */
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
      () => page.goto(this.getUrlConsulta(), { waitUntil: "domcontentloaded" }),
      { tentativas: 3, baseMs: 1500, nome: `${this.tribunal}.goto` },
    );

    // Aguarda JS terminar de renderizar. PJe usa JSF/RichFaces — DOMContentLoaded
    // dispara antes do framework montar o form. Sem isso, scrapers veem
    // página vazia e desistem cedo (latência ~2s no log do usuário).
    await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
    await page.waitForTimeout(800);

    // Modal de cookies / termo de uso aparece em alguns TRTs no primeiro
    // acesso. Tenta fechar — falha silenciosa se o modal não existe.
    await this.fecharModaisInterstitiais(page);

    if (await temCaptchaNaPagina(page)) {
      const screenshotPath = await capturarScreenshot(page, `${this.tribunal}-captcha-${cnjLimpo}`);
      return {
        ...baseResultado,
        categoriaErro: "captcha_bloqueio",
        mensagemErro: "Captcha detectado na página de consulta",
        screenshotPath,
      };
    }

    // Localiza o input do CNJ. PJe varia bastante de versão pra versão:
    //   • IDs JSF parametrizados (fPP:..., formularioBuscaProcessual:...)
    //   • Inputs em iframe nas versões mais antigas
    //   • Aba "Por número único" precisa ser clicada antes em algumas UIs
    //   • Placeholder/aria-label como fallback resiliente
    const inputCnj = await this.localizarInputCnj(page);

    if (!inputCnj) {
      // Salva HTML da página inteira pra debug remoto — quando o screenshot
      // não conta a história toda (ex: estrutura de formulário escondida).
      const html = await page.content().catch(() => "");
      const screenshotPath = await capturarScreenshot(page, `${this.tribunal}-no-input-${cnjLimpo}`);
      return {
        ...baseResultado,
        categoriaErro: "parse_falhou",
        mensagemErro:
          `Input de CNJ não encontrado na página de consulta ${this.tribunal.toUpperCase()}. ` +
          `URL atual: ${page.url()}. ` +
          `Tamanho HTML: ${html.length} chars. ` +
          `Title: ${await page.title().catch(() => "?")}.`,
        screenshotPath,
      };
    }

    await inputCnj.click({ timeout: 5000 }).catch(() => {});
    await inputCnj.fill(cnjMascarado);

    // Botão de busca: tipicamente "Pesquisar" ou ícone lupa.
    const botaoBuscar = page
      .locator(
        [
          "button:has-text('Pesquisar')",
          "input[type='submit'][value*='Pesquisar' i]",
          "a:has-text('Pesquisar')",
          "button[type='submit']",
        ].join(", "),
      )
      .first();

    await Promise.all([
      page.waitForLoadState("networkidle").catch(() => {}),
      botaoBuscar.click({ timeout: TIMEOUT_SELETOR_MS }),
    ]);

    // Aguarda renderização do resultado. PJe pode mostrar "Nenhum processo
    // encontrado" ou tabela de resultados. Damos tempo extra antes de
    // checar qual cenário caiu.
    await page.waitForTimeout(800);

    const textoNaoEncontrado = page
      .locator("text=/Nenhum processo encontrado|nenhum registro|não encontrado/i")
      .first();
    const naoEncontrado = await textoNaoEncontrado.isVisible().catch(() => false);
    if (naoEncontrado) {
      return {
        ...baseResultado,
        categoriaErro: "cnj_nao_encontrado",
        mensagemErro: "Tribunal respondeu mas processo não foi localizado",
      };
    }

    // Procura link/linha do processo no resultado e clica pra abrir detalhe.
    // O link típico contém o CNJ ou tem texto "Detalhes".
    const linkProcesso = page
      .locator(
        [
          `a:has-text('${cnjMascarado}')`,
          "a:has-text('Detalhes')",
          "tr.linhaResultado a",
          "table a[onclick*='Processo']",
        ].join(", "),
      )
      .first();

    const linkVisible = await linkProcesso.isVisible().catch(() => false);
    if (!linkVisible) {
      // Pode ser que a busca já tenha redirecionado pro detalhe direto —
      // verificamos se há tabela de movimentações na página atual.
      const temMovimentacoes = await page
        .locator("text=/movimentações|movimentos|histórico/i")
        .first()
        .isVisible()
        .catch(() => false);

      if (!temMovimentacoes) {
        const screenshotPath = await capturarScreenshot(page, `trt2-no-result-${cnjLimpo}`);
        return {
          ...baseResultado,
          categoriaErro: "parse_falhou",
          mensagemErro: "Resultado de busca não exibiu link nem movimentações",
          screenshotPath,
        };
      }
    } else {
      await linkProcesso.click();
      await page.waitForLoadState("networkidle").catch(() => {});
    }

    const capa = await this.extrairCapa(page, cnjMascarado);
    const movimentacoes = await this.extrairMovimentacoes(page);

    return {
      ...baseResultado,
      ok: true,
      capa,
      movimentacoes,
    };
  }

  /**
   * Extrai a capa do processo. PJe usa labels textuais "Classe", "Assunto",
   * "Valor da Causa", etc — buscamos por proximidade, não por seletores
   * fixos (que mudam entre versões).
   */
  /**
   * Tenta fechar modais que aparecem no primeiro acesso de alguns TRTs:
   * "Aceitar termo de uso", "Aceitar cookies", "Continuar" no aviso de
   * sistema. Falha silenciosa se modal não existe (cenário esperado em
   * acessos subsequentes).
   */
  protected async fecharModaisInterstitiais(page: Page): Promise<void> {
    const botoesParaFechar = [
      "button:has-text('Aceitar')",
      "button:has-text('Concordo')",
      "button:has-text('Continuar')",
      "button:has-text('OK')",
      "button:has-text('Fechar')",
      "button[aria-label*='Fechar' i]",
      ".modal button.close",
      "div[role='dialog'] button:visible",
    ];
    for (const sel of botoesParaFechar) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 500 })) {
          await el.click({ timeout: 1500 });
          await page.waitForTimeout(300);
        }
      } catch {
        // ignora — modal pode não existir
      }
    }
  }

  /**
   * Localiza o input do CNJ tentando estratégias múltiplas. Retorna o
   * Locator pronto pra `.fill()` ou null se nada for encontrado.
   *
   * Ordem de tentativas:
   *  1. Clica em aba "Número Único" se existir (PJe TRT modernos)
   *  2. Procura input no DOM principal por name/id/placeholder/aria
   *  3. Procura dentro de iframes (PJe v1 antigo embute em iframe)
   */
  protected async localizarInputCnj(page: Page) {
    const seletoresInput = [
      "input[name*='numeroProcesso' i]",
      "input[id*='NumeroProcesso' i]",
      "input[id*='numero' i][type='text']",
      "input[placeholder*='processo' i]",
      "input[placeholder*='CNJ' i]",
      "input[placeholder*='Número' i]",
      "input[aria-label*='processo' i]",
      "input[aria-label*='número' i]",
      "input[name*='NumProcesso' i]",
      "input.numeroProcesso",
      "input[maxlength='25']",
      "input[maxlength='20']",
    ];
    const seletorComposto = seletoresInput.join(", ");

    // 1. Aba "Número Único" — alguns PJes têm tabs separadas pra tipo
    //    de busca. Clicar na aba certa coloca o input visível.
    const tabsParaClicar = [
      "a:has-text('Número Único')",
      "a:has-text('Número do Processo')",
      "a:has-text('Por Número')",
      "button:has-text('Número Único')",
      "[role='tab']:has-text('Número')",
    ];
    for (const sel of tabsParaClicar) {
      try {
        const tab = page.locator(sel).first();
        if (await tab.isVisible({ timeout: 500 })) {
          await tab.click({ timeout: 1500 });
          await page.waitForTimeout(400);
          break;
        }
      } catch {
        // ignora
      }
    }

    // 2. Tenta DOM principal
    const inputDireto = page.locator(seletorComposto).first();
    if (await inputDireto.isVisible({ timeout: 2000 }).catch(() => false)) {
      return inputDireto;
    }

    // 3. Fallback: procura em iframes (PJe v1 antigo)
    const frames = page.frames();
    for (const frame of frames) {
      if (frame === page.mainFrame()) continue;
      try {
        const inputFrame = frame.locator(seletorComposto).first();
        if (await inputFrame.isVisible({ timeout: 1000 }).catch(() => false)) {
          return inputFrame;
        }
      } catch {
        // ignora frames que não permitem acesso
      }
    }

    return null;
  }

  private async extrairCapa(page: Page, cnj: string): Promise<ProcessoCapa> {
    const lerCampoPorLabel = async (labels: string[]): Promise<string | null> => {
      for (const label of labels) {
        // Estratégia: localiza elemento com texto do label, navega pro irmão
        // ou pai e captura o conteúdo. PJe varia bastante — tentamos N
        // estratégias.
        const seletor = page
          .locator(`xpath=//*[normalize-space(text())='${label}' or normalize-space(text())='${label}:']`)
          .first();
        const visible = await seletor.isVisible().catch(() => false);
        if (!visible) continue;

        // Tenta capturar próximo irmão ou conteúdo do pai
        const valor = await page
          .locator(
            `xpath=(//*[normalize-space(text())='${label}' or normalize-space(text())='${label}:']/following-sibling::*[1] | //*[normalize-space(text())='${label}' or normalize-space(text())='${label}:']/..)[1]`,
          )
          .first()
          .innerText()
          .catch(() => "");
        if (valor && valor.trim() && valor.trim() !== label) {
          return valor.replace(label, "").replace(/^[:\s]+/, "").trim();
        }
      }
      return null;
    };

    const classe = await lerCampoPorLabel(["Classe Judicial", "Classe", "Tipo da Ação"]);
    const orgao = await lerCampoPorLabel(["Órgão Julgador", "Vara", "Juízo"]);
    const valorRaw = await lerCampoPorLabel(["Valor da Causa", "Valor da causa", "Valor"]);
    const dataDistRaw = await lerCampoPorLabel(["Distribuído em", "Data de Distribuição", "Distribuição"]);
    const assuntosRaw = await lerCampoPorLabel(["Assuntos", "Assunto"]);

    const partes = await this.extrairPartes(page);

    return {
      cnj,
      classe,
      assuntos: assuntosRaw ? this.parseAssuntos(assuntosRaw) : [],
      orgaoJulgador: orgao,
      juiz: null,
      comarca: null,
      uf: "SP",
      valorCausaCentavos: parseValorBRLCentavos(valorRaw),
      dataDistribuicao: parseDataBR(dataDistRaw),
      status: null,
      partes,
      segredoJustica: false,
    };
  }

  private parseAssuntos(raw: string): string[] {
    return raw
      .split(/[,;\n]|\s+e\s+/)
      .map((a) => a.trim())
      .filter((a) => a.length > 2);
  }

  private async extrairPartes(page: Page): Promise<ParteProcesso[]> {
    // PJe costuma ter seções "Polo Ativo" e "Polo Passivo". Buscamos por
    // cabeçalhos textuais e capturamos os blocos seguintes.
    const partes: ParteProcesso[] = [];

    const polos: Array<{ label: string; polo: ParteProcesso["polo"] }> = [
      { label: "Polo Ativo", polo: "ativo" },
      { label: "Polo Passivo", polo: "passivo" },
      { label: "Outros", polo: "terceiro" },
    ];

    for (const { label, polo } of polos) {
      const blocos = page.locator(
        `xpath=//*[normalize-space(text())='${label}']/following::*[self::table or self::ul or self::div][1]//tr | //*[normalize-space(text())='${label}']/following::*[self::table or self::ul or self::div][1]//li`,
      );
      const count = await blocos.count().catch(() => 0);

      for (let i = 0; i < Math.min(count, 20); i++) {
        const texto = (await blocos.nth(i).innerText().catch(() => "")).trim();
        if (!texto) continue;

        const nome = texto.split("\n")[0]?.trim() || texto;
        if (nome.length < 2 || nome.length > 200) continue;

        partes.push({
          nome,
          polo,
          tipo: nome.match(/\bLTDA\b|S\.A\.|EIRELI|MEI/i) ? "juridica" : "fisica",
          documento: null,
          advogados: [],
        });
      }
    }

    return partes;
  }

  /**
   * Extrai a tabela de movimentações. Cada linha geralmente tem
   * "data + descrição". O PJe pode renderizar em <table>, <ul> ou cards.
   */
  private async extrairMovimentacoes(page: Page): Promise<MovimentacaoProcesso[]> {
    const movs: MovimentacaoProcesso[] = [];

    const linhas = page.locator(
      [
        "table.movimentacoes tbody tr",
        "table[id*='movimentacao' i] tbody tr",
        "table[id*='movimento' i] tbody tr",
        "ul.movimentos li",
        "div.movimentacao",
      ].join(", "),
    );

    const count = await linhas.count().catch(() => 0);
    if (count === 0) return [];

    for (let i = 0; i < Math.min(count, 500); i++) {
      const textoCompleto = (await linhas.nth(i).innerText().catch(() => "")).trim();
      if (!textoCompleto) continue;

      // Heurística: data BR no início (DD/MM/YYYY) seguida de texto.
      const matchData = textoCompleto.match(
        /(\d{2}\/\d{2}\/\d{4}(?:\s+\d{2}:\d{2}(?::\d{2})?)?)/,
      );
      if (!matchData) continue;

      const dataIso = parseDataBR(matchData[1]);
      if (!dataIso) continue;

      const texto = textoCompleto
        .replace(matchData[0], "")
        .replace(/^[\s\-:]+/, "")
        .trim();

      if (texto.length < 3) continue;

      movs.push({
        data: dataIso,
        texto,
        tipo: null,
        documento: null,
      });
    }

    return movs;
  }
}

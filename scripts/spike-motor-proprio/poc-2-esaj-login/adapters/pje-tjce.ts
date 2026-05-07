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
import { gerarCodigoTotp, gerarCodigosVizinhos, type CodigosVizinhos } from "./tjce-totp";
import type {
  MovimentacaoProcesso,
  ParteProcesso,
  ProcessoCapa,
  ResultadoScraper,
} from "../../lib/types-spike";
import {
  mascararCnj,
  normalizarCnj,
  parseDataBR,
  parseValorBRLCentavos,
} from "../../lib/parser-utils";

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
  /**
   * Quando o Keycloak forçou CONFIGURE_TOTP e o robô auto-configurou,
   * retorna o secret base32 NOVO que precisa ser cadastrado no app
   * autenticador do usuário (Google Authenticator/Authy) pra que ele
   * também consiga gerar códigos válidos manualmente.
   *
   * Caller deve:
   *   1. Persistir esse secret no cofre (substituir o antigo)
   *   2. Mostrar pro usuário com instrução de adicionar no app
   */
  totpSecretConfigurado?: string;
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

interface DiagnosticoTotp {
  secretTamanho: number;
  /** Primeiros 4 chars do secret (mascarado) */
  secretInicio: string;
  /** Últimos 4 chars do secret (mascarado) */
  secretFim: string;
  /** Secret completo após limpeza (toUpperCase + remove whitespace) */
  secretCompletoLimpo: string;
  /** Char codes Unicode de cada char do secret limpo */
  secretCharCodes: number[];
  /** Tamanho do secret BRUTO (antes de limpar whitespace) */
  secretTamanhoBruto: number;
  /** Código de 6 dígitos gerado pelo cofre na hora do submit */
  codigoGerado: string;
  /** Hora UTC do servidor quando o código foi gerado */
  horaServidorUtc: string;
  /** Quantos segundos restam até a janela TOTP atual expirar (e código mudar) */
  segundosRestantesNaJanela: number;
  /** Códigos das 5 janelas vizinhas — ajuda a detectar drift de clock */
  vizinhos: CodigosVizinhos;
}

export class PjeTjceScraper {
  readonly tribunal = "tjce";
  readonly nome = "Tribunal de Justiça do Ceará — PJe via PDPJ-cloud";

  /**
   * Captura informação sobre o TOTP gerado quando preenchemos o input.
   * Usado APENAS pra construir mensagem de erro detalhada se o
   * Keycloak rejeitar o código — assim o usuário consegue comparar
   * com o app autenticador dele em tempo real e diagnosticar drift.
   *
   * Nunca expõe o secret completo — só primeiros/últimos 4 chars.
   */
  private diagnosticoTotp: DiagnosticoTotp | null = null;

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

    let totpSecretConfigurado: string | undefined;
    try {
      const operacao = this.executarLogin(page, (s) => {
        totpSecretConfigurado = s;
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
        mensagem: totpSecretConfigurado
          ? "Login OK + 2FA auto-configurado. Adicione o novo secret no seu app autenticador."
          : "Login no PJe TJCE via PDPJ-cloud bem-sucedido",
        latenciaMs: Date.now() - inicio,
        storageStateJson,
        screenshotPath: null,
        totpSecretConfigurado,
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
      // PJe TJCE 1º grau usa JSF/Seam. URL inicial confirmada via teste real:
      //   /pje1grau/QuadroAviso/listViewQuadroAvisoMensagem.seam (painel)
      //   /pje1grau/Processo/ConsultaProcesso/listView.seam (busca)
      //
      // O .seam é stateful: precisa do `cid` (conversation id) na URL.
      // Acessamos a URL de busca direta, JSF cria nova conversation.
      const urlBusca =
        "https://pje.tjce.jus.br/pje1grau/Processo/ConsultaProcesso/listView.seam";
      await page.goto(urlBusca, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

      // Se redirecionou pro SSO, sessão expirou — caller deve relogar
      if (page.url().includes(HOST_KEYCLOAK)) {
        return {
          ...baseResultado,
          latenciaMs: Date.now() - inicio,
          categoriaErro: "tribunal_indisponivel",
          mensagemErro: "Sessão expirada — PDPJ-cloud redirecionou pra login do Keycloak",
          finalizadoEm: new Date().toISOString(),
        };
      }

      // ─── Localiza input do CNJ ───
      // PJe 1.x JSF tem IDs parametrizados (`fPP:numeroProcesso:...`) mas o
      // atributo `name` costuma conter "numeroDigitoAnoUnificado" ou
      // "numeroProcesso". Selectors flexíveis pra resiliência.
      const inputCnj = page
        .locator(
          [
            "input[name*='numeroDigitoAnoUnificado']",
            "input[id*='numeroDigitoAnoUnificado']",
            "input[name*='numeroProcesso' i]",
            "input[id*='NumeroProcesso' i]",
            "input[id*='numero' i][type='text']:visible",
            "input[placeholder*='processo' i]",
          ].join(", "),
        )
        .first();

      if (!(await inputCnj.isVisible({ timeout: 5000 }).catch(() => false))) {
        const html = await page.content().catch(() => "");
        const screenshotPath = await this.tirarScreenshotErro(
          page,
          `pje-tjce-no-input-${cnjLimpo}`,
        );
        return {
          ...baseResultado,
          latenciaMs: Date.now() - inicio,
          categoriaErro: "parse_falhou",
          mensagemErro:
            `Input de CNJ não encontrado na busca PJe TJCE. ` +
            `URL: ${page.url()}, title: ${await page.title().catch(() => "?")}, ` +
            `tamanho HTML: ${html.length}`,
          screenshotPath,
          finalizadoEm: new Date().toISOString(),
        };
      }

      await inputCnj.click({ timeout: 3000 }).catch(() => {});
      await inputCnj.fill(cnjMascarado);

      // Submit: tenta botão (input/button/link) primeiro; se falhar, fallback
      // pra Enter no input. PJe 1.x JSF renderiza botões de várias formas
      // (input[type=submit], button, a4j:commandButton -> <a>, etc).
      const seletoresBotao = [
        "input[type='submit'][value*='Pesquisar' i]",
        "input[type='submit'][value*='Buscar' i]",
        "input[type='submit'][value*='Consultar' i]",
        "input[type='button'][value*='Pesquisar' i]",
        "button[type='submit']:has-text('Pesquisar')",
        "button:has-text('Pesquisar')",
        "button:has-text('Buscar')",
        "a:has-text('Pesquisar'):visible",
        "a[id*='Pesquisar' i]:visible",
        "a[onclick*='pesquis' i]:visible",
        "input[type='submit']:visible",
      ];
      const botaoPesquisar = page.locator(seletoresBotao.join(", ")).first();

      const botaoVisivel = await botaoPesquisar
        .isVisible({ timeout: 3000 })
        .catch(() => false);

      if (botaoVisivel) {
        await Promise.all([
          page.waitForLoadState("networkidle", { timeout: 18_000 }).catch(() => {}),
          botaoPesquisar.click({ timeout: 5000 }).catch(async () => {
            // Se click falhar (ex: elemento overlapped), tenta Enter
            await inputCnj.press("Enter").catch(() => {});
          }),
        ]);
      } else {
        // Sem botão visível — submete via Enter no input do CNJ
        await Promise.all([
          page.waitForLoadState("networkidle", { timeout: 18_000 }).catch(() => {}),
          inputCnj.press("Enter"),
        ]);
      }
      await page.waitForTimeout(1500);

      // ─── Detecta cenários após submit ───
      const naoEncontrado = await page
        .locator("text=/Nenhum processo encontrado|nenhum registro|não encontrado/i")
        .first()
        .isVisible()
        .catch(() => false);
      if (naoEncontrado) {
        return {
          ...baseResultado,
          latenciaMs: Date.now() - inicio,
          categoriaErro: "cnj_nao_encontrado",
          mensagemErro: "PJe TJCE respondeu mas não localizou o processo",
          finalizadoEm: new Date().toISOString(),
        };
      }

      // Procura link/linha do processo no resultado.
      // PJe TJCE 1º grau (RichFaces): cada linha tem múltiplos botões,
      // identificados por `fPP:processosTable:{id}:j_id{N}`. Diagnóstico
      // mostrou que `:j_id487` é o "Ver detalhes" (btn-default-sm) e
      // `:j_id492` é outro botão (btn-link-condensed). Preferimos j_id487.
      const seletorLinkResultado =
        "a[id*='processosTable'][id$=':j_id487'], " +
        "a[id*='processosTable'][id$=':j_id492'], " +
        "a.btn-link[id*='processosTable']";
      const linkProcesso = page.locator(seletorLinkResultado).first();

      const linkVisible = await linkProcesso.isVisible({ timeout: 3000 }).catch(() => false);
      if (linkVisible) {
        // Aguarda modal de loading sumir
        await page
          .locator("#modalStatusContent, #modalStatusContentTable")
          .first()
          .waitFor({ state: "hidden", timeout: 5000 })
          .catch(() => {});

        // Estratégia definitiva: POST AJAX manual via page.request,
        // bypassa simulação de click. Sequência real do PJe TJCE:
        //   1. POST AJAX `listView.seam` com viewState + ID do link
        //   2. Servidor responde XML com <redirect url=".../Detalhe/...?id=X&ca=Y">
        //   3. Browser segue redirect → carrega detalhe
        // Replicamos 1+3 manualmente, sem depender de simular click.
        const dadosLink = await page
          .evaluate((sel) => {
            const link = document.querySelector(sel) as HTMLAnchorElement | null;
            if (!link) return null;
            const linkId = link.id;
            const form = link.closest("form") as HTMLFormElement | null;
            if (!form) return null;
            const viewStateInput = form.querySelector(
              "input[name='javax.faces.ViewState']",
            ) as HTMLInputElement | null;
            const viewState = viewStateInput?.value ?? null;
            const formId = form.id || form.name || "fPP";
            // Parseia `parameters` do onclick A4J.AJAX.Submit. Padrão:
            //   onclick="A4J.AJAX.Submit('fPP',event,{
            //     'similarityGroupingId':'X',
            //     'parameters':{'k1':'v1','k2':'v2'}
            //   })"
            // Esses parameters viram hidden inputs no submit AJAX.
            const onclickStr = link.getAttribute("onclick") ?? "";
            const parameters: Record<string, string> = {};
            const paramsMatch = onclickStr.match(/['"]parameters['"]\s*:\s*\{([^}]+)\}/);
            if (paramsMatch) {
              // Extrai cada par 'chave':'valor'
              const re = /['"]([^'"]+)['"]\s*:\s*['"]([^'"]*)['"]/g;
              let m: RegExpExecArray | null;
              while ((m = re.exec(paramsMatch[1])) !== null) {
                parameters[m[1]] = m[2];
              }
            }
            return {
              linkId,
              formId,
              viewState,
              action: form.action,
              parameters,
            };
          }, seletorLinkResultado)
          .catch(() => null);

        let urlDetalhe: string | null = null;

        if (dadosLink && dadosLink.viewState) {
          // Monta payload padrão RichFaces 3.x AJAX
          const payload = new URLSearchParams();
          payload.append("AJAXREQUEST", "_viewRoot");
          payload.append(dadosLink.formId, dadosLink.formId);
          payload.append(dadosLink.linkId, dadosLink.linkId);
          payload.append("ajaxSingle", dadosLink.linkId);
          payload.append("similarityGroupingId", dadosLink.linkId);
          // Injeta `parameters` parseados do onclick (ex:
          // idProcessoSelecionado=3253677). Sem isso, servidor rejeita.
          for (const [k, v] of Object.entries(dadosLink.parameters)) {
            payload.append(k, v);
          }
          payload.append("javax.faces.ViewState", dadosLink.viewState);
          payload.append("AJAX:EVENTS_COUNT", "1");

          const ajaxResponse = await page.request
            .post(dadosLink.action, {
              data: payload.toString(),
              headers: {
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "Faces-Request": "partial/ajax",
                Accept: "text/xml,application/xml,*/*;q=0.5",
                Referer: page.url(),
              },
              maxRedirects: 0,
            })
            .catch(() => null);

          if (ajaxResponse) {
            const xmlText = await ajaxResponse.text().catch(() => "");
            // Parse `<redirect url="..."` no XML response
            const redirectMatch = xmlText.match(/<redirect[^>]+url="([^"]+)"/i);
            if (redirectMatch) {
              const urlRedirect = redirectMatch[1].replace(/&amp;/g, "&");
              urlDetalhe = urlRedirect.startsWith("http")
                ? urlRedirect
                : `https://pje.tjce.jus.br${urlRedirect.startsWith("/") ? "" : "/"}${urlRedirect}`;
            }
          }
        }

        // Fallback: tenta ainda dispatchEvent (caso o POST manual falhe
        // por algum detalhe de formato) e captura via waitForResponse
        if (!urlDetalhe) {
          const respPromise = page
            .waitForResponse(
              (r) => r.url().includes("listProcessoCompletoAdvogado.seam"),
              { timeout: 8000 },
            )
            .catch(() => null);
          await page.dispatchEvent(seletorLinkResultado, "click").catch(() => {});
          const resp = await respPromise;
          if (resp) urlDetalhe = resp.url();
        }

        if (urlDetalhe) {
          await page.goto(urlDetalhe, { waitUntil: "domcontentloaded" });
          await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
          await page.waitForTimeout(1500);
        }
      }
      // Se não há link, pode ser que a busca já redirecionou direto
      // pro detalhe (PJe faz isso quando há match único). Seguimos
      // tentando extrair da página atual.

      // ─── Extração ───
      const capa = await this.extrairCapa(page, cnjMascarado);
      const movimentacoes = await this.extrairMovimentacoes(page);

      // Validação básica: se não pegou nada, é provável que extração
      // falhou (selectors errados ou página não é a de detalhe)
      const conseguiuExtrair = capa.classe || capa.partes.length > 0 || movimentacoes.length > 0;
      if (!conseguiuExtrair) {
        const screenshotPath = await this.tirarScreenshotErro(
          page,
          `pje-tjce-extracao-vazia-${cnjLimpo}`,
        );
        // Diagnóstico: dump resumido de elementos relevantes pra eu ver
        // selectors reais sem precisar do HTML inteiro.
        const debug = await page.evaluate(() => {
          const sample = (el: Element, len = 120) =>
            el.outerHTML.replace(/\s+/g, " ").slice(0, len);
          const tables = Array.from(document.querySelectorAll("table"))
            .slice(0, 5)
            .map((t) => {
              const id = t.id || "(sem id)";
              const rows = t.querySelectorAll("tr").length;
              const firstRow = t.querySelector("tr")?.textContent?.trim().slice(0, 80) ?? "";
              return `table#${id} rows=${rows} firstRow="${firstRow}"`;
            });
          const linksProc = Array.from(document.querySelectorAll("a"))
            .filter((a) => /processosTable|processo/i.test(a.id ?? ""))
            .slice(0, 3)
            .map((a) => sample(a, 250));
          const msgs = Array.from(
            document.querySelectorAll(".rich-messages, .ui-messages, .alert, .erro, .mensagem"),
          )
            .slice(0, 3)
            .map((el) => (el.textContent ?? "").trim().slice(0, 200))
            .filter(Boolean);
          // Diagnóstico do RichFaces / A4J
          const w = window as unknown as Record<string, unknown>;
          const a4j = w.A4J as Record<string, unknown> | undefined;
          const ajax = a4j?.AJAX as Record<string, unknown> | undefined;
          const a4jStatus = {
            A4J: typeof w.A4J,
            "A4J.AJAX": typeof a4j?.AJAX,
            "A4J.AJAX.Submit": typeof ajax?.Submit,
            jsf: typeof w.jsf,
          };
          // Forms da página + viewState
          const forms = Array.from(document.querySelectorAll("form")).map((f) => ({
            id: f.id || "(sem id)",
            action: f.action.slice(0, 100),
            method: f.method,
            inputs: f.querySelectorAll("input").length,
            hasViewState: !!f.querySelector("input[name='javax.faces.ViewState']"),
          }));
          return {
            bodyLen: document.body.innerHTML.length,
            tables,
            linksProc,
            msgs,
            a4jStatus,
            forms,
          };
        }).catch(() => null);

        return {
          ...baseResultado,
          latenciaMs: Date.now() - inicio,
          categoriaErro: "parse_falhou",
          mensagemErro:
            `Extração vazia. URL=${page.url()} | title=${await page.title().catch(() => "?")} | ` +
            `bodyLen=${debug?.bodyLen ?? "?"} | tables=${JSON.stringify(debug?.tables ?? [])} | ` +
            `linksCnj=${JSON.stringify(debug?.linksProc ?? [])} | msgs=${JSON.stringify(debug?.msgs ?? [])} | ` +
            `a4j=${JSON.stringify(debug?.a4jStatus ?? {})} | forms=${JSON.stringify(debug?.forms ?? [])}`,
          screenshotPath,
          finalizadoEm: new Date().toISOString(),
        };
      }

      return {
        ...baseResultado,
        ok: true,
        capa,
        movimentacoes,
        latenciaMs: Date.now() - inicio,
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
   * Extrai capa do processo (classe, partes, valor, etc) usando busca
   * por proximidade textual em vez de IDs JSF voláteis.
   *
   * Timeout curto (1500ms) por label pra não travar quando elemento não
   * existe — `setDefaultTimeout(25_000)` da page faria cada miss esperar
   * 25s, e com ~16 labels o adapter bloqueava por minutos.
   */
  private async extrairCapa(page: Page, cnj: string): Promise<ProcessoCapa> {
    const lerCampoPorLabel = async (labels: string[]): Promise<string | null> => {
      for (const label of labels) {
        try {
          const locator = page
            .locator(
              `xpath=(//*[normalize-space(text())='${label}' or normalize-space(text())='${label}:']/following-sibling::*[1] | //*[normalize-space(text())='${label}' or normalize-space(text())='${label}:']/..)[1]`,
            )
            .first();
          // Checa existência rápido em vez de innerText timeout-eternal
          const count = await locator.count().catch(() => 0);
          if (count === 0) continue;
          const valor = await locator.innerText({ timeout: 1500 }).catch(() => "");
          if (valor && valor.trim() && !valor.trim().endsWith(":")) {
            return valor.replace(label, "").replace(/^[:\s]+/, "").trim();
          }
        } catch {
          // ignora
        }
      }
      return null;
    };

    const classe = await lerCampoPorLabel(["Classe Judicial", "Classe", "Tipo da Ação"]);
    const orgao = await lerCampoPorLabel([
      "Órgão Julgador",
      "Vara",
      "Juízo",
      "Órgão Julgador Colegiado",
    ]);
    const valorRaw = await lerCampoPorLabel(["Valor da Causa", "Valor da causa", "Valor"]);
    const dataDistRaw = await lerCampoPorLabel([
      "Distribuído em",
      "Data de Distribuição",
      "Distribuição",
      "Data Autuação",
    ]);
    const assuntosRaw = await lerCampoPorLabel(["Assuntos", "Assunto"]);

    const partes = await this.extrairPartes(page);

    return {
      cnj,
      classe,
      assuntos: assuntosRaw ? this.parseAssuntos(assuntosRaw) : [],
      orgaoJulgador: orgao,
      juiz: null,
      comarca: null,
      uf: "CE",
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

  /**
   * Extrai partes do processo. PJe costuma ter seções "Polo Ativo" e
   * "Polo Passivo" — captura blocos seguintes a esses cabeçalhos.
   */
  private async extrairPartes(page: Page): Promise<ParteProcesso[]> {
    const partes: ParteProcesso[] = [];
    const polos: Array<{ label: string; polo: ParteProcesso["polo"] }> = [
      { label: "Polo Ativo", polo: "ativo" },
      { label: "Polo Passivo", polo: "passivo" },
      { label: "Outros", polo: "terceiro" },
    ];

    for (const { label, polo } of polos) {
      try {
        const blocos = page.locator(
          `xpath=//*[normalize-space(text())='${label}']/following::*[self::table or self::ul or self::div][1]//tr | //*[normalize-space(text())='${label}']/following::*[self::table or self::ul or self::div][1]//li`,
        );
        const count = await blocos.count().catch(() => 0);

        for (let i = 0; i < Math.min(count, 20); i++) {
          const texto = (
            await blocos.nth(i).innerText({ timeout: 1500 }).catch(() => "")
          ).trim();
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
      } catch {
        // ignora
      }
    }

    return partes;
  }

  /**
   * Extrai movimentações. PJe geralmente lista em <table> com colunas
   * "Data" e "Movimento". Cada linha é uma movimentação.
   */
  private async extrairMovimentacoes(page: Page): Promise<MovimentacaoProcesso[]> {
    const movs: MovimentacaoProcesso[] = [];

    const linhas = page.locator(
      [
        "table.movimentacoes tbody tr",
        "table[id*='movimentacao' i] tbody tr",
        "table[id*='movimento' i] tbody tr",
        "table[id*='historico' i] tbody tr",
        "ul.movimentos li",
        "div.movimentacao",
        "table[role='grid'] tbody tr",
      ].join(", "),
    );

    const count = await linhas.count().catch(() => 0);
    if (count === 0) return [];

    for (let i = 0; i < Math.min(count, 500); i++) {
      const textoCompleto = (
        await linhas.nth(i).innerText({ timeout: 1500 }).catch(() => "")
      ).trim();
      if (!textoCompleto) continue;

      // Heurística: data BR no início (DD/MM/YYYY) seguida de texto
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

  /**
   * Fluxo de login PDPJ-cloud:
   *  1. Acessa pje.tjce.jus.br → tribunal redireciona pro SSO
   *  2. Aguarda chegar no Keycloak (host sso.cloud.pje.jus.br)
   *  3. Form padrão Keycloak: id="username", id="password", id="kc-login"
   *  4. Detecta 2FA na tela seguinte (id="otp" ou similar)
   *  5. Aguarda redirect de volta pra pje.tjce.jus.br
   */
  private async executarLogin(
    page: Page,
    onTotpAutoConfigurado: (secret: string) => void,
  ): Promise<void> {
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
    // Cada visita à tela gera SECRET NOVO no servidor — não dá pra usar
    // secret cadastrado antes pelo usuário (já foi descartado).
    //
    // Estratégia: capturar o secret atual da página, gerar código com
    // ele, completar a configuração, retornar o secret novo via callback.
    // Caller atualiza o cofre + avisa o usuário pra adicionar o secret
    // no app autenticador dele também.
    if (
      page.url().includes("CONFIGURE_TOTP") ||
      page.url().includes("execution=CONFIGURE")
    ) {
      const secretCapturado = await this.extrairSecretTotpDaTela(page);
      if (!secretCapturado) {
        // Captura HTML pra diagnóstico — sem isso, fico tentando às cegas
        // qual selector usar. Trunca pra não saturar log/UI.
        const htmlBody = await page
          .locator("body")
          .innerHTML()
          .catch(() => "");
        const htmlLimpo = htmlBody
          .replace(/\s+/g, " ")
          .replace(/<svg[\s\S]*?<\/svg>/g, "<svg/>")
          .replace(/<style[\s\S]*?<\/style>/g, "")
          .replace(/<script[\s\S]*?<\/script>/g, "")
          .trim();
        const inputsCount = await page.locator("input").count().catch(() => 0);
        const kbdCount = await page.locator("kbd").count().catch(() => 0);
        const codeCount = await page.locator("code").count().catch(() => 0);
        const linkCount = await page.locator("a").count().catch(() => 0);

        throw new Error(
          "PDPJ_CONFIGURE_TOTP: detectei a tela de configuração de 2FA mas não " +
            `consegui capturar o secret base32 da página. ` +
            `Diagnóstico: ${inputsCount} inputs, ${kbdCount} <kbd>, ${codeCount} <code>, ${linkCount} <a>. ` +
            `URL: ${page.url()}. ` +
            `HTML (primeiros 3000 chars, sem style/script/svg): ${htmlLimpo.slice(0, 3000)}`,
        );
      }

      // Gera código TOTP do secret capturado e completa a configuração
      const codigoTotp = gerarCodigoTotp(secretCapturado);

      const inputTotp = page.locator("input#totp, input[name='totp']").first();
      const inputUserLabel = page
        .locator("input#userLabel, input[name='userLabel']")
        .first();

      if (!(await inputTotp.isVisible({ timeout: 3000 }).catch(() => false))) {
        throw new Error(
          `Campo "totp" não encontrado na tela CONFIGURE_TOTP — Keycloak pode ter mudado. URL: ${page.url()}`,
        );
      }

      await inputTotp.fill(codigoTotp);

      // Campo opcional "Nome do dispositivo" — preenche pra deixar
      // identificável quando o usuário olhar lista de devices no Keycloak
      if (await inputUserLabel.isVisible({ timeout: 500 }).catch(() => false)) {
        await inputUserLabel.fill("Jurify Motor Próprio (auto-configurado)");
      }

      const botaoSave = page
        .locator(
          [
            "input#saveTOTPBtn",
            "button[name='submitAction'][value='Save']",
            "input[type='submit']",
            "button[type='submit']",
          ].join(", "),
        )
        .first();

      await Promise.all([
        page.waitForLoadState("networkidle", { timeout: 18_000 }).catch(() => {}),
        botaoSave.click({ timeout: 5000 }),
      ]);
      await page.waitForTimeout(2000);

      // Confirma que saiu da tela CONFIGURE_TOTP
      if (
        page.url().includes("CONFIGURE_TOTP") ||
        page.url().includes("execution=CONFIGURE")
      ) {
        const diag = await this.coletarDiagnosticoKeycloak(page);
        throw new Error(
          `Auto-configuração de TOTP falhou — Keycloak ainda está em CONFIGURE_TOTP. ` +
            `Mensagem: ${diag.mensagemErro || "(sem mensagem)"}. ` +
            `Inputs: ${diag.inputs}.`,
        );
      }

      // Sucesso — secret é o novo TOTP da conta. Notifica caller.
      onTotpAutoConfigurado(secretCapturado);
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

      // Diagnóstico do TOTP — guardado em fechamento pra usar caso login falhe.
      // NÃO loga em stdout pra não vazar (Sentry/CloudWatch capturam logs).
      const secretBruto = this.credencial.totpSecret;
      const secretLimpo = secretBruto.replace(/\s+/g, "").toUpperCase();
      const secretCharCodes = Array.from(secretLimpo).map((c) => c.charCodeAt(0));
      const codigo = gerarCodigoTotp(secretBruto);
      const vizinhos = gerarCodigosVizinhos(secretBruto);
      const agoraUtc = new Date().toISOString();
      const segundosNaJanela = Math.floor(Date.now() / 1000) % 30;
      const segundosRestantes = 30 - segundosNaJanela;
      this.diagnosticoTotp = {
        secretTamanho: secretLimpo.length,
        secretTamanhoBruto: secretBruto.length,
        secretInicio: secretLimpo.slice(0, 4),
        secretFim: secretLimpo.slice(-4),
        secretCompletoLimpo: secretLimpo,
        secretCharCodes,
        codigoGerado: codigo,
        horaServidorUtc: agoraUtc,
        segundosRestantesNaJanela: segundosRestantes,
        vizinhos,
      };

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

      // Se a falha foi na tela de TOTP especificamente, inclui diagnóstico
      // do código gerado pelo cofre — ajuda a confirmar/refutar drift de
      // secret entre cofre e app autenticador do usuário.
      const ehFalhaTotp =
        urlFinal.includes("authenticate") &&
        (diag.inputs.includes("'otp'") || diag.inputs.includes("\"otp\"")) &&
        this.diagnosticoTotp !== null;

      const blocoTotp = ehFalhaTotp && this.diagnosticoTotp
        ? `\n\n=== DIAGNÓSTICO TOTP (compare com seu app autenticador AGORA) ===\n` +
          `Código gerado pelo cofre (janela atual): ${this.diagnosticoTotp.codigoGerado}\n` +
          `Secret tamanho limpo: ${this.diagnosticoTotp.secretTamanho} chars (bruto: ${this.diagnosticoTotp.secretTamanhoBruto})\n` +
          `Secret início: ${this.diagnosticoTotp.secretInicio}... fim: ...${this.diagnosticoTotp.secretFim}\n` +
          `Hora do servidor (UTC): ${this.diagnosticoTotp.horaServidorUtc}\n` +
          `Segundos restantes até próximo código: ${this.diagnosticoTotp.segundosRestantesNaJanela}\n` +
          `Counter TOTP atual: ${this.diagnosticoTotp.vizinhos.counterAtual}\n` +
          `\n--- Códigos das 5 janelas vizinhas (detecção de drift de clock) ---\n` +
          `Janela -60s (2 atrás):  ${this.diagnosticoTotp.vizinhos.menos2}\n` +
          `Janela -30s (1 atrás):  ${this.diagnosticoTotp.vizinhos.menos1}\n` +
          `Janela ATUAL:           ${this.diagnosticoTotp.vizinhos.atual}  ← essa foi enviada\n` +
          `Janela +30s (1 frente): ${this.diagnosticoTotp.vizinhos.mais1}\n` +
          `Janela +60s (2 frente): ${this.diagnosticoTotp.vizinhos.mais2}\n` +
          `\n--- SECRET COMPLETO armazenado no cofre (compare letra-a-letra com app) ---\n` +
          `${this.diagnosticoTotp.secretCompletoLimpo}\n` +
          `Char codes (Unicode decimal de cada char): [${this.diagnosticoTotp.secretCharCodes.join(",")}]\n` +
          `Esperado: char codes A-Z = 65-90, 2-7 = 50-55. Qualquer outro valor → caractere problemático.\n` +
          `\nSe o secret acima FOR DIFERENTE do que está no app autenticador, achou a causa.\n` +
          `Se for IDÊNTICO mas códigos não batem, é problema diferente (drift de clock,\n` +
          `bug no decoder base32, etc) — me avise.`
        : "";

      throw new Error(
        `Login rejeitado pelo Keycloak (PDPJ-cloud).\n` +
          `Username usado: "${usernameMascarado}" (${this.credencial.username.length} chars).\n` +
          `Mensagem do Keycloak: ${diag.mensagemErro || "(sem mensagem capturada)"}.\n` +
          `Inputs detectados: ${diag.inputs}.\n` +
          `URL: ${urlFinal}.\n` +
          `Title: ${diag.title}.` +
          blocoTotp,
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

  /**
   * Captura o secret base32 mostrado na tela CONFIGURE_TOTP do Keycloak.
   *
   * Keycloak apresenta o secret de várias formas dependendo da versão/
   * tema:
   *   • <kbd id="kc-totp-secret-key">JBSW Y3DP EHPK 3PXP</kbd>
   *   • <span id="kc-totp-secret-key-value">JBSW Y3DP...</span>
   *   • <input readonly value="JBSWY3DP..."> dentro de details/summary
   *   • Texto livre num <p> ou <div> que parece base32
   *
   * Tenta múltiplas estratégias e retorna o secret limpo (sem espaços,
   * uppercase). Retorna null se nada parecer secret base32.
   */
  private async extrairSecretTotpDaTela(page: Page): Promise<string | null> {
    // ESTRATÉGIA 0: forçar URL com mode=manual.
    // O Keycloak do PDPJ-cloud TJCE aceita ?mode=manual na URL pra mostrar
    // o secret em texto direto (sem precisar clicar link). Confirmado via
    // screenshot do usuário em 07/05/2026:
    // sso.cloud.pje.jus.br/.../required-action?...&mode=manual&execution=CONFIGURE_TOTP
    const urlAtual = page.url();
    if (urlAtual.includes("CONFIGURE_TOTP") && !urlAtual.includes("mode=manual")) {
      const sep = urlAtual.includes("?") ? "&" : "?";
      try {
        await page.goto(`${urlAtual}${sep}mode=manual`, {
          waitUntil: "domcontentloaded",
          timeout: 10_000,
        });
        await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
        await page.waitForTimeout(400);
      } catch {
        // ignora — segue tentando os selectors mesmo sem o redirect
      }
    }

    // Estratégia 1: clicar em links/botões/details que revelam o
    // secret em texto. Versões PT-BR/EN do Keycloak variam o texto.
    // Tentamos múltiplos sem `:visible` pra alcançar elementos
    // colapsados (details/summary).
    const linksRevelar = [
      "a:has-text('escanear')",
      "a:has-text('Não consegue')",
      "a:has-text('não consigo')",
      "a:has-text('Não posso')",
      "a:has-text('chave')",
      "a:has-text('texto')",
      "a:has-text('manualmente')",
      "a:has-text(\"can't scan\")",
      "a:has-text('Unable to scan')",
      "a:has-text('cannot scan')",
      "a:has-text('display key')",
      "a:has-text('Mostrar')",
      "a:has-text('Exibir')",
      "a#mode-detail-link",
      "a#mode-manual-link",
      "button:has-text('escanear')",
      "button:has-text('Não consegue')",
      "summary",
      "details summary",
      "[role='button']:has-text('escanear')",
    ];
    for (const sel of linksRevelar) {
      try {
        const els = page.locator(sel);
        const count = await els.count();
        for (let i = 0; i < Math.min(count, 3); i++) {
          const el = els.nth(i);
          if (await el.isVisible({ timeout: 200 }).catch(() => false)) {
            await el.click({ timeout: 1500 }).catch(() => {});
            await page.waitForTimeout(300);
          }
        }
      } catch {
        // ignora
      }
    }

    // Estratégia 2: selectors específicos do Keycloak — varre TODOS
    // os matches (não só primeiro) porque pode ter múltiplos kbd/code
    const seletoresSecret = [
      "kbd#kc-totp-secret-key",
      "kbd",
      "#kc-totp-secret-key",
      "#kc-totp-secret-key-value",
      "#kc-totp-secret-qr-code",
      "[id*='totp-secret']",
      "[id*='secret-key']",
      "[id*='secret-value']",
      "[class*='totp-secret']",
      "[class*='secret-key']",
      "input[readonly][type='text']",
      "input[type='text'][readonly]",
      "code",
      "pre",
      "samp",
      "[data-testid*='secret']",
      "[aria-label*='secret' i]",
    ];
    for (const sel of seletoresSecret) {
      try {
        const els = page.locator(sel);
        const count = await els.count();
        for (let i = 0; i < Math.min(count, 5); i++) {
          const el = els.nth(i);
          const txt = (
            (await el.getAttribute("value").catch(() => null)) ||
            (await el.getAttribute("data-secret").catch(() => null)) ||
            (await el.innerText().catch(() => "")) ||
            (await el.textContent().catch(() => "")) ||
            ""
          ).trim();
          const limpo = txt.replace(/\s+/g, "").toUpperCase();
          if (/^[A-Z2-7]{16,128}$/.test(limpo)) {
            return limpo;
          }
        }
      } catch {
        // ignora
      }
    }

    // Estratégia 2.5: busca POR TEXTO em elementos folha (sem children).
    // O TJCE customizou o template do Keycloak — secret aparece destacado
    // mas o elemento exato que contém é desconhecido. Filtramos elementos
    // que têm texto matching o padrão do secret (16+ chars base32 com
    // grupos de 4 separados por espaço) E não têm filhos (só folhas).
    try {
      const candidatos = await page.evaluate(() => {
        const padrao = /^(?:[A-Z2-7]{4}\s+){3,}[A-Z2-7]{2,8}$/;
        const resultados: string[] = [];
        const todosNodes = document.querySelectorAll<HTMLElement>("*");
        todosNodes.forEach((node) => {
          if (resultados.length >= 5) return;
          if (node.children.length > 0) return; // só folhas
          const txt = (node.textContent || "").trim();
          if (txt && padrao.test(txt)) {
            resultados.push(txt);
          }
        });
        return resultados;
      });
      for (const c of candidatos) {
        const limpo = c.replace(/\s+/g, "").toUpperCase();
        if (/^[A-Z2-7]{16,64}$/.test(limpo)) {
          return limpo;
        }
      }
    } catch {
      // ignora
    }

    // Estratégia 3: busca regex no HTML visível (texto e atributos)
    try {
      const html = await page.content().catch(() => "");
      // Padrão 1: "JBSW Y3DP EHPK 3PXP" com ou sem espaço, em qualquer
      // contexto (texto, value, data-*)
      const padroes = [
        /(?:[A-Z2-7]{4}\s+){3,}[A-Z2-7]{2,8}/g, // grupos de 4 separados por espaço
        /\b[A-Z2-7]{16,128}\b/g, // bloco contínuo de base32
      ];
      for (const re of padroes) {
        const matches = html.match(re);
        if (matches) {
          for (const m of matches) {
            const limpo = m.replace(/\s+/g, "").toUpperCase();
            if (/^[A-Z2-7]{16,128}$/.test(limpo)) {
              // Filtro extra: ignora cookies/JWT/UUIDs (parecem base32 mas
              // não são secret TOTP). Secrets TOTP típicos têm 16-32 chars.
              if (limpo.length >= 16 && limpo.length <= 64) {
                return limpo;
              }
            }
          }
        }
      }

      // Padrão 2: também busca em texto visível (innerText)
      const texto = await page.locator("body").innerText().catch(() => "");
      const matches2 = texto.match(/(?:[A-Z2-7]{4}\s+){3,}[A-Z2-7]{2,8}/g);
      if (matches2) {
        for (const m of matches2) {
          const limpo = m.replace(/\s+/g, "").toUpperCase();
          if (/^[A-Z2-7]{16,64}$/.test(limpo)) {
            return limpo;
          }
        }
      }
    } catch {
      // ignora
    }

    return null;
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

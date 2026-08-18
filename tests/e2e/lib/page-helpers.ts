/**
 * Listeners de saúde de página. Use `watchConsoleErrors` / `watchNetwork5xx`
 * no início de cada teste e chame `.expectNone()` antes de finalizar pra
 * falhar o teste se a UI logou erro JS ou se algum endpoint retornou 5xx.
 *
 * Importante: anexar ANTES de qualquer `page.goto` — eventos disparados
 * antes do listener são perdidos.
 */

import { expect, type Page } from "@playwright/test";
import { ehAcaoProibida, ehRotaProibida } from "../../../server/admin/jornada/lista-negra";

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
  // Como o `fetch` abortado aparece pro código do client: o wrapper de
  // tRPC loga "Failed to fetch" no console. Medido: o robô de jornada
  // acusava isso só na PRIMEIRA e na ÚLTIMA rota da varredura — as duas
  // pontas onde ele navega (ou encerra) com query em voo. Some no meio da
  // lista, onde nada é interrompido. Reproduziu igual em dev e em build
  // de produção, o que descartou o Vite.
  //
  // Queda real de servidor não passa despercebida por causa disto: ela
  // aparece como 5xx ou requestfailed não-abortado no `watchNetwork5xx`.
  "Failed to fetch",
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

/**
 * O clique do robô, com a lista negra na frente.
 *
 * O robô roda num escritório descartável, então em tese poderia clicar em
 * tudo. Não confiamos nisso por duas razões: a parede que isola o escritório
 * é a MESMA que o robô está lá pra auditar (se ela tiver furo, o clique
 * destrutivo acontece do lado errado), e nem tudo que destrói respeita
 * escritório — cancelar assinatura fala com o Asaas, gerar cobrança cria
 * fatura de verdade.
 *
 * Falhar aqui é proposital e barulhento: um passo do robô tentando clicar em
 * algo proibido é bug do passo, não acidente aceitável. Melhor a execução
 * morrer do que descobrir depois o que foi clicado.
 */
export async function clicarSeguro(page: Page, nome: string | RegExp): Promise<void> {
  const alvo = page.getByRole("button", { name: nome }).first();
  const texto = (await alvo.textContent().catch(() => null)) ?? String(nome);
  const rotulo = (await alvo.getAttribute("aria-label").catch(() => null)) ?? texto;

  if (ehAcaoProibida(rotulo) || ehAcaoProibida(String(nome))) {
    throw new Error(
      `Lista negra: o robô tentou clicar em "${rotulo}". ` +
        "Ação destrutiva, que cobra ou que manda mensagem não é clicada nem no escritório de teste.",
    );
  }

  await alvo.click();
}

/**
 * Navegação do robô, com a mesma régua.
 *
 * `/admin` é global: não tem `escritorioId` pra filtrar, então a parede
 * principal simplesmente não existe lá dentro.
 */
export async function irSeguro(page: Page, rota: string): Promise<void> {
  if (ehRotaProibida(rota)) {
    throw new Error(`Lista negra: o robô tentou abrir "${rota}", que está fora do alcance dele.`);
  }
  await page.goto(rota, { waitUntil: "domcontentloaded" });
}

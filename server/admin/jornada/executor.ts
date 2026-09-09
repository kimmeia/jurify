/**
 * O robô de jornada rodando a partir do servidor.
 *
 * O mesmo percurso existia como spec de Playwright, e por isso só rodava por
 * comando de terminal — quem opera o sistema não abre terminal, então na
 * prática nunca rodava. Aqui ele vira código de servidor comum, disparável
 * por botão no painel e por cron.
 *
 * NÃO É O `playwright test`. Usa a biblioteca direto, como o scraper do PJe
 * já faz em produção. Rodar um test runner dentro do processo do servidor
 * traria relatório, workers e ciclo de vida que não servem pra nada aqui — o
 * que se quer é abrir um navegador, andar, e devolver o que deu errado.
 *
 * SEGURANÇA. Tudo acontece num escritório criado no começo e apagado no fim.
 * A navegação passa por `ehRotaProibida` e nenhum clique destrutivo é feito.
 * A parede real continua sendo o `escritorioId` do produto; isto aqui é a
 * segunda tranca, que não depende do código auditado estar correto.
 */

import { chromium, type Browser, type Page } from "@playwright/test";
import { createLogger } from "../../_core/logger";
import { ehRotaProibida } from "./lista-negra";
import {
  MARCA_ERROR_BOUNDARY,
  PAUSA_POS_RENDER_MS,
  ROTAS_JORNADA,
  SELETOR_ESQUELETO,
  TIMEOUT_EXECUCAO_MS,
  TIMEOUT_MONTAGEM_MS,
  TIMEOUT_ROTA_MS,
  TIMEOUT_SPINNER_MS,
} from "./rotas";
import {
  seedTestEscritorio,
  teardownTestEscritorio,
  TEST_PASSWORD,
} from "./escritorio-descartavel";

const log = createLogger("robo-jornada");

export interface AchadoRota {
  rota: string;
  ok: boolean;
  ms: number;
  /** Vazio quando `ok`. Um problema por linha, na ordem em que apareceu. */
  problemas: string[];
  /**
   * Quanto cada degrau custou, guardado mesmo quando a rota passa.
   *
   * Sem isto não dá pra distinguir "a tela abriu rápido" de "a conferência
   * não conferiu nada" — as duas dão verde. Uma varredura inteira em que
   * todo mundo monta em 0ms é um resultado sobre o robô, não sobre o app.
   */
  diagnostico: DiagnosticoRota;
}

export interface DiagnosticoRota {
  /**
   * O React já estava montado quando o `domcontentloaded` voltou?
   *
   * Numa SPA com `<script type="module">` o script é *deferred* e roda antes
   * do evento, então o esperado é `true` — e aí esperar a montagem não custa
   * nada, legitimamente. `false` significa que a espera fez trabalho.
   */
  montadoNoDCL: boolean;
  msMontagem: number;
  msSpinner: number;
  /** Havia esqueleto na tela em algum momento? Nenhum spinner nunca é suspeito. */
  viuEsqueleto: boolean;
}

export interface ResultadoJornada {
  runId: string;
  baseUrl: string;
  duracaoMs: number;
  rotas: AchadoRota[];
  rotasComAchado: number;
  /** `false` = sobrou escritório de teste no banco. É o campo que se olha. */
  escritorioLimpo: boolean;
  erro?: string;
}

/**
 * Ruído que não é defeito: request cancelada pelo próprio navegador.
 *
 * Acontece o tempo todo numa SPA — componente desmonta e aborta o fetch em
 * voo, navegação corta polling. Aparece só na primeira e na última rota da
 * varredura, nunca no meio, o que confirma a origem. Queda real de servidor
 * continua coberta pelo monitor de 5xx, que não filtra nada.
 */
const RUIDO_DE_REDE = [
  "net::ERR_ABORTED",
  "net::ERR_CONNECTION_RESET",
  "net::ERR_NETWORK_CHANGED",
  "Failed to fetch",
  "AbortError",
];

function ehRuido(texto: string): boolean {
  return RUIDO_DE_REDE.some((p) => texto.includes(p));
}

/**
 * Uma execução por vez.
 *
 * São minutos de navegador aberto; duas ao mesmo tempo brigariam por CPU no
 * mesmo container que atende os usuários, e criariam dois escritórios de teste
 * cujo teardown pode se atropelar.
 */
let rodando = false;

export function jornadaEmAndamento(): boolean {
  return rodando;
}

async function abrirNavegador(): Promise<Browser> {
  return chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
}

/** Entra pela tela de login, como o usuário entra. */
async function entrar(page: Page, baseUrl: string, email: string): Promise<void> {
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded", timeout: TIMEOUT_ROTA_MS });
  await page.getByLabel(/e-?mail/i).first().fill(email);
  await page.getByLabel(/senha/i).first().fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /entrar/i }).first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: TIMEOUT_ROTA_MS });
}

const esperar = <T>(p: Promise<T>) => p.then(() => true).catch(() => false);

const VAZIO: DiagnosticoRota = {
  montadoNoDCL: false,
  msMontagem: 0,
  msSpinner: 0,
  viuEsqueleto: false,
};

/**
 * Uma tela, do jeito que um humano olharia: esperar aparecer, e só então
 * julgar.
 *
 * A ordem aqui é o produto inteiro deste arquivo, então vale dizer o porquê de
 * cada degrau. Uma rota que não abre esconde as dezoito seguintes se a
 * varredura parar, por isso nada aqui lança — tudo vira linha no relatório e a
 * caminhada continua.
 */
async function conferirRota(
  page: Page,
  baseUrl: string,
  rota: string,
): Promise<{ problemas: string[]; diagnostico: DiagnosticoRota }> {
  const problemas: string[] = [];

  const abriu = await esperar(
    page.goto(`${baseUrl}${rota}`, { waitUntil: "domcontentloaded", timeout: TIMEOUT_ROTA_MS }),
  );
  if (!abriu) {
    return { problemas: [`não carregou em ${TIMEOUT_ROTA_MS / 1000}s`], diagnostico: VAZIO };
  }

  const montadoJa = async () =>
    page
      .evaluate(() => (document.getElementById("root")?.childElementCount ?? 0) > 0)
      .catch(() => false);

  // Medido ANTES de esperar: numa SPA com script deferred o React já rodou
  // quando o evento chega, e aí a espera passa de graça — legitimamente. O que
  // não pode é não saber qual dos dois casos aconteceu.
  const montadoNoDCL = await montadoJa();

  const t1 = Date.now();
  // O app existir vem antes de qualquer julgamento sobre ele. `#root` vazio
  // depois deste tempo é tela branca — que é como uma quebra no primeiro
  // render aparece pra quem usa.
  const montou = await esperar(
    page.waitForFunction(
      () => (document.getElementById("root")?.childElementCount ?? 0) > 0,
      null,
      { timeout: TIMEOUT_MONTAGEM_MS },
    ),
  );
  const msMontagem = Date.now() - t1;
  if (!montou) {
    return {
      problemas: [`tela em branco: o app não montou em ${TIMEOUT_MONTAGEM_MS / 1000}s`],
      diagnostico: { ...VAZIO, montadoNoDCL, msMontagem },
    };
  }

  const viuEsqueleto = await page
    .evaluate((sel) => !!document.querySelector(sel), SELETOR_ESQUELETO)
    .catch(() => false);

  const t2 = Date.now();
  const saiuDoEsqueleto = await esperar(
    page.waitForFunction((sel) => !document.querySelector(sel), SELETOR_ESQUELETO, {
      timeout: TIMEOUT_SPINNER_MS,
    }),
  );
  const msSpinner = Date.now() - t2;
  if (!saiuDoEsqueleto) problemas.push(`spinner não sumiu em ${TIMEOUT_SPINNER_MS / 1000}s`);

  // A tela pode cair depois de montar — o efeito roda, e aí quebra. Sem este
  // respiro o erro chegaria durante a rota seguinte e seria contado nela.
  await page.waitForTimeout(PAUSA_POS_RENDER_MS);

  if (await page.getByText(MARCA_ERROR_BOUNDARY).first().isVisible().catch(() => false)) {
    problemas.push("ErrorBoundary engoliu uma exceção de render");
  }

  // Voltar pro login no meio da caminhada é sessão morrendo — e passaria
  // despercebido, porque a tela de login abre perfeitamente bem.
  const onde = new URL(page.url()).pathname;
  if (onde.startsWith("/login")) problemas.push("caiu pro login: a sessão não sobreviveu");

  return { problemas, diagnostico: { montadoNoDCL, msMontagem, msSpinner, viuEsqueleto } };
}

export async function rodarJornada(baseUrl: string): Promise<ResultadoJornada> {
  if (rodando) throw new Error("Já existe uma varredura de jornada em andamento.");
  rodando = true;

  const inicio = Date.now();
  const rotas: AchadoRota[] = [];
  let browser: Browser | null = null;
  let runId = "";
  let escritorioLimpo = false;
  let erro: string | undefined;

  try {
    const escritorio = await seedTestEscritorio();
    runId = escritorio.runId;

    browser = await abrirNavegador();
    const context = await browser.newContext({ locale: "pt-BR", viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    // Anexar ANTES do primeiro goto: evento disparado antes do listener é
    // perdido, e a primeira tela é onde erro de bootstrap aparece.
    const errosConsole: string[] = [];
    page.on("pageerror", (e) => errosConsole.push(`JS: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error" && !ehRuido(m.text())) errosConsole.push(`console: ${m.text()}`);
    });
    const falhas5xx: string[] = [];
    page.on("response", (r) => {
      if (r.status() >= 500) falhas5xx.push(`${r.status()} ${r.url()}`);
    });

    await entrar(page, baseUrl, escritorio.users.dono.email);

    for (const rota of ROTAS_JORNADA) {
      // Cinto além do suspensório: a lista de rotas já é fixa, mas rota
      // proibida entrando por descuido não daria erro — daria acesso.
      if (ehRotaProibida(rota)) continue;

      const t0 = Date.now();
      const errosAntes = errosConsole.length;
      const falhasAntes = falhas5xx.length;

      const { problemas, diagnostico } = await conferirRota(page, baseUrl, rota);

      problemas.push(...errosConsole.slice(errosAntes));
      problemas.push(...falhas5xx.slice(falhasAntes));

      rotas.push({ rota, ok: problemas.length === 0, ms: Date.now() - t0, problemas, diagnostico });
    }

    await context.close();
  } catch (err) {
    erro = err instanceof Error ? err.message : String(err);
    log.error({ err: erro, runId }, "varredura de jornada falhou");
  } finally {
    await browser?.close().catch(() => {});

    // O teardown roda mesmo com a execução quebrada no meio — é exatamente o
    // caso em que ninguém está olhando, e escritório de teste sobrando no
    // banco de produção é o risco que este robô não pode criar.
    if (runId) {
      escritorioLimpo = await teardownTestEscritorio(runId)
        .then(() => true)
        .catch((e) => {
          log.error({ err: String(e), runId }, "teardown do escritório de teste falhou");
          return false;
        });
    }
    rodando = false;
  }

  return {
    runId,
    baseUrl,
    duracaoMs: Date.now() - inicio,
    rotas,
    rotasComAchado: rotas.filter((r) => !r.ok).length,
    escritorioLimpo,
    erro,
  };
}

/**
 * Mata a execução se ela passar do teto.
 *
 * Navegador travado seguraria a trava `rodando` pra sempre, e o botão do
 * painel ficaria morto até o próximo deploy.
 */
export async function rodarJornadaComTeto(baseUrl: string): Promise<ResultadoJornada> {
  let estourou: NodeJS.Timeout | undefined;
  const teto = new Promise<never>((_, reject) => {
    estourou = setTimeout(
      () => reject(new Error(`Varredura passou de ${TIMEOUT_EXECUCAO_MS / 60_000} min e foi interrompida.`)),
      TIMEOUT_EXECUCAO_MS,
    );
  });
  try {
    return await Promise.race([rodarJornada(baseUrl), teto]);
  } finally {
    if (estourou) clearTimeout(estourou);
  }
}

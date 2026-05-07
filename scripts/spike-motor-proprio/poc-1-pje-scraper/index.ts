/**
 * PoC 1 — Scraper PJe (Consulta Pública)
 *
 * Orquestrador que roda os adapters de tribunais contra CNJs reais e
 * gera relatório de viabilidade técnica.
 *
 * Saída:
 *  - Console: progresso em tempo real (ok/falha por CNJ)
 *  - samples/poc-1-{ts}.json: dump completo das raspagens
 *  - samples/poc-1-{ts}-stats.json: estatísticas agregadas
 *
 * Uso:
 *   pnpm tsx scripts/spike-motor-proprio/poc-1-pje-scraper/index.ts
 *
 *   # com CNJs específicos via env var
 *   SPIKE_CNJS_TRT2='1000123-45.2024.5.02.0001,1000999-88.2024.5.02.0002' \
 *     pnpm tsx scripts/spike-motor-proprio/poc-1-pje-scraper/index.ts
 *
 *   # apenas um tribunal
 *   SPIKE_TRIBUNAIS=trt2 \
 *     pnpm tsx scripts/spike-motor-proprio/poc-1-pje-scraper/index.ts
 *
 * Não roda em CI — Playwright + tribunais reais. Rodar manualmente em
 * staging Railway ou local com VPN/proxy se necessário.
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { closeBrowser, percentil } from "../lib/playwright-helpers";
import { sleep } from "../lib/parser-utils";
import {
  captureSpikeError,
  flushSpikeSentry,
  initSpikeSentry,
} from "../lib/sentry-spike";
import { CNJS_PUBLICOS, TRIBUNAIS_DO_POC_1, type CnjTeste } from "../lib/cnjs-publicos";
import type {
  CategoriaErro,
  EstatisticasPoc,
  ResultadoScraper,
} from "../lib/types-spike";
import type { ScraperTribunalAdapter } from "./adapters/base";
import { TRT2Scraper } from "./adapters/trt2";
import { TRT15Scraper } from "./adapters/trt15";
import { TJDFTScraper, TJMGScraper, TRF1Scraper } from "./adapters/placeholders";

const SAMPLES_DIR = path.resolve(process.cwd(), "scripts/spike-motor-proprio/samples");

const ADAPTERS: Record<string, () => ScraperTribunalAdapter> = {
  trt2: () => new TRT2Scraper(),
  trt15: () => new TRT15Scraper(),
  tjdft: () => new TJDFTScraper(),
  tjmg: () => new TJMGScraper(),
  trf1: () => new TRF1Scraper(),
};

/**
 * Pausa entre consultas no mesmo tribunal — comportamento educado pra
 * não disparar rate limit. 1.5s é suficiente pra tribunais brasileiros
 * sem ser lento demais.
 */
const DELAY_ENTRE_CONSULTAS_MS = 1500;

interface ResultadoTribunal {
  tribunal: string;
  nome: string;
  resultados: ResultadoScraper[];
  estatisticas: EstatisticasPoc;
}

async function rodarTribunal(
  tribunalKey: keyof typeof CNJS_PUBLICOS,
  cnjs: CnjTeste[],
): Promise<ResultadoTribunal | null> {
  const factory = ADAPTERS[tribunalKey];
  if (!factory) {
    console.warn(`[poc-1] adapter não cadastrado: ${tribunalKey}`);
    return null;
  }

  const adapter = factory();

  if (cnjs.length === 0) {
    console.warn(
      `[poc-1] tribunal=${adapter.tribunal} sem CNJs cadastrados — pule via env SPIKE_CNJS_${tribunalKey.toUpperCase()}`,
    );
    return {
      tribunal: adapter.tribunal,
      nome: adapter.nome,
      resultados: [],
      estatisticas: estatisticasVazias(adapter.tribunal),
    };
  }

  console.log(
    `\n[poc-1] === ${adapter.nome} (${adapter.tribunal}) ===` +
      `\n[poc-1] ${cnjs.length} CNJs alvo`,
  );

  const resultados: ResultadoScraper[] = [];

  for (let i = 0; i < cnjs.length; i++) {
    const { cnj, descricao } = cnjs[i];
    console.log(`[poc-1] (${i + 1}/${cnjs.length}) ${cnj} — ${descricao}`);

    const inicio = Date.now();
    let resultado: ResultadoScraper;
    try {
      resultado = await adapter.consultarPorCnj(cnj);
    } catch (err) {
      // Adapters bem-comportados não lançam, mas qualquer escapada é
      // capturada aqui pra não interromper o batch.
      captureSpikeError(err, { tribunal: adapter.tribunal, cnj });
      resultado = {
        ok: false,
        tribunal: adapter.tribunal,
        cnj,
        latenciaMs: Date.now() - inicio,
        capa: null,
        movimentacoes: [],
        categoriaErro: "outro",
        mensagemErro: err instanceof Error ? err.message : String(err),
        screenshotPath: null,
        finalizadoEm: new Date().toISOString(),
      };
    }

    if (resultado.ok) {
      console.log(
        `[poc-1] ✓ ok em ${resultado.latenciaMs}ms — ${resultado.movimentacoes.length} movimentações, ${resultado.capa?.partes.length ?? 0} partes`,
      );
    } else {
      console.log(
        `[poc-1] ✗ falha em ${resultado.latenciaMs}ms — categoria=${resultado.categoriaErro}, msg=${resultado.mensagemErro?.slice(0, 100)}`,
      );
    }
    resultados.push(resultado);

    if (i < cnjs.length - 1) {
      await sleep(DELAY_ENTRE_CONSULTAS_MS);
    }
  }

  const estatisticas = computarEstatisticas(adapter.tribunal, resultados);
  return { tribunal: adapter.tribunal, nome: adapter.nome, resultados, estatisticas };
}

function estatisticasVazias(tribunal: string): EstatisticasPoc {
  return {
    tribunal,
    totalTentativas: 0,
    totalSucessos: 0,
    totalFalhas: 0,
    taxaSucessoPct: 0,
    latenciaMediaMs: 0,
    latenciaP50Ms: 0,
    latenciaP95Ms: 0,
    errosPorCategoria: {
      cnj_nao_encontrado: 0,
      captcha_bloqueio: 0,
      timeout: 0,
      parse_falhou: 0,
      tribunal_indisponivel: 0,
      outro: 0,
    },
  };
}

function computarEstatisticas(
  tribunal: string,
  resultados: ResultadoScraper[],
): EstatisticasPoc {
  const total = resultados.length;
  const sucessos = resultados.filter((r) => r.ok).length;
  const falhas = total - sucessos;
  const latencias = resultados.map((r) => r.latenciaMs);

  const errosPorCategoria: Record<CategoriaErro, number> = {
    cnj_nao_encontrado: 0,
    captcha_bloqueio: 0,
    timeout: 0,
    parse_falhou: 0,
    tribunal_indisponivel: 0,
    outro: 0,
  };

  for (const r of resultados) {
    if (!r.ok && r.categoriaErro) {
      errosPorCategoria[r.categoriaErro]++;
    }
  }

  return {
    tribunal,
    totalTentativas: total,
    totalSucessos: sucessos,
    totalFalhas: falhas,
    taxaSucessoPct: total > 0 ? Math.round((sucessos / total) * 1000) / 10 : 0,
    latenciaMediaMs:
      total > 0 ? Math.round(latencias.reduce((a, b) => a + b, 0) / total) : 0,
    latenciaP50Ms: percentil(latencias, 50),
    latenciaP95Ms: percentil(latencias, 95),
    errosPorCategoria,
  };
}

function imprimirResumo(resultadosPorTribunal: ResultadoTribunal[]): void {
  console.log("\n[poc-1] ═══════════════════════════════════════════════════════");
  console.log("[poc-1] RESUMO");
  console.log("[poc-1] ═══════════════════════════════════════════════════════");

  for (const tr of resultadosPorTribunal) {
    const e = tr.estatisticas;
    const veredito = vereditoPorTaxa(e.taxaSucessoPct, e.totalTentativas);
    console.log(
      `[poc-1] ${veredito} ${tr.tribunal.toUpperCase().padEnd(6)} ` +
        `${e.totalSucessos}/${e.totalTentativas} ok (${e.taxaSucessoPct}%) — ` +
        `lat médio ${e.latenciaMediaMs}ms, p95 ${e.latenciaP95Ms}ms`,
    );

    const errosNaoZero = Object.entries(e.errosPorCategoria).filter(([, v]) => v > 0);
    if (errosNaoZero.length > 0) {
      const errosStr = errosNaoZero.map(([k, v]) => `${k}=${v}`).join(", ");
      console.log(`[poc-1]        erros: ${errosStr}`);
    }
  }
  console.log("[poc-1] ═══════════════════════════════════════════════════════\n");
}

/**
 * Veredito visual rápido baseado na taxa de sucesso.
 *  ≥95% = verde, 70-94% = amarelo, <70% ou zero tentativas = vermelho
 */
function vereditoPorTaxa(taxa: number, tentativas: number): string {
  if (tentativas === 0) return "[—]";
  if (taxa >= 95) return "[OK]";
  if (taxa >= 70) return "[!!]";
  return "[XX]";
}

function salvarSamples(
  resultadosPorTribunal: ResultadoTribunal[],
): { jsonPath: string; statsPath: string } {
  if (!fs.existsSync(SAMPLES_DIR)) {
    fs.mkdirSync(SAMPLES_DIR, { recursive: true });
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(SAMPLES_DIR, `poc-1-${ts}.json`);
  const statsPath = path.join(SAMPLES_DIR, `poc-1-${ts}-stats.json`);

  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        executadoEm: new Date().toISOString(),
        ambiente: process.env.JURIFY_AMBIENTE || process.env.NODE_ENV || "local",
        gitCommit: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT || null,
        tribunais: resultadosPorTribunal,
      },
      null,
      2,
    ),
  );

  fs.writeFileSync(
    statsPath,
    JSON.stringify(
      resultadosPorTribunal.map((tr) => tr.estatisticas),
      null,
      2,
    ),
  );

  return { jsonPath, statsPath };
}

async function main(): Promise<void> {
  initSpikeSentry({ pocId: 1, workerName: "spike-pje-scraper" });

  console.log("[poc-1] Iniciando PoC 1 — Scraper PJe");
  console.log(`[poc-1] Ambiente: ${process.env.JURIFY_AMBIENTE || process.env.NODE_ENV || "local"}`);

  const tribunaisFiltro = process.env.SPIKE_TRIBUNAIS
    ?.split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean) as Array<keyof typeof CNJS_PUBLICOS> | undefined;

  const tribunaisAlvo = tribunaisFiltro ?? TRIBUNAIS_DO_POC_1;

  const resultadosPorTribunal: ResultadoTribunal[] = [];

  for (const tribunalKey of tribunaisAlvo) {
    const cnjs = CNJS_PUBLICOS[tribunalKey];
    const resultado = await rodarTribunal(tribunalKey, cnjs);
    if (resultado) resultadosPorTribunal.push(resultado);
  }

  imprimirResumo(resultadosPorTribunal);
  const { jsonPath, statsPath } = salvarSamples(resultadosPorTribunal);
  console.log(`[poc-1] Sample salvo: ${jsonPath}`);
  console.log(`[poc-1] Stats salvas: ${statsPath}`);

  await closeBrowser();
  await flushSpikeSentry();
}

main().catch(async (err) => {
  console.error("[poc-1] FALHA FATAL:", err);
  captureSpikeError(err, { etapa: "main" });
  await closeBrowser().catch(() => {});
  await flushSpikeSentry().catch(() => {});
  process.exit(1);
});

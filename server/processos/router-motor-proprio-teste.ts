/**
 * Router admin — Motor Próprio (Spike — endpoint de teste).
 *
 * Endpoint exposto na UI `/admin/motor-proprio-teste` para validar os
 * adapters PJe (TRT-2, TRT-15) contra CNJs reais sem precisar rodar
 * scripts CLI. Útil pra demo + iteração rápida durante o Spike.
 *
 * SEGURANÇA / GATES:
 *  1. `adminProcedure` — só admin do Jurify, nunca usuário comum
 *  2. `JURIFY_AMBIENTE === "staging"` — bloqueia em produção
 *     (mesmo que caia merge inadvertido pra main)
 *  3. Rate limit aplicado pelo middleware global tRPC
 *
 * NOTA SOBRE LAZY IMPORTS:
 * Os adapters (`TRT2Scraper`, `TRT15Scraper`) e o `playwright-helpers`
 * dependem de `@playwright/test` que vive em devDependencies. Se
 * importássemos estaticamente aqui, o esbuild iria deixar o pacote
 * external no bundle do server, e em production (sem devDeps instaladas)
 * o `node dist/index.js` crasha no startup com `Cannot find module
 * '@playwright/test'`.
 *
 * Solução: lazy `await import()` dentro das mutations. Em production,
 * `exigirAmbienteTeste()` lança FORBIDDEN antes do import, então o
 * pacote nunca é resolvido. Em staging, o postinstall já instalou
 * Playwright via `JURIFY_AMBIENTE=staging`.
 *
 * Quando o Spike completar e virar Sprint 1 oficial, este router vai
 * ser substituído por `processosRouter.consultarPorCnj()` chamando
 * worker dedicado. Por ora chama o adapter direto na request — síncrono,
 * não escala, mas serve pra validação manual.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import { validarCnj } from "../../scripts/spike-motor-proprio/lib/parser-utils";
import { createLogger } from "../_core/logger";

const log = createLogger("motor-proprio-teste");

let sentryInicializado = false;
async function garantirSentry() {
  if (sentryInicializado) return;
  const { initSpikeSentry } = await import(
    "../../scripts/spike-motor-proprio/lib/sentry-spike"
  );
  initSpikeSentry({ pocId: 1, workerName: "spike-pje-scraper-trpc" });
  sentryInicializado = true;
}

/**
 * Tribunais disponíveis pra teste — mantém em sync com adapters
 * implementados em `scripts/spike-motor-proprio/poc-1-pje-scraper/adapters/`.
 *
 * Metadata estática (nome legível) fica aqui pra que `tribunaisDisponiveis`
 * possa retornar dropdown sem instanciar adapter (que carregaria
 * Playwright). Quando adicionar TJDFT/TJMG/TRF1 no Dia 3, registrar
 * aqui também.
 */
const TRIBUNAIS_DISPONIVEIS = ["trt2", "trt7", "trt15"] as const;
type TribunalDisponivel = (typeof TRIBUNAIS_DISPONIVEIS)[number];

const TRIBUNAIS_METADATA: Record<TribunalDisponivel, { nome: string }> = {
  trt2: { nome: "Tribunal Regional do Trabalho — 2ª Região (SP)" },
  trt7: { nome: "Tribunal Regional do Trabalho — 7ª Região (Ceará)" },
  trt15: { nome: "Tribunal Regional do Trabalho — 15ª Região (Campinas)" },
};

/**
 * Cria o adapter via lazy import. Só executa quando endpoint é chamado
 * de fato (após o gate de ambiente bloquear production).
 */
async function criarAdapterLazy(tribunal: TribunalDisponivel) {
  if (tribunal === "trt2") {
    const mod = await import(
      "../../scripts/spike-motor-proprio/poc-1-pje-scraper/adapters/trt2"
    );
    return new mod.TRT2Scraper();
  }
  if (tribunal === "trt7") {
    const mod = await import(
      "../../scripts/spike-motor-proprio/poc-1-pje-scraper/adapters/trt7"
    );
    return new mod.TRT7Scraper();
  }
  if (tribunal === "trt15") {
    const mod = await import(
      "../../scripts/spike-motor-proprio/poc-1-pje-scraper/adapters/trt15"
    );
    return new mod.TRT15Scraper();
  }
  // exhaustive check — TS força incluir todos os cases
  throw new Error(`Tribunal não implementado: ${tribunal satisfies never}`);
}

/**
 * Confirma que estamos em ambiente de teste antes de invocar Playwright.
 * Em production, retorna FORBIDDEN — proteção em camadas com a feature
 * flag `escritorios.usarMotorProprio` que ainda não existe per-user
 * neste endpoint.
 */
function exigirAmbienteTeste() {
  const ambiente = process.env.JURIFY_AMBIENTE;
  if (ambiente !== "staging" && process.env.NODE_ENV !== "development") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Endpoint de teste do motor próprio só disponível em ambiente staging. " +
        "Para production, use o router processos oficial (Sprint 1+).",
    });
  }
}

export const motorProprioTesteRouter = router({
  /**
   * Lista de tribunais com adapter implementado (pra dropdown da UI).
   * Retorna metadata estática — não instancia adapter (que carregaria
   * Playwright à toa).
   */
  tribunaisDisponiveis: adminProcedure.query(() => {
    return TRIBUNAIS_DISPONIVEIS.map((t) => ({
      codigo: t,
      nome: TRIBUNAIS_METADATA[t].nome,
    }));
  }),

  /**
   * Indica se o ambiente atual permite chamar `testarCnj`.
   * Frontend usa pra desabilitar o botão e mostrar aviso em production.
   */
  ambienteSuportaTeste: adminProcedure.query(() => {
    const ambiente = process.env.JURIFY_AMBIENTE || process.env.NODE_ENV || "unknown";
    return {
      ambiente,
      suportaTeste: ambiente === "staging" || ambiente === "development",
    };
  }),

  /**
   * Consulta um CNJ no tribunal selecionado e retorna o ResultadoScraper
   * estruturado. Chamado pelo botão "Consultar" na UI de teste.
   *
   * Latência típica: 5-15s (Playwright headless + navegação + extração).
   * Browser é mantido vivo entre chamadas (pool de `getBrowser()`).
   *
   * NUNCA lança — adapter retorna `ResultadoScraper { ok: false, ... }`
   * em qualquer falha. Frontend exibe a categoria do erro pro admin.
   */
  testarCnj: adminProcedure
    .input(
      z.object({
        cnj: z
          .string()
          .min(20, "CNJ precisa ter ao menos 20 caracteres")
          .max(32, "CNJ não pode passar de 32 caracteres")
          .refine((v) => validarCnj(v), {
            message: "CNJ inválido (módulo 97 não bate)",
          }),
        tribunal: z.enum(TRIBUNAIS_DISPONIVEIS),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      exigirAmbienteTeste();
      await garantirSentry();

      log.info(
        { admin: ctx.user.id, tribunal: input.tribunal, cnj: input.cnj },
        "[motor-proprio-teste] consulta iniciada",
      );

      const adapter = await criarAdapterLazy(input.tribunal);
      const resultado = await adapter.consultarPorCnj(input.cnj);

      log.info(
        {
          admin: ctx.user.id,
          tribunal: input.tribunal,
          ok: resultado.ok,
          latenciaMs: resultado.latenciaMs,
          movimentacoes: resultado.movimentacoes.length,
          categoriaErro: resultado.categoriaErro,
        },
        "[motor-proprio-teste] consulta finalizada",
      );

      return resultado;
    }),

  /**
   * Libera o browser pool — útil se admin quiser forçar novo login/contexto
   * limpo (ex: depois de mudar versão do Chromium em deploy).
   */
  fecharBrowser: adminProcedure.mutation(async () => {
    exigirAmbienteTeste();
    const { closeBrowser } = await import(
      "../../scripts/spike-motor-proprio/lib/playwright-helpers"
    );
    await closeBrowser();
    return { ok: true };
  }),
});

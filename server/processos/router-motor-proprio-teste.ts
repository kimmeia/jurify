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
 * Quando o Spike completar e virar Sprint 1 oficial, este router vai
 * ser substituído por `processosRouter.consultarPorCnj()` chamando
 * worker dedicado. Por ora chama o adapter direto na request — síncrono,
 * não escala, mas serve pra validação manual.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import { TRT2Scraper } from "../../scripts/spike-motor-proprio/poc-1-pje-scraper/adapters/trt2";
import { TRT15Scraper } from "../../scripts/spike-motor-proprio/poc-1-pje-scraper/adapters/trt15";
import {
  closeBrowser,
} from "../../scripts/spike-motor-proprio/lib/playwright-helpers";
import {
  initSpikeSentry,
} from "../../scripts/spike-motor-proprio/lib/sentry-spike";
import type { ScraperTribunalAdapter } from "../../scripts/spike-motor-proprio/poc-1-pje-scraper/adapters/base";
import { validarCnj } from "../../scripts/spike-motor-proprio/lib/parser-utils";
import { createLogger } from "../_core/logger";

const log = createLogger("motor-proprio-teste");

/**
 * Inicialização lazy do Sentry do Spike — só registra na primeira chamada.
 * Evita bagunçar startup do servidor com tags de Spike caso a feature
 * nunca seja usada.
 */
let sentryInicializado = false;
function garantirSentry() {
  if (sentryInicializado) return;
  initSpikeSentry({ pocId: 1, workerName: "spike-pje-scraper-trpc" });
  sentryInicializado = true;
}

/**
 * Tribunais disponíveis pra teste — mantém em sync com adapters
 * implementados em `scripts/spike-motor-proprio/poc-1-pje-scraper/adapters/`.
 */
const TRIBUNAIS_DISPONIVEIS = ["trt2", "trt15"] as const;
type TribunalDisponivel = (typeof TRIBUNAIS_DISPONIVEIS)[number];

function criarAdapter(tribunal: TribunalDisponivel): ScraperTribunalAdapter {
  switch (tribunal) {
    case "trt2":
      return new TRT2Scraper();
    case "trt15":
      return new TRT15Scraper();
    default:
      // exhaustive check — TS força incluir todos os cases
      throw new Error(`Tribunal não implementado: ${tribunal satisfies never}`);
  }
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
   * Não exige ambiente de teste — apenas lista metadados.
   */
  tribunaisDisponiveis: adminProcedure.query(() => {
    return TRIBUNAIS_DISPONIVEIS.map((t) => {
      const adapter = criarAdapter(t);
      return { codigo: t, nome: adapter.nome };
    });
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
      garantirSentry();

      log.info(
        { admin: ctx.user.id, tribunal: input.tribunal, cnj: input.cnj },
        "[motor-proprio-teste] consulta iniciada",
      );

      const adapter = criarAdapter(input.tribunal);
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
    await closeBrowser();
    return { ok: true };
  }),
});

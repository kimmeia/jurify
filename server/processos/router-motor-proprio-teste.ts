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
import {
  resolverAmbiente,
  ambienteSuportaTeste as ambientePermiteTeste,
} from "../_core/ambiente";
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
const TRIBUNAIS_DISPONIVEIS = ["trt2", "trt7", "trt15", "tjce"] as const;
type TribunalDisponivel = (typeof TRIBUNAIS_DISPONIVEIS)[number];

interface TribunalMeta {
  nome: string;
  /** Indica que esse tribunal exige credencial cadastrada no cofre */
  exigeCredencial: boolean;
  /** Sistema do cofre que casa com este tribunal (quando exigeCredencial) */
  sistemaCofre?: "esaj_tjce" | "esaj_tjsp" | "esaj_*";
}

const TRIBUNAIS_METADATA: Record<TribunalDisponivel, TribunalMeta> = {
  trt2: { nome: "Tribunal Regional do Trabalho — 2ª Região (SP)", exigeCredencial: false },
  trt7: { nome: "Tribunal Regional do Trabalho — 7ª Região (Ceará)", exigeCredencial: false },
  trt15: { nome: "Tribunal Regional do Trabalho — 15ª Região (Campinas)", exigeCredencial: false },
  tjce: {
    nome: "Tribunal de Justiça do Ceará — E-SAJ",
    exigeCredencial: true,
    sistemaCofre: "esaj_tjce",
  },
};

/**
 * Cria o adapter via lazy import. Só executa quando endpoint é chamado
 * de fato (após o gate de ambiente bloquear production).
 *
 * Para tribunais que exigem credencial (ex: TJCE), o caller passa o
 * `credencialId` resolvido. O helper busca + decripta credencial e
 * retorna adapter pronto pra usar.
 */
async function criarAdapterLazy(
  tribunal: TribunalDisponivel,
  credencialId?: number,
) {
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
  if (tribunal === "tjce") {
    if (!credencialId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "TJCE exige credencial cadastrada — selecione uma credencial ativa do cofre antes de consultar.",
      });
    }
    const { buscarCredencialDecriptada, recuperarSessao } = await import(
      "../escritorio/cofre-helpers"
    );
    const cred = await buscarCredencialDecriptada(credencialId);
    if (!cred) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Credencial não encontrada no cofre",
      });
    }
    if (cred.sistema !== "esaj_tjce" && cred.sistema !== "esaj_*") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Credencial é do sistema "${cred.sistema}", não compatível com TJCE`,
      });
    }
    const mod = await import(
      "../../scripts/spike-motor-proprio/poc-2-esaj-login/adapters/tjce"
    );
    const scraper = new mod.EsajTjceScraper({
      username: cred.username,
      password: cred.password,
      totpSecret: cred.totpSecret,
    });
    // Adapta a interface do EsajTjceScraper pra ScraperTribunalAdapter:
    // primeiro recupera sessão (ou loga se não tem), depois consulta.
    return {
      tribunal: "tjce",
      nome: TRIBUNAIS_METADATA.tjce.nome,
      consultarPorCnj: async (cnj: string) => {
        let storageState = await recuperarSessao(credencialId);
        if (!storageState) {
          // Sem sessão válida — loga primeiro
          const login = await scraper.testarLogin();
          if (!login.ok || !login.storageStateJson) {
            return {
              ok: false,
              tribunal: "tjce",
              cnj,
              latenciaMs: login.latenciaMs,
              capa: null,
              movimentacoes: [],
              categoriaErro: "outro" as const,
              mensagemErro: `Login falhou antes da consulta: ${login.mensagem}`,
              screenshotPath: login.screenshotPath,
              finalizadoEm: new Date().toISOString(),
            };
          }
          storageState = login.storageStateJson;
          const { salvarSessao } = await import("../escritorio/cofre-helpers");
          await salvarSessao(
            credencialId,
            storageState,
            new Date(Date.now() + 90 * 60 * 1000),
          );
        }
        return scraper.consultarPorCnj(cnj, storageState);
      },
    };
  }
  // exhaustive check — TS força incluir todos os cases
  throw new Error(`Tribunal não implementado: ${tribunal satisfies never}`);
}

/**
 * Confirma que estamos em ambiente de teste antes de invocar Playwright.
 * Em production, retorna FORBIDDEN — proteção em camadas com a feature
 * flag `escritorios.usarMotorProprio` que ainda não existe per-user
 * neste endpoint.
 *
 * Resolução de ambiente centralizada em `_core/ambiente.ts` — usa
 * RAILWAY_ENVIRONMENT_NAME como fallback pra evitar bug de env var
 * não-configurada acidentalmente no dashboard do Railway.
 */
function exigirAmbienteTeste() {
  if (!ambientePermiteTeste()) {
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
   * Playwright à toa). Inclui flag `exigeCredencial` pra UI mostrar
   * seletor de credencial quando necessário.
   */
  tribunaisDisponiveis: adminProcedure.query(() => {
    return TRIBUNAIS_DISPONIVEIS.map((t) => ({
      codigo: t,
      nome: TRIBUNAIS_METADATA[t].nome,
      exigeCredencial: TRIBUNAIS_METADATA[t].exigeCredencial,
      sistemaCofre: TRIBUNAIS_METADATA[t].sistemaCofre,
    }));
  }),

  /**
   * Indica se o ambiente atual permite chamar `testarCnj`.
   * Frontend usa pra desabilitar o botão e mostrar aviso em production.
   *
   * Reusa a resolução centralizada de `_core/ambiente.ts` — assim a
   * UI exibe o MESMO valor que o gate do backend usa pra autorizar.
   */
  ambienteSuportaTeste: adminProcedure.query(() => {
    return {
      ambiente: resolverAmbiente(),
      suportaTeste: ambientePermiteTeste(),
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
        /** Obrigatório quando tribunal exige credencial (ex: TJCE) */
        credencialId: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      exigirAmbienteTeste();
      await garantirSentry();

      log.info(
        {
          admin: ctx.user.id,
          tribunal: input.tribunal,
          cnj: input.cnj,
          credencialId: input.credencialId ?? null,
        },
        "[motor-proprio-teste] consulta iniciada",
      );

      const adapter = await criarAdapterLazy(input.tribunal, input.credencialId);
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

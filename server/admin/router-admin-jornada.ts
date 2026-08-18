/**
 * Router admin — robô de jornada.
 *
 * Expõe o catálogo, o histórico e o disparo sob demanda. O robô já existia
 * como spec de Playwright e por isso só rodava por comando de terminal — quem
 * opera o sistema não abre terminal, então na prática nunca rodava.
 *
 * `rodar` NÃO espera o fim. A varredura leva minutos e uma mutation segurando
 * a conexão todo esse tempo estouraria em qualquer proxy no caminho. Ela abre
 * a linha do histórico, devolve o runId e segue em background; o painel
 * acompanha pelo histórico.
 *
 * Como o auditor, aqui não existe caminho de correção. O robô relata.
 */

import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { createLogger } from "../_core/logger";
import { CONFERENCIAS } from "./jornada/conferencias";
import { ROTAS_JORNADA } from "./jornada/rotas";
import { ACOES_PROIBIDAS, ROTAS_PROIBIDAS } from "./jornada/lista-negra";
import { jornadaEmAndamento, rodarJornadaComTeto } from "./jornada/executor";
import { abrirVarredura, fecharVarredura, listarVarreduras, marcarFalha } from "./jornada/historico";

const log = createLogger("robo-jornada");

/**
 * Onde o robô entra. `JORNADA_BASE_URL` permite apontar pra staging sem mexer
 * no resto — que é a recomendação: contra staging não existe nem a escrita
 * temporária do escritório descartável no banco de produção.
 */
function baseUrlPadrao(): string {
  return (
    process.env.JORNADA_BASE_URL ||
    process.env.APP_URL ||
    process.env.VITE_APP_URL ||
    "http://localhost:3000"
  ).replace(/\/+$/, "");
}

function novoRunId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export const adminJornadaRouter = router({
  /** O que o robô percorre e o que ele nunca toca — pro painel poder mostrar. */
  catalogo: adminProcedure.query(() => ({
    rotas: ROTAS_JORNADA,
    conferencias: CONFERENCIAS,
    // A lista negra vira texto: RegExp não atravessa a serialização, e o que
    // o painel precisa é mostrar QUE existe uma trava, com o tamanho dela.
    acoesProibidas: ACOES_PROIBIDAS.map((r) => r.source),
    rotasProibidas: ROTAS_PROIBIDAS,
    baseUrl: baseUrlPadrao(),
    emAndamento: jornadaEmAndamento(),
  })),

  historico: adminProcedure
    .input(z.object({ limite: z.number().int().min(1).max(50).optional() }).optional())
    .query(async ({ input }) => ({
      varreduras: await listarVarreduras(input?.limite ?? 10),
      emAndamento: jornadaEmAndamento(),
    })),

  rodar: adminProcedure.mutation(async () => {
    if (jornadaEmAndamento()) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Já existe uma varredura em andamento. Espere ela terminar.",
      });
    }

    const baseUrl = baseUrlPadrao();
    const runId = novoRunId();
    await abrirVarredura(runId, baseUrl, "manual");

    // Sem `await`: a resposta volta agora com o runId, e o painel acompanha
    // pelo histórico. Segurar a conexão por minutos estouraria no proxy.
    void rodarJornadaComTeto(baseUrl)
      .then((r) => fecharVarredura(runId, { ...r, runId }))
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ err: msg, runId }, "varredura de jornada não completou");
        return marcarFalha(runId, msg);
      });

    return { runId, baseUrl };
  }),
});

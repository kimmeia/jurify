/**
 * Router admin — Robô auditor.
 *
 * Expõe o catálogo de invariantes, o histórico de varreduras e o disparo
 * sob demanda.
 *
 * Fase 1: shadow mode. Não existe procedure de correção neste router, e
 * isso é proposital — enquanto as regras não tiverem histórico provando
 * que não geram falso positivo, o robô só relata. A ausência de um
 * `corrigir` aqui é a garantia, não a UI escondendo o botão.
 */

import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { listarRegras, varrer, LIMITE_LINHAS_PADRAO } from "./auditoria/executor";
import { listarUltimasVarreduras, salvarVarredura } from "./auditoria/historico";

export const adminRoboAuditorRouter = router({
  /** Catálogo de invariantes vigiando o banco. */
  listarRegras: adminProcedure.query(() => ({
    regras: listarRegras(),
    limiteLinhasPadrao: LIMITE_LINHAS_PADRAO,
  })),

  /**
   * Últimas varreduras gravadas — inclusive as do cron. É o que permite
   * responder "quando o robô olhou pela última vez?" sem depender do
   * Sentry estar configurado.
   */
  historico: adminProcedure
    .input(z.object({ limite: z.number().int().min(1).max(50).optional() }).optional())
    .query(async ({ input }) => ({
      varreduras: await listarUltimasVarreduras(input?.limite ?? 10),
    })),

  /**
   * Roda a varredura. Mutation porque é ação (N queries no banco de
   * produção), não leitura cacheável — mesmo sendo read-only.
   */
  varrer: adminProcedure
    .input(
      z
        .object({
          ids: z.array(z.string().max(20)).max(50).optional(),
          limiteLinhas: z.number().int().min(1).max(500).optional(),
        })
        .optional(),
    )
    .mutation(async ({ input }) => {
      const resultado = await varrer({ ids: input?.ids, limiteLinhas: input?.limiteLinhas });
      // Varredura parcial (com `ids`) não entra no histórico: ela não
      // descreve o estado do banco, e registrada viraria uma "última
      // varredura" enganosa com 1 regra executada.
      if (!input?.ids?.length) await salvarVarredura(resultado, "manual");
      return resultado;
    }),
});

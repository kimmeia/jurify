/**
 * Router admin — Robô auditor.
 *
 * Expõe o catálogo de invariantes e dispara a varredura sob demanda.
 *
 * Fase 1: shadow mode. Não existe procedure de correção neste router, e
 * isso é proposital — enquanto as regras não tiverem histórico provando
 * que não geram falso positivo, o robô só relata. A ausência de um
 * `corrigir` aqui é a garantia, não a UI escondendo o botão.
 */

import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { listarRegras, varrer, LIMITE_LINHAS_PADRAO } from "./auditoria/executor";

export const adminRoboAuditorRouter = router({
  /** Catálogo de invariantes vigiando o banco. */
  listarRegras: adminProcedure.query(() => ({
    regras: listarRegras(),
    limiteLinhasPadrao: LIMITE_LINHAS_PADRAO,
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
    .mutation(async ({ input }) =>
      varrer({ ids: input?.ids, limiteLinhas: input?.limiteLinhas }),
    ),
});

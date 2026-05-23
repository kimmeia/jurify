/**
 * Procedure admin para auditar tribunais candidatos ao motor próprio.
 *
 * Roda o fetch de fora (em staging/produção, onde a rede de saída é
 * liberada) já que o sandbox de dev tem allowlist de hosts. NÃO consome
 * credencial — só inspeciona a porta de entrada de cada tribunal.
 */
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { createLogger } from "../_core/logger";
import { ALVOS, auditarTribunais } from "./auditar-tribunais";

const log = createLogger("admin-tribunais");

export const adminTribunaisRouter = router({
  /** Lista os alvos disponíveis (pra montar filtro na UI, se precisar). */
  listarAlvos: adminProcedure.query(() =>
    ALVOS.map(({ id, label, url }) => ({ id, label, url })),
  ),

  /**
   * Executa a auditoria. Dispara N requests externos — por isso é mutation
   * (ação, não cacheável). `ids` filtra os alvos; vazio = todos.
   */
  auditar: adminProcedure
    .input(
      z
        .object({
          ids: z.array(z.string().max(40)).max(50).optional(),
          timeoutMs: z.number().int().min(2_000).max(30_000).optional(),
        })
        .optional(),
    )
    .mutation(async ({ input }) => {
      const inicio = Date.now();
      const resultados = await auditarTribunais(input?.ids, {
        timeoutMs: input?.timeoutMs,
      });

      const resumo = {
        total: resultados.length,
        pdpjCloud: resultados.filter((r) => r.usaPdpjCloud).length,
        comErro: resultados.filter((r) => r.erro).length,
        reusoBaixo: resultados.filter((r) => r.reuso === "BAIXO").length,
        duracaoMs: Date.now() - inicio,
      };

      log.info(resumo, "Auditoria de tribunais concluída");

      return { resumo, resultados, executadoEm: new Date().toISOString() };
    }),
});

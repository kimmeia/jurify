/**
 * Router tRPC — manutenção de dados (admin JuridFlow).
 *
 * Operações de uma vez só, que antes exigiriam shell de produção. O dono do
 * produto não tem terminal no servidor; deixar a reconstrução do histórico
 * dependendo disso seria o mesmo que não tê-la feito.
 *
 * `simular` não grava nada e existe pra decisão ser tomada com o número na
 * frente. `aplicar` é retomável: se o orçamento de tempo acabar no meio, o
 * retorno diz quanto falta e o botão continua de onde parou.
 */
import { adminProcedure, router } from "../_core/trpc";
import { reconstruirEpisodios, statusBackfill } from "../atendimento/backfill";

export const adminManutencaoRouter = router({
  /** Quanto do histórico de atendimentos já foi reconstruído. */
  statusEpisodios: adminProcedure.query(async () => {
    return (
      (await statusBackfill()) ?? {
        totalConversas: 0,
        conversasComEpisodio: 0,
        conversasSemEpisodio: 0,
        episodios: 0,
      }
    );
  }),

  simularEpisodios: adminProcedure.mutation(async () => {
    return reconstruirEpisodios({ aplicar: false });
  }),

  reconstruirEpisodios: adminProcedure.mutation(async () => {
    return reconstruirEpisodios({ aplicar: true });
  }),
});

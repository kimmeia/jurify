/**
 * Router de Web Push (PWA).
 *
 * - chavePublica: o client precisa da chave VAPID pública pra se inscrever.
 * - inscrever / desinscrever: salva/remove a inscrição do dispositivo do
 *   próprio usuário (ctx.user.id — isolamento por utilizador).
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getVapidPublicKey, salvarInscricao, removerInscricao, enviarPushParaUsuario } from "../_core/web-push";

export const pushRouter = router({
  /** Chave VAPID pública (ou null se push indisponível no servidor). */
  chavePublica: protectedProcedure.query(async () => {
    const publicKey = await getVapidPublicKey();
    return { publicKey };
  }),

  /** Registra o dispositivo do usuário pra receber push. Idempotente. */
  inscrever: protectedProcedure
    .input(
      z.object({
        endpoint: z.string().url().max(512),
        keys: z.object({
          p256dh: z.string().min(1).max(255),
          auth: z.string().min(1).max(255),
        }),
        userAgent: z.string().max(255).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await salvarInscricao(ctx.user.id, { endpoint: input.endpoint, keys: input.keys }, input.userAgent);
      return { success: true };
    }),

  /** Remove a inscrição deste dispositivo (desativar / logout). */
  desinscrever: protectedProcedure
    .input(z.object({ endpoint: z.string().max(512) }))
    .mutation(async ({ input }) => {
      await removerInscricao(input.endpoint);
      return { success: true };
    }),

  /**
   * Envia uma notificação de teste pro próprio usuário (forçada — aparece
   * mesmo com o app aberto). Devolve diagnóstico: quantas inscrições existem
   * e quantas o gateway aceitou. Se inscricoes=0, o aparelho não está
   * inscrito (refazer "Ativar"); se enviados>0 e nada aparece, é o service
   * worker antigo (recarregar o app).
   */
  testar: protectedProcedure.mutation(async ({ ctx }) => {
    const r = await enviarPushParaUsuario(ctx.user.id, {
      titulo: "🔔 Notificação de teste",
      corpo: "Funcionou! As notificações do JuridFlow estão ativas neste aparelho.",
      url: "/atendimento",
      tag: "teste-push",
      dados: { forcar: true },
    });
    return r;
  }),
});

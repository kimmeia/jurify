import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

/**
 * Pausa/reativa o bot de uma conversa.
 *
 * O "bot pausado" não é um flag próprio: deriva de `conversas.status`.
 *   • `aguardando`      → bot ativo (SmartFlow responde)
 *   • `em_atendimento`  → bot pausado (dispatcher ignora a conversa)
 *
 * Até então a pausa só acontecia implicitamente ao enviar uma mensagem;
 * este hook expõe o toggle explícito.
 */
export function botStatusInfo(status: string | undefined) {
  return {
    managed: status === "aguardando" || status === "em_atendimento",
    pausado: status === "em_atendimento",
  };
}

export function useBotToggle(onDone?: () => void) {
  const mut = trpc.crm.atualizarConversa.useMutation({
    onSuccess: (_data, vars) => {
      toast.success(
        vars.status === "em_atendimento"
          ? "Bot pausado — você assumiu o atendimento."
          : "Bot reativado — o fluxo responde na próxima mensagem.",
      );
      onDone?.();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return {
    pending: mut.isPending,
    toggle: (conversaId: number, pausado: boolean) =>
      mut.mutate({ id: conversaId, status: pausado ? "aguardando" : "em_atendimento" }),
  };
}

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { CircleDollarSign, CalendarClock, Wallet, X } from "lucide-react";
import { NovaCobrancaDialog, type CobrancaCriadaInfo } from "@/pages/financeiro/dialogs";

type ModoInicial = "avulsa" | "parcelada" | "manual";

export type LancarCobrancaCardCtx = {
  cardId: number;
  cardTitulo: string;
  clienteId: number | null;
  clienteNome?: string | null;
  processoId: number | null;
  valorEstimado: number | null;
  asaasConectado: boolean;
};

const formatBRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Modal disparado quando um card vai pra coluna "Concluído/Ganho" pela primeira
 * vez (e ainda não tem cobrança vinculada). Oferece 4 caminhos:
 *
 *  - Avulsa  → cobrança única no Asaas (PIX/boleto/cartão)
 *  - Parcelada → N parcelas no Asaas (cada parcela = 1 cobrança vinculada)
 *  - Manual  → registra pagamento já recebido fora do Asaas
 *  - Pular   → fecha sem lançar; card fica em "Ganho" só com valorEstimado
 *
 * Após criar cobrança, amarra o paymentId no card (procedure
 * `kanban.vincularCobranca`) pra que o modal não reabra ao mover card de novo.
 * Se o valor da cobrança difere do valorEstimado, pergunta se quer sincronizar
 * o card.
 */
export function LancarCobrancaCardModal({
  open,
  onOpenChange,
  ctx,
  onConcluido,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ctx: LancarCobrancaCardCtx | null;
  onConcluido?: () => void;
}) {
  const [modoEscolhido, setModoEscolhido] = useState<ModoInicial | null>(null);
  const [askSyncValor, setAskSyncValor] = useState<{ novoValor: number } | null>(null);

  const vincularMut = (trpc as any).kanban.vincularCobranca.useMutation({
    onError: (e: any) => toast.error("Erro ao vincular cobrança ao card", { description: e.message }),
  });
  const editarCardMut = (trpc as any).kanban.editarCard.useMutation({
    onError: (e: any) => toast.error("Erro ao atualizar valor do card", { description: e.message }),
  });

  if (!ctx) return null;

  const fechar = (chamarOnConcluido = true) => {
    setModoEscolhido(null);
    setAskSyncValor(null);
    onOpenChange(false);
    if (chamarOnConcluido) onConcluido?.();
  };

  const handleCobrancaCriada = async (info: CobrancaCriadaInfo) => {
    if (info.paymentId) {
      await vincularMut.mutateAsync({
        cardId: ctx.cardId,
        asaasPaymentId: info.paymentId,
        valorEstimado: info.valor,
      });
    }
    // Se valor da cobrança difere do valorEstimado do card → pergunta se quer sincronizar
    // (vincularMut já gravou novo valor; este passo é só pra confirmar pro user que o
    // card foi atualizado. Se quiser MANTER o estimado original, restauramos abaixo.)
    if (ctx.valorEstimado != null && Math.abs(ctx.valorEstimado - info.valor) > 0.01) {
      setAskSyncValor({ novoValor: info.valor });
    } else {
      toast.success("Cobrança vinculada ao card");
      fechar();
    }
  };

  // Etapa 1: escolha de tipo
  if (!modoEscolhido && !askSyncValor) {
    const opcoes: Array<{ id: ModoInicial; titulo: string; sub: string; icon: any; disabled?: boolean }> = [
      { id: "avulsa", titulo: "Cobrança avulsa", sub: "Asaas — pagamento único", icon: CircleDollarSign, disabled: !ctx.asaasConectado },
      { id: "parcelada", titulo: "Parcelamento", sub: "Asaas — 2 a 24 parcelas", icon: CalendarClock, disabled: !ctx.asaasConectado },
      { id: "manual", titulo: "Manual", sub: "Já recebido (dinheiro / transferência)", icon: Wallet },
    ];
    return (
      <Dialog open={open} onOpenChange={(o) => { if (!o) fechar(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Lançar cobrança?</DialogTitle>
            <DialogDescription>
              <span className="block font-medium text-foreground">{ctx.cardTitulo}</span>
              {ctx.clienteNome && <span className="block text-xs">Cliente: {ctx.clienteNome}</span>}
              {ctx.valorEstimado != null && (
                <span className="block text-xs">Valor estimado: <strong>{formatBRL(ctx.valorEstimado)}</strong></span>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2">
            {opcoes.map((o) => {
              const Icon = o.icon;
              return (
                <button
                  key={o.id}
                  type="button"
                  disabled={o.disabled}
                  onClick={() => setModoEscolhido(o.id)}
                  className="w-full flex items-center gap-3 p-3 rounded-lg border hover:border-primary hover:bg-accent/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-left"
                >
                  <Icon className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{o.titulo}</p>
                    <p className="text-xs text-muted-foreground">{o.sub}</p>
                  </div>
                </button>
              );
            })}
            {!ctx.asaasConectado && (
              <p className="text-[10px] text-muted-foreground italic px-1">
                Asaas não está conectado — só lançamento manual disponível.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => fechar()}>
              <X className="h-4 w-4 mr-1" /> Pular
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Etapa 3: pergunta sincronizar valorEstimado do card
  if (askSyncValor) {
    return (
      <AlertDialog open={true}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Atualizar valor do card?</AlertDialogTitle>
            <AlertDialogDescription>
              Você lançou cobrança de <strong>{formatBRL(askSyncValor.novoValor)}</strong> mas o card
              tem valor estimado de <strong>{ctx.valorEstimado != null ? formatBRL(ctx.valorEstimado) : "—"}</strong>.
              <br /><br />
              Atualizar o valor do card pro novo valor cobrado? (recomendado — mantém o card sincronizado)
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={async () => {
                // user disse "manter estimado original" → reverte o valor que vinculou
                await editarCardMut.mutateAsync({ id: ctx.cardId, valorEstimado: ctx.valorEstimado });
                toast.success("Valor do card mantido");
                fechar();
              }}
            >
              Manter {ctx.valorEstimado != null ? formatBRL(ctx.valorEstimado) : "original"}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                toast.success("Valor do card atualizado");
                fechar();
              }}
            >
              Atualizar pra {formatBRL(askSyncValor.novoValor)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  // Etapa 2: form de cobrança via NovaCobrancaDialog
  return (
    <NovaCobrancaDialog
      open={open}
      onOpenChange={(o) => { if (!o) fechar(false); }}
      onSuccess={() => {/* atualizações ficam pro Kanban refetch via onConcluido */}}
      onCobrancaCriada={handleCobrancaCriada}
      contatoIdInicial={ctx.clienteId ?? undefined}
      esconderCliente={ctx.clienteId != null}
      asaasConectado={ctx.asaasConectado}
      valorInicial={ctx.valorEstimado}
      processoIdsIniciais={ctx.processoId ? [ctx.processoId] : undefined}
    />
  );
}

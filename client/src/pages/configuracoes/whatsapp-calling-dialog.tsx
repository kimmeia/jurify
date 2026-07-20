/**
 * Dialog de configuração da ligação de voz (WhatsApp Business Calling API).
 *
 * Lê o status atual via `whatsappCalling.statusCalling` e permite habilitar/
 * desabilitar a ligação no MESMO número já conectado pra mensagem. Receber
 * chamada é grátis; ligar pro cliente é pago e exige permissão prévia dele.
 */

import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, Phone, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onClose: () => void;
  canalId: number;
  canEdit: boolean;
}

export function WhatsAppCallingDialog({ open, onClose, canalId, canEdit }: Props) {
  const statusQuery = trpc.whatsappCalling.statusCalling.useQuery(
    { canalId },
    { enabled: open, retry: false },
  );

  const definirMut = trpc.whatsappCalling.definirCalling.useMutation({
    onSuccess: (r) => {
      toast.success(r.habilitado ? "Ligação habilitada no número!" : "Ligação desabilitada.");
      statusQuery.refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const habilitado = !!statusQuery.data?.habilitado;
  const coexBloqueado = !!(statusQuery.data as any)?.coexBloqueado;
  const carregando = statusQuery.isLoading || definirMut.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5 text-green-600" />
            Ligação de voz
          </DialogTitle>
          <DialogDescription>
            Receba e faça ligações de voz pelo mesmo número do WhatsApp, direto no atendimento.
          </DialogDescription>
        </DialogHeader>

        {statusQuery.isLoading && (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando configuração...
          </div>
        )}

        {statusQuery.error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {(statusQuery.error as any).message}
          </div>
        )}

        {!statusQuery.isLoading && !statusQuery.error && coexBloqueado && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200 space-y-1.5">
            <p className="flex items-start gap-1.5 font-medium">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              Número em modo coexistência
            </p>
            <p>
              Este número continua conectado ao app WhatsApp Business no celular. Nesse modo,
              as chamadas de voz ficam <strong>no app do celular</strong> — a Calling API da
              Meta não suporta números em coexistência.
            </p>
          </div>
        )}

        {!statusQuery.isLoading && !statusQuery.error && !coexBloqueado && (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">Ligação habilitada</p>
                <p className="text-xs text-muted-foreground">
                  {habilitado ? "O número aceita chamadas de voz." : "As chamadas estão desativadas."}
                </p>
              </div>
              <Switch
                checked={habilitado}
                disabled={!canEdit || carregando}
                onCheckedChange={(v) => definirMut.mutate({ canalId, habilitar: v })}
              />
            </div>

            <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground space-y-1.5">
              <p className="flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-500" />
                <span>
                  No painel do Facebook App, assine o campo de webhook <strong>calls</strong> — sem
                  isso as chamadas não chegam.
                </span>
              </p>
              <p>• Receber chamada do cliente é <strong>grátis</strong>.</p>
              <p>
                • Ligar pro cliente é <strong>pago por minuto</strong> e exige que ele aprove um
                pedido de permissão antes (válido por 7 dias).
              </p>
            </div>

            {!canEdit && (
              <p className="text-xs text-muted-foreground">
                Apenas donos e gestores podem alterar esta configuração.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

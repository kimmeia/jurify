/**
 * Config de ligação do escritório (dono/gestor): transbordo automático on/off
 * e modo da janela de chamada recebida (overlay vs discreto). Vale pra todos.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { PhoneCall, Loader2 } from "lucide-react";

export function LigacaoConfigCard({ canEdit }: { canEdit: boolean }) {
  const utils = trpc.useUtils();
  const q = trpc.whatsappCalling.configChamada.useQuery();
  const mut = trpc.whatsappCalling.atualizarConfigChamada.useMutation({
    onSuccess: () => {
      utils.whatsappCalling.configChamada.invalidate();
      toast.success("Configuração de ligação salva.");
    },
    onError: (e) => toast.error(e.message),
  });

  const transbordo = q.data?.transbordoAtivo ?? false;
  const modo = q.data?.modoJanela ?? "overlay";
  const avisoPerdida = q.data?.avisoPerdidaAtivo ?? false;
  const disabled = !canEdit || mut.isPending || q.isLoading;

  const opcao = (valor: "overlay" | "discreto", titulo: string, desc: string) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => mut.mutate({ modoJanela: valor })}
      className={
        "text-left rounded-xl border p-3 transition-colors disabled:opacity-60 " +
        (modo === valor ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted/50")
      }
    >
      <p className="text-sm font-semibold">{titulo}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
    </button>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PhoneCall className="h-4 w-4" /> Ligação (WhatsApp)
          {mut.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Transbordo automático</p>
            <p className="text-xs text-muted-foreground">
              Chamada não atendida pelo responsável em ~15s toca pros atendentes disponíveis. Desligado = fica só com o responsável.
            </p>
          </div>
          <Switch
            checked={transbordo}
            disabled={disabled}
            onCheckedChange={(v) => mut.mutate({ transbordoAtivo: v })}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Aviso de chamada perdida</p>
            <p className="text-xs text-muted-foreground">
              Quando ninguém atende uma chamada recebida, envia um WhatsApp automático avisando que vai retornar. Desligado por padrão — só liga se quiser esse disparo automático.
            </p>
          </div>
          <Switch
            checked={avisoPerdida}
            disabled={disabled}
            onCheckedChange={(v) => mut.mutate({ avisoPerdidaAtivo: v })}
          />
        </div>

        <div>
          <p className="text-sm font-medium mb-2">Janela de chamada recebida</p>
          <div className="grid grid-cols-2 gap-2">
            {opcao("overlay", "Overlay", "Pop-up em tela cheia quando toca.")}
            {opcao("discreto", "Discreto", "Widget pisca no canto + som, sem cobrir a tela.")}
          </div>
        </div>

        {!canEdit && (
          <p className="text-xs text-muted-foreground">Apenas dono/gestor pode alterar a configuração de ligação.</p>
        )}
      </CardContent>
    </Card>
  );
}

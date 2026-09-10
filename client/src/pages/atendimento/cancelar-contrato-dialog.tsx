/**
 * "Cancelar contrato" — o mesmo diálogo na ficha do cliente e no Pipeline —
 * e a pergunta "cancelado ou perdido?" que o Pipeline faz ao arrastar um
 * contrato Ganho pra Perdido (senão cancelamento vira perda sem querer).
 */
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { MOTIVOS_CANCELAMENTO, type MotivoCancelamento } from "@shared/cancelamento-contrato";
import { dataLocalHoje } from "@shared/data-calendario";
import { parseValorBR } from "@shared/valor-br";

export type AlvoCancelamento = {
  id: number;
  nome: string;
  valorEstimado?: string | null;
  fechadoEm?: string | null;
  origemLead?: string | null;
};

const fmtBRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
const fmtData = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR") : "";

export function CancelarContratoDialog({ alvo, onClose, onDone }: {
  alvo: AlvoCancelamento | null;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [data, setData] = useState(dataLocalHoje());
  const [motivo, setMotivo] = useState<MotivoCancelamento | "">("");
  const [detalhe, setDetalhe] = useState("");
  const [encerrarServico, setEncerrarServico] = useState(true);

  useEffect(() => {
    if (alvo) {
      setData(dataLocalHoje());
      setMotivo("");
      setDetalhe("");
      setEncerrarServico(true);
    }
  }, [alvo?.id]);

  const mut = trpc.crm.cancelarContrato.useMutation({
    onSuccess: () => {
      toast.success("Contrato cancelado");
      onClose();
      onDone?.();
    },
    onError: (e: any) => toast.error(e?.message ?? "Não foi possível cancelar o contrato"),
  });

  if (!alvo) return null;
  const valor = parseValorBR(alvo.valorEstimado ?? null);
  const podeConfirmar = !!motivo && /^\d{4}-\d{2}-\d{2}$/.test(data) && !mut.isPending;

  return (
    <Dialog open={!!alvo} onOpenChange={(o) => { if (!o && !mut.isPending) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <XCircle className="h-5 w-5 text-danger-fg" /> Cancelar contrato
          </DialogTitle>
          <DialogDescription>
            <strong>{alvo.nome}</strong>
            {valor > 0 ? ` · ${fmtBRL(valor)}` : ""}
            {alvo.fechadoEm ? ` · fechado em ${fmtData(alvo.fechadoEm)}` : ""}
            {alvo.origemLead ? ` · origem ${alvo.origemLead}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="space-y-1">
            <Label className="text-xs">Data do cancelamento</Label>
            <Input type="date" value={data} max={dataLocalHoje()} onChange={(e) => setData(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Motivo</Label>
            <div className="flex flex-wrap gap-1.5">
              {MOTIVOS_CANCELAMENTO.map((m) => {
                const on = motivo === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMotivo(m.id)}
                    className={
                      "rounded-full border px-3 py-1 text-[12px] font-medium transition-colors " +
                      (on ? "bg-foreground text-background border-foreground" : "border-border hover:bg-muted/40")
                    }
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Detalhe (opcional)</Label>
            <Input
              value={detalhe}
              onChange={(e) => setDetalhe(e.target.value)}
              placeholder="Ex.: pediu o distrato por telefone, vai pagar só a entrada"
              maxLength={500}
            />
          </div>
          <label className="flex items-start gap-2 text-[12px] leading-snug cursor-pointer">
            <Checkbox
              checked={encerrarServico}
              onCheckedChange={(v) => setEncerrarServico(v === true)}
              className="mt-0.5"
            />
            <span>
              Encerrar também o <strong>serviço deste cliente</strong> como "Cancelado pelo cliente", com a mesma data
              e motivo (é a Situação do serviço que já existe na ficha).
            </span>
          </label>
          <p className="rounded-md border border-warning/30 bg-warning-bg px-2.5 py-2 text-[11px] leading-snug text-warning-fg">
            O fechamento continua contando no mês em que fechou; o que já foi recebido continua no caixa. Comissão já
            paga não é mexida por aqui. Cobranças em aberto no Asaas continuam como estão — cancelar cobrança é no Financeiro.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mut.isPending}>Voltar</Button>
          <Button
            className="bg-danger hover:bg-danger text-danger-on"
            disabled={!podeConfirmar}
            onClick={() => {
              if (!motivo) return;
              mut.mutate({
                id: alvo.id,
                data,
                motivo,
                detalhe: detalhe.trim() || undefined,
                encerrarServico,
              });
            }}
          >
            {mut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <XCircle className="h-4 w-4 mr-2" />}
            Confirmar cancelamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Arrastou um contrato Ganho pra Perdido: foi cancelado (fechou e desistiu)
 *  ou o lead foi perdido? Cada resposta abre o diálogo certo. */
export function CanceladoOuPerdidoDialog({ alvo, onClose, onCancelado, onPerdido }: {
  alvo: { id: number; nome: string } | null;
  onClose: () => void;
  onCancelado: () => void;
  onPerdido: () => void;
}) {
  return (
    <AlertDialog open={!!alvo} onOpenChange={(o) => { if (!o) onClose(); }}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Este contrato foi cancelado ou o lead foi perdido?</AlertDialogTitle>
          <AlertDialogDescription>
            <strong>{alvo?.nome}</strong> está em Ganho — o contrato fechou. Se o cliente desistiu depois, é um
            <strong> cancelamento</strong> (fica registrado com data e motivo, e o fechamento continua contando no mês em que
            fechou). "Perdido" é pra lead que nunca chegou a fechar.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col sm:flex-row gap-2">
          <AlertDialogCancel>Voltar</AlertDialogCancel>
          <Button variant="outline" onClick={onPerdido}>Foi perdido (nunca fechou)</Button>
          <Button className="bg-danger hover:bg-danger text-danger-on" onClick={onCancelado}>Foi cancelado</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

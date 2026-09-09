/**
 * Gate bloqueante de aceite dos Termos de Uso — trava o DONO do escritório
 * quando a versão aceita ficou pra trás (conta antiga sem aceite ou termo
 * atualizado). Não fecha sem aceitar: sem X, sem clicar fora, sem Esc.
 *
 * Colaboradores não são travados (aceitam no próprio cadastro) e admin/
 * impersonação nunca veem — o servidor decide (termos.status).
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, ScrollText } from "lucide-react";
import { toast } from "sonner";

export default function TermosGate() {
  const utils = trpc.useUtils();
  const { data } = trpc.termos.status.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
  });
  const [aceitou, setAceitou] = useState(false);

  const aceitarMut = trpc.termos.aceitar.useMutation({
    onSuccess: () => {
      utils.termos.status.invalidate();
      toast.success("Termos aceitos — bom trabalho!");
    },
    onError: (err) => toast.error("Não foi possível registrar o aceite", { description: err.message }),
  });

  if (!data?.precisaAceitar) return null;

  return (
    <Dialog open>
      <DialogContent
        className="max-w-xl [&>button]:hidden"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <ScrollText className="h-5 w-5 text-info-fg" />
            Atualizamos os Termos de Uso
            <Badge variant="outline" className="text-[10px] border-info/30 text-info-fg">
              versão {data.versaoAtual} · {data.atualizadoEm}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            Pra continuar usando o JuridFlow, o responsável pelo escritório precisa ler e aceitar
            a nova versão dos{" "}
            <a href="/termos" target="_blank" rel="noopener noreferrer" className="font-semibold text-info-fg underline">
              Termos de Uso
            </a>{" "}
            e da{" "}
            <a href="/privacidade" target="_blank" rel="noopener noreferrer" className="font-semibold text-info-fg underline">
              Política de Privacidade
            </a>.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border bg-muted/40 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">
            O que mudou nesta versão
          </p>
          <ul className="list-disc pl-4 space-y-1">
            {data.mudancas.map((m, i) => (
              <li key={i} className="text-xs text-foreground/90 leading-relaxed">{m}</li>
            ))}
          </ul>
        </div>

        <label className="flex items-start gap-2.5 rounded-lg border p-3 cursor-pointer select-none">
          <Checkbox
            checked={aceitou}
            onCheckedChange={(v) => setAceitou(v === true)}
            className="mt-0.5"
          />
          <span className="text-sm leading-relaxed">
            Li e aceito a nova versão dos Termos de Uso e da Política de Privacidade em nome do escritório.
          </span>
        </label>

        <div className="flex items-center gap-3">
          <Button
            className="flex-1"
            size="lg"
            disabled={!aceitou || aceitarMut.isPending}
            onClick={() => aceitarMut.mutate()}
          >
            {aceitarMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Aceitar e continuar
          </Button>
          <p className="w-44 text-[10px] text-muted-foreground leading-snug">
            O aceite é registrado com data, hora, IP e versão — fica na trilha de auditoria.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

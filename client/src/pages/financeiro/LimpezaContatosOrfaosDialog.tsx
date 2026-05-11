/**
 * Diálogo de limpeza de contatos Asaas órfãos. Contexto: o
 * `sincronizarClientes` antigo (corrigido em PR #241) fazia bulk import
 * de TODOS os customers do Asaas. Quem clicou Sincronizar antes do fix
 * ficou com centenas/milhares de contatos no CRM sem cobrança nem
 * processo vinculado.
 *
 * Esta tela mostra preview (count + amostra de nomes) antes de executar
 * a limpeza, pra dar segurança visual ao admin.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertCircle, CheckCircle2, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

export function LimpezaContatosOrfaosDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSuccess: () => void;
}) {
  const [confirmacao, setConfirmacao] = useState("");

  const preview = (trpc as any).asaas?.preverLimpezaContatosAsaas?.useQuery?.(
    undefined,
    { retry: false, enabled: open },
  );

  const executar = (trpc as any).asaas?.executarLimpezaContatosAsaas?.useMutation?.({
    onSuccess: (r: { deletados: number; vinculosRemovidos: number }) => {
      toast.success(`${r.deletados} contato(s) removido(s)`, {
        description:
          r.vinculosRemovidos > 0
            ? `Também foram removidos ${r.vinculosRemovidos} vínculo(s) Asaas associado(s).`
            : undefined,
      });
      onSuccess();
      onOpenChange(false);
      setConfirmacao("");
    },
    onError: (err: any) =>
      toast.error("Erro ao remover", { description: err.message }),
  });

  const total = preview?.data?.total ?? 0;
  const amostra = preview?.data?.amostra ?? [];
  const podeConfirmar =
    confirmacao.trim().toLowerCase() === "limpar" &&
    total > 0 &&
    !executar?.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setConfirmacao("");
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-destructive" />
            Limpar contatos Asaas órfãos
          </DialogTitle>
          <DialogDescription>
            Remove contatos que foram importados do Asaas mas que <b>não têm
            cobrança nem processo vinculado</b>. Contatos com qualquer atividade
            no CRM ficam intocados.
          </DialogDescription>
        </DialogHeader>

        {preview?.isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : total === 0 ? (
          <div className="flex items-center gap-2 rounded border bg-emerald-50 dark:bg-emerald-950/20 p-3 text-sm text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Nenhum contato órfão encontrado — está tudo limpo.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm text-amber-900 dark:text-amber-200">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p>
                    <b>{total}</b> contato(s) sem cobrança nem processo seriam
                    removidos.
                  </p>
                  <p className="text-xs opacity-80">
                    Esta ação é <b>irreversível</b>. Contatos com cobranças
                    futuras serão recriados automaticamente quando aparecerem.
                  </p>
                </div>
              </div>
            </div>

            {amostra.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">
                  Amostra dos primeiros 20:
                </p>
                <div className="max-h-40 overflow-y-auto rounded border p-2 text-xs space-y-0.5 bg-muted/30">
                  {amostra.map((c: { id: number; nome: string }) => (
                    <div key={c.id} className="truncate">
                      <span className="text-muted-foreground tabular-nums">
                        #{c.id}
                      </span>{" "}
                      {c.nome}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className="text-xs text-muted-foreground block mb-1">
                Digite <b>limpar</b> pra habilitar o botão:
              </label>
              <input
                type="text"
                value={confirmacao}
                onChange={(e) => setConfirmacao(e.target.value)}
                placeholder="limpar"
                className="w-full h-9 px-2 text-sm rounded border bg-background"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          {total > 0 && (
            <Button
              variant="destructive"
              onClick={() => executar?.mutate?.()}
              disabled={!podeConfirmar}
            >
              {executar?.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Remover {total} contato(s)
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Diálogo de RESET DE HISTÓRICO FINANCEIRO. Operação destrutiva,
 * usada quando o caixa do escritório está contaminado por lançamentos
 * manuais errados (duplicatas, valores trocados, etc) e o operador
 * prefere zerar e ressincronizar tudo do Asaas em vez de catar caso
 * a caso.
 *
 * Apaga: cobranças, comissões fechadas, log de fechamentos automáticos,
 *        eventos de webhook antigos.
 *
 * Preserva: API key do Asaas, mapeamento contato↔customer, regras de
 *           comissão, categorias, despesas, contatos.
 *
 * Confirmação tripla:
 *  1. Dropdown menu vermelho com label "Resetar histórico (zerar tudo)"
 *  2. Modal mostra os counts do que vai apagar (dry-run)
 *  3. Operador precisa digitar exatamente "RESETAR HISTORICO COBRANCAS"
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
import { AlertTriangle, CheckCircle2, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

const FRASE_CONFIRMACAO = "RESETAR HISTORICO COBRANCAS";

interface PreviaApagar {
  cobrancas: number;
  cobrancaAcoes: number;
  comissoesFechadas: number;
  comissoesItens: number;
  comissoesLogs: number;
  webhookEventos: number;
}

interface Previa {
  escritorioId: number;
  escritorioNome: string;
  apagar: PreviaApagar;
  preservar: string[];
}

export function ResetarHistoricoDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSuccess: () => void;
}) {
  const [confirmacao, setConfirmacao] = useState("");

  const previa = (trpc as any).asaas?.previaApagarHistoricoCobrancas?.useQuery?.(
    undefined,
    { retry: false, enabled: open, refetchOnWindowFocus: false },
  );

  const executar = (trpc as any).asaas?.apagarHistoricoCobrancas?.useMutation?.({
    onSuccess: (r: { deletados: PreviaApagar; proximoPasso: string }) => {
      toast.success(
        `Histórico apagado: ${r.deletados.cobrancas} cobranças, ${r.deletados.comissoesFechadas} comissões fechadas`,
        { description: r.proximoPasso, duration: 8000 },
      );
      onSuccess();
      onOpenChange(false);
      setConfirmacao("");
    },
    onError: (err: any) =>
      toast.error("Erro ao apagar histórico", { description: err.message }),
  });

  const data: Previa | undefined = previa?.data;
  const apagar = data?.apagar;
  const totalApagar =
    apagar
      ? apagar.cobrancas +
        apagar.cobrancaAcoes +
        apagar.comissoesFechadas +
        apagar.comissoesItens +
        apagar.comissoesLogs +
        apagar.webhookEventos
      : 0;
  const podeConfirmar =
    confirmacao === FRASE_CONFIRMACAO &&
    totalApagar > 0 &&
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
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-4 w-4" />
            Resetar histórico financeiro
          </DialogTitle>
          <DialogDescription>
            Apaga <b>todas as cobranças, comissões fechadas e eventos antigos</b>{" "}
            do seu escritório. Use quando o caixa estiver contaminado por
            lançamentos errados e for mais fácil zerar e ressincronizar do que
            corrigir caso a caso.
          </DialogDescription>
        </DialogHeader>

        {previa?.isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : previa?.error ? (
          <div className="rounded border border-red-200 bg-red-50 dark:bg-red-950/20 p-3 text-sm text-red-700 dark:text-red-300">
            {previa.error.message ||
              "Não foi possível carregar a prévia. Você precisa ser o dono do escritório."}
          </div>
        ) : totalApagar === 0 ? (
          <div className="flex items-center gap-2 rounded border bg-emerald-50 dark:bg-emerald-950/20 p-3 text-sm text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Nenhum histórico para apagar — escritório já está limpo.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />
                <div className="space-y-1.5 flex-1">
                  <p className="font-semibold text-destructive">
                    Vai apagar do escritório "{data?.escritorioNome}":
                  </p>
                  <ul className="text-xs space-y-0.5 ml-1">
                    {apagar!.cobrancas > 0 && (
                      <li>
                        • <b className="tabular-nums">{apagar!.cobrancas}</b>{" "}
                        cobrança(s) (Asaas + manuais)
                      </li>
                    )}
                    {apagar!.comissoesFechadas > 0 && (
                      <li>
                        • <b className="tabular-nums">{apagar!.comissoesFechadas}</b>{" "}
                        fechamento(s) de comissão
                      </li>
                    )}
                    {apagar!.comissoesItens > 0 && (
                      <li>
                        • <b className="tabular-nums">{apagar!.comissoesItens}</b>{" "}
                        item(ns) de comissão
                      </li>
                    )}
                    {apagar!.cobrancaAcoes > 0 && (
                      <li>
                        • <b className="tabular-nums">{apagar!.cobrancaAcoes}</b>{" "}
                        vínculo(s) cobrança↔processo
                      </li>
                    )}
                    {apagar!.comissoesLogs > 0 && (
                      <li>
                        • <b className="tabular-nums">{apagar!.comissoesLogs}</b>{" "}
                        log(s) de fechamento automático
                      </li>
                    )}
                    {apagar!.webhookEventos > 0 && (
                      <li>
                        • <b className="tabular-nums">{apagar!.webhookEventos}</b>{" "}
                        evento(s) de webhook antigos
                      </li>
                    )}
                  </ul>
                </div>
              </div>
            </div>

            {data?.preservar && data.preservar.length > 0 && (
              <div className="rounded border bg-muted/30 p-3 text-xs">
                <p className="font-semibold mb-1">Vai preservar:</p>
                <ul className="space-y-0.5 opacity-80">
                  {data.preservar.map((p) => (
                    <li key={p}>• {p}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="rounded border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-900 dark:text-amber-200">
              <b>Depois do reset:</b> vá em "Sincronizar tudo" pra o Asaas
              reinserir o histórico baseado nos vínculos preservados.
              Lançamentos manuais que você fez NÃO voltam (eles não existem
              no Asaas).
            </div>

            <div>
              <label className="text-xs text-muted-foreground block mb-1">
                Digite exatamente <code className="font-mono bg-muted px-1 rounded">{FRASE_CONFIRMACAO}</code> pra confirmar:
              </label>
              <input
                type="text"
                value={confirmacao}
                onChange={(e) => setConfirmacao(e.target.value)}
                placeholder={FRASE_CONFIRMACAO}
                className="w-full h-9 px-2 text-sm rounded border bg-background font-mono"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          {totalApagar > 0 && (
            <Button
              variant="destructive"
              onClick={() => executar?.mutate?.({ confirmacao: FRASE_CONFIRMACAO })}
              disabled={!podeConfirmar}
            >
              {executar?.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Apagar histórico
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

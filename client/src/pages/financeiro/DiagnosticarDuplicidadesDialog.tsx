/**
 * Diagnóstico read-only de possíveis pagamentos duplicados.
 * Não cancela nem altera nada — só mostra a magnitude do problema
 * pra o usuário decidir o próximo passo (limpar manualmente, ou
 * pedir implementação da caixa de conciliação).
 */

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
import { AlertTriangle, Clock, FileText, Loader2 } from "lucide-react";
import { formatBRL } from "./helpers";

export function DiagnosticarDuplicidadesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, isLoading, refetch } = (trpc as any).asaas.diagnosticarDuplicidades.useQuery(
    undefined,
    { enabled: open, retry: false, refetchOnWindowFocus: false },
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Diagnóstico de pagamentos duplicados
          </DialogTitle>
          <DialogDescription>
            Análise read-only do escritório. Nada é alterado.
            Mostra órfãs, pares suspeitos e cobranças manuais já-pagas.
          </DialogDescription>
        </DialogHeader>

        {isLoading || !data ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Cards de resumo */}
            <div className="grid grid-cols-3 gap-3">
              <div className="border rounded-lg p-3 space-y-1">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5 text-amber-500" />
                  Órfãs pagas
                </div>
                <p className="text-2xl font-bold text-amber-600 tabular-nums">
                  {data.orfasRecebidas.count}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {formatBRL(data.orfasRecebidas.valorTotal)}
                </p>
                <p className="text-[10px] text-muted-foreground italic">
                  pagas sem cliente vinculado
                </p>
              </div>

              <div className="border-2 border-red-200 rounded-lg p-3 space-y-1">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                  Pares suspeitos
                </div>
                <p className="text-2xl font-bold text-red-600 tabular-nums">
                  {data.paresSuspeitos.count}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {formatBRL(data.paresSuspeitos.valorTotal)}
                </p>
                <p className="text-[10px] text-muted-foreground italic">
                  mesmo valor + datas próximas
                </p>
              </div>

              <div className="border rounded-lg p-3 space-y-1">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <FileText className="h-3.5 w-3.5 text-blue-500" />
                  Manuais já-pagas
                </div>
                <p className="text-2xl font-bold text-blue-600 tabular-nums">
                  {data.manuaisJaPagas.count}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {formatBRL(data.manuaisJaPagas.valorTotal)}
                </p>
                <p className="text-[10px] text-muted-foreground italic">
                  lançadas manualmente como recebidas
                </p>
              </div>
            </div>

            {/* Exemplos de pares */}
            {data.paresSuspeitos.exemplos.length > 0 && (
              <div className="border rounded-lg p-3 space-y-2">
                <p className="text-sm font-semibold">
                  Exemplos dos pares suspeitos (até 5)
                </p>
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="text-left py-1">Cobranças</th>
                      <th className="text-left py-1">Tipo</th>
                      <th className="text-right py-1">Valor</th>
                      <th className="text-left py-1">Datas pagamento</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.paresSuspeitos.exemplos.map((ex: any, i: number) => (
                      <tr key={i}>
                        <td className="py-1.5 font-mono">
                          #{ex.idA} ↔ #{ex.idB}
                        </td>
                        <td className="py-1.5 text-muted-foreground">{ex.lados}</td>
                        <td className="py-1.5 text-right tabular-nums">
                          {formatBRL(ex.valor)}
                        </td>
                        <td className="py-1.5 text-muted-foreground text-[10px]">
                          {ex.dataPagA || "—"} · {ex.dataPagB || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Interpretação */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs space-y-2 dark:bg-amber-950/30 dark:border-amber-900">
              <p className="font-semibold">Como ler os números:</p>
              <ul className="list-disc list-inside space-y-1 ml-2 text-slate-700 dark:text-slate-300">
                <li>
                  <strong>Órfãs pagas</strong> são candidatas a serem vinculadas
                  manualmente a clientes existentes (Pix em nome de terceiro).
                </li>
                <li>
                  <strong>Pares suspeitos</strong> são casos prováveis de duplicação
                  — cliente pagou 1 vez mas o caixa registra 2x. Cada par precisa
                  ser revisado manualmente.
                </li>
                <li>
                  <strong>Manuais já-pagas</strong> é volume informativo. Quanto maior,
                  maior o risco de duplicação no estilo "Carlos + esposa".
                </li>
              </ul>
              {data.paresSuspeitos.count === 0 && data.orfasRecebidas.count === 0 && (
                <p className="text-emerald-700 font-medium pt-2 border-t">
                  ✓ Nenhuma duplicação ou órfã encontrada no momento.
                </p>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => refetch()} disabled={isLoading}>
            Atualizar
          </Button>
          <Button onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

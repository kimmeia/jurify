/**
 * Card de progresso da importação de extrato Asaas em segundo plano —
 * topo da aba Despesas. Espelho do PainelSyncHistorico da aba Cobranças.
 *
 * Estados:
 *  - agendado/executando: spinner + barra + contadores + velocidade + Pausar
 *  - executando com `proximaTentativaEm` futuro: âmbar "aguardando cota,
 *    retoma sozinho" + botão "Tentar agora"
 *  - pausado/erro: âmbar + Retomar
 *  - concluido: verde + Fechar (zera o estado)
 *  - inativo: não renderiza nada
 */

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

export function ExtratoSyncCard() {
  const utils = trpc.useUtils();
  const { data } = (trpc as any).asaas?.extratoSyncStatus?.useQuery?.(undefined, {
    refetchInterval: 30_000,
    staleTime: 15_000,
  }) || {};

  const invalidate = () => {
    (utils as any).asaas?.extratoSyncStatus?.invalidate?.();
    (utils as any).despesas?.listar?.invalidate?.();
  };
  const pausarMut = (trpc as any).asaas?.extratoSyncPausar?.useMutation?.({
    onSuccess: invalidate,
    onError: (e: any) => toast.error("Erro", { description: e.message }),
  }) || {};
  const retomarMut = (trpc as any).asaas?.extratoSyncRetomar?.useMutation?.({
    onSuccess: invalidate,
    onError: (e: any) => toast.error("Erro", { description: e.message }),
  }) || {};
  const cancelarMut = (trpc as any).asaas?.extratoSyncCancelar?.useMutation?.({
    onSuccess: invalidate,
    onError: (e: any) => toast.error("Erro", { description: e.message }),
  }) || {};
  const ajustarMut = (trpc as any).asaas?.extratoSyncAjustarVelocidade?.useMutation?.({
    onSuccess: () => {
      toast.success("Velocidade ajustada");
      invalidate();
    },
    onError: (e: any) => toast.error("Erro", { description: e.message }),
  }) || {};

  if (!data || data.status === "inativo") return null;

  if (data.status === "concluido") {
    return (
      <div className="rounded-lg border border-green-300 bg-green-50 dark:bg-green-950/30 px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap text-sm">
        <span className="text-green-800 dark:text-green-200 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" />
          <span>
            <strong>Extrato importado por completo.</strong>{" "}
            {data.despesasImportadas} despesa(s)
            {data.duplicadas > 0 ? ` · ${data.duplicadas} duplicadas ignoradas` : ""}
            {data.erros > 0 ? ` · ${data.erros} com erro` : ""}
          </span>
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => cancelarMut.mutate?.()}
        >
          Fechar
        </Button>
      </div>
    );
  }

  const total = data.totalDias ?? 0;
  const feitos = data.diasFeitos ?? 0;
  const restante = Math.max(0, total - feitos);
  const pct = total > 0 ? Math.min(100, (feitos / total) * 100) : 0;
  const intervaloMin = data.intervaloMinutos ?? 10;
  const diasPorTick = data.diasPorTick ?? 7;
  const minutosRestante = Math.ceil((restante / Math.max(1, diasPorTick)) * intervaloMin);
  const horasRestante = Math.floor(minutosRestante / 60);
  const diasRestante = Math.floor(horasRestante / 24);
  const estimativaTexto =
    diasRestante > 1 ? `~${diasRestante} dias` : horasRestante > 1 ? `~${horasRestante}h` : `~${minutosRestante}min`;

  const aguardandoCota =
    data.status === "executando" &&
    data.proximaTentativaEm &&
    new Date(data.proximaTentativaEm).getTime() > Date.now();

  const emAlerta = data.status === "pausado" || data.status === "erro" || aguardandoCota;
  const corStatus = emAlerta ? "border-amber-300 bg-amber-50" : "border-violet-300 bg-violet-50";

  return (
    <Card className={"border " + corStatus}>
      <CardContent className="py-3 space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <RefreshCw
            className={
              "h-4 w-4 " +
              (data.status === "executando" && !aguardandoCota
                ? "animate-spin text-violet-600"
                : "text-amber-600")
            }
          />
          <div className="flex-1 min-w-[200px]">
            <div className="text-sm font-medium">
              {aguardandoCota && "Importando extrato — aguardando cota do Asaas"}
              {!aguardandoCota && data.status === "executando" && "Importando extrato do Asaas"}
              {data.status === "agendado" && "Importação de extrato agendada"}
              {data.status === "pausado" && "Importação de extrato pausada"}
              {data.status === "erro" && "Importação de extrato com erro"}
            </div>
            <div className="text-xs text-muted-foreground">
              {feitos} de {total} dias · {restante} restantes · estimativa {estimativaTexto}
              {aguardandoCota && data.proximaTentativaEm
                ? ` · retoma sozinho às ${new Date(data.proximaTentativaEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
                : ""}
            </div>
            {data.status === "erro" && data.erroMensagem && (
              <div className="text-xs text-red-600 mt-0.5">{data.erroMensagem}</div>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {data.status === "pausado" || data.status === "erro" || aguardandoCota ? (
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => retomarMut.mutate?.()}
                disabled={retomarMut.isPending}
              >
                {aguardandoCota ? "Tentar agora" : "Retomar"}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => pausarMut.mutate?.()}
                disabled={pausarMut.isPending}
              >
                Pausar
              </Button>
            )}
          </div>
        </div>

        <div className="w-full h-1.5 bg-slate-200 rounded overflow-hidden">
          <div
            className={"h-full transition-all " + (emAlerta ? "bg-amber-500" : "bg-violet-500")}
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="flex items-center gap-3 pt-1 border-t flex-wrap text-xs">
          <span className="text-muted-foreground">
            <strong className="text-foreground">{data.despesasImportadas}</strong> despesas novas
          </span>
          <span className="text-muted-foreground">
            <strong className="text-foreground">{data.duplicadas}</strong> duplicadas
          </span>
          {data.erros > 0 && (
            <span className="text-muted-foreground">
              <strong className="text-foreground">{data.erros}</strong> erros pontuais
            </span>
          )}
          {data.cursor && (
            <span className="text-muted-foreground">
              último dia: <strong className="text-foreground">{data.cursor}</strong>
            </span>
          )}
          <span className="ml-auto flex items-center gap-2">
            <span className="font-medium text-muted-foreground">Velocidade:</span>
            <label className="flex items-center gap-1">
              <span className="text-muted-foreground">a cada</span>
              <Select
                value={String(intervaloMin)}
                onValueChange={(v) =>
                  ajustarMut.mutate?.({ intervaloMinutos: Number(v), diasPorTick })
                }
                disabled={ajustarMut.isPending}
              >
                <SelectTrigger className="h-6 text-xs w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5 min</SelectItem>
                  <SelectItem value="10">10 min</SelectItem>
                  <SelectItem value="30">30 min</SelectItem>
                  <SelectItem value="60">60 min</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="flex items-center gap-1">
              <span className="text-muted-foreground">processa</span>
              <Select
                value={String(diasPorTick)}
                onValueChange={(v) =>
                  ajustarMut.mutate?.({ intervaloMinutos: intervaloMin, diasPorTick: Number(v) })
                }
                disabled={ajustarMut.isPending}
              >
                <SelectTrigger className="h-6 text-xs w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 dia</SelectItem>
                  <SelectItem value="7">7 dias</SelectItem>
                  <SelectItem value="15">15 dias</SelectItem>
                  <SelectItem value="30">30 dias</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

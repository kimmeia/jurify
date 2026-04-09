/**
 * MonitoramentoJudit — Aba de monitoramento processual via Judit.IO
 * Usado dentro da página de Processos, disponível para planos que incluem o serviço.
 */

import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Search, Plus, Pause, Play, Trash2, CheckCircle2, Clock, Loader2,
  AlertCircle, Radar, ArrowRight, Building2, Calendar, Scale,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

// ═══════════════════════════════════════════════════════════════════════════════
// STATUS BADGE
// ═══════════════════════════════════════════════════════════════════════════════

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    created: { label: "Aguardando", cls: "bg-blue-500/15 text-blue-700 border-blue-500/25", icon: <Clock className="h-3 w-3 mr-1" /> },
    updating: { label: "Atualizando", cls: "bg-amber-500/15 text-amber-700 border-amber-500/25", icon: <Loader2 className="h-3 w-3 mr-1 animate-spin" /> },
    updated: { label: "Ativo", cls: "bg-emerald-500/15 text-emerald-700 border-emerald-500/25", icon: <CheckCircle2 className="h-3 w-3 mr-1" /> },
    paused: { label: "Pausado", cls: "bg-gray-500/15 text-gray-600 border-gray-500/25", icon: <Pause className="h-3 w-3 mr-1" /> },
  };
  const cfg = map[status] || { label: status, cls: "", icon: null };
  return <Badge className={`${cfg.cls} hover:${cfg.cls} font-normal`}>{cfg.icon}{cfg.label}</Badge>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSULTA + RESULTADO
// ═══════════════════════════════════════════════════════════════════════════════

function ConsultaProcesso({ onMonitorar }: { onMonitorar: (cnj: string) => void }) {
  const [cnj, setCnj] = useState("");
  const [resultado, setResultado] = useState<any>(null);

  const consultarMut = trpc.juditUsuario.consultarProcesso.useMutation({
    onSuccess: (data) => {
      setResultado(data);
      if (data.encontrado) toast.success("Processo encontrado");
      else toast.error(data.mensagem || "Processo não encontrado");
    },
    onError: (err) => toast.error("Erro na consulta", { description: err.message }),
  });

  const processo = resultado?.processo;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          Consultar processo
        </CardTitle>
        <CardDescription>
          Busque um processo por número CNJ em 90+ tribunais. Consome 1 crédito.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="0009999-99.9999.8.26.9999"
            value={cnj}
            onChange={(e) => setCnj(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") consultarMut.mutate({ numeroCnj: cnj.trim() }); }}
            className="font-mono text-sm"
          />
          <Button
            onClick={() => consultarMut.mutate({ numeroCnj: cnj.trim() })}
            disabled={consultarMut.isPending || cnj.trim().length < 20}
          >
            {consultarMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
            Consultar
          </Button>
        </div>

        {consultarMut.isPending && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
            <Loader2 className="h-4 w-4 animate-spin" />
            Consultando tribunais (pode levar até 30s)...
          </div>
        )}

        {resultado && !resultado.encontrado && !consultarMut.isPending && (
          <div className="flex items-start gap-2 text-sm text-destructive p-3 rounded-lg bg-destructive/5">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{resultado.mensagem}</span>
          </div>
        )}

        {processo && (
          <div className="border rounded-lg p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-mono text-sm font-medium">{processo.code}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{processo.name}</p>
              </div>
              <Badge variant="outline">{processo.tribunal_acronym}</Badge>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              {processo.distribution_date && (
                <div className="flex items-center gap-1.5">
                  <Calendar className="h-3 w-3 text-muted-foreground" />
                  <span className="text-muted-foreground">Distribuição:</span>
                  <span>{new Date(processo.distribution_date).toLocaleDateString("pt-BR")}</span>
                </div>
              )}
              {processo.area && (
                <div className="flex items-center gap-1.5">
                  <Scale className="h-3 w-3 text-muted-foreground" />
                  <span>{processo.area}</span>
                </div>
              )}
              {processo.county && (
                <div className="flex items-center gap-1.5">
                  <Building2 className="h-3 w-3 text-muted-foreground" />
                  <span className="truncate">{processo.county}</span>
                </div>
              )}
              {processo.status && (
                <div>
                  <span className="text-muted-foreground">Status: </span>
                  <span>{processo.status}</span>
                </div>
              )}
            </div>

            {processo.last_step && (
              <div className="pt-2 border-t">
                <p className="text-xs text-muted-foreground">
                  Última movimentação ({processo.last_step.step_date ? new Date(processo.last_step.step_date).toLocaleDateString("pt-BR") : ""}):
                </p>
                <p className="text-xs mt-0.5">{processo.last_step.content}</p>
              </div>
            )}

            {processo.subjects && processo.subjects.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {processo.subjects.slice(0, 4).map((s: any, i: number) => (
                  <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{s.name}</span>
                ))}
              </div>
            )}

            <Button size="sm" onClick={() => onMonitorar(processo.code)} className="mt-1">
              <Radar className="h-3.5 w-3.5 mr-1.5" />
              Monitorar este processo
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DIALOG CRIAR MONITORAMENTO
// ═══════════════════════════════════════════════════════════════════════════════

function CriarDialog({
  cnjInicial, open, onOpenChange, onSuccess,
}: {
  cnjInicial: string; open: boolean; onOpenChange: (o: boolean) => void; onSuccess: () => void;
}) {
  const [cnj, setCnj] = useState(cnjInicial);
  const [apelido, setApelido] = useState("");
  const [credencialId, setCredencialId] = useState<string>("");

  // Credenciais do cofre
  const { data: credenciais } = (trpc as any).juditCredenciais?.listar?.useQuery?.(undefined, { retry: false }) || { data: undefined };
  const credsAtivas = (credenciais || []).filter((c: any) => c.status === "ativa" || c.status === "validando");

  const criarMut = trpc.juditUsuario.criarMonitoramento.useMutation({
    onSuccess: (data) => {
      toast.success(data.mensagem);
      onOpenChange(false);
      setCnj("");
      setApelido("");
      setCredencialId("");
      onSuccess();
    },
    onError: (err: any) => toast.error("Erro", { description: err.message }),
  });

  if (cnjInicial && cnjInicial !== cnj && open) setCnj(cnjInicial);

  const semCredenciais = !credsAtivas || credsAtivas.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo monitoramento</DialogTitle>
          <DialogDescription>
            O processo será monitorado diariamente. Requer credencial OAB cadastrada no Cofre (LGPD).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label className="text-sm font-medium">Número CNJ</label>
            <Input placeholder="0009999-99.9999.8.26.9999" value={cnj} onChange={(e) => setCnj(e.target.value)} className="font-mono text-sm mt-1" />
          </div>
          <div>
            <label className="text-sm font-medium">Apelido (opcional)</label>
            <Input placeholder="Ex: Indenização do João" value={apelido} onChange={(e) => setApelido(e.target.value)} className="mt-1" />
          </div>
          {semCredenciais ? (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
              <p className="font-semibold">Credencial OAB necessária</p>
              <p className="mt-0.5">Cadastre uma credencial de advogado no Cofre de Credenciais para poder monitorar processos.</p>
            </div>
          ) : (
            <div>
              <label className="text-sm font-medium">Credencial OAB *</label>
              <select
                value={credencialId}
                onChange={(e) => setCredencialId(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm mt-1"
              >
                <option value="">Selecione a credencial</option>
                {credsAtivas.map((c: any) => (
                  <option key={c.id} value={String(c.id)}>{c.customerKey} ({c.username})</option>
                ))}
              </select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            onClick={() => criarMut.mutate({ numeroCnj: cnj.trim(), credencialId: Number(credencialId), apelido: apelido || undefined })}
            disabled={criarMut.isPending || cnj.trim().length < 20 || !credencialId}
          >
            {criarMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
            Monitorar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CARD DE MONITORAMENTO
// ═══════════════════════════════════════════════════════════════════════════════

function MonitoramentoCard({ mon, onRefresh }: { mon: any; onRefresh: () => void }) {
  const isAtivo = ["created", "updating", "updated"].includes(mon.statusJudit);

  const pausarMut = trpc.juditUsuario.pausar.useMutation({
    onSuccess: () => { toast.success("Pausado"); onRefresh(); },
    onError: (err) => toast.error(err.message),
  });

  const reativarMut = trpc.juditUsuario.reativar.useMutation({
    onSuccess: () => { toast.success("Reativado"); onRefresh(); },
    onError: (err) => toast.error(err.message),
  });

  const deletarMut = trpc.juditUsuario.deletar.useMutation({
    onSuccess: () => { toast.success("Removido"); onRefresh(); },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Card className="transition-all hover:shadow-sm">
      <CardContent className="py-4 px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <p className="font-mono text-xs font-medium">{mon.searchKey}</p>
              <StatusBadge status={mon.statusJudit} />
            </div>
            {mon.apelido && <p className="text-sm text-foreground">{mon.apelido}</p>}
            {mon.nomePartes && <p className="text-xs text-muted-foreground truncate">{mon.nomePartes}</p>}
            {mon.tribunal && (
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{mon.tribunal}</span>
                {mon.totalAtualizacoes > 0 && <span>{mon.totalAtualizacoes} atualização{mon.totalAtualizacoes !== 1 ? "ões" : ""}</span>}
              </div>
            )}
            {mon.ultimaMovimentacao && (
              <div className="pt-1.5 border-t mt-2">
                <p className="text-[10px] text-muted-foreground">
                  Última mov. ({mon.ultimaMovimentacaoData ? new Date(mon.ultimaMovimentacaoData).toLocaleDateString("pt-BR") : ""}):
                </p>
                <p className="text-xs mt-0.5 line-clamp-2">{mon.ultimaMovimentacao}</p>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {isAtivo && (
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => pausarMut.mutate({ id: mon.id })} disabled={pausarMut.isPending} title="Pausar">
                <Pause className="h-3.5 w-3.5" />
              </Button>
            )}
            {mon.statusJudit === "paused" && (
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => reativarMut.mutate({ id: mon.id })} disabled={reativarMut.isPending} title="Reativar">
                <Play className="h-3.5 w-3.5" />
              </Button>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive" title="Remover">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remover monitoramento?</AlertDialogTitle>
                  <AlertDialogDescription>
                    O processo {mon.searchKey} não será mais monitorado e você deixará de receber atualizações.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => deletarMut.mutate({ id: mon.id })} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    Remover
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL (exportado)
// ═══════════════════════════════════════════════════════════════════════════════

export default function MonitoramentoJudit() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [cnjParaMonitorar, setCnjParaMonitorar] = useState("");

  const { data: statusJudit } = trpc.juditUsuario.status.useQuery(undefined, { retry: false });
  const { data: monitoramentos, isLoading, refetch } = trpc.juditUsuario.meusMonitoramentos.useQuery(undefined, { retry: false, enabled: statusJudit?.disponivel });

  if (!statusJudit?.disponivel) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
          <div className="h-12 w-12 rounded-2xl bg-muted flex items-center justify-center">
            <Radar className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="text-center">
            <p className="font-medium">Monitoramento processual avançado</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              {!statusJudit?.juditConectado
                ? "Serviço indisponível no momento."
                : "Faça upgrade do seu plano para monitorar processos em tempo real em 90+ tribunais."
              }
            </p>
          </div>
          {statusJudit?.juditConectado && !statusJudit?.planoPermite && (
            <Button variant="outline" size="sm" onClick={() => window.location.href = "/plans"}>
              <ArrowRight className="h-3.5 w-3.5 mr-1.5" />
              Ver planos
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  const handleMonitorar = (cnj: string) => {
    setCnjParaMonitorar(cnj);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-4">
      {/* Info bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/25 hover:bg-emerald-500/15 text-[10px] font-normal">
            <Radar className="h-3 w-3 mr-1" />Judit.IO
          </Badge>
          <span>
            {statusJudit.monitoramentosAtivos} de {statusJudit.maxMonitoramentos >= 999999 ? "ilimitado" : statusJudit.maxMonitoramentos} monitoramentos
          </span>
        </div>
        <Button size="sm" onClick={() => { setCnjParaMonitorar(""); setDialogOpen(true); }}>
          <Plus className="h-4 w-4 mr-1.5" />
          Novo monitoramento
        </Button>
      </div>

      {/* Consulta avulsa */}
      <ConsultaProcesso onMonitorar={handleMonitorar} />

      {/* Lista de monitoramentos */}
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : monitoramentos && monitoramentos.length > 0 ? (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground">Meus monitoramentos</h3>
          {monitoramentos.map((mon) => (
            <MonitoramentoCard key={mon.id} mon={mon} onRefresh={() => refetch()} />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-10 gap-2">
            <Radar className="h-8 w-8 text-muted-foreground opacity-30" />
            <p className="text-sm text-muted-foreground">Nenhum monitoramento ativo. Consulte um processo acima e clique em "Monitorar".</p>
          </CardContent>
        </Card>
      )}

      {/* Dialog */}
      <CriarDialog
        cnjInicial={cnjParaMonitorar}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSuccess={() => refetch()}
      />
    </div>
  );
}

import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Search, Plus, Pause, Play, Trash2, RefreshCw, Activity, Eye, Loader2,
  AlertCircle, CheckCircle2, Clock, Radar, BarChart3,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

// ═══════════════════════════════════════════════════════════════════════════════
// STATUS BADGE
// ═══════════════════════════════════════════════════════════════════════════════

function TrackingStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    created: { label: "Criado", cls: "bg-blue-500/15 text-blue-700 border-blue-500/25", icon: <Clock className="h-3 w-3 mr-1" /> },
    updating: { label: "Atualizando", cls: "bg-amber-500/15 text-amber-700 border-amber-500/25", icon: <RefreshCw className="h-3 w-3 mr-1 animate-spin" /> },
    updated: { label: "Ativo", cls: "bg-emerald-500/15 text-emerald-700 border-emerald-500/25", icon: <CheckCircle2 className="h-3 w-3 mr-1" /> },
    paused: { label: "Pausado", cls: "bg-gray-500/15 text-gray-600 border-gray-500/25", icon: <Pause className="h-3 w-3 mr-1" /> },
    deleted: { label: "Deletado", cls: "bg-red-500/15 text-red-700 border-red-500/25", icon: <Trash2 className="h-3 w-3 mr-1" /> },
  };
  const cfg = map[status] || { label: status, cls: "", icon: null };
  return <Badge className={`${cfg.cls} hover:${cfg.cls} font-normal`}>{cfg.icon}{cfg.label}</Badge>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSULTA AVULSA
// ═══════════════════════════════════════════════════════════════════════════════

function ConsultaProcesso({ onMonitorar }: { onMonitorar: (cnj: string) => void }) {
  const [cnj, setCnj] = useState("");
  const [resultado, setResultado] = useState<any>(null);

  const consultarMut = trpc.juditOperacoes.consultarProcesso.useMutation({
    onSuccess: (data) => {
      setResultado(data);
      if (data.encontrado) {
        toast.success("Processo encontrado");
      } else {
        toast.error(data.mensagem || "Processo não encontrado");
      }
    },
    onError: (err) => toast.error("Erro na consulta", { description: err.message }),
  });

  const handleConsultar = () => {
    if (!cnj.trim() || cnj.trim().length < 20) {
      toast.error("Insira um número CNJ válido (ex: 0009999-99.9999.8.26.9999)");
      return;
    }
    setResultado(null);
    consultarMut.mutate({ numeroCnj: cnj.trim() });
  };

  const processo = resultado?.processo;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          Consulta processual
        </CardTitle>
        <CardDescription>
          Busque um processo por número CNJ diretamente nos tribunais via Judit.IO.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="0009999-99.9999.8.26.9999"
            value={cnj}
            onChange={(e) => setCnj(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleConsultar(); }}
            className="font-mono text-sm"
          />
          <Button onClick={handleConsultar} disabled={consultarMut.isPending}>
            {consultarMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
            Consultar
          </Button>
        </div>

        {consultarMut.isPending && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            Consultando tribunais via Judit.IO (pode levar até 30s)...
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
                <p className="font-medium text-sm">{processo.code}</p>
                <p className="text-xs text-muted-foreground">{processo.name}</p>
              </div>
              <Badge variant="outline">{processo.tribunal_acronym}</Badge>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div>
                <span className="text-muted-foreground">Distribuição: </span>
                <span>{processo.distribution_date ? new Date(processo.distribution_date).toLocaleDateString("pt-BR") : "—"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Instância: </span>
                <span>{processo.instance}ª</span>
              </div>
              <div>
                <span className="text-muted-foreground">Status: </span>
                <span>{processo.status || "—"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Área: </span>
                <span>{processo.area || processo.justice_description || "—"}</span>
              </div>
              {processo.amount && (
                <div>
                  <span className="text-muted-foreground">Valor: </span>
                  <span>R$ {processo.amount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
                </div>
              )}
              {processo.judge && (
                <div>
                  <span className="text-muted-foreground">Juiz: </span>
                  <span>{processo.judge}</span>
                </div>
              )}
            </div>

            {processo.last_step && (
              <div className="pt-2 border-t">
                <p className="text-xs text-muted-foreground mb-1">Última movimentação ({processo.last_step.step_date ? new Date(processo.last_step.step_date).toLocaleDateString("pt-BR") : ""}):</p>
                <p className="text-xs">{processo.last_step.content}</p>
              </div>
            )}

            {processo.subjects && processo.subjects.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {processo.subjects.slice(0, 5).map((s: any, i: number) => (
                  <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{s.name}</span>
                ))}
              </div>
            )}

            <Button size="sm" className="mt-2" onClick={() => onMonitorar(processo.code)}>
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

function CriarMonitoramentoDialog({
  cnjInicial,
  open,
  onOpenChange,
  onSuccess,
}: {
  cnjInicial: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSuccess: () => void;
}) {
  const [cnj, setCnj] = useState(cnjInicial);
  const [apelido, setApelido] = useState("");
  const [recurrence, setRecurrence] = useState(1);

  const criarMut = trpc.juditOperacoes.criarMonitoramento.useMutation({
    onSuccess: (data) => {
      toast.success(data.mensagem);
      onOpenChange(false);
      setCnj("");
      setApelido("");
      onSuccess();
    },
    onError: (err) => toast.error("Erro ao criar monitoramento", { description: err.message }),
  });

  // Sync cnjInicial when it changes
  if (cnjInicial && cnjInicial !== cnj && open) {
    setCnj(cnjInicial);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo monitoramento</DialogTitle>
          <DialogDescription>
            A Judit.IO irá consultar este processo diariamente nos tribunais.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label className="text-sm font-medium">Número CNJ</label>
            <Input
              placeholder="0009999-99.9999.8.26.9999"
              value={cnj}
              onChange={(e) => setCnj(e.target.value)}
              className="font-mono text-sm mt-1"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Apelido (opcional)</label>
            <Input
              placeholder="Ex: Processo do João — Indenização"
              value={apelido}
              onChange={(e) => setApelido(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Recorrência (dias)</label>
            <Input
              type="number"
              min={1}
              max={30}
              value={recurrence}
              onChange={(e) => setRecurrence(Number(e.target.value))}
              className="mt-1 w-24"
            />
            <p className="text-xs text-muted-foreground mt-1">
              A cada quantos dias a Judit deve verificar atualizações (1 = diário).
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => criarMut.mutate({ numeroCnj: cnj.trim(), recurrence, apelido: apelido || undefined })} disabled={criarMut.isPending || !cnj.trim()}>
            {criarMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
            Criar monitoramento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TABELA DE MONITORAMENTOS
// ═══════════════════════════════════════════════════════════════════════════════

function TabelaMonitoramentos({ onRefresh, refreshKey }: { onRefresh: () => void; refreshKey: number }) {
  const { data, isLoading, refetch } = trpc.juditOperacoes.listarMonitoramentos.useQuery(
    { status: "todos", pageSize: 50 },
    { retry: false }
  );

  const pausarMut = trpc.juditOperacoes.pausarMonitoramento.useMutation({
    onSuccess: () => { toast.success("Monitoramento pausado"); refetch(); },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  const reativarMut = trpc.juditOperacoes.reativarMonitoramento.useMutation({
    onSuccess: () => { toast.success("Monitoramento reativado"); refetch(); },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  const deletarMut = trpc.juditOperacoes.deletarMonitoramento.useMutation({
    onSuccess: () => { toast.success("Monitoramento removido"); refetch(); onRefresh(); },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  const syncMut = trpc.juditOperacoes.sincronizarStatus.useMutation({
    onSuccess: (data) => {
      toast.success(`Sincronizado: ${data.atualizados} de ${data.total} atualizados`);
      refetch();
    },
    onError: (err) => toast.error("Erro ao sincronizar", { description: err.message }),
  });

  // Refetch when parent signals
  if (refreshKey > 0) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
  }

  const items = data?.items ?? [];
  const isAtivo = (s: string) => ["created", "updating", "updated"].includes(s);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Radar className="h-4 w-4 text-muted-foreground" />
              Monitoramentos ativos
            </CardTitle>
            <CardDescription>
              Processos sendo monitorados diariamente via Judit.IO.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => syncMut.mutate()} disabled={syncMut.isPending}>
            {syncMut.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
            Sincronizar
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Radar className="h-10 w-10 mb-3 opacity-30" />
            <p className="text-sm font-medium text-foreground mb-1">Nenhum monitoramento</p>
            <p className="text-xs">Consulte um processo acima e clique em "Monitorar".</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Processo</TableHead>
                <TableHead>Tribunal</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Última mov.</TableHead>
                <TableHead>Atualizações</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((mon) => (
                <TableRow key={mon.id}>
                  <TableCell>
                    <div>
                      <p className="font-mono text-xs">{mon.searchKey}</p>
                      {mon.apelido && <p className="text-xs text-muted-foreground">{mon.apelido}</p>}
                      {mon.nomePartes && <p className="text-[10px] text-muted-foreground truncate max-w-[200px]">{mon.nomePartes}</p>}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{mon.tribunal || "—"}</TableCell>
                  <TableCell><TrackingStatusBadge status={mon.statusJudit} /></TableCell>
                  <TableCell>
                    <div className="max-w-[180px]">
                      {mon.ultimaMovimentacao ? (
                        <>
                          <p className="text-xs truncate">{mon.ultimaMovimentacao}</p>
                          {mon.ultimaMovimentacaoData && (
                            <p className="text-[10px] text-muted-foreground">
                              {new Date(mon.ultimaMovimentacaoData).toLocaleDateString("pt-BR")}
                            </p>
                          )}
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">Aguardando...</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-center">{mon.totalAtualizacoes}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {isAtivo(mon.statusJudit) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => pausarMut.mutate({ id: mon.id })}
                          disabled={pausarMut.isPending}
                          title="Pausar"
                        >
                          <Pause className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {mon.statusJudit === "paused" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => reativarMut.mutate({ id: mon.id })}
                          disabled={reativarMut.isPending}
                          title="Reativar"
                        >
                          <Play className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive" title="Deletar">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Deletar monitoramento?</AlertDialogTitle>
                            <AlertDialogDescription>
                              O monitoramento de {mon.searchKey} será removido da Judit.IO e não receberá mais atualizações. O histórico local será mantido.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deletarMut.mutate({ id: mon.id })}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Deletar
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PÁGINA PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════

export default function AdminJuditPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [cnjParaMonitorar, setCnjParaMonitorar] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const { data: stats, isLoading: statsLoading } = trpc.juditOperacoes.stats.useQuery(undefined, { retry: false });

  const handleMonitorar = (cnj: string) => {
    setCnjParaMonitorar(cnj);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Judit.IO — Monitoramento
          </h1>
          <p className="text-muted-foreground mt-1">
            Consulte e monitore processos em 90+ tribunais via Judit.IO.
          </p>
        </div>
        <Button onClick={() => { setCnjParaMonitorar(""); setDialogOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" />
          Novo monitoramento
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <Activity className="h-4 w-4 text-emerald-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Ativos</p>
                {statsLoading ? <Skeleton className="h-6 w-8" /> : <p className="text-xl font-bold">{stats?.ativos ?? 0}</p>}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-gray-500/10 flex items-center justify-center">
                <Pause className="h-4 w-4 text-gray-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Pausados</p>
                {statsLoading ? <Skeleton className="h-6 w-8" /> : <p className="text-xl font-bold">{stats?.pausados ?? 0}</p>}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Radar className="h-4 w-4 text-blue-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total</p>
                {statsLoading ? <Skeleton className="h-6 w-8" /> : <p className="text-xl font-bold">{stats?.total ?? 0}</p>}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-violet-500/10 flex items-center justify-center">
                <BarChart3 className="h-4 w-4 text-violet-500" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Atualizações</p>
                {statsLoading ? <Skeleton className="h-6 w-8" /> : <p className="text-xl font-bold">{stats?.totalRespostas ?? 0}</p>}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Consulta avulsa */}
      <ConsultaProcesso onMonitorar={handleMonitorar} />

      {/* Tabela de monitoramentos */}
      <TabelaMonitoramentos onRefresh={() => setRefreshKey((k) => k + 1)} refreshKey={refreshKey} />

      {/* Dialog criar monitoramento */}
      <CriarMonitoramentoDialog
        cnjInicial={cnjParaMonitorar}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSuccess={() => setRefreshKey((k) => k + 1)}
      />
    </div>
  );
}

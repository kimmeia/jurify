import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle, Search, XCircle, Loader2, TrendingDown, DollarSign, Users2, Gift } from "lucide-react";
import { useState, useMemo } from "react";
import { toast } from "sonner";

function SubscriptionStatusBadge({ status }: { status: string }) {
  const variants: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    active: { label: "Ativa", variant: "default" },
    trialing: { label: "Trial", variant: "secondary" },
    canceled: { label: "Cancelada", variant: "destructive" },
    past_due: { label: "Vencida", variant: "destructive" },
    incomplete: { label: "Incompleta", variant: "outline" },
    unpaid: { label: "Não paga", variant: "destructive" },
    paused: { label: "Pausada", variant: "secondary" },
  };
  const config = variants[status] || { label: status, variant: "outline" as const };
  return <Badge variant={config.variant} className="text-[10px]">{config.label}</Badge>;
}

export default function AdminSubscriptions() {
  const { data: allSubs, isLoading, refetch } = trpc.admin.allSubscriptions.useQuery(undefined, {
    retry: false,
  });

  const { data: stats } = trpc.admin.stats.useQuery(undefined, { retry: false });

  const [busca, setBusca] = useState("");
  const [statusFiltro, setStatusFiltro] = useState<string>("all");
  const [cancelarSub, setCancelarSub] = useState<any | null>(null);
  const [motivoCancelamento, setMotivoCancelamento] = useState("");
  const [cortesiaSub, setCortesiaSub] = useState<any | null>(null);
  const [motivoCortesia, setMotivoCortesia] = useState("");
  const [expiraEm, setExpiraEm] = useState<string>("");
  const [removerCortesiaSub, setRemoverCortesiaSub] = useState<any | null>(null);
  const [motivoRemocaoCortesia, setMotivoRemocaoCortesia] = useState("");

  const cancelarMut = trpc.admin.cancelarAssinaturaAdmin.useMutation({
    onSuccess: () => {
      toast.success("Assinatura cancelada");
      setCancelarSub(null);
      setMotivoCancelamento("");
      refetch();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  const marcarCortesiaMut = trpc.admin.marcarCortesia.useMutation({
    onSuccess: () => {
      toast.success("Cortesia ativada");
      setCortesiaSub(null);
      setMotivoCortesia("");
      setExpiraEm("");
      refetch();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  const removerCortesiaMut = trpc.admin.removerCortesia.useMutation({
    onSuccess: () => {
      toast.success("Cortesia removida");
      setRemoverCortesiaSub(null);
      setMotivoRemocaoCortesia("");
      refetch();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  const formatCurrency = (cents: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

  const filtradas = useMemo(() => {
    if (!allSubs) return [];
    return allSubs.filter((s) => {
      if (statusFiltro !== "all" && s.status !== statusFiltro) return false;
      if (busca.trim()) {
        const b = busca.toLowerCase();
        const nome = (s.userName || "").toLowerCase();
        const plano = (s.planName || "").toLowerCase();
        if (!nome.includes(b) && !plano.includes(b)) return false;
      }
      return true;
    });
  }, [allSubs, busca, statusFiltro]);

  const mrr = stats?.mrr ?? 0;
  const ativas = stats?.activeSubscriptions ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Assinaturas</h1>
        <p className="text-muted-foreground mt-1">
          Acompanhe e gerencie todas as assinaturas da plataforma.
        </p>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <DollarSign className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">MRR</p>
                <p className="text-2xl font-bold">{formatCurrency(mrr)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Users2 className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Ativas</p>
                <p className="text-2xl font-bold">{ativas}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <TrendingDown className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Vencidas</p>
                <p className="text-2xl font-bold">
                  {allSubs?.filter((s) => s.status === "past_due").length ?? 0}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="text-base">Todas as assinaturas</CardTitle>
              <CardDescription>
                {filtradas.length} {filtradas.length === 1 ? "assinatura" : "assinaturas"}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por cliente ou plano..."
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  className="pl-9 text-sm"
                />
              </div>
              <Select value={statusFiltro} onValueChange={setStatusFiltro}>
                <SelectTrigger className="w-[140px] text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="active">Ativas</SelectItem>
                  <SelectItem value="trialing">Trial</SelectItem>
                  <SelectItem value="past_due">Vencidas</SelectItem>
                  <SelectItem value="canceled">Canceladas</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : filtradas.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Plano</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Válida até</TableHead>
                  <TableHead>Criada em</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtradas.map((sub) => (
                  <TableRow key={sub.id}>
                    <TableCell className="font-medium">{sub.userName || "—"}</TableCell>
                    <TableCell>{sub.planName || "—"}</TableCell>
                    <TableCell>{sub.priceAmount ? formatCurrency(sub.priceAmount) : "—"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <SubscriptionStatusBadge status={sub.status} />
                        {sub.cortesia && (
                          <Badge
                            variant="outline"
                            className="text-[10px] border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
                            title={
                              sub.cortesiaMotivo
                                ? `Cortesia: ${sub.cortesiaMotivo}${
                                    sub.cortesiaExpiraEm
                                      ? ` (expira ${new Date(sub.cortesiaExpiraEm).toLocaleDateString("pt-BR")})`
                                      : ""
                                  }`
                                : "Cortesia"
                            }
                          >
                            <Gift className="h-2.5 w-2.5 mr-0.5" />
                            Cortesia
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {sub.currentPeriodEnd
                        ? new Date(sub.currentPeriodEnd).toLocaleDateString("pt-BR")
                        : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(sub.createdAt).toLocaleDateString("pt-BR")}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {sub.cortesia ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-amber-700 hover:text-amber-800 dark:text-amber-400"
                            onClick={() => setRemoverCortesiaSub(sub)}
                          >
                            <Gift className="h-3 w-3 mr-1" />
                            Remover cortesia
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-emerald-700 hover:text-emerald-800 dark:text-emerald-400"
                            onClick={() => setCortesiaSub(sub)}
                          >
                            <Gift className="h-3 w-3 mr-1" />
                            Cortesia
                          </Button>
                        )}
                        {(sub.status === "active" || sub.status === "trialing" || sub.status === "past_due") && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-destructive hover:text-destructive"
                            onClick={() => setCancelarSub(sub)}
                          >
                            <XCircle className="h-3 w-3 mr-1" />
                            Cancelar
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <AlertCircle className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">
                {busca || statusFiltro !== "all"
                  ? "Nenhuma assinatura para os filtros."
                  : "Nenhuma assinatura encontrada."}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!cancelarSub} onOpenChange={(o) => { if (!o) setCancelarSub(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar assinatura?</AlertDialogTitle>
            <AlertDialogDescription>
              Vai cancelar a assinatura de <strong>{cancelarSub?.userName}</strong>
              {" "}(plano {cancelarSub?.planName}) no Asaas E localmente. Esta ação
              não pode ser desfeita — o cliente terá que criar uma nova assinatura.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            placeholder="Motivo do cancelamento (auditável)"
            value={motivoCancelamento}
            onChange={(e) => setMotivoCancelamento(e.target.value)}
            rows={2}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={motivoCancelamento.trim().length < 3 || cancelarMut.isPending}
              onClick={() => {
                if (!cancelarSub) return;
                cancelarMut.mutate({
                  subscriptionId: cancelarSub.id,
                  motivo: motivoCancelamento.trim(),
                });
              }}
            >
              {cancelarMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Confirmar cancelamento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!cortesiaSub} onOpenChange={(o) => { if (!o) { setCortesiaSub(null); setMotivoCortesia(""); setExpiraEm(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Marcar como cortesia?</AlertDialogTitle>
            <AlertDialogDescription>
              Vai liberar acesso pra <strong>{cortesiaSub?.userName}</strong>
              {" "}(plano {cortesiaSub?.planName}) sem mexer no Asaas. Útil pra
              cliente piloto ou isenção pontual. Pode remover a qualquer momento.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <Textarea
              placeholder="Motivo (auditável). Ex: 'Cliente piloto, parceria março/abril'"
              value={motivoCortesia}
              onChange={(e) => setMotivoCortesia(e.target.value)}
              rows={2}
            />
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                Expira em (opcional — deixe em branco pra cortesia sem prazo)
              </label>
              <Input
                type="date"
                value={expiraEm}
                onChange={(e) => setExpiraEm(e.target.value)}
                min={new Date().toISOString().slice(0, 10)}
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={motivoCortesia.trim().length < 3 || marcarCortesiaMut.isPending}
              onClick={() => {
                if (!cortesiaSub) return;
                const expira = expiraEm ? new Date(expiraEm + "T23:59:59").getTime() : undefined;
                marcarCortesiaMut.mutate({
                  subscriptionId: cortesiaSub.id,
                  motivo: motivoCortesia.trim(),
                  expiraEm: expira,
                });
              }}
            >
              {marcarCortesiaMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Ativar cortesia
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!removerCortesiaSub} onOpenChange={(o) => { if (!o) { setRemoverCortesiaSub(null); setMotivoRemocaoCortesia(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover cortesia?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{removerCortesiaSub?.userName}</strong> vai voltar a depender
              do status real da assinatura (atual: <code>{removerCortesiaSub?.status}</code>).
              Se a sub estiver canceled/past_due, o cliente perde acesso.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            placeholder="Motivo da remoção (auditável)"
            value={motivoRemocaoCortesia}
            onChange={(e) => setMotivoRemocaoCortesia(e.target.value)}
            rows={2}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 hover:bg-amber-700 text-white"
              disabled={motivoRemocaoCortesia.trim().length < 3 || removerCortesiaMut.isPending}
              onClick={() => {
                if (!removerCortesiaSub) return;
                removerCortesiaMut.mutate({
                  subscriptionId: removerCortesiaSub.id,
                  motivo: motivoRemocaoCortesia.trim(),
                });
              }}
            >
              {removerCortesiaMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Remover cortesia
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

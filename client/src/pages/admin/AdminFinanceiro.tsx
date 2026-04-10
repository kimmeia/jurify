import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  DollarSign, TrendingUp, AlertTriangle, Clock, ExternalLink, RefreshCw,
  Loader2, Wallet, Receipt, Repeat, Search, XCircle, ArrowUpRight, CheckCircle2,
  Hourglass, Ban, Coins,
} from "lucide-react";
import { toast } from "sonner";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";

function formatBRL(cents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

function formatMes(yyyymm: string) {
  const [y, m] = yyyymm.split("-");
  const mesesBR = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  return `${mesesBR[parseInt(m, 10) - 1]}/${y.slice(2)}`;
}

function StatusPagamentoBadge({ status }: { status: string }) {
  const cfg: Record<string, { label: string; cls: string; icon: any }> = {
    PENDING:    { label: "Pendente", cls: "bg-amber-500/15 text-amber-700 border-amber-500/30", icon: Hourglass },
    RECEIVED:   { label: "Pago",     cls: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30", icon: CheckCircle2 },
    CONFIRMED:  { label: "Confirmado", cls: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30", icon: CheckCircle2 },
    OVERDUE:    { label: "Vencida",  cls: "bg-red-500/15 text-red-700 border-red-500/30", icon: AlertTriangle },
    REFUNDED:   { label: "Estornado", cls: "bg-slate-500/15 text-slate-700 border-slate-500/30", icon: Ban },
    RECEIVED_IN_CASH: { label: "Recebido", cls: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30", icon: CheckCircle2 },
  };
  const c = cfg[status] || { label: status, cls: "bg-slate-500/15 text-slate-700", icon: Clock };
  const Icon = c.icon;
  return (
    <Badge className={`${c.cls} text-[10px]`}>
      <Icon className="h-2.5 w-2.5 mr-1" />
      {c.label}
    </Badge>
  );
}

function StatusSubBadge({ status }: { status: string }) {
  if (status === "ACTIVE") {
    return <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30 text-[10px]">Ativa</Badge>;
  }
  if (status === "EXPIRED" || status === "INACTIVE") {
    return <Badge variant="outline" className="text-[10px]">Cancelada</Badge>;
  }
  return <Badge variant="outline" className="text-[10px]">{status}</Badge>;
}

export default function AdminFinanceiro() {
  const [tab, setTab] = useState("visao");
  const [filtroStatus, setFiltroStatus] = useState<string>("todos");
  const [busca, setBusca] = useState("");
  const [cancelPgto, setCancelPgto] = useState<any>(null);
  const [cancelSub, setCancelSub] = useState<any>(null);
  const [motivoCancel, setMotivoCancel] = useState("");

  const utils = trpc.useUtils();

  const { data: status, isLoading: loadStatus } = trpc.adminFinanceiro.status.useQuery();
  const { data: kpis, refetch: refetchKpis } = trpc.adminFinanceiro.kpis.useQuery(undefined, {
    enabled: status?.conectado,
  });
  const { data: pagamentos, isLoading: loadPag, refetch: refetchPag } =
    trpc.adminFinanceiro.listarPagamentos.useQuery(
      { status: filtroStatus !== "todos" ? filtroStatus as any : undefined, limit: 100 },
      { enabled: status?.conectado },
    );
  const { data: assinaturas, refetch: refetchSubs } =
    trpc.adminFinanceiro.listarAssinaturas.useQuery(undefined, { enabled: status?.conectado });
  const { data: cashFlow } = trpc.adminFinanceiro.cashFlowMensal.useQuery(
    { meses: 6 },
    { enabled: status?.conectado },
  );

  // Judit credit KPIs (tempo real)
  const { data: juditKpis } = (trpc as any).adminJudit.kpis.useQuery(undefined, { refetchInterval: 30000 });

  const refetchAll = () => {
    refetchKpis();
    refetchPag();
    refetchSubs();
    utils.adminFinanceiro.cashFlowMensal.invalidate();
  };

  const cancelPgtoMut = trpc.adminFinanceiro.cancelarPagamento.useMutation({
    onSuccess: () => {
      toast.success("Cobrança cancelada");
      setCancelPgto(null);
      setMotivoCancel("");
      refetchAll();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  const cancelSubMut = trpc.adminFinanceiro.cancelarAssinaturaPorAsaasId.useMutation({
    onSuccess: () => {
      toast.success("Assinatura cancelada");
      setCancelSub(null);
      setMotivoCancel("");
      refetchAll();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  const pagamentosFiltrados = useMemo(() => {
    if (!pagamentos) return [];
    if (!busca.trim()) return pagamentos;
    const b = busca.toLowerCase();
    return pagamentos.filter((p) =>
      (p.userName || "").toLowerCase().includes(b) ||
      (p.userEmail || "").toLowerCase().includes(b) ||
      (p.description || "").toLowerCase().includes(b) ||
      p.id.toLowerCase().includes(b),
    );
  }, [pagamentos, busca]);

  // Não conectado: mostra aviso
  if (loadStatus) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-4 gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      </div>
    );
  }

  if (!status?.conectado) {
    return (
      <div className="space-y-6">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-emerald-100 to-green-100 dark:from-emerald-900/40 dark:to-green-900/40">
            <DollarSign className="h-6 w-6 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Financeiro SaaS</h1>
            <p className="text-muted-foreground mt-1">
              Gestão da cobrança dos escritórios assinantes do Jurify.
            </p>
          </div>
        </div>

        <Card className="border-amber-500/30 bg-amber-50/30 dark:bg-amber-950/10">
          <CardContent className="pt-6 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-foreground">
                Asaas não configurado
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Configure a integração do Asaas em{" "}
                <a href="/admin/integrations" className="underline text-foreground">
                  /admin/integrations
                </a>{" "}
                antes de usar o módulo financeiro.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-emerald-100 to-green-100 dark:from-emerald-900/40 dark:to-green-900/40">
            <DollarSign className="h-6 w-6 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Financeiro SaaS</h1>
            <p className="text-muted-foreground mt-1">
              Gestão da cobrança dos escritórios assinantes do Jurify.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={refetchAll}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Atualizar
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm text-muted-foreground">MRR</CardTitle>
            <DollarSign className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatBRL(kpis?.mrr ?? 0)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {kpis?.assinaturasAtivas ?? 0} assinaturas ativas
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm text-muted-foreground">Recebido 30d</CardTitle>
            <TrendingUp className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatBRL(kpis?.receita30d ?? 0)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {kpis?.pago30d ?? 0} pagamentos recebidos
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm text-muted-foreground">Pendente</CardTitle>
            <Hourglass className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatBRL(kpis?.pendente ?? 0)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Aguardando pagamento
            </p>
          </CardContent>
        </Card>

        <Card className="border-red-500/20">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm text-muted-foreground">Vencido</CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-red-600">{formatBRL(kpis?.vencido ?? 0)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Requer cobrança ativa
            </p>
          </CardContent>
        </Card>

        <Card className="border-indigo-500/20">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm text-muted-foreground">Judit Créditos</CardTitle>
            <Coins className="h-4 w-4 text-indigo-500" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-indigo-600">{(juditKpis?.creditos?.totalComprado ?? 0).toLocaleString("pt-BR")}</p>
            <p className="text-xs text-muted-foreground mt-1">
              vendidos · {(juditKpis?.creditos?.totalConsumido ?? 0).toLocaleString("pt-BR")} consumidos
            </p>
            {juditKpis?.creditos?.escritoriosSaldoBaixo > 0 && (
              <p className="text-[10px] text-red-600 mt-0.5">
                {juditKpis.creditos.escritoriosSaldoBaixo} escritório(s) com saldo baixo
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Saldo Asaas */}
      <Card>
        <CardContent className="pt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Wallet className="h-5 w-5 text-emerald-600" />
            <div>
              <p className="text-sm text-muted-foreground">Saldo disponível no Asaas ({status.modo})</p>
              <p className="text-xl font-bold">{formatBRL((status?.saldo ?? 0) * 100)}</p>
            </div>
          </div>
          <a
            href="https://www.asaas.com/home"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            Abrir painel Asaas <ExternalLink className="h-3 w-3" />
          </a>
        </CardContent>
      </Card>

      {/* Tabs: Visão / Pagamentos / Assinaturas */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="visao" className="text-xs">
            <TrendingUp className="h-3.5 w-3.5 mr-1.5" /> Cash Flow
          </TabsTrigger>
          <TabsTrigger value="pagamentos" className="text-xs">
            <Receipt className="h-3.5 w-3.5 mr-1.5" /> Pagamentos
          </TabsTrigger>
          <TabsTrigger value="assinaturas" className="text-xs">
            <Repeat className="h-3.5 w-3.5 mr-1.5" /> Assinaturas
          </TabsTrigger>
        </TabsList>

        {/* ─── Cash flow ─── */}
        <TabsContent value="visao" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cash flow — últimos 6 meses</CardTitle>
              <CardDescription>Recebido, pendente e vencido por mês</CardDescription>
            </CardHeader>
            <CardContent>
              {!cashFlow || cashFlow.length === 0 ? (
                <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
                  Sem dados para exibir
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={cashFlow.map((m) => ({ ...m, mes: formatMes(m.mes) }))}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="mes" className="text-xs" />
                    <YAxis
                      className="text-xs"
                      tickFormatter={(v: number) => `R$${(v / 1000).toFixed(0)}k`}
                    />
                    <Tooltip
                      formatter={(v: number) =>
                        new Intl.NumberFormat("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        }).format(v)
                      }
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="recebido" name="Recebido" fill="#10b981" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="pendente" name="Pendente" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="vencido" name="Vencido" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Pagamentos ─── */}
        <TabsContent value="pagamentos" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <CardTitle className="text-base">Pagamentos</CardTitle>
                  <CardDescription>
                    {pagamentosFiltrados.length} {pagamentosFiltrados.length === 1 ? "cobrança" : "cobranças"}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative w-56">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Buscar cliente..."
                      value={busca}
                      onChange={(e) => setBusca(e.target.value)}
                      className="pl-8 text-xs h-8"
                    />
                  </div>
                  <Select value={filtroStatus} onValueChange={setFiltroStatus}>
                    <SelectTrigger className="w-[140px] text-xs h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos</SelectItem>
                      <SelectItem value="PENDING">Pendentes</SelectItem>
                      <SelectItem value="RECEIVED">Pagos</SelectItem>
                      <SelectItem value="CONFIRMED">Confirmados</SelectItem>
                      <SelectItem value="OVERDUE">Vencidos</SelectItem>
                      <SelectItem value="REFUNDED">Estornados</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loadPag ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : pagamentosFiltrados.length === 0 ? (
                <div className="flex flex-col items-center py-12 text-muted-foreground text-sm">
                  <Receipt className="h-10 w-10 mb-2 opacity-30" />
                  Nenhum pagamento encontrado
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead>Valor</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Vencimento</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagamentosFiltrados.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium text-sm">{p.userName || "—"}</p>
                            <p className="text-[10px] text-muted-foreground">{p.userEmail || p.customerId}</p>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                          {p.description || "—"}
                        </TableCell>
                        <TableCell className="text-sm font-medium">
                          {formatBRL(p.value * 100)}
                        </TableCell>
                        <TableCell>
                          <StatusPagamentoBadge status={p.status} />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(p.dueDate).toLocaleDateString("pt-BR")}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              asChild
                            >
                              <a href={p.invoiceUrl} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </Button>
                            {(p.status === "PENDING" || p.status === "OVERDUE") && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-destructive hover:text-destructive"
                                onClick={() => setCancelPgto(p)}
                              >
                                <XCircle className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Assinaturas ─── */}
        <TabsContent value="assinaturas" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Assinaturas</CardTitle>
              <CardDescription>
                {assinaturas?.length ?? 0} assinaturas registradas no Asaas admin
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!assinaturas || assinaturas.length === 0 ? (
                <div className="flex flex-col items-center py-12 text-muted-foreground text-sm">
                  <Repeat className="h-10 w-10 mb-2 opacity-30" />
                  Nenhuma assinatura ainda
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Valor</TableHead>
                      <TableHead>Ciclo</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Próxima cobrança</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assinaturas.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium text-sm">{s.userName || "—"}</p>
                            <p className="text-[10px] text-muted-foreground">{s.userEmail || s.customerId}</p>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm font-medium">
                          {formatBRL(s.value * 100)}
                        </TableCell>
                        <TableCell className="text-xs">
                          {s.cycle === "MONTHLY" ? "Mensal" :
                           s.cycle === "YEARLY" ? "Anual" :
                           s.cycle === "QUARTERLY" ? "Trimestral" :
                           s.cycle === "SEMIANNUALLY" ? "Semestral" :
                           s.cycle}
                        </TableCell>
                        <TableCell>
                          <StatusSubBadge status={s.status} />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {s.nextDueDate ? new Date(s.nextDueDate).toLocaleDateString("pt-BR") : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {s.status === "ACTIVE" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs text-destructive hover:text-destructive"
                              onClick={() => setCancelSub(s)}
                            >
                              <XCircle className="h-3 w-3 mr-1" />
                              Cancelar
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialog de cancelamento de pagamento */}
      <AlertDialog open={!!cancelPgto} onOpenChange={(o) => { if (!o) { setCancelPgto(null); setMotivoCancel(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar cobrança?</AlertDialogTitle>
            <AlertDialogDescription>
              Vai excluir a cobrança <code className="text-xs">{cancelPgto?.id}</code> de{" "}
              <strong>{cancelPgto?.userName || cancelPgto?.userEmail}</strong> no valor de{" "}
              <strong>{formatBRL((cancelPgto?.value ?? 0) * 100)}</strong>. Motivo será auditado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            placeholder="Motivo do cancelamento (obrigatório)"
            value={motivoCancel}
            onChange={(e) => setMotivoCancel(e.target.value)}
            rows={2}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={motivoCancel.trim().length < 3 || cancelPgtoMut.isPending}
              onClick={() => cancelPgto && cancelPgtoMut.mutate({
                paymentId: cancelPgto.id,
                motivo: motivoCancel.trim(),
              })}
            >
              {cancelPgtoMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialog de cancelamento de assinatura */}
      <AlertDialog open={!!cancelSub} onOpenChange={(o) => { if (!o) { setCancelSub(null); setMotivoCancel(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar assinatura?</AlertDialogTitle>
            <AlertDialogDescription>
              Vai cancelar a assinatura de{" "}
              <strong>{cancelSub?.userName || cancelSub?.userEmail}</strong> no Asaas E
              localmente. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            placeholder="Motivo do cancelamento (obrigatório)"
            value={motivoCancel}
            onChange={(e) => setMotivoCancel(e.target.value)}
            rows={2}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={motivoCancel.trim().length < 3 || cancelSubMut.isPending}
              onClick={() => cancelSub && cancelSubMut.mutate({
                asaasSubscriptionId: cancelSub.id,
                motivo: motivoCancel.trim(),
              })}
            >
              {cancelSubMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

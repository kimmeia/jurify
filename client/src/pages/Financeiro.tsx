import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DollarSign, TrendingUp, AlertTriangle, Clock, Plus, ExternalLink, Copy,
  RefreshCw, Loader2, Settings, CheckCircle2, XCircle, Receipt, Users,
  UserPlus, Repeat, Trash2, Search, Wallet, Download, Filter, ArrowUpRight,
  Calendar,
} from "lucide-react";
import { toast } from "sonner";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  LineChart, Line, Legend,
} from "recharts";
import {
  formatBRL, formatBRLShort, formatMes, StatusBadge, FormaBadge, CICLO_LABELS,
  exportCobrancasCSV,
} from "./financeiro/helpers";
import {
  NovaCobrancaDialog, NovaAssinaturaDialog, NovoClienteDialog,
} from "./financeiro/dialogs";
import { ComissoesTab } from "./financeiro/Comissoes";
import { DespesasTab } from "./financeiro/Despesas";

// ─── Componente principal ────────────────────────────────────────────────────

export default function Financeiro() {
  const [tab, setTab] = useState("cobrancas");
  const [novaCobrancaOpen, setNovaCobrancaOpen] = useState(false);
  const [novaAssinaturaOpen, setNovaAssinaturaOpen] = useState(false);
  const [novoClienteOpen, setNovoClienteOpen] = useState(false);
  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [filtroForma, setFiltroForma] = useState("todos");
  const [busca, setBusca] = useState("");
  const [periodo, setPeriodo] = useState<3 | 6 | 12>(6);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());

  // Auto-refresh: cron sincroniza a cada 10min; webhook pode atualizar a qualquer
  // momento. Revalidamos no frontend a cada 60s e quando o usuário volta à aba.
  const REFRESH_MS = 60_000;

  const { data: statusAsaas, isLoading: loadStatus, refetch: refetchStatus } =
    trpc.asaas.status.useQuery(undefined, { retry: false });
  const { data: kpis, refetch: refetchKpis } = trpc.asaas.kpis.useQuery(undefined, {
    retry: false,
    enabled: statusAsaas?.conectado,
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true,
  });
  const { data: saldo } = trpc.asaas.obterSaldo.useQuery(undefined, {
    retry: false,
    enabled: statusAsaas?.conectado,
    refetchInterval: REFRESH_MS,
  });
  const { data: cashFlow } = trpc.asaas.cashFlowMensal.useQuery(
    { meses: periodo },
    {
      retry: false,
      enabled: statusAsaas?.conectado,
      refetchInterval: REFRESH_MS * 2, // 2 min (menos sensível a mudanças)
    },
  );
  const { data: forecast } = trpc.asaas.forecast.useQuery(
    { dias: 30 },
    {
      retry: false,
      enabled: statusAsaas?.conectado,
      refetchInterval: REFRESH_MS * 2,
    },
  );
  const { data: cobrancas, isLoading: loadCob, refetch: refetchCob } =
    trpc.asaas.listarCobrancas.useQuery(
      { status: filtroStatus !== "todos" ? filtroStatus : undefined, limit: 100 },
      {
        retry: false,
        enabled: statusAsaas?.conectado,
        refetchInterval: REFRESH_MS,
        refetchOnWindowFocus: true,
      },
    );
  const { data: assinaturas, refetch: refetchSubs } =
    trpc.asaas.listarAssinaturas.useQuery(undefined, {
      retry: false,
      enabled: statusAsaas?.conectado,
      refetchInterval: REFRESH_MS,
    });
  const { data: clientesVinculados, refetch: refetchClientes } =
    trpc.asaas.listarClientesVinculados.useQuery(
      { busca: busca || undefined },
      { retry: false, enabled: statusAsaas?.conectado },
    );

  const syncMut = trpc.asaas.sincronizarClientes.useMutation({
    onSuccess: (data: any) => {
      const p: string[] = [];
      if (data.novos > 0) p.push(`${data.novos} cliente(s) novo(s)`);
      if (data.vinculados > 0) p.push(`${data.vinculados} cliente(s) vinculado(s)`);
      if (data.removidos > 0) p.push(`${data.removidos} cliente(s) removido(s)`);
      if (data.cobNovas > 0) p.push(`${data.cobNovas} cobrança(s) nova(s)`);
      if (data.cobAtualizadas > 0) p.push(`${data.cobAtualizadas} cobrança(s) com status alterado`);
      if (data.cobRemovidas > 0) p.push(`${data.cobRemovidas} cobrança(s) removida(s)`);

      if (p.length === 0) {
        toast.success("Tudo em dia", { description: "Nenhuma mudança encontrada." });
      } else {
        toast.success("Sincronização concluída", { description: p.join(" · ") });
      }
      refetchAll();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  const excluirCobMut = trpc.asaas.excluirCobranca.useMutation({
    onSuccess: () => {
      toast.success("Cobrança cancelada");
      refetchCob();
      refetchKpis();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  const cancelarSubMut = trpc.asaas.cancelarAssinatura.useMutation({
    onSuccess: () => {
      toast.success("Assinatura cancelada");
      refetchSubs();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  const refetchAll = () => {
    refetchStatus();
    refetchKpis();
    refetchCob();
    refetchSubs();
    refetchClientes();
  };

  // Filtra cobranças visíveis (filtros client-side adicionais)
  const cobrancasFiltradas = useMemo(() => {
    if (!cobrancas?.items) return [];
    return cobrancas.items.filter((c: any) => {
      if (filtroForma !== "todos" && c.formaPagamento !== filtroForma) return false;
      if (busca && !`${c.nomeContato} ${c.descricao || ""}`.toLowerCase().includes(busca.toLowerCase())) return false;
      return true;
    });
  }, [cobrancas, filtroForma, busca]);

  const toggleSelecionada = (id: string) => {
    setSelecionadas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelecionarTodas = () => {
    if (selecionadas.size === cobrancasFiltradas.length) {
      setSelecionadas(new Set());
    } else {
      setSelecionadas(new Set(cobrancasFiltradas.map((c: any) => c.id)));
    }
  };

  const handleBulkExport = () => {
    const selecionadasList = cobrancasFiltradas.filter((c: any) => selecionadas.has(c.id));
    if (selecionadasList.length === 0) {
      exportCobrancasCSV(cobrancasFiltradas);
      toast.success(`${cobrancasFiltradas.length} cobrança(s) exportada(s)`);
    } else {
      exportCobrancasCSV(selecionadasList);
      toast.success(`${selecionadasList.length} cobrança(s) exportada(s)`);
    }
  };

  const handleBulkDelete = () => {
    const selecionadasList = cobrancasFiltradas.filter(
      (c: any) => selecionadas.has(c.id) && c.status === "PENDING",
    );
    if (selecionadasList.length === 0) {
      toast.error("Selecione cobranças pendentes para cancelar");
      return;
    }
    if (!confirm(`Cancelar ${selecionadasList.length} cobrança(s) pendente(s)?`)) return;
    for (const c of selecionadasList) {
      excluirCobMut.mutate({ id: c.id });
    }
    setSelecionadas(new Set());
  };

  if (loadStatus) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // Estado desconectado — card grande convidando a conectar
  if (!statusAsaas?.conectado) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Financeiro</h1>
          <p className="text-muted-foreground mt-1">Gerencie cobranças via Asaas.</p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center shadow-lg">
              <DollarSign className="h-8 w-8 text-white" />
            </div>
            <div className="text-center">
              <p className="font-semibold text-lg">Conecte sua conta Asaas</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-md">
                Crie cobranças (Pix, boleto, cartão), acompanhe recebimentos e
                integre com o CRM em segundos.
              </p>
            </div>
            <Button size="lg" onClick={() => (window.location.href = "/configuracoes")}>
              <Settings className="h-4 w-4 mr-2" />
              Configurar agora
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ─── Header ─── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Financeiro</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/25 hover:bg-emerald-500/15 text-[10px] font-normal">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Asaas {statusAsaas.modo === "sandbox" ? "Sandbox" : "Produção"}
            </Badge>
            {saldo && (
              <span className="text-xs text-muted-foreground">
                Saldo: <strong className="text-foreground">{formatBRL(saldo.balance)}</strong>
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => syncMut.mutate()}
            disabled={syncMut.isPending}
          >
            {syncMut.isPending ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            )}
            Sincronizar
          </Button>
          <Button size="sm" onClick={() => setNovaCobrancaOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            Nova cobrança
          </Button>
        </div>
      </div>

      {/* ─── Tabs principais ─── */}
      {/*
        TabsList é sticky pra continuar acessível ao rolar — antes ficava
        no rodapé da página depois do hero+KPIs+forecast, exigindo scroll
        pra qualquer navegação. Cada aba tem seus KPIs/gráficos
        contextuais (cobranças vê fluxo de caixa; comissões vê os KPIs
        próprios — total comissionável, sem decisão, próximo lançamento).
      */}
      <Tabs value={tab} onValueChange={setTab}>
        <div className="sticky top-0 z-20 -mx-4 px-4 sm:-mx-6 sm:px-6 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 py-2 border-b">
          <TabsList>
          <TabsTrigger value="cobrancas" className="gap-1.5">
            <Receipt className="h-3.5 w-3.5" />
            Cobranças ({kpis?.totalCobrancas ?? 0})
          </TabsTrigger>
          <TabsTrigger value="assinaturas" className="gap-1.5">
            <Repeat className="h-3.5 w-3.5" />
            Assinaturas ({assinaturas?.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="clientes" className="gap-1.5">
            <Users className="h-3.5 w-3.5" />
            Clientes ({clientesVinculados?.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="comissoes" className="gap-1.5">
            <DollarSign className="h-3.5 w-3.5" />
            Comissões
          </TabsTrigger>
          <TabsTrigger value="despesas" className="gap-1.5">
            <Wallet className="h-3.5 w-3.5" />
            Despesas
          </TabsTrigger>
          </TabsList>
        </div>

        {/* ─── Aba: Cobranças ─── */}
        <TabsContent value="cobrancas" className="mt-4 space-y-4">
          {/* Hero: Fluxo de caixa (gráfico grande) — específico da
              aba Cobranças, antes era no topo geral mas faz mais sentido
              agrupado com a tabela de cobranças. */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-start justify-between flex-wrap gap-4 mb-6">
                <div>
                  <p className="text-sm text-muted-foreground font-medium">Fluxo de caixa</p>
                  <div className="flex items-baseline gap-3 mt-1">
                    <h2 className="text-3xl font-bold tracking-tight text-emerald-600">
                      {formatBRL(cashFlow?.totalRecebido ?? kpis?.recebido ?? 0)}
                    </h2>
                    <span className="text-sm text-muted-foreground">recebido nos últimos {periodo} meses</span>
                  </div>
                </div>
                <Tabs value={String(periodo)} onValueChange={(v) => setPeriodo(Number(v) as 3 | 6 | 12)}>
                  <TabsList className="h-8">
                    <TabsTrigger value="3" className="text-xs px-3">3m</TabsTrigger>
                    <TabsTrigger value="6" className="text-xs px-3">6m</TabsTrigger>
                    <TabsTrigger value="12" className="text-xs px-3">12m</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              <div className="h-56">
                {cashFlow && cashFlow.pontos.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={cashFlow.pontos} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                      <XAxis
                        dataKey="mes"
                        tick={{ fontSize: 11, fill: "#9ca3af" }}
                        tickFormatter={formatMes}
                        stroke="#e5e7eb"
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: "#9ca3af" }}
                        tickFormatter={formatBRLShort}
                        stroke="#e5e7eb"
                        width={60}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "white",
                          border: "1px solid #e5e7eb",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                        labelFormatter={formatMes}
                        formatter={(v: number) => formatBRL(v)}
                      />
                      <Legend wrapperStyle={{ fontSize: "11px" }} />
                      <Bar dataKey="recebido" fill="#10b981" name="Recebido" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="pendente" fill="#f59e0b" name="Pendente" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="vencido" fill="#ef4444" name="Vencido" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                    Sem dados no período selecionado.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* KPIs */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <KPICard
              icon={TrendingUp}
              label="Recebido"
              value={formatBRL(kpis?.recebido ?? 0)}
              color="emerald"
            />
            <KPICard
              icon={Clock}
              label="A receber"
              value={formatBRL(kpis?.pendente ?? 0)}
              color="amber"
            />
            <KPICard
              icon={AlertTriangle}
              label="Vencido"
              value={formatBRL(kpis?.vencido ?? 0)}
              color="red"
            />
            <KPICard
              icon={Wallet}
              label="Saldo Asaas"
              value={saldo ? formatBRL(saldo.balance) : "—"}
              color="blue"
            />
          </div>

          {/* Forecast — próximos 30 dias */}
          {forecast && forecast.semanas.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-blue-500" />
                    Previsão de recebimentos — próximos 30 dias
                  </CardTitle>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-muted-foreground">
                      Total previsto: <strong className="text-foreground">{formatBRL(forecast.total)}</strong>
                    </span>
                    {forecast.atrasado > 0 && (
                      <span className="text-red-600">
                        ⚠ {formatBRL(forecast.atrasado)} já vencido
                      </span>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="h-28">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={forecast.semanas} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="#e5e7eb" />
                      <YAxis tick={{ fontSize: 10 }} tickFormatter={formatBRLShort} stroke="#e5e7eb" width={60} />
                      <Tooltip
                        contentStyle={{ fontSize: "11px", borderRadius: "8px" }}
                        formatter={(v: number) => formatBRL(v)}
                      />
                      <Line
                        type="monotone"
                        dataKey="valor"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        dot={{ r: 4, fill: "#3b82f6" }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Barra de filtros */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por cliente ou descrição..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="pl-9 h-9 text-sm"
              />
            </div>
            <Select value={filtroStatus} onValueChange={setFiltroStatus}>
              <SelectTrigger className="w-36 h-9 text-xs">
                <Filter className="h-3 w-3 mr-1" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos status</SelectItem>
                <SelectItem value="PENDING">Pendente</SelectItem>
                <SelectItem value="RECEIVED">Recebido</SelectItem>
                <SelectItem value="CONFIRMED">Confirmado</SelectItem>
                <SelectItem value="OVERDUE">Vencido</SelectItem>
                <SelectItem value="REFUNDED">Estornado</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filtroForma} onValueChange={setFiltroForma}>
              <SelectTrigger className="w-32 h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todas formas</SelectItem>
                <SelectItem value="PIX">Pix</SelectItem>
                <SelectItem value="BOLETO">Boleto</SelectItem>
                <SelectItem value="CREDIT_CARD">Cartão</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex-1" />
            <Button size="sm" variant="outline" onClick={handleBulkExport}>
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Exportar CSV
            </Button>
          </div>

          {/* Bulk actions bar — aparece quando há seleções */}
          {selecionadas.size > 0 && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-50 border border-blue-200">
              <span className="text-sm font-medium text-blue-900">
                {selecionadas.size} cobrança(s) selecionada(s)
              </span>
              <div className="flex-1" />
              <Button size="sm" variant="outline" onClick={handleBulkExport}>
                <Download className="h-3.5 w-3.5 mr-1" />
                Exportar
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-destructive"
                onClick={handleBulkDelete}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Cancelar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelecionadas(new Set())}
              >
                Limpar seleção
              </Button>
            </div>
          )}

          {/* Tabela */}
          {loadCob ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : cobrancasFiltradas.length > 0 ? (
            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={
                          selecionadas.size > 0 &&
                          selecionadas.size === cobrancasFiltradas.length
                        }
                        onCheckedChange={toggleSelecionarTodas}
                      />
                    </TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Valor</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead>Forma</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cobrancasFiltradas.map((c: any) => (
                    <TableRow key={c.id} data-state={selecionadas.has(c.id) ? "selected" : undefined}>
                      <TableCell>
                        <Checkbox
                          checked={selecionadas.has(c.id)}
                          onCheckedChange={() => toggleSelecionada(c.id)}
                        />
                      </TableCell>
                      <TableCell className="font-medium text-sm">{c.nomeContato}</TableCell>
                      <TableCell className="font-mono text-sm">
                        {formatBRL(parseFloat(c.valor))}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {c.vencimento
                          ? new Date(c.vencimento + "T12:00:00").toLocaleDateString("pt-BR")
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <FormaBadge forma={c.formaPagamento} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={c.status} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground truncate max-w-[120px]">
                        {c.descricao || "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {c.invoiceUrl && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => window.open(c.invoiceUrl, "_blank")}
                              title="Link pagamento"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {c.invoiceUrl && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => {
                                navigator.clipboard.writeText(c.invoiceUrl);
                                toast.success("Link copiado");
                              }}
                              title="Copiar"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {c.status === "PENDING" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-destructive"
                              onClick={() => {
                                if (confirm("Cancelar?")) excluirCobMut.mutate({ id: c.id });
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <Receipt className="h-8 w-8 text-muted-foreground opacity-30" />
              <p className="text-sm text-muted-foreground">
                {busca || filtroStatus !== "todos" || filtroForma !== "todos"
                  ? "Nenhuma cobrança corresponde aos filtros."
                  : "Nenhuma cobrança ainda."}
              </p>
            </div>
          )}
        </TabsContent>

        {/* ─── Aba: Assinaturas ─── */}
        <TabsContent value="assinaturas" className="mt-4 space-y-4">
          <div className="flex items-center justify-end">
            <Button size="sm" variant="outline" onClick={() => setNovaAssinaturaOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Nova assinatura
            </Button>
          </div>
          {assinaturas && assinaturas.length > 0 ? (
            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Valor</TableHead>
                    <TableHead>Ciclo</TableHead>
                    <TableHead>Próx. venc.</TableHead>
                    <TableHead>Forma</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assinaturas.map((s: any) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium text-sm">{s.contatoNome}</TableCell>
                      <TableCell className="font-mono text-sm">{formatBRL(s.value)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {CICLO_LABELS[s.cycle] || s.cycle}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {s.nextDueDate
                          ? new Date(s.nextDueDate + "T12:00:00").toLocaleDateString("pt-BR")
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <FormaBadge forma={s.billingType} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={s.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        {s.status === "ACTIVE" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-destructive"
                            onClick={() => {
                              if (confirm("Cancelar assinatura?"))
                                cancelarSubMut.mutate({ assinaturaId: s.id });
                            }}
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
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <Repeat className="h-8 w-8 text-muted-foreground opacity-30" />
              <p className="text-sm text-muted-foreground">Nenhuma assinatura.</p>
            </div>
          )}
        </TabsContent>

        {/* ─── Aba: Clientes ─── */}
        <TabsContent value="clientes" className="mt-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar cliente..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="pl-9 h-9 text-sm"
              />
            </div>
            <Button size="sm" variant="outline" onClick={() => setNovoClienteOpen(true)}>
              <UserPlus className="h-3.5 w-3.5 mr-1" />
              Novo cliente
            </Button>
          </div>
          {clientesVinculados && clientesVinculados.length > 0 ? (
            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>CPF/CNPJ</TableHead>
                    <TableHead>Contato</TableHead>
                    <TableHead className="text-center">Cobranças</TableHead>
                    <TableHead>Pendente</TableHead>
                    <TableHead>Vencido</TableHead>
                    <TableHead>Pago</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clientesVinculados.map((c: any) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium text-sm">{c.contatoNome}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {c.cpfCnpj}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {c.contatoTelefone || c.contatoEmail || "—"}
                      </TableCell>
                      <TableCell className="text-sm text-center">{c.totalCobrancas}</TableCell>
                      <TableCell className="text-sm text-amber-600">
                        {c.pendente > 0 ? formatBRL(c.pendente) : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-red-600">
                        {c.vencido > 0 ? formatBRL(c.vencido) : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-emerald-600">
                        {c.pago > 0 ? formatBRL(c.pago) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <Users className="h-8 w-8 text-muted-foreground opacity-30" />
              <p className="text-sm text-muted-foreground">Nenhum cliente vinculado.</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="comissoes" className="mt-4">
          <ComissoesTab />
        </TabsContent>

        <TabsContent value="despesas" className="mt-4">
          <DespesasTab />
        </TabsContent>
      </Tabs>

      {/* ─── Dialogs ─── */}
      <NovaCobrancaDialog
        open={novaCobrancaOpen}
        onOpenChange={setNovaCobrancaOpen}
        onSuccess={() => {
          refetchCob();
          refetchKpis();
          refetchSubs();
        }}
      />
      <NovaAssinaturaDialog
        open={novaAssinaturaOpen}
        onOpenChange={setNovaAssinaturaOpen}
        onSuccess={refetchSubs}
      />
      <NovoClienteDialog
        open={novoClienteOpen}
        onOpenChange={setNovoClienteOpen}
        onSuccess={refetchClientes}
      />
    </div>
  );
}

// ─── Sub-componente: KPI Card ─────────────────────────────────────────────

function KPICard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: any;
  label: string;
  value: string;
  color: "emerald" | "amber" | "red" | "blue";
}) {
  const colors = {
    emerald: { bg: "bg-emerald-500/10", text: "text-emerald-500", valueText: "text-emerald-600" },
    amber: { bg: "bg-amber-500/10", text: "text-amber-500", valueText: "text-amber-600" },
    red: { bg: "bg-red-500/10", text: "text-red-500", valueText: "text-red-600" },
    blue: { bg: "bg-blue-500/10", text: "text-blue-500", valueText: "text-foreground" },
  };
  const c = colors[color];
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center gap-3">
          <div className={`h-10 w-10 rounded-lg ${c.bg} flex items-center justify-center`}>
            <Icon className={`h-5 w-5 ${c.text}`} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground font-medium">{label}</p>
            <p className={`text-xl font-bold ${c.valueText}`}>{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

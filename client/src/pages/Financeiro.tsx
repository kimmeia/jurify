import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DollarSign, TrendingUp, AlertTriangle, Clock, Plus, ExternalLink, Copy,
  RefreshCw, Loader2, Settings, CheckCircle2, XCircle, Receipt, Users,
  UserPlus, Trash2, Search, Wallet, Download, Filter, ArrowUpRight, BarChart3,
  Paperclip, FileUp,
} from "lucide-react";
import { toast } from "sonner";
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import {
  formatBRL, formatBRLShort, formatMes, formatDiaCurto, formatDiaCompleto, StatusBadge, FormaBadge, CICLO_LABELS, useFinanceiroPerms,
  exportCobrancasCSV,
} from "./financeiro/helpers";
import {
  NovaCobrancaDialog, NovoClienteDialog, AnexosCobrancaDialog,
} from "./financeiro/dialogs";
import { ComissoesTab } from "./financeiro/Comissoes";
import { DespesasTab } from "./financeiro/Despesas";
import { RelatoriosTab } from "./financeiro/Relatorios";
import { OFXImportDialog } from "./financeiro/OFXImportDialog";
import { LimpezaContatosOrfaosDialog } from "./financeiro/LimpezaContatosOrfaosDialog";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";

/** Helper: 1º dia e último dia do mês corrente em YYYY-MM-DD. */
function rangeMesCorrente(): { inicio: string; fim: string } {
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth();
  const inicio = new Date(ano, mes, 1);
  const fim = new Date(ano, mes + 1, 0);
  return {
    inicio: inicio.toISOString().slice(0, 10),
    fim: fim.toISOString().slice(0, 10),
  };
}

// ─── Componente principal ────────────────────────────────────────────────────

export default function Financeiro() {
  const utils = trpc.useUtils();
  const [tab, setTab] = useState("cobrancas");
  const [novaCobrancaOpen, setNovaCobrancaOpen] = useState(false);
  const [anexosCobrId, setAnexosCobrId] = useState<number | null>(null);
  const [ofxOpen, setOfxOpen] = useState(false);
  const [limpezaOpen, setLimpezaOpen] = useState(false);
  const perms = useFinanceiroPerms();
  const [novoClienteOpen, setNovoClienteOpen] = useState(false);
  // Filtros multi-select. Vazio = "todos" (sem filtro).
  const [filtroStatus, setFiltroStatus] = useState<string[]>([]);
  const [filtroForma, setFiltroForma] = useState<string[]>([]);
  const [busca, setBusca] = useState("");
  // Período do gráfico de fluxo de caixa. Pode ser preset (3/6/12 meses)
  // ou range customizado (dataInicio/dataFim). Quando custom, `periodo`
  // fica como null e a query usa as datas; caso contrário usa `meses`.
  // Default: range custom = mês corrente (1º a último dia). Pra ver mais
  // meses pra trás, user troca pra preset.
  const [periodo, setPeriodo] = useState<3 | 6 | 12 | null>(null);
  const [rangeCustom, setRangeCustom] = useState<{ inicio: string; fim: string } | null>(
    rangeMesCorrente(),
  );
  const [rangePopoverOpen, setRangePopoverOpen] = useState(false);
  // Inputs locais do popover (só commitam ao clicar Aplicar).
  const [rangeInicioInput, setRangeInicioInput] = useState("");
  const [rangeFimInput, setRangeFimInput] = useState("");
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [confirmBulkCancel, setConfirmBulkCancel] = useState(false);
  const [cobrancaParaCancelar, setCobrancaParaCancelar] = useState<any | null>(null);

  // Auto-refresh: cron sincroniza a cada 10min; webhook pode atualizar a
  // qualquer momento. Revalidamos a cada 5min — antes era 60s mas com 4
  // queries em polling simultâneo + multi-usuário, batia rate limit 429
  // do Asaas (12h de bloqueio). 5min cobre o pior caso do cron sem inflar
  // tráfego. refetchOnWindowFocus desligado pelo default global.
  const REFRESH_MS = 5 * 60_000;

  const { data: statusAsaas, isLoading: loadStatus } =
    trpc.asaas.status.useQuery(undefined, { retry: false });

  // Range efetivo (dataInicio/dataFim concretos) derivado do estado atual.
  // Usado tanto pelo gráfico quanto pelos KPIs e filtro de cobranças.
  const rangeEfetivo = useMemo<{ inicio: string; fim: string }>(() => {
    if (rangeCustom) return rangeCustom;
    const meses = periodo ?? 6;
    const hoje = new Date();
    const inicio = new Date(hoje.getFullYear(), hoje.getMonth() - (meses - 1), 1);
    const fim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0); // último dia do mês atual
    return { inicio: inicio.toISOString().slice(0, 10), fim: fim.toISOString().slice(0, 10) };
  }, [rangeCustom, periodo]);

  // KPIs respeitam o range escolhido: cobranças PAGAS filtram por
  // dataPagamento dentro do range (bate com Comissões); pendentes/
  // vencidas filtram por vencimento (faz sentido por vencimento).
  const { data: kpis, refetch: refetchKpis } = trpc.asaas.kpis.useQuery(
    {
      pagamentoInicio: rangeEfetivo.inicio,
      pagamentoFim: rangeEfetivo.fim,
      vencimentoInicio: rangeEfetivo.inicio,
      vencimentoFim: rangeEfetivo.fim,
    },
    {
      retry: false,
      enabled: statusAsaas?.conectado,
      refetchInterval: REFRESH_MS,
    },
  );
  const { data: saldo } = trpc.asaas.obterSaldo.useQuery(undefined, {
    retry: false,
    enabled: statusAsaas?.conectado,
    refetchInterval: REFRESH_MS,
  });
  const { data: cashFlow } = trpc.asaas.cashFlowMensal.useQuery(
    rangeCustom
      ? { dataInicio: rangeCustom.inicio, dataFim: rangeCustom.fim }
      : { meses: periodo ?? 6 },
    {
      retry: false,
      enabled: statusAsaas?.conectado,
      refetchInterval: REFRESH_MS * 2, // 2 min (menos sensível a mudanças)
    },
  );

  // Filtro da aba Cobranças: agora por DATA DE PAGAMENTO (bate com a
  // aba Comissões). PENDING/OVERDUE não têm dataPagamento — são
  // incluídas separadamente quando o user marca esses status no
  // multi-select (filtramos por vencimento como fallback nesse caso).
  // listarCobrancas inclui cobranças manuais + Asaas — funciona mesmo
  // sem Asaas conectado (mostra só as manuais).
  const filtraPorVencimento = filtroStatus.length > 0 && filtroStatus.every(
    (s) => s === "PENDING" || s === "OVERDUE",
  );
  const ITENS_POR_PAGINA = 50;
  const [paginaCob, setPaginaCob] = useState(0);
  const { data: cobrancas, isLoading: loadCob, refetch: refetchCob } =
    trpc.asaas.listarCobrancas.useQuery(
      {
        status: filtroStatus.length > 0 ? filtroStatus : undefined,
        formaPagamento: filtroForma.length > 0 ? filtroForma : undefined,
        ...(filtraPorVencimento
          ? { vencimentoInicio: rangeEfetivo.inicio, vencimentoFim: rangeEfetivo.fim }
          : { pagamentoInicio: rangeEfetivo.inicio, pagamentoFim: rangeEfetivo.fim }),
        limit: ITENS_POR_PAGINA,
        offset: paginaCob * ITENS_POR_PAGINA,
      },
      {
        retry: false,
        refetchInterval: REFRESH_MS,
      },
    );

  // Reseta página quando filtros mudam — evita ficar numa página vazia
  // depois de trocar status/forma.
  useEffect(() => {
    setPaginaCob(0);
  }, [
    filtroStatus.join(","),
    filtroForma.join(","),
    rangeEfetivo.inicio,
    rangeEfetivo.fim,
  ]);
  const { data: clientesVinculados, refetch: refetchClientes } =
    trpc.asaas.listarClientesVinculados.useQuery(
      { busca: busca || undefined },
      { retry: false, enabled: statusAsaas?.conectado },
    );

  const syncMut = trpc.asaas.sincronizarClientes.useMutation({
    onSuccess: (data: any) => {
      const p: string[] = [];
      if (data.atualizadosVinculados > 0) p.push(`${data.atualizadosVinculados} cliente(s) com dados atualizados`);
      if (data.novos > 0) p.push(`${data.novos} cliente(s) novo(s) adotado(s)`);
      if (data.vinculados > 0) p.push(`${data.vinculados} cliente(s) vinculado(s) a contato existente`);
      if (data.removidos > 0) p.push(`${data.removidos} cliente(s) removido(s)`);
      if (data.cobNovas > 0) p.push(`${data.cobNovas} cobrança(s) nova(s)`);
      if (data.cobAtualizadas > 0) p.push(`${data.cobAtualizadas} cobrança(s) com status alterado`);
      if (data.cobAdotadas > 0) p.push(`${data.cobAdotadas} cobrança(s) com nome corrigido`);
      if (data.cobRemovidas > 0) p.push(`${data.cobRemovidas} cobrança(s) removida(s)`);

      if (p.length === 0) {
        toast.success("Tudo em dia", { description: "Nenhuma mudança encontrada." });
      } else {
        toast.success("Sincronização concluída", { description: p.join(" · ") });
      }
      // Sync mexe em clientes + cobranças (afeta KPIs). status não muda.
      // invalidate marca como stale e refetch só roda quando a query
      // ainda está montada — evita 4 requests paralelos imediatos.
      utils.asaas.kpis.invalidate();
      utils.asaas.listarCobrancas.invalidate();
      utils.asaas.listarClientesVinculados.invalidate();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  const excluirCobMut = trpc.asaas.excluirCobranca.useMutation({
    onSuccess: () => {
      toast.success("Cobrança cancelada");
      utils.asaas.listarCobrancas.invalidate();
      utils.asaas.kpis.invalidate();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  // Marca cobrança manual como recebida. Disponível só em cobranças
  // origem='manual' com status PENDING/OVERDUE — Asaas sincroniza
  // automaticamente via webhook nas origens 'asaas'.
  const marcarPagaMut = trpc.asaas.marcarCobrancaPaga.useMutation({
    onSuccess: () => {
      toast.success("Cobrança marcada como paga");
      utils.asaas.listarCobrancas.invalidate();
      utils.asaas.kpis.invalidate();
    },
    onError: (err: any) => toast.error("Erro", { description: err.message }),
  });

  const cancelarSubMut = trpc.asaas.cancelarAssinatura.useMutation({
    onSuccess: () => {
      toast.success("Assinatura cancelada");
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  // Filtra cobranças visíveis (filtros client-side adicionais).
  // Forma já vai pro backend, mas mantemos o filtro de busca livre.
  const cobrancasFiltradas = useMemo(() => {
    if (!cobrancas?.items) return [];
    return cobrancas.items.filter((c: any) => {
      if (busca && !`${c.nomeContato} ${c.descricao || ""}`.toLowerCase().includes(busca.toLowerCase())) return false;
      return true;
    });
  }, [cobrancas, busca]);

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

  // Lista de cobranças pendentes selecionadas — derivada pra usar tanto no
  // contador do dialog quanto na execução do bulk delete.
  const cobrancasBulkSelecionadas = cobrancasFiltradas.filter(
    (c: any) => selecionadas.has(c.id) && c.status === "PENDING",
  );

  const handleBulkDelete = () => {
    if (cobrancasBulkSelecionadas.length === 0) {
      toast.error("Selecione cobranças pendentes para cancelar");
      return;
    }
    setConfirmBulkCancel(true);
  };

  const confirmarBulkCancel = () => {
    for (const c of cobrancasBulkSelecionadas) {
      excluirCobMut.mutate({ id: c.id });
    }
    setSelecionadas(new Set());
    setConfirmBulkCancel(false);
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
  // Antes havia early return aqui que escondia o módulo inteiro quando
  // Asaas não estava conectado. Mas Despesas e Comissões são dados
  // locais (não dependem do Asaas), então passaram a ficar inacessíveis
  // sem motivo. Agora destravamos: as abas funcionam sempre, e cada aba
  // que precisa de Asaas (Cobranças/Assinaturas/Clientes/Saldo) mostra
  // CTA inline. Banner global avisa se está desconectado.
  const conectado = !!statusAsaas?.conectado;

  return (
    <div className="space-y-6">
      {/* ─── Header ─── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Financeiro</h1>
          <div className="flex items-center gap-2 mt-1">
            {conectado ? (
              <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/25 hover:bg-emerald-500/15 text-[10px] font-normal">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Asaas {statusAsaas.modo === "sandbox" ? "Sandbox" : "Produção"}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
                Asaas desconectado
              </Badge>
            )}
            {conectado && saldo && (
              <span className="text-xs text-muted-foreground">
                Saldo: <strong className="text-foreground">{formatBRL(saldo.balance)}</strong>
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {conectado ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => syncMut.mutate()}
              disabled={syncMut.isPending}
              title="Atualiza status/pagamento das cobranças que já estão no sistema. Pra puxar cobranças novas do Asaas, use 'Importar histórico' em Configurações."
            >
              {syncMut.isPending ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              )}
              Sincronizar
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => (window.location.href = "/configuracoes")}
            >
              <Settings className="h-3.5 w-3.5 mr-1.5" />
              Conectar Asaas
            </Button>
          )}
          {perms.podeEditar && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setOfxOpen(true)}
              title="Conciliar extrato bancário (OFX): marcar pagas as despesas/cobranças que o banco confirmou"
            >
              <FileUp className="h-4 w-4 mr-1.5" />
              Importar OFX
            </Button>
          )}
          {perms.podeExcluir && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setLimpezaOpen(true)}
              title="Remover contatos importados do Asaas que não têm cobrança nem processo vinculado"
            >
              <Trash2 className="h-4 w-4 mr-1.5" />
              Limpar órfãos
            </Button>
          )}
          {perms.podeCriar && (
            <Button
              size="sm"
              onClick={() => setNovaCobrancaOpen(true)}
              title={!conectado ? "Asaas desconectado: você pode registrar cobrança manual (dinheiro/transferência)" : undefined}
            >
              <Plus className="h-4 w-4 mr-1.5" />
              Nova cobrança
            </Button>
          )}
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
          <TabsTrigger value="relatorios" className="gap-1.5">
            <BarChart3 className="h-3.5 w-3.5" />
            Relatórios
          </TabsTrigger>
          </TabsList>
        </div>

        {/* ─── Aba: Cobranças ─── */}
        {/* A aba mostra cobranças manuais + Asaas sempre. Quando o Asaas
            está desconectado, escondemos o gráfico de fluxo de caixa
            (depende de KPIs Asaas) e o card de saldo, mas a tabela de
            cobranças continua acessível — útil pra escritórios que
            ainda registram só manualmente. */}
        <TabsContent value="cobrancas" className="mt-4 space-y-4">
          <div className="space-y-4">
          {!conectado && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-900 dark:text-amber-200">
              <b>Asaas desconectado.</b> Você está vendo apenas cobranças manuais.
              Pra criar cobranças online (Pix, boleto, cartão) e ver KPIs/fluxo de
              caixa,{" "}
              <button
                className="underline font-medium"
                onClick={() => (window.location.href = "/configuracoes")}
              >
                conecte o Asaas
              </button>
              .
            </div>
          )}
          {conectado && (
            <>
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
                    <span className="text-sm text-muted-foreground">
                      {rangeCustom
                        ? `entre ${rangeCustom.inicio.split("-").reverse().join("/")} e ${rangeCustom.fim.split("-").reverse().join("/")}`
                        : `recebido nos últimos ${periodo ?? 6} meses`}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Tabs
                    value={rangeCustom ? "custom" : String(periodo ?? 6)}
                    onValueChange={(v) => {
                      if (v === "custom") return; // tratado pelo Popover abaixo
                      setRangeCustom(null);
                      setPeriodo(Number(v) as 3 | 6 | 12);
                    }}
                  >
                    <TabsList className="h-8">
                      <TabsTrigger value="3" className="text-xs px-3">3m</TabsTrigger>
                      <TabsTrigger value="6" className="text-xs px-3">6m</TabsTrigger>
                      <TabsTrigger value="12" className="text-xs px-3">12m</TabsTrigger>
                    </TabsList>
                  </Tabs>
                  <Popover
                    open={rangePopoverOpen}
                    onOpenChange={(o) => {
                      setRangePopoverOpen(o);
                      if (o) {
                        // Pre-popula inputs com o range atual ou um default
                        // (últimos 6 meses).
                        if (rangeCustom) {
                          setRangeInicioInput(rangeCustom.inicio);
                          setRangeFimInput(rangeCustom.fim);
                        } else {
                          const hoje = new Date();
                          const inicio = new Date(hoje.getFullYear(), hoje.getMonth() - 5, 1);
                          const fim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
                          setRangeInicioInput(inicio.toISOString().slice(0, 10));
                          setRangeFimInput(fim.toISOString().slice(0, 10));
                        }
                      }
                    }}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        variant={rangeCustom ? "default" : "outline"}
                        size="sm"
                        className="h-8 text-xs"
                      >
                        Personalizar
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-72 space-y-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">De</Label>
                        <Input
                          type="date"
                          value={rangeInicioInput}
                          onChange={(e) => setRangeInicioInput(e.target.value)}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Até</Label>
                        <Input
                          type="date"
                          value={rangeFimInput}
                          onChange={(e) => setRangeFimInput(e.target.value)}
                          className="h-8 text-sm"
                        />
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        Agrupamento mensal. Máx 36 meses.
                      </p>
                      <div className="flex gap-2 pt-1">
                        {rangeCustom && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="flex-1 h-8 text-xs"
                            onClick={() => {
                              setRangeCustom(null);
                              setPeriodo(6);
                              setRangePopoverOpen(false);
                            }}
                          >
                            Limpar
                          </Button>
                        )}
                        <Button
                          size="sm"
                          className="flex-1 h-8 text-xs"
                          disabled={
                            !rangeInicioInput ||
                            !rangeFimInput ||
                            rangeInicioInput > rangeFimInput
                          }
                          onClick={() => {
                            setRangeCustom({
                              inicio: rangeInicioInput,
                              fim: rangeFimInput,
                            });
                            setRangePopoverOpen(false);
                          }}
                        >
                          Aplicar
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              {/* ComposedChart com gradient — mesmo estilo do Dashboard.
                  Recebido + Pendente como áreas sobrepostas com fade vertical
                  e Vencido como Line vermelha (status=OVERDUE pelo Asaas, +
                  PENDING já passada do vencimento, agrupado por data de
                  vencimento). KPI "Vencido" abaixo continua mostrando o
                  total geral. */}
              <div className="h-56 -mx-2">
                {cashFlow && cashFlow.pontos.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={cashFlow.pontos} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="financeiroColorRecebido" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="financeiroColorPendente" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.25} />
                          <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                      <XAxis
                        dataKey="chave"
                        tick={{ fontSize: 10, fill: "#9ca3af" }}
                        tickFormatter={cashFlow.granularidade === "dia" ? formatDiaCurto : formatMes}
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
                        labelFormatter={cashFlow.granularidade === "dia" ? formatDiaCompleto : formatMes}
                        formatter={(v: number) => formatBRL(v)}
                      />
                      <Area
                        type="monotone"
                        dataKey="recebido"
                        stroke="#10b981"
                        strokeWidth={2}
                        fill="url(#financeiroColorRecebido)"
                        name="Recebido"
                      />
                      <Area
                        type="monotone"
                        dataKey="pendente"
                        stroke="#f59e0b"
                        strokeWidth={2}
                        fill="url(#financeiroColorPendente)"
                        name="Pendente"
                      />
                      <Line
                        type="monotone"
                        dataKey="vencido"
                        stroke="#ef4444"
                        strokeWidth={2}
                        dot={{ r: 2, fill: "#ef4444" }}
                        activeDot={{ r: 4 }}
                        name="Vencido"
                      />
                    </ComposedChart>
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
              label="Recebido (líquido)"
              value={formatBRL(kpis?.recebidoLiquido ?? 0)}
              subValue={
                kpis && kpis.recebidoLiquido !== kpis.recebido
                  ? `${formatBRL(kpis.recebido)} bruto`
                  : undefined
              }
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
            </>
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
            <MultiSelectFilter
              placeholder="Todos status"
              value={filtroStatus}
              onChange={setFiltroStatus}
              showFilterIcon
              className="w-40"
              options={[
                { value: "PENDING", label: "Pendente" },
                { value: "RECEIVED", label: "Recebido" },
                { value: "CONFIRMED", label: "Confirmado" },
                { value: "OVERDUE", label: "Vencido" },
                { value: "REFUNDED", label: "Estornado" },
              ]}
            />
            <MultiSelectFilter
              placeholder="Todas formas"
              value={filtroForma}
              onChange={setFiltroForma}
              className="w-36"
              options={[
                { value: "PIX", label: "Pix" },
                { value: "BOLETO", label: "Boleto" },
                { value: "CREDIT_CARD", label: "Cartão" },
                { value: "DINHEIRO", label: "Dinheiro" },
                { value: "TRANSFERENCIA", label: "Transferência" },
                { value: "OUTRO", label: "Outro" },
                { value: "UNDEFINED", label: "Cliente escolhe" },
              ]}
            />
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
                      <TableCell className="text-xs text-muted-foreground max-w-[200px]">
                        <div className="flex items-center gap-1.5">
                          {c.parcelaAtual && c.parcelaTotal && (
                            <span
                              className="shrink-0 rounded border border-violet-300 bg-violet-50 px-1 py-0 text-[9px] font-medium text-violet-700 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-300"
                              title={`Parcela ${c.parcelaAtual} de ${c.parcelaTotal}`}
                            >
                              {c.parcelaAtual}/{c.parcelaTotal}
                            </span>
                          )}
                          <span className="truncate">{c.descricao || "—"}</span>
                        </div>
                        {Array.isArray(c.acoesVinculadas) && c.acoesVinculadas.length > 0 && (
                          <div
                            className="mt-0.5 flex flex-wrap gap-1"
                            title={c.acoesVinculadas
                              .map((a: any) => a.apelido || `#${a.processoId}`)
                              .join(" · ")}
                          >
                            {c.acoesVinculadas.slice(0, 3).map((a: any) => (
                              <span
                                key={a.processoId}
                                className="rounded border border-blue-200 bg-blue-50 px-1 py-0 text-[9px] text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300"
                              >
                                {a.apelido || `#${a.processoId}`}
                              </span>
                            ))}
                            {c.acoesVinculadas.length > 3 && (
                              <span className="text-[9px] text-muted-foreground">
                                +{c.acoesVinculadas.length - 3}
                              </span>
                            )}
                          </div>
                        )}
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
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                            onClick={() => setAnexosCobrId(c.id)}
                            title="Anexos (boletos, recibos, NFe)"
                          >
                            <Paperclip className="h-3.5 w-3.5" />
                          </Button>
                          {/* "Marcar paga": só pra manual + pendente/vencida.
                              Em cobranças Asaas, o status sincroniza via
                              webhook automaticamente — botão seria confuso. */}
                          {perms.podeEditar && c.origem === "manual" &&
                            (c.status === "PENDING" || c.status === "OVERDUE") && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-emerald-600"
                                onClick={() => marcarPagaMut.mutate({ id: c.id })}
                                disabled={marcarPagaMut.isPending}
                                title="Marcar como paga (hoje)"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          {perms.podeExcluir && c.status === "PENDING" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-destructive"
                              onClick={() => setCobrancaParaCancelar(c)}
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
              {/* Paginação: aparece quando há mais de 1 página */}
              {(cobrancas?.total ?? 0) > ITENS_POR_PAGINA && (
                <div className="flex items-center justify-between px-3 py-2 border-t text-xs">
                  <span className="text-muted-foreground tabular-nums">
                    {paginaCob * ITENS_POR_PAGINA + 1}–
                    {Math.min(
                      (paginaCob + 1) * ITENS_POR_PAGINA,
                      cobrancas?.total ?? 0,
                    )}{" "}
                    de {cobrancas?.total ?? 0}
                  </span>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => setPaginaCob((p) => Math.max(0, p - 1))}
                      disabled={paginaCob === 0 || loadCob}
                    >
                      Anterior
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => setPaginaCob((p) => p + 1)}
                      disabled={
                        (paginaCob + 1) * ITENS_POR_PAGINA >=
                          (cobrancas?.total ?? 0) || loadCob
                      }
                    >
                      Próxima
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <Receipt className="h-8 w-8 text-muted-foreground opacity-30" />
              <p className="text-sm text-muted-foreground">
                {busca || filtroStatus.length > 0 || filtroForma.length > 0
                  ? "Nenhuma cobrança corresponde aos filtros."
                  : conectado
                    ? "Nenhuma cobrança ainda."
                    : "Nenhuma cobrança manual ainda. Clique em 'Nova cobrança' pra registrar."}
              </p>
            </div>
          )}
          </div>
        </TabsContent>

        {/* ─── Aba: Clientes ─── */}
        <TabsContent value="clientes" className="mt-4 space-y-4">
          {!conectado ? (
            <AsaasDisconnectedCta titulo="Clientes vinculados" descricao="Sincronização com clientes do Asaas." />
          ) : (
            <div className="space-y-4">
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
            </div>
          )}
        </TabsContent>

        <TabsContent value="comissoes" className="mt-4">
          <ComissoesTab />
        </TabsContent>

        <TabsContent value="despesas" className="mt-4">
          <DespesasTab />
        </TabsContent>

        <TabsContent value="relatorios" className="mt-4">
          <RelatoriosTab />
        </TabsContent>
      </Tabs>

      {/* ─── Dialogs ─── */}
      <NovaCobrancaDialog
        open={novaCobrancaOpen}
        onOpenChange={setNovaCobrancaOpen}
        asaasConectado={conectado}
        onSuccess={() => {
          refetchCob();
          refetchKpis();
        }}
      />
      <NovoClienteDialog
        open={novoClienteOpen}
        onOpenChange={setNovoClienteOpen}
        onSuccess={refetchClientes}
      />
      <AnexosCobrancaDialog
        cobrancaId={anexosCobrId}
        open={anexosCobrId !== null}
        onOpenChange={(o) => !o && setAnexosCobrId(null)}
      />
      <OFXImportDialog
        open={ofxOpen}
        onOpenChange={setOfxOpen}
        onSuccess={() => {
          refetchCob();
          refetchKpis();
        }}
      />
      <LimpezaContatosOrfaosDialog
        open={limpezaOpen}
        onOpenChange={setLimpezaOpen}
        onSuccess={() => {
          refetchCob();
          refetchClientes();
        }}
      />

      <AlertDialog
        open={confirmBulkCancel}
        onOpenChange={setConfirmBulkCancel}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Cancelar {cobrancasBulkSelecionadas.length} cobrança(s)
              pendente(s)?
            </AlertDialogTitle>
            <AlertDialogDescription>
              As cobranças pendentes selecionadas serão canceladas no Asaas e
              no sistema. Cobranças já pagas ou estornadas não são afetadas.
              Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluirCobMut.isPending}>
              Manter
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={excluirCobMut.isPending}
              onClick={(e) => {
                e.preventDefault();
                confirmarBulkCancel();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Cancelar cobranças
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={cobrancaParaCancelar !== null}
        onOpenChange={(o) => !o && setCobrancaParaCancelar(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar cobrança?</AlertDialogTitle>
            <AlertDialogDescription>
              A cobrança de{" "}
              <strong>
                {cobrancaParaCancelar?.nomeContato ?? "—"}
              </strong>
              {cobrancaParaCancelar?.valor && (
                <>
                  {" "}no valor de{" "}
                  <strong>
                    {formatBRL(parseFloat(cobrancaParaCancelar.valor))}
                  </strong>
                </>
              )}{" "}
              será cancelada no Asaas e no sistema. Esta ação não pode ser
              desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluirCobMut.isPending}>
              Manter
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={excluirCobMut.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (!cobrancaParaCancelar) return;
                excluirCobMut.mutate({ id: cobrancaParaCancelar.id });
                setCobrancaParaCancelar(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Cancelar cobrança
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Sub-componente: KPI Card ─────────────────────────────────────────────

function KPICard({
  icon: Icon,
  label,
  value,
  subValue,
  color,
}: {
  icon: any;
  label: string;
  value: string;
  /** Linha pequena abaixo do valor principal — útil pra mostrar
   *  recorte secundário tipo "líquido" sob o bruto. */
  subValue?: string;
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
            {subValue && (
              <p className="text-[10px] text-muted-foreground mt-0.5">{subValue}</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** CTA mostrado dentro de cada aba que depende do Asaas estar conectado.
 *  Mantém o módulo Financeiro acessível pra Despesas/Comissões mesmo
 *  sem Asaas — só as abas Asaas-específicas é que pedem conexão. */
function AsaasDisconnectedCta({ titulo, descricao }: { titulo: string; descricao: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
        <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center shadow-lg">
          <DollarSign className="h-8 w-8 text-white" />
        </div>
        <div className="text-center">
          <p className="font-semibold text-lg">{titulo}</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-md">
            {descricao} Conecte sua conta Asaas pra ativar.
          </p>
        </div>
        <Button size="sm" onClick={() => (window.location.href = "/configuracoes")}>
          <Settings className="h-4 w-4 mr-2" />
          Conectar Asaas
        </Button>
      </CardContent>
    </Card>
  );
}

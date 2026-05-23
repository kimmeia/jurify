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
  DollarSign, TrendingUp, TrendingDown, AlertTriangle, Clock, Plus, ExternalLink, Copy,
  RefreshCw, Loader2, Settings, CheckCircle2, XCircle, Receipt, Users,
  UserPlus, Trash2, Search, Wallet, Download, Filter, ArrowUpRight,
  Paperclip, FileUp, Percent, MoreVertical, CalendarDays, CircleDollarSign,
  Wand2, Tags,
} from "lucide-react";
import { PulseDot, gradientAvatar, gerarIniciais } from "./dashboards/common";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { DespesasWrapper } from "./financeiro/DespesasWrapper";
import { OFXImportDialog } from "./financeiro/OFXImportDialog";
import { LimpezaContatosOrfaosDialog } from "./financeiro/LimpezaContatosOrfaosDialog";
import { DiagnosticarDuplicidadesDialog } from "./financeiro/DiagnosticarDuplicidadesDialog";
import { ResolverDuplicidadesDialog } from "./financeiro/ResolverDuplicidadesDialog";
import { ResetarHistoricoDialog } from "./financeiro/ResetarHistoricoDialog";
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
  const [diagOpen, setDiagOpen] = useState(false);
  const [resolverDupOpen, setResolverDupOpen] = useState(false);
  const [resetHistOpen, setResetHistOpen] = useState(false);
  const perms = useFinanceiroPerms();
  const [novoClienteOpen, setNovoClienteOpen] = useState(false);
  // Aba Clientes: chip de quick filter + filtro de dias em atraso + ordenação por coluna.
  type ClientesChip = "todos" | "inadimplentes" | "pendente" | "bons" | "sem_cobranca";
  type ClientesSortCol = "nome" | "cobrancas" | "pendente" | "vencido" | "pago" | "atraso";
  type ClientesSortDir = "asc" | "desc";
  const [chipClientes, setChipClientes] = useState<ClientesChip>("todos");
  const [filtroDiasAtraso, setFiltroDiasAtraso] = useState<string>("");
  const [sortClientes, setSortClientes] = useState<{ col: ClientesSortCol; dir: ClientesSortDir } | null>(null);
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
  const [bulkAtribuirAberto, setBulkAtribuirAberto] = useState(false);
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

  // Filtro de período da aba Cobranças usa COALESCE(dataPagamento,
  // vencimento) no backend — bate com a ordenação. Pendentes/vencidas
  // entram pelo vencimento, pagas pela dataPagamento. Mostra todos
  // os status por default — filtros aplicam-se sobre o conjunto completo.
  const [filtrosAvancados, setFiltrosAvancados] = useState<FiltrosAvancadosState>(
    () => carregarFiltrosAvancados(),
  );
  useEffect(() => {
    salvarFiltrosAvancados(filtrosAvancados);
  }, [filtrosAvancados]);
  const ITENS_POR_PAGINA = 25;
  const [paginaCob, setPaginaCob] = useState(0);
  const { data: cobrancas, isLoading: loadCob, refetch: refetchCob } =
    trpc.asaas.listarCobrancas.useQuery(
      {
        status: filtroStatus.length > 0 ? filtroStatus : undefined,
        formaPagamento: filtroForma.length > 0 ? filtroForma : undefined,
        pagamentoInicio: rangeEfetivo.inicio,
        pagamentoFim: rangeEfetivo.fim,
        categoriaIds: filtrosAvancados.categoriaIds.length > 0
          ? filtrosAvancados.categoriaIds : undefined,
        incluirSemCategoria: filtrosAvancados.incluirSemCategoria || undefined,
        atendenteIds: filtrosAvancados.atendenteIds.length > 0
          ? filtrosAvancados.atendenteIds : undefined,
        incluirSemAtendente: filtrosAvancados.incluirSemAtendente || undefined,
        comissao: filtrosAvancados.comissao.length > 0
          ? filtrosAvancados.comissao : undefined,
        valorMin: filtrosAvancados.valorMin ?? undefined,
        valorMax: filtrosAvancados.valorMax ?? undefined,
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
    filtrosAvancados,
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

  // Bulk cancel via endpoint dedicado. Serializa as chamadas ao Asaas
  // no backend pra respeitar rate limit (antes o frontend disparava N
  // mutations em paralelo, podendo bloquear a API key por 12h).
  const excluirCobBulkMut = (trpc as any).asaas?.excluirCobrancasEmMassa?.useMutation?.({
    onSuccess: (r: {
      excluidasAsaas: number;
      excluidasManual: number;
      ignoradas: number;
      erros: Array<{ id: number; mensagem: string }>;
      abortadoPorRateLimit: boolean;
    }) => {
      const total = r.excluidasAsaas + r.excluidasManual;
      if (r.abortadoPorRateLimit) {
        toast.warning(
          `${total} cancelada(s) — lote pausado por rate limit. Tente o restante em alguns minutos.`,
        );
      } else if (r.erros.length > 0) {
        toast.warning(
          `${total} cancelada(s), ${r.erros.length} com erro` +
            (r.ignoradas > 0 ? `, ${r.ignoradas} ignorada(s)` : ""),
          { description: r.erros.slice(0, 3).map((e) => e.mensagem).join(" · ") },
        );
      } else {
        toast.success(
          `${total} cobrança(s) cancelada(s)` +
            (r.ignoradas > 0 ? ` · ${r.ignoradas} ignorada(s)` : ""),
        );
      }
      setSelecionadas(new Set());
      utils.asaas.listarCobrancas.invalidate();
      utils.asaas.kpis.invalidate();
    },
    onError: (err: any) =>
      toast.error("Erro", { description: err.message }),
  }) ?? { mutate: () => {}, isPending: false };

  // Listas pra edição inline de categoria/atendente em cada linha da
  // tabela de cobranças. 1 query no mount cada, cacheada — render
  // popover na célula sem refetch a cada interação.
  const { data: categoriasList } =
    trpc.financeiro.listarCategoriasCobranca.useQuery(undefined, {
      staleTime: 5 * 60_000,
    });
  const { data: equipeData } =
    trpc.configuracoes.listarColaboradores.useQuery(undefined, {
      staleTime: 5 * 60_000,
    });
  const atendentesList = useMemo(
    () =>
      (equipeData && "colaboradores" in equipeData
        ? equipeData.colaboradores
        : []
      ).filter((c: any) => c.cargo !== "estagiario"),
    [equipeData],
  );

  // Mutation única pra inline (1 ID) e bulk (N IDs). Invalida queries
  // dependentes (kpis, contadoresPendencia pros banners) ao sucesso.
  const atribuirMut = trpc.financeiro.atribuirCobrancasEmMassa.useMutation({
    onSuccess: () => {
      utils.asaas.listarCobrancas.invalidate();
      utils.financeiro.contadoresPendencia.invalidate();
      utils.asaas.kpis.invalidate();
    },
    onError: (err: any) => toast.error("Erro", { description: err.message }),
  });

  // Toggle de comissionável individual — 3 estados (padrão/sim/não) via
  // `asaasCobrancas.comissionavelOverride`. `null` = segue categoria.
  const comissionavelMut = trpc.asaas.atualizarComissionavel.useMutation({
    onSuccess: () => utils.asaas.listarCobrancas.invalidate(),
    onError: (err: any) => toast.error("Erro", { description: err.message }),
  });

  // "Pagamento por terceiro": cobrança paga pelo CPF da esposa de Carlos,
  // mas Carlos é o cliente real. Seta `contatoBeneficiarioId` — DRE/
  // comissão atribuem ao beneficiário (Carlos), nome da esposa fica
  // como "Pago por" na linha.
  const beneficiarioMut = trpc.asaas.atribuirBeneficiario.useMutation({
    onSuccess: () => {
      toast.success("Beneficiário atualizado");
      utils.asaas.listarCobrancas.invalidate();
      utils.financeiro.contadoresPendencia.invalidate();
    },
    onError: (err: any) => toast.error("Erro", { description: err.message }),
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

  // Cobranças elegíveis pra exclusão em massa:
  //  - Asaas: só PENDING (pago lá fora não cancela aqui — webhook propaga)
  //  - Manual: qualquer status (lançamento por engano precisa ser desfeito,
  //    inclusive já marcado como recebido)
  const cobrancasBulkSelecionadas = cobrancasFiltradas.filter((c: any) => {
    if (!selecionadas.has(c.id)) return false;
    if (c.origem === "manual") return true;
    return c.status === "PENDING";
  });

  const handleBulkDelete = () => {
    if (cobrancasBulkSelecionadas.length === 0) {
      toast.error(
        "Nenhuma cobrança elegível selecionada. Asaas: só pendentes. Manual: qualquer status.",
      );
      return;
    }
    setConfirmBulkCancel(true);
  };

  const confirmarBulkCancel = () => {
    const ids = cobrancasBulkSelecionadas.map((c: any) => Number(c.id));
    excluirCobBulkMut.mutate({ ids });
    setConfirmBulkCancel(false);
  };

  // ─── Queries dedicadas pra cards de atenção ───────────────────────────────
  // ANTES: calculávamos de `cobrancas.items` (página atual filtrada por
  // range/status), o que escondia OVERDUE antigas e PENDING futuras.
  // AGORA: 2 queries dedicadas — uma pra todos os OVERDUE do escritório
  // e outra pros PENDING dos próximos 7 dias. Cache de 5min (mesmo que
  // a lista principal).
  const hoje7d = useMemo(() => {
    const h = new Date();
    h.setHours(0, 0, 0, 0);
    const hojeStr = h.toISOString().slice(0, 10);
    const sete = new Date(h);
    sete.setDate(sete.getDate() + 7);
    return { hojeStr, fimStr: sete.toISOString().slice(0, 10) };
  }, []);

  const { data: cobrancasVencidas } = trpc.asaas.listarCobrancas.useQuery(
    { status: ["OVERDUE"], limit: 100 },
    { retry: false, refetchInterval: REFRESH_MS, enabled: !!statusAsaas?.conectado },
  );

  const { data: cobrancasProximas7d } = trpc.asaas.listarCobrancas.useQuery(
    {
      status: ["PENDING"],
      vencimentoInicio: hoje7d.hojeStr,
      vencimentoFim: hoje7d.fimStr,
      limit: 100,
    },
    { retry: false, refetchInterval: REFRESH_MS, enabled: !!statusAsaas?.conectado },
  );

  // Top devedores: agrupa OVERDUE por contato, soma valor, pega top 3.
  const topDevedores = useMemo(() => {
    const lista: any[] = (cobrancasVencidas as any)?.items || [];
    const grupos = new Map<string, { nome: string; valor: number; qtd: number; maxDias: number }>();
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    for (const c of lista) {
      const nome = (c as any).nomeContato || "—";
      const valor = parseFloat(c.valor) || 0;
      const venc = c.vencimento ? new Date(c.vencimento + "T12:00:00") : null;
      const dias = venc ? Math.floor((hoje.getTime() - venc.getTime()) / (1000 * 60 * 60 * 24)) : 0;
      const atual = grupos.get(nome) ?? { nome, valor: 0, qtd: 0, maxDias: 0 };
      atual.valor += valor;
      atual.qtd += 1;
      atual.maxDias = Math.max(atual.maxDias, dias);
      grupos.set(nome, atual);
    }
    return Array.from(grupos.values()).sort((a, b) => b.valor - a.valor).slice(0, 3);
  }, [cobrancasVencidas]);

  // Receita prevista nos próximos 7 dias (já vem filtrada do backend)
  const receitaPrevista7d = useMemo(() => {
    const lista: any[] = (cobrancasProximas7d as any)?.items || [];
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    return lista
      .map((c: any) => ({
        id: c.id,
        nome: c.nomeContato || "—",
        valor: parseFloat(c.valor) || 0,
        forma: c.formaPagamento || "UNDEFINED",
        vencimento: c.vencimento,
        diasAte: c.vencimento
          ? Math.max(0, Math.ceil((new Date(c.vencimento + "T12:00:00").getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24)))
          : 0,
      }))
      .sort((a: any, b: any) => a.diasAte - b.diasAte)
      .slice(0, 5);
  }, [cobrancasProximas7d]);
  const totalReceitaPrevista7d = receitaPrevista7d.reduce((a: number, b: any) => a + b.valor, 0);

  // % inadimplência derivado dos KPIs
  const pctInadimplencia = useMemo(() => {
    const venc = kpis?.vencido ?? 0;
    const pend = kpis?.pendente ?? 0;
    const recVenc = kpis?.recebidoComVencimentoNoPeriodo ?? 0;
    const totalEsperado = venc + pend + recVenc;
    if (totalEsperado <= 0) return null;
    return +((venc / totalEsperado) * 100).toFixed(1);
  }, [kpis]);

  // Pontos do sparkline (cashflow mensal) — pega só recebido
  const sparkPontos = useMemo(
    () => (cashFlow?.pontos || []).map((p: any) => Number(p.recebido || 0)),
    [cashFlow],
  );

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
    <div className="rounded-2xl bg-gradient-to-br from-slate-50/40 via-white to-emerald-50/20 p-6 space-y-5">
      {/* ═══════════ STATUS BAR ═══════════ */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-full">
            {conectado ? (
              <>
                <PulseDot />
                <span className="text-xs font-semibold text-slate-900">Asaas {statusAsaas?.modo === "sandbox" ? "Sandbox" : "conectado"}</span>
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                <span className="text-xs font-medium text-slate-500">Asaas desconectado</span>
              </>
            )}
          </div>
          {conectado && saldo && (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-full">
              <CircleDollarSign className="w-3.5 h-3.5 text-emerald-600" />
              <span className="text-xs text-slate-500">Saldo Asaas</span>
              <span className="text-xs font-bold tabular-nums text-slate-900">
                {formatBRL(saldo.balance)}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {conectado ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => syncMut.mutate()}
              disabled={syncMut.isPending}
              className="h-9"
              title="Atualiza status/pagamento das cobranças. Pra importar cobranças novas, use 'Importar histórico' em Configurações."
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
              className="h-9"
              onClick={() => (window.location.href = "/configuracoes")}
            >
              <Settings className="h-3.5 w-3.5 mr-1.5" />
              Conectar Asaas
            </Button>
          )}
          {perms.podeCriar && (
            <Button
              size="sm"
              onClick={() => setNovaCobrancaOpen(true)}
              className="h-9 bg-slate-900 text-white hover:bg-slate-800 font-semibold"
              title={!conectado ? "Asaas desconectado: você pode registrar cobrança manual (dinheiro/transferência)" : undefined}
            >
              <Plus className="h-4 w-4 mr-1.5" />
              Nova cobrança
            </Button>
          )}
          {(perms.podeEditar || perms.podeExcluir) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="px-2 h-9" title="Mais ações">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {perms.podeEditar && (
                  <DropdownMenuItem
                    onClick={() => setOfxOpen(true)}
                    title="Conciliar extrato bancário (OFX): marcar pagas as despesas/cobranças que o banco confirmou"
                  >
                    <FileUp className="h-4 w-4 mr-2" />
                    Importar OFX
                  </DropdownMenuItem>
                )}
                {perms.podeExcluir && (
                  <DropdownMenuItem
                    onClick={() => setLimpezaOpen(true)}
                    title="Remover contatos importados do Asaas que não têm cobrança nem processo vinculado"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Limpar órfãos
                  </DropdownMenuItem>
                )}
                {perms.podeExcluir && (
                  <DropdownMenuItem
                    onClick={() => setResolverDupOpen(true)}
                    title="Wizard pra limpar duplicatas no caixa — resolver cada par escolhendo qual cobrança manter"
                  >
                    <Wand2 className="h-4 w-4 mr-2" />
                    Resolver duplicatas
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() => setDiagOpen(true)}
                  title="Visão geral read-only: contagem de duplicatas, órfãs pagas, manuais já-pagas"
                >
                  <Search className="h-4 w-4 mr-2" />
                  Diagnosticar (visão geral)
                </DropdownMenuItem>
                {perms.podeExcluir && (
                  <DropdownMenuItem
                    onClick={() => setResetHistOpen(true)}
                    className="text-destructive focus:text-destructive focus:bg-destructive/10"
                    title="Apaga tudo (cobranças + comissões) pra ressincronizar do zero. Preserva configuração e mapeamento de clientes."
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Resetar histórico (zerar)
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* ═══════════ HERO COMANDO CENTRAL ═══════════ */}
      <HeroFinanceiro
        kpis={kpis}
        saldo={saldo}
        sparkPontos={sparkPontos}
        periodo={periodo}
        rangeCustom={rangeCustom}
        onPeriodoChange={(v) => { setRangeCustom(null); setPeriodo(v); }}
      />

      {/* ═══════════ LINHA DE ATENÇÃO ═══════════ */}
      {conectado && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <CardInadimplencia pct={pctInadimplencia} vencido={kpis?.vencido ?? 0} />
          <CardTopDevedores devedores={topDevedores} />
          <CardReceitaPrevista lista={receitaPrevista7d} total={totalReceitaPrevista7d} />
        </div>
      )}

      {/* ─── Tabs principais ─── */}
      {/*
        TabsList é sticky pra continuar acessível ao rolar — antes ficava
        no rodapé da página depois do hero+KPIs+forecast, exigindo scroll
        pra qualquer navegação. Cada aba tem seus KPIs/gráficos
        contextuais (cobranças vê fluxo de caixa; comissões vê os KPIs
        próprios — total comissionável, sem decisão, próximo lançamento).
      */}
      <Tabs value={tab} onValueChange={setTab}>
        <div className="sticky top-0 z-20 py-2 -mx-4 px-4 sm:-mx-6 sm:px-6 bg-gradient-to-br from-slate-50/95 to-white/95 backdrop-blur-md">
          <TabsList className="!bg-slate-100 !h-auto !p-1.5 inline-flex gap-1 rounded-xl border border-slate-200 shadow-sm">
            <TabsTrigger
              value="cobrancas"
              className="!text-xs !gap-1.5 !px-3 !py-2 !rounded-lg !text-slate-600 hover:!text-slate-900 data-[state=active]:!bg-white data-[state=active]:!text-slate-900 data-[state=active]:!shadow-sm transition-all"
            >
              <Receipt className="h-3.5 w-3.5" />
              Cobranças
              <span className="ml-1 text-[10px] bg-slate-200/70 text-slate-600 px-1.5 rounded-full tabular-nums font-semibold">
                {kpis?.totalCobrancas ?? 0}
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="clientes"
              className="!text-xs !gap-1.5 !px-3 !py-2 !rounded-lg !text-slate-600 hover:!text-slate-900 data-[state=active]:!bg-white data-[state=active]:!text-slate-900 data-[state=active]:!shadow-sm transition-all"
            >
              <Users className="h-3.5 w-3.5" />
              Clientes
              <span className="ml-1 text-[10px] bg-slate-200/70 text-slate-600 px-1.5 rounded-full tabular-nums font-semibold">
                {clientesVinculados?.length ?? 0}
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="despesas"
              className="!text-xs !gap-1.5 !px-3 !py-2 !rounded-lg !text-slate-600 hover:!text-slate-900 data-[state=active]:!bg-white data-[state=active]:!text-slate-900 data-[state=active]:!shadow-sm transition-all"
            >
              <TrendingDown className="h-3.5 w-3.5" />
              Despesas
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
          <BannersPendencia />
          <PainelSyncHistorico />
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
            <FiltrosAvancadosPopover
              filtros={filtrosAvancados}
              setFiltros={setFiltrosAvancados}
              categorias={(categoriasList ?? []).filter((c: any) => c.ativo)}
              atendentes={atendentesList}
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
              {perms.podeEditar && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                  onClick={() => setBulkAtribuirAberto(true)}
                  disabled={atribuirMut.isPending}
                >
                  <Tags className="h-3.5 w-3.5 mr-1" />
                  Atribuir em massa
                </Button>
              )}
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
                    <TableHead className="min-w-[140px]">Categoria</TableHead>
                    <TableHead className="min-w-[140px]">Atendente</TableHead>
                    <TableHead className="min-w-[110px]">Comissão</TableHead>
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
                      <TableCell className="font-medium text-sm">
                        <CelulaCliente
                          cobranca={c}
                          podeEditar={perms.podeEditar}
                          onAtribuirBeneficiario={(beneficiarioId) =>
                            beneficiarioMut.mutate({
                              cobrancaId: c.id,
                              contatoBeneficiarioId: beneficiarioId,
                            })
                          }
                        />
                      </TableCell>
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
                      <TableCell className="p-1">
                        <CelulaCategoria
                          cobrancaId={c.id}
                          categoriaIdAtual={c.categoriaId ?? null}
                          categorias={(categoriasList ?? []).filter(
                            (cat: any) => cat.ativo,
                          )}
                          onAtribuir={(categoriaId) =>
                            atribuirMut.mutate({
                              cobrancaIds: [c.id],
                              categoriaId,
                            })
                          }
                          disabled={!perms.podeEditar || atribuirMut.isPending}
                        />
                      </TableCell>
                      <TableCell className="p-1">
                        <CelulaAtendente
                          cobrancaId={c.id}
                          atendenteIdAtual={c.atendenteId ?? null}
                          atendentes={atendentesList}
                          onAtribuir={(atendenteId) =>
                            atribuirMut.mutate({
                              cobrancaIds: [c.id],
                              atendenteId,
                            })
                          }
                          disabled={!perms.podeEditar || atribuirMut.isPending}
                        />
                      </TableCell>
                      <TableCell className="p-1">
                        <CelulaComissao
                          cobrancaId={c.id}
                          comissionavelOverride={c.comissionavelOverride ?? null}
                          onAtualizar={(v) =>
                            comissionavelMut.mutate({ id: c.id, valor: v })
                          }
                          disabled={!perms.podeEditar || comissionavelMut.isPending}
                        />
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
                          {/* Excluir:
                              - Asaas: só PENDING (Asaas pago não cancela aqui)
                              - Manual: qualquer status (engano precisa ser desfeito) */}
                          {perms.podeExcluir &&
                            (c.origem === "manual" || c.status === "PENDING") && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-destructive"
                              onClick={() => setCobrancaParaCancelar(c)}
                              title={
                                c.origem === "manual" && c.status !== "PENDING"
                                  ? "Excluir cobrança manual (qualquer status)"
                                  : "Cancelar cobrança pendente"
                              }
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
            <ClientesContent
              clientes={clientesVinculados ?? []}
              busca={busca}
              setBusca={setBusca}
              onNovoCliente={() => setNovoClienteOpen(true)}
              chip={chipClientes}
              setChip={setChipClientes}
              filtroDiasAtraso={filtroDiasAtraso}
              setFiltroDiasAtraso={setFiltroDiasAtraso}
              sort={sortClientes}
              setSort={setSortClientes}
            />
          )}
        </TabsContent>

        <TabsContent value="despesas" className="mt-4">
          <DespesasWrapper />
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
      <DiagnosticarDuplicidadesDialog
        open={diagOpen}
        onOpenChange={setDiagOpen}
      />
      <ResolverDuplicidadesDialog
        open={resolverDupOpen}
        onOpenChange={setResolverDupOpen}
      />

      <ResetarHistoricoDialog
        open={resetHistOpen}
        onOpenChange={setResetHistOpen}
        onSuccess={() => {
          // Invalida tudo do módulo asaas — estado mudou radicalmente
          utils.asaas.kpis.invalidate();
          utils.asaas.listarCobrancas.invalidate();
          utils.asaas.listarClientesVinculados.invalidate();
          (utils.asaas as any).resumoPorContatos?.invalidate?.();
          (utils.asaas as any).diagnosticarDuplicidades?.invalidate?.();
          (utils.asaas as any).listarParesSuspeitos?.invalidate?.();
        }}
      />

      <AlertDialog
        open={confirmBulkCancel}
        onOpenChange={setConfirmBulkCancel}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Excluir {cobrancasBulkSelecionadas.length} cobrança(s)?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Cobranças Asaas pendentes serão canceladas no Asaas e no sistema;
              cobranças manuais serão removidas do sistema. Cobranças Asaas já
              pagas/estornadas não são afetadas. Esta ação não pode ser desfeita.
              Cobranças que já entraram em fechamento de comissão são bloqueadas
              automaticamente — exclua o fechamento primeiro se precisar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluirCobBulkMut.isPending}>
              Manter
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={excluirCobBulkMut.isPending}
              onClick={(e) => {
                e.preventDefault();
                confirmarBulkCancel();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {excluirCobBulkMut.isPending ? "Excluindo..." : "Excluir"}
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

      <BulkAtribuirDialog
        open={bulkAtribuirAberto}
        onClose={() => setBulkAtribuirAberto(false)}
        cobrancaIds={Array.from(selecionadas).map((id) => Number(id))}
        categorias={(categoriasList ?? []).filter((c: any) => c.ativo)}
        atendentes={atendentesList}
        onConfirm={(payload) => {
          atribuirMut.mutate(payload, {
            onSuccess: (r: any) => {
              toast.success(
                `${r?.atualizadas ?? payload.cobrancaIds.length} cobrança(s) atualizada(s)`,
              );
              setBulkAtribuirAberto(false);
              setSelecionadas(new Set());
            },
          });
        }}
        isPending={atribuirMut.isPending}
      />
    </div>
  );
}

// ─── Sub-componente: aba Clientes (filtros + ordenação client-side) ──────

type ClientesChipLocal = "todos" | "inadimplentes" | "pendente" | "bons" | "sem_cobranca";
type ClientesSortColLocal = "nome" | "cobrancas" | "pendente" | "vencido" | "pago" | "atraso";
type ClientesSortDirLocal = "asc" | "desc";

function ClientesContent({
  clientes,
  busca,
  setBusca,
  onNovoCliente,
  chip,
  setChip,
  filtroDiasAtraso,
  setFiltroDiasAtraso,
  sort,
  setSort,
}: {
  clientes: any[];
  busca: string;
  setBusca: (v: string) => void;
  onNovoCliente: () => void;
  chip: ClientesChipLocal;
  setChip: (v: ClientesChipLocal) => void;
  filtroDiasAtraso: string;
  setFiltroDiasAtraso: (v: string) => void;
  sort: { col: ClientesSortColLocal; dir: ClientesSortDirLocal } | null;
  setSort: (v: { col: ClientesSortColLocal; dir: ClientesSortDirLocal } | null) => void;
}) {
  // Contagens pra mostrar nos chips
  const contagens = useMemo(() => ({
    todos: clientes.length,
    inadimplentes: clientes.filter((c) => c.vencido > 0).length,
    pendente: clientes.filter((c) => c.pendente > 0).length,
    bons: clientes.filter((c) => c.pago > 0 && c.vencido === 0).length,
    sem_cobranca: clientes.filter((c) => c.totalCobrancas === 0).length,
  }), [clientes]);

  // Aplica filtro do chip + filtro de dias em atraso
  const filtrados = useMemo(() => {
    let lista = clientes;
    if (chip === "inadimplentes") lista = lista.filter((c) => c.vencido > 0);
    else if (chip === "pendente") lista = lista.filter((c) => c.pendente > 0);
    else if (chip === "bons") lista = lista.filter((c) => c.pago > 0 && c.vencido === 0);
    else if (chip === "sem_cobranca") lista = lista.filter((c) => c.totalCobrancas === 0);
    const minDias = parseInt(filtroDiasAtraso, 10);
    if (!isNaN(minDias) && minDias > 0) {
      lista = lista.filter((c) => c.diasAtrasoMax != null && c.diasAtrasoMax >= minDias);
    }
    return lista;
  }, [clientes, chip, filtroDiasAtraso]);

  // Ordenação. Quando sort=null, aplica a ordem default conforme o chip ativo.
  const ordenados = useMemo(() => {
    const efetivo = sort ?? defaultSortPorChip(chip);
    const cmp = (a: any, b: any) => {
      const vA = valorOrdenacao(a, efetivo.col);
      const vB = valorOrdenacao(b, efetivo.col);
      if (vA < vB) return efetivo.dir === "asc" ? -1 : 1;
      if (vA > vB) return efetivo.dir === "asc" ? 1 : -1;
      return 0;
    };
    return [...filtrados].sort(cmp);
  }, [filtrados, sort, chip]);

  const handleSort = (col: ClientesSortColLocal) => {
    if (!sort || sort.col !== col) {
      setSort({ col, dir: "desc" });
    } else if (sort.dir === "desc") {
      setSort({ col, dir: "asc" });
    } else {
      setSort(null);
    }
  };

  return (
    <div className="space-y-3">
      {/* Linha 1: busca + filtro dias + novo cliente */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar cliente..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
        <div className="flex items-center gap-1.5 text-xs border rounded px-2 h-9 bg-background">
          <span className="text-muted-foreground">Atraso &gt;</span>
          <Input
            type="number"
            min="0"
            value={filtroDiasAtraso}
            onChange={(e) => setFiltroDiasAtraso(e.target.value)}
            className="h-7 w-14 text-xs border-0 shadow-none px-1 focus-visible:ring-0"
            placeholder="0"
          />
          <span className="text-muted-foreground">dias</span>
        </div>
        {(chip !== "todos" || filtroDiasAtraso !== "" || sort != null) && (
          <Button
            size="sm"
            variant="ghost"
            className="h-9 text-xs"
            onClick={() => {
              setChip("todos");
              setFiltroDiasAtraso("");
              setSort(null);
            }}
          >
            Limpar
          </Button>
        )}
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={onNovoCliente}>
          <UserPlus className="h-3.5 w-3.5 mr-1" />
          Novo cliente
        </Button>
      </div>

      {/* Linha 2: chips de quick filter */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider mr-1">Mostrar:</span>
        <ClientesChipBtn ativo={chip === "todos"} onClick={() => setChip("todos")}>
          Todos ({contagens.todos})
        </ClientesChipBtn>
        <ClientesChipBtn ativo={chip === "inadimplentes"} onClick={() => setChip("inadimplentes")}>
          ⚠ Inadimplentes ({contagens.inadimplentes})
        </ClientesChipBtn>
        <ClientesChipBtn ativo={chip === "pendente"} onClick={() => setChip("pendente")}>
          ⏱ Com pendente ({contagens.pendente})
        </ClientesChipBtn>
        <ClientesChipBtn ativo={chip === "bons"} onClick={() => setChip("bons")}>
          ✓ Bons pagadores ({contagens.bons})
        </ClientesChipBtn>
        <ClientesChipBtn ativo={chip === "sem_cobranca"} onClick={() => setChip("sem_cobranca")}>
          — Sem cobrança ({contagens.sem_cobranca})
        </ClientesChipBtn>
      </div>

      {ordenados.length > 0 ? (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead><SortBtn label="Nome" col="nome" sort={sort} onClick={handleSort} /></TableHead>
                <TableHead>CPF/CNPJ</TableHead>
                <TableHead>Contato</TableHead>
                <TableHead className="text-center"><SortBtn label="Cobranças" col="cobrancas" sort={sort} onClick={handleSort} /></TableHead>
                <TableHead className="text-right"><SortBtn label="Pendente" col="pendente" sort={sort} onClick={handleSort} /></TableHead>
                <TableHead className="text-right"><SortBtn label="Vencido" col="vencido" sort={sort} onClick={handleSort} /></TableHead>
                <TableHead className="text-right"><SortBtn label="Pago" col="pago" sort={sort} onClick={handleSort} /></TableHead>
                <TableHead className="text-right"><SortBtn label="Atraso" col="atraso" sort={sort} onClick={handleSort} /></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ordenados.map((c: any) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium text-sm">{c.contatoNome}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{c.cpfCnpj}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {c.contatoTelefone || c.contatoEmail || "—"}
                  </TableCell>
                  <TableCell className="text-sm text-center tabular-nums">{c.totalCobrancas}</TableCell>
                  <TableCell className="text-sm text-right text-amber-600 tabular-nums">
                    {c.pendente > 0 ? formatBRL(c.pendente) : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-right text-red-600 tabular-nums">
                    {c.vencido > 0 ? formatBRL(c.vencido) : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-right text-emerald-600 tabular-nums">
                    {c.pago > 0 ? formatBRL(c.pago) : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-right tabular-nums">
                    {c.diasAtrasoMax != null ? (
                      <span className="text-red-600 font-semibold">{c.diasAtrasoMax} dias</span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 gap-2">
          <Users className="h-8 w-8 text-muted-foreground opacity-30" />
          <p className="text-sm text-muted-foreground">
            {clientes.length === 0 ? "Nenhum cliente vinculado." : "Nenhum cliente bate com os filtros."}
          </p>
        </div>
      )}
    </div>
  );
}

function ClientesChipBtn({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
        ativo
          ? "bg-foreground text-background border-foreground"
          : "bg-background text-muted-foreground hover:bg-muted border-border"
      }`}
    >
      {children}
    </button>
  );
}

function SortBtn({
  label,
  col,
  sort,
  onClick,
}: {
  label: string;
  col: ClientesSortColLocal;
  sort: { col: ClientesSortColLocal; dir: ClientesSortDirLocal } | null;
  onClick: (c: ClientesSortColLocal) => void;
}) {
  const ativo = sort?.col === col;
  const icon = !ativo ? "↕" : sort?.dir === "desc" ? "↓" : "↑";
  return (
    <button
      onClick={() => onClick(col)}
      className={`inline-flex items-center gap-1 font-semibold hover:text-foreground ${
        ativo ? "text-foreground" : "text-muted-foreground"
      }`}
    >
      {label}
      <span className={ativo ? "" : "text-muted-foreground/50"}>{icon}</span>
    </button>
  );
}

function defaultSortPorChip(
  chip: ClientesChipLocal,
): { col: ClientesSortColLocal; dir: ClientesSortDirLocal } {
  if (chip === "inadimplentes") return { col: "atraso", dir: "desc" };
  if (chip === "pendente") return { col: "pendente", dir: "desc" };
  if (chip === "bons") return { col: "pago", dir: "desc" };
  return { col: "nome", dir: "asc" };
}

function valorOrdenacao(c: any, col: ClientesSortColLocal): number | string {
  switch (col) {
    case "nome": return (c.contatoNome || "").toLowerCase();
    case "cobrancas": return c.totalCobrancas || 0;
    case "pendente": return c.pendente || 0;
    case "vencido": return c.vencido || 0;
    case "pago": return c.pago || 0;
    case "atraso": return c.diasAtrasoMax ?? -1;
  }
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

/**
 * Filtros avançados da aba Cobranças — multi-select de Categoria,
 * Atendente, Status de comissão + range de valor. Persiste em
 * localStorage pra o usuário não perder ao recarregar.
 */
type FiltrosAvancadosState = {
  categoriaIds: number[];
  incluirSemCategoria: boolean;
  atendenteIds: number[];
  incluirSemAtendente: boolean;
  comissao: ("sim" | "nao" | "indef")[];
  valorMin: number | null;
  valorMax: number | null;
};

const FILTROS_AV_DEFAULT: FiltrosAvancadosState = {
  categoriaIds: [],
  incluirSemCategoria: false,
  atendenteIds: [],
  incluirSemAtendente: false,
  comissao: [],
  valorMin: null,
  valorMax: null,
};

const FILTROS_AV_LS_KEY = "jurify:financeiro:cobrancas:filtros-avancados:v1";

function carregarFiltrosAvancados(): FiltrosAvancadosState {
  if (typeof window === "undefined") return FILTROS_AV_DEFAULT;
  try {
    const raw = localStorage.getItem(FILTROS_AV_LS_KEY);
    if (!raw) return FILTROS_AV_DEFAULT;
    const parsed = JSON.parse(raw);
    return { ...FILTROS_AV_DEFAULT, ...parsed };
  } catch {
    return FILTROS_AV_DEFAULT;
  }
}

function salvarFiltrosAvancados(f: FiltrosAvancadosState) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(FILTROS_AV_LS_KEY, JSON.stringify(f));
  } catch {
    /* localStorage cheio/bloqueado — ignora */
  }
}

function contarFiltrosAvancadosAtivos(f: FiltrosAvancadosState): number {
  let n = 0;
  if (f.categoriaIds.length > 0 || f.incluirSemCategoria) n++;
  if (f.atendenteIds.length > 0 || f.incluirSemAtendente) n++;
  if (f.comissao.length > 0) n++;
  if (f.valorMin !== null || f.valorMax !== null) n++;
  return n;
}

function FiltrosAvancadosPopover({
  filtros,
  setFiltros,
  categorias,
  atendentes,
}: {
  filtros: FiltrosAvancadosState;
  setFiltros: (f: FiltrosAvancadosState) => void;
  categorias: Array<{ id: number; nome: string }>;
  atendentes: Array<{ id: number; userName?: string | null }>;
}) {
  const [aberto, setAberto] = useState(false);
  const ativos = contarFiltrosAvancadosAtivos(filtros);
  const set = <K extends keyof FiltrosAvancadosState>(
    k: K,
    v: FiltrosAvancadosState[K],
  ) => setFiltros({ ...filtros, [k]: v });

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant={ativos > 0 ? "default" : "outline"}
          className="h-9 text-xs gap-1.5"
        >
          <Filter className="h-3.5 w-3.5" />
          Filtros avançados
          {ativos > 0 && (
            <span className="ml-1 rounded-full bg-white/20 px-1.5 text-[10px] font-semibold tabular-nums">
              {ativos}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 max-h-[80vh] overflow-y-auto" align="end">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">Filtros avançados</h4>
            {ativos > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setFiltros(FILTROS_AV_DEFAULT)}
              >
                Limpar tudo
              </Button>
            )}
          </div>

          {/* Categoria */}
          <div className="space-y-1.5">
            <Label className="text-xs">Categoria</Label>
            <MultiSelectFilter
              placeholder="Todas categorias"
              value={filtros.categoriaIds.map(String)}
              onChange={(v) => set("categoriaIds", v.map(Number))}
              options={categorias.map((c) => ({
                value: String(c.id),
                label: c.nome,
              }))}
              className="w-full"
            />
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <Checkbox
                checked={filtros.incluirSemCategoria}
                onCheckedChange={(v) => set("incluirSemCategoria", !!v)}
              />
              <span className="text-amber-700">Incluir cobranças sem categoria</span>
            </label>
          </div>

          {/* Atendente */}
          <div className="space-y-1.5">
            <Label className="text-xs">Atendente</Label>
            <MultiSelectFilter
              placeholder="Todos atendentes"
              value={filtros.atendenteIds.map(String)}
              onChange={(v) => set("atendenteIds", v.map(Number))}
              options={atendentes.map((a) => ({
                value: String(a.id),
                label: a.userName ?? `#${a.id}`,
              }))}
              className="w-full"
            />
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <Checkbox
                checked={filtros.incluirSemAtendente}
                onCheckedChange={(v) => set("incluirSemAtendente", !!v)}
              />
              <span className="text-blue-700">Incluir cobranças sem atendente</span>
            </label>
          </div>

          {/* Comissão */}
          <div className="space-y-1.5">
            <Label className="text-xs">Status de comissão</Label>
            <MultiSelectFilter
              placeholder="Qualquer status"
              value={filtros.comissao}
              onChange={(v) => set("comissao", v as ("sim" | "nao" | "indef")[])}
              options={[
                { value: "sim", label: "Comissiona (Sim)" },
                { value: "nao", label: "Não comissiona" },
                { value: "indef", label: "Indefinida (sem categoria)" },
              ]}
              className="w-full"
            />
          </div>

          {/* Valor */}
          <div className="space-y-1.5">
            <Label className="text-xs">Faixa de valor (R$)</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                step="0.01"
                placeholder="Mín"
                value={filtros.valorMin ?? ""}
                onChange={(e) =>
                  set(
                    "valorMin",
                    e.target.value === "" ? null : parseFloat(e.target.value),
                  )
                }
                className="h-8 text-xs"
              />
              <span className="text-xs text-muted-foreground">até</span>
              <Input
                type="number"
                step="0.01"
                placeholder="Máx"
                value={filtros.valorMax ?? ""}
                onChange={(e) =>
                  set(
                    "valorMax",
                    e.target.value === "" ? null : parseFloat(e.target.value),
                  )
                }
                className="h-8 text-xs"
              />
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Banners "X cobranças sem categoria/sem atendente" no topo da aba
 * Cobranças. Só aparece se contagem > 0 — cria loop natural de
 * manutenção (some quando você zera). Link leva pra /relatorios
 * (DRE) ou /atribuir-cobrancas conforme o caso.
 *
 * Som direciona o operador pra `?filtro=semCategoria` na lista de
 * atribuição (sub-tab "Atribuir cobranças" dentro do DespesasWrapper)
 * — assim o trabalho de catch-up vira 1 clique. Futuro: substituir
 * pela edição inline na própria lista de cobranças.
 */
function BannersPendencia() {
  const { data } = trpc.financeiro.contadoresPendencia.useQuery(undefined, {
    staleTime: 60_000,
  });
  if (!data) return null;
  const { semCategoria, semAtendente, semContato } = data;
  if (semCategoria === 0 && semAtendente === 0 && (semContato ?? 0) === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      {(semContato ?? 0) > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-red-300 bg-red-50 p-3 text-xs">
          <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
          <div className="flex-1">
            <b className="text-red-900">
              {semContato} {semContato === 1 ? "cobrança sem cliente" : "cobranças sem cliente"}
            </b>
            <span className="text-red-700">
              {" "}— pagamento recebido sem vínculo no CRM. Afeta DRE, comissão e detecção de duplicatas.
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-red-400 text-red-900 hover:bg-red-100"
            onClick={() => {
              window.location.href = "/financeiro/revisar-orfas";
            }}
          >
            <UserPlus className="h-3 w-3 mr-1" />
            Revisar órfãs
          </Button>
        </div>
      )}
      {semCategoria > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
          <div className="flex-1">
            <b className="text-amber-900">
              {semCategoria} {semCategoria === 1 ? "cobrança sem categoria" : "cobranças sem categoria"}
            </b>
            <span className="text-amber-700"> — afeta o DRE em /relatorios.</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-amber-400 text-amber-900 hover:bg-amber-100"
            onClick={() => {
              window.location.href = "/financeiro/atribuir?filtro=semCategoria";
            }}
          >
            <Tags className="h-3 w-3 mr-1" />
            Categorizar em massa
          </Button>
        </div>
      )}
      {semAtendente > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs">
          <UserPlus className="h-4 w-4 text-blue-600 shrink-0" />
          <div className="flex-1">
            <b className="text-blue-900">
              {semAtendente} {semAtendente === 1 ? "cobrança sem atendente" : "cobranças sem atendente"}
            </b>
            <span className="text-blue-700"> — sem comissão atribuída.</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-blue-300 text-blue-900 hover:bg-blue-100"
            onClick={() => {
              window.location.href = "/financeiro/atribuir?filtro=semAtendente";
            }}
          >
            <UserPlus className="h-3 w-3 mr-1" />
            Atribuir em massa
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Dialog do botão "Atribuir em massa" na bulk action bar. Permite
 * categorizar/atribuir atendente em N cobranças selecionadas. Os 2
 * campos são opcionais — se o usuário só seleciona Categoria, atendente
 * fica intacto. "— sem —" explícita seta o campo pra null.
 *
 * Confirma com summary do que vai mudar e o número de cobranças
 * afetadas. Erro inline (toast) se algum dos cobrancaIds não pertence
 * ao escritório (server valida via requireEscritorio).
 */
function BulkAtribuirDialog({
  open,
  onClose,
  cobrancaIds,
  categorias,
  atendentes,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onClose: () => void;
  cobrancaIds: number[];
  categorias: Array<{ id: number; nome: string }>;
  atendentes: Array<{ id: number; userName?: string | null }>;
  onConfirm: (payload: {
    cobrancaIds: number[];
    categoriaId?: number | null;
    atendenteId?: number | null;
  }) => void;
  isPending: boolean;
}) {
  const [categoriaVal, setCategoriaVal] = useState<string>("keep");
  const [atendenteVal, setAtendenteVal] = useState<string>("keep");

  function resolverPayload() {
    const payload: {
      cobrancaIds: number[];
      categoriaId?: number | null;
      atendenteId?: number | null;
    } = { cobrancaIds };
    if (categoriaVal !== "keep") {
      payload.categoriaId =
        categoriaVal === "none" ? null : Number(categoriaVal);
    }
    if (atendenteVal !== "keep") {
      payload.atendenteId =
        atendenteVal === "none" ? null : Number(atendenteVal);
    }
    return payload;
  }

  const nadaSelecionado = categoriaVal === "keep" && atendenteVal === "keep";

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Tags className="h-4 w-4 text-emerald-600" />
            Atribuir em massa
          </AlertDialogTitle>
          <AlertDialogDescription>
            Vai alterar <b>{cobrancaIds.length}</b> cobrança(s). Campos com
            "Manter atual" ficam intactos.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label className="text-xs">Categoria</Label>
            <Select value={categoriaVal} onValueChange={setCategoriaVal}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="keep">Manter atual</SelectItem>
                <SelectItem value="none" className="italic text-amber-700">
                  — sem categoria —
                </SelectItem>
                {categorias.map((cat) => (
                  <SelectItem key={cat.id} value={String(cat.id)}>
                    {cat.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Atendente</Label>
            <Select value={atendenteVal} onValueChange={setAtendenteVal}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="keep">Manter atual</SelectItem>
                <SelectItem value="none" className="italic text-blue-700">
                  — sem atendente —
                </SelectItem>
                {atendentes.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.userName ?? `#${a.id}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={isPending || nadaSelecionado || cobrancaIds.length === 0}
            onClick={(e) => {
              e.preventDefault();
              onConfirm(resolverPayload());
            }}
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
            ) : null}
            Aplicar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Célula "Cliente" da tabela. Mostra:
 *  - Beneficiário se diferente do pagador ("Carlos Silva")
 *    com sub-linha cinza "Pago por Maria Silva"
 *  - Pagador apenas, quando não há beneficiário override
 *
 * Botão sutil 🔗 ao hover abre popover pra atribuir/remover beneficiário
 * via busca de contato. Útil pro caso clássico Carlos+esposa.
 */
function CelulaCliente({
  cobranca,
  podeEditar,
  onAtribuirBeneficiario,
}: {
  cobranca: any;
  podeEditar: boolean;
  onAtribuirBeneficiario: (beneficiarioId: number | null) => void;
}) {
  const [popoverAberto, setPopoverAberto] = useState(false);
  const temBeneficiario =
    cobranca.contatoBeneficiarioId &&
    cobranca.contatoBeneficiarioId !== cobranca.contatoId;
  const nomePagador = cobranca.nomeContato || "—";
  const nomeBeneficiario = cobranca.nomeContatoBeneficiario;

  return (
    <div className="group flex items-start gap-1.5">
      <div className="flex-1 min-w-0">
        {temBeneficiario && nomeBeneficiario ? (
          <>
            <div className="text-sm font-medium flex items-center gap-1">
              <span className="truncate">{nomeBeneficiario}</span>
              <span
                className="shrink-0 rounded border border-violet-300 bg-violet-50 px-1 text-[9px] font-medium text-violet-700"
                title="Cliente real — beneficiário do pagamento"
              >
                cliente
              </span>
            </div>
            <div className="text-[11px] text-muted-foreground truncate">
              Pago por {nomePagador}
            </div>
          </>
        ) : (
          <div className="text-sm truncate">{nomePagador}</div>
        )}
      </div>
      {podeEditar && (
        <Popover open={popoverAberto} onOpenChange={setPopoverAberto}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
              title={
                temBeneficiario
                  ? "Editar pagamento por terceiro"
                  : "Marcar como pagamento por terceiro"
              }
            >
              <UserPlus className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-80" align="start">
            <BuscarBeneficiario
              cobrancaContatoId={cobranca.contatoId}
              beneficiarioAtual={cobranca.contatoBeneficiarioId ?? null}
              onSelect={(id) => {
                onAtribuirBeneficiario(id);
                setPopoverAberto(false);
              }}
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

/** Busca de contato dentro do popover do "Pagamento por terceiro".
 *  Faz query `crm.listarContatos` com debounce. Mostra opção "Remover
 *  beneficiário" quando já existe. */
function BuscarBeneficiario({
  cobrancaContatoId,
  beneficiarioAtual,
  onSelect,
}: {
  cobrancaContatoId: number | null;
  beneficiarioAtual: number | null;
  onSelect: (id: number | null) => void;
}) {
  const [busca, setBusca] = useState("");
  const { data: contatos = [], isLoading } = (trpc as any).crm?.listarContatos?.useQuery?.(
    { busca: busca || undefined },
    { staleTime: 30_000 },
  ) ?? { data: [], isLoading: false };

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold">Pagamento por terceiro</div>
      <p className="text-[11px] text-muted-foreground">
        Quem é o <b>cliente real</b> (beneficiário)? O pagador atual continua
        registrado como quem efetuou o pagamento.
      </p>
      <Input
        placeholder="Buscar cliente por nome ou CPF..."
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        className="h-8 text-xs"
      />
      <div className="max-h-48 overflow-y-auto border rounded">
        {isLoading && (
          <div className="p-2 text-xs text-muted-foreground text-center">
            <Loader2 className="h-3 w-3 animate-spin inline mr-1" />
            Buscando...
          </div>
        )}
        {!isLoading && contatos.length === 0 && busca.length > 0 && (
          <div className="p-2 text-xs text-muted-foreground text-center">
            Nenhum cliente encontrado
          </div>
        )}
        {!isLoading && contatos.length === 0 && busca.length === 0 && (
          <div className="p-2 text-xs text-muted-foreground text-center">
            Digite pra buscar
          </div>
        )}
        {contatos.slice(0, 10).map((c: any) => {
          const desabilitado = c.id === cobrancaContatoId;
          return (
            <button
              type="button"
              key={c.id}
              disabled={desabilitado}
              onClick={() => onSelect(c.id)}
              className={
                "w-full text-left p-2 text-xs hover:bg-accent border-b last:border-b-0 " +
                (desabilitado ? "opacity-40 cursor-not-allowed" : "")
              }
              title={
                desabilitado
                  ? "Esse é o pagador atual — escolha outro como beneficiário"
                  : ""
              }
            >
              <div className="font-medium">{c.nome}</div>
              <div className="text-[10px] text-muted-foreground">
                {c.cpfCnpj || c.telefone || "sem CPF/telefone"}
              </div>
            </button>
          );
        })}
      </div>
      {beneficiarioAtual !== null && (
        <Button
          variant="outline"
          size="sm"
          className="w-full h-7 text-xs text-destructive"
          onClick={() => onSelect(null)}
        >
          <XCircle className="h-3 w-3 mr-1" />
          Remover vínculo (sem beneficiário)
        </Button>
      )}
    </div>
  );
}

/**
 * Célula editável da tabela de cobranças pra atribuir/trocar Categoria.
 * Renderiza Select compacto inline — sem modal. Valor "none" significa
 * "sem categoria" (categoriaId=null). Atribuição é otimista: dispara
 * `atribuirCobrancasEmMassa` com cobrancaIds=[id] direto pela mutation
 * do caller; o invalidate do listarCobrancas refresca o cache logo após.
 *
 * Pra não confundir o usuário: select desabilitado quando user não tem
 * permissão de edição OU enquanto a mutation tá em flight.
 */
function CelulaCategoria({
  cobrancaId: _cobrancaId,
  categoriaIdAtual,
  categorias,
  onAtribuir,
  disabled,
}: {
  cobrancaId: string | number;
  categoriaIdAtual: number | null;
  categorias: Array<{ id: number; nome: string }>;
  onAtribuir: (categoriaId: number | null) => void;
  disabled?: boolean;
}) {
  const value = categoriaIdAtual === null ? "none" : String(categoriaIdAtual);
  const semCategoria = categoriaIdAtual === null;
  return (
    <Select
      value={value}
      onValueChange={(v) => onAtribuir(v === "none" ? null : Number(v))}
      disabled={disabled}
    >
      <SelectTrigger
        className={
          "h-7 text-xs border-dashed " +
          (semCategoria
            ? "text-amber-700 border-amber-300 bg-amber-50/40"
            : "border-slate-200")
        }
      >
        <SelectValue placeholder="— sem —" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none" className="text-amber-700 italic">
          — sem categoria —
        </SelectItem>
        {categorias.map((cat) => (
          <SelectItem key={cat.id} value={String(cat.id)}>
            {cat.nome}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Célula editável de comissionável da cobrança. 3 estados (override null):
 *  - "padrao" (null)  → segue `categoria.comissionavel` (default)
 *  - "sim"   (true)   → força comissionar (ignora categoria)
 *  - "nao"   (false)  → força não-comissionar
 *
 * Mostra com cores distintas pra deixar claro quando há override ativo
 * (estado padrão é neutro; sim=verde; nao=vermelho).
 */
function CelulaComissao({
  cobrancaId: _cobrancaId,
  comissionavelOverride,
  onAtualizar,
  disabled,
}: {
  cobrancaId: string | number;
  comissionavelOverride: boolean | null;
  onAtualizar: (valor: boolean | null) => void;
  disabled?: boolean;
}) {
  const value =
    comissionavelOverride === null
      ? "padrao"
      : comissionavelOverride
        ? "sim"
        : "nao";
  const cor =
    value === "sim"
      ? "text-emerald-700 border-emerald-300 bg-emerald-50/40"
      : value === "nao"
        ? "text-red-700 border-red-300 bg-red-50/40"
        : "text-slate-600 border-slate-200";
  return (
    <Select
      value={value}
      onValueChange={(v) =>
        onAtualizar(v === "padrao" ? null : v === "sim")
      }
      disabled={disabled}
    >
      <SelectTrigger className={"h-7 text-xs border-dashed " + cor}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="padrao" className="italic text-slate-600">
          Padrão (categoria)
        </SelectItem>
        <SelectItem value="sim" className="text-emerald-700">
          Sim — comissionar
        </SelectItem>
        <SelectItem value="nao" className="text-red-700">
          Não — não comissionar
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

/** Idem CelulaCategoria pra Atendente (responsável pela comissão). */
function CelulaAtendente({
  cobrancaId: _cobrancaId,
  atendenteIdAtual,
  atendentes,
  onAtribuir,
  disabled,
}: {
  cobrancaId: string | number;
  atendenteIdAtual: number | null;
  atendentes: Array<{ id: number; userName?: string | null; cargo?: string }>;
  onAtribuir: (atendenteId: number | null) => void;
  disabled?: boolean;
}) {
  const value = atendenteIdAtual === null ? "none" : String(atendenteIdAtual);
  const semAtendente = atendenteIdAtual === null;
  return (
    <Select
      value={value}
      onValueChange={(v) => onAtribuir(v === "none" ? null : Number(v))}
      disabled={disabled}
    >
      <SelectTrigger
        className={
          "h-7 text-xs border-dashed " +
          (semAtendente
            ? "text-blue-700 border-blue-300 bg-blue-50/40"
            : "border-slate-200")
        }
      >
        <SelectValue placeholder="— sem —" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none" className="text-blue-700 italic">
          — sem atendente —
        </SelectItem>
        {atendentes.map((a) => (
          <SelectItem key={a.id} value={String(a.id)}>
            {a.userName ?? `#${a.id}`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Painel "Sincronizando histórico Asaas" — aparece no topo da aba
 * Cobranças quando o sync histórico está agendado/executando/pausado/erro.
 * Some quando concluído (UX limpa pro estado estável).
 *
 * Mostra progresso (dias feitos / total), próxima janela, controles de
 * velocidade (intervaloMinutos + diasPorTick) e pausar/cancelar/retomar.
 *
 * Refetch a cada 30s — não usa polling agressivo porque o cron é tick
 * de 5min mínimo.
 */
function PainelSyncHistorico() {
  const utils = trpc.useUtils();
  const { data } = trpc.asaas.statusSyncHistorico.useQuery(undefined, {
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  const ajustarMut = trpc.asaas.ajustarVelocidadeSyncHistorico.useMutation({
    onSuccess: () => {
      toast.success("Velocidade ajustada");
      utils.asaas.statusSyncHistorico.invalidate();
    },
    onError: (err: any) => toast.error("Erro", { description: err.message }),
  });
  const pausarMut = trpc.asaas.pausarSyncHistorico.useMutation({
    onSuccess: () => utils.asaas.statusSyncHistorico.invalidate(),
  });
  const retomarMut = trpc.asaas.retomarSyncHistorico.useMutation({
    onSuccess: () => utils.asaas.statusSyncHistorico.invalidate(),
  });

  if (!data || data.status === "inativo" || data.status === "concluido") {
    return null;
  }

  const total = data.totalDias ?? 0;
  const feitos = data.diasFeitos ?? 0;
  const restante = Math.max(0, total - feitos);
  const pct = total > 0 ? Math.min(100, (feitos / total) * 100) : 0;
  const intervaloMin = data.intervaloMinutos ?? 10;
  const diasPorTick = (data as any).diasPorTick ?? 1;
  // Estimativa: cada tick avança `diasPorTick` dias e leva `intervaloMin`
  // minutos. Tempo restante ≈ (restante / diasPorTick) × intervaloMin.
  const minutosRestante = Math.ceil((restante / diasPorTick) * intervaloMin);
  const horasRestante = Math.floor(minutosRestante / 60);
  const diasRestante = Math.floor(horasRestante / 24);
  const estimativaTexto =
    diasRestante > 1
      ? `~${diasRestante} dias`
      : horasRestante > 1
        ? `~${horasRestante}h`
        : `~${minutosRestante}min`;

  const corStatus =
    data.status === "pausado" || data.status === "erro"
      ? "border-amber-300 bg-amber-50"
      : "border-blue-300 bg-blue-50";

  return (
    <Card className={"border " + corStatus}>
      <CardContent className="py-3 space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <RefreshCw
            className={
              "h-4 w-4 " +
              (data.status === "executando" ? "animate-spin text-blue-600" : "text-amber-600")
            }
          />
          <div className="flex-1 min-w-[200px]">
            <div className="text-sm font-medium">
              {data.status === "executando" && "Importando histórico do Asaas"}
              {data.status === "agendado" && "Importação histórica agendada"}
              {data.status === "pausado" && "Importação pausada"}
              {data.status === "erro" && "Importação com erro"}
            </div>
            <div className="text-xs text-muted-foreground">
              {feitos} de {total} dias · {restante} restantes · estimativa {estimativaTexto}
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {data.status !== "pausado" && data.status !== "erro" ? (
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => pausarMut.mutate()}
              >
                Pausar
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => retomarMut.mutate()}
              >
                Retomar
              </Button>
            )}
          </div>
        </div>

        <div className="w-full h-1.5 bg-slate-200 rounded overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Controles de velocidade */}
        <div className="flex items-center gap-3 pt-1 border-t flex-wrap text-xs">
          <span className="font-medium text-muted-foreground">Velocidade:</span>
          <label className="flex items-center gap-1">
            <span className="text-muted-foreground">A cada</span>
            <Select
              value={String(intervaloMin)}
              onValueChange={(v) =>
                ajustarMut.mutate({
                  intervaloMinutos: Number(v),
                  diasPorTick,
                })
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
                ajustarMut.mutate({
                  intervaloMinutos: intervaloMin,
                  diasPorTick: Number(v),
                })
              }
              disabled={ajustarMut.isPending}
            >
              <SelectTrigger className="h-6 text-xs w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 dia</SelectItem>
                <SelectItem value="3">3 dias</SelectItem>
                <SelectItem value="5">5 dias</SelectItem>
                <SelectItem value="7">7 dias</SelectItem>
              </SelectContent>
            </Select>
          </label>
          {(intervaloMin <= 5 || diasPorTick >= 5) && (
            <span className="text-amber-700 text-[11px]">
              ⚡ Modo turbo — pode bater no rate guard se Asaas estiver com cota baixa
            </span>
          )}
        </div>

        {data.erroMensagem && (
          <p className="text-xs text-amber-700">⚠ {data.erroMensagem}</p>
        )}
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

// ═══════════════════════════════════════════════════════════════════════════════
// Hero "Comando Central" — gradient emerald/teal com 4 KPIs + sparkline
// ═══════════════════════════════════════════════════════════════════════════════

function HeroFinanceiro({
  kpis,
  saldo,
  sparkPontos,
  periodo,
  rangeCustom,
  onPeriodoChange,
}: {
  kpis: any;
  saldo: any;
  sparkPontos: number[];
  periodo: 3 | 6 | 12 | null;
  rangeCustom: { inicio: string; fim: string } | null;
  onPeriodoChange: (v: 3 | 6 | 12) => void;
}) {
  const recebido = kpis?.recebidoLiquido ?? 0;
  // "Entrou no caixa" = bruto pago no período (asaas + manual). Discrimina
  // Asaas vs Caixa Manual (recebido por fora do Asaas).
  const entrouCaixa = kpis?.recebido ?? 0;
  const recebidoManual = kpis?.recebidoManual ?? 0;
  const recebidoAsaas = entrouCaixa - recebidoManual;
  const pendente = kpis?.pendente ?? 0;
  const vencido = kpis?.vencido ?? 0;
  const saldoAtual = saldo?.balance ?? 0;
  const totalCobrancas = kpis?.totalCobrancas ?? 0;
  const totalReceitaPeriodo = sparkPontos.reduce((a, b) => a + b, 0);

  // Calcula path do sparkline (normaliza pontos pra altura)
  const max = Math.max(1, ...sparkPontos);
  const sparkPath = useMemo(() => {
    if (sparkPontos.length === 0) return "";
    const w = 400;
    const h = 100;
    const stepX = w / Math.max(1, sparkPontos.length - 1);
    const pts = sparkPontos.map((v, i) => [i * stepX, h - (v / max) * h * 0.85 - 10]);
    return pts.map(([x, y], i) => (i === 0 ? `M${x},${y}` : `L${x},${y}`)).join(" ");
  }, [sparkPontos, max]);
  const sparkFillPath = sparkPath ? `${sparkPath} L400,120 L0,120 Z` : "";

  return (
    <div className="rounded-2xl bg-gradient-to-br from-emerald-700 via-teal-700 to-cyan-800 p-7 text-white relative overflow-hidden shadow-xl">
      <CircleDollarSign
        className="absolute -right-10 -bottom-12 w-56 h-56 opacity-10"
        strokeWidth={1.2}
      />
      <div className="relative">
        <div className="flex items-start justify-between mb-5 flex-wrap gap-3">
          <div>
            <p className="text-xs font-medium text-white/85 uppercase tracking-wider mb-1">
              Painel Financeiro
            </p>
            <p className="text-xs text-white/70">
              {rangeCustom
                ? `${rangeCustom.inicio.split("-").reverse().join("/")} → ${rangeCustom.fim.split("-").reverse().join("/")}`
                : `Últimos ${periodo ?? 6} meses`}
            </p>
          </div>
          <div className="inline-flex bg-white/15 border border-white/20 rounded-lg overflow-hidden">
            {([3, 6, 12] as const).map((m) => (
              <button
                key={m}
                onClick={() => onPeriodoChange(m)}
                className={`px-3 py-1 text-[11px] font-medium transition-colors ${
                  !rangeCustom && periodo === m
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-white/80 hover:text-white"
                }`}
              >
                {m}m
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-end">
          {/* 4 KPIs em grid 2x2 (esquerda) */}
          <div className="lg:col-span-6 grid grid-cols-2 gap-3">
            <KPIHero
              label="Entrou no caixa"
              value={formatBRLShort(entrouCaixa)}
              breakdown={
                recebidoManual > 0
                  ? [
                      { label: "Asaas", valor: formatBRL(recebidoAsaas) },
                      { label: "Manual", valor: formatBRL(recebidoManual) },
                    ]
                  : undefined
              }
              hint={recebidoManual > 0 ? undefined : `${recebido < entrouCaixa ? formatBRLShort(recebido) + " líquido" : ""}`}
              icon={CheckCircle2}
              tone="emerald"
            />
            <KPIHero
              label="A receber"
              value={formatBRLShort(pendente)}
              hint={`${totalCobrancas} cobrança(s)`}
              icon={Clock}
              tone="blue"
            />
            <KPIHero
              label="Vencido"
              value={formatBRLShort(vencido)}
              icon={AlertTriangle}
              tone="rose"
              alert={vencido > 0}
            />
            <KPIHero
              label="Saldo Asaas"
              value={formatBRLShort(saldoAtual)}
              hint="Disponível pra saque"
              icon={Wallet}
              tone="neutral"
            />
          </div>

          {/* Sparkline (direita) */}
          <div className="lg:col-span-6">
            <div className="flex items-baseline justify-between mb-2">
              <div>
                <p className="text-[10px] text-white/65 uppercase tracking-wider mb-1">
                  Tendência · período
                </p>
                <p className="text-xl font-bold tabular-nums leading-none">
                  {formatBRLShort(totalReceitaPeriodo)}
                  <span className="text-xs text-white/70 font-normal ml-1">total recebido</span>
                </p>
              </div>
            </div>
            {sparkPontos.length > 0 ? (
              <svg viewBox="0 0 400 120" className="w-full h-28">
                <defs>
                  <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="white" stopOpacity="0.45" />
                    <stop offset="100%" stopColor="white" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <line x1="0" y1="30" x2="400" y2="30" stroke="rgba(255,255,255,0.08)" strokeDasharray="3,3" />
                <line x1="0" y1="60" x2="400" y2="60" stroke="rgba(255,255,255,0.08)" strokeDasharray="3,3" />
                <line x1="0" y1="90" x2="400" y2="90" stroke="rgba(255,255,255,0.08)" strokeDasharray="3,3" />
                <path d={sparkFillPath} fill="url(#sparkGrad)" />
                <path
                  d={sparkPath}
                  fill="none"
                  stroke="white"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {sparkPontos.length > 0 && (() => {
                  const w = 400;
                  const stepX = w / Math.max(1, sparkPontos.length - 1);
                  const lastIdx = sparkPontos.length - 1;
                  const lastY = 120 - (sparkPontos[lastIdx]! / max) * 100 * 0.85 - 10;
                  return (
                    <circle
                      cx={lastIdx * stepX}
                      cy={lastY}
                      r={4.5}
                      fill="rgb(110 231 183)"
                      stroke="white"
                      strokeWidth={2}
                    />
                  );
                })()}
              </svg>
            ) : (
              <div className="h-28 flex items-center justify-center text-xs text-white/50">
                Sem dados no período.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function KPIHero({
  label,
  value,
  hint,
  icon: Icon,
  tone,
  alert,
  breakdown,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: any;
  tone: "emerald" | "blue" | "rose" | "neutral";
  alert?: boolean;
  /** Sub-linhas opcionais (ex: Asaas / Manual no card "Entrou no caixa"). */
  breakdown?: Array<{ label: string; valor: string }>;
}) {
  const numColor =
    tone === "emerald" ? "text-emerald-100"
    : tone === "blue" ? "text-blue-200"
    : tone === "rose" ? "text-rose-200"
    : "text-white";
  return (
    <div className={`bg-white/10 rounded-xl p-4 border border-white/15 ${alert ? "ring-1 ring-rose-300/30" : ""}`}>
      <div className="flex items-center gap-1.5 mb-2 text-[10px] text-white/65 uppercase tracking-wider font-semibold">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <p className={`text-2xl font-bold tabular-nums leading-none ${numColor}`}>{value}</p>
      {breakdown && breakdown.length > 0 && (
        <div className="mt-2 space-y-0.5">
          {breakdown.map((b) => (
            <div key={b.label} className="flex items-center justify-between text-[11px] text-white/70 tabular-nums">
              <span>{b.label}</span>
              <span>{b.valor}</span>
            </div>
          ))}
        </div>
      )}
      {hint && <p className="text-[11px] text-white/65 mt-1 tabular-nums">{hint}</p>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Linha de Atenção: 3 cards (Inadimplência ring + Top devedores + Receita 7d)
// ═══════════════════════════════════════════════════════════════════════════════

function CardInadimplencia({ pct, vencido }: { pct: number | null; vencido: number }) {
  const valor = pct ?? 0;
  const dash = 263.9;
  const offset = dash - (Math.min(100, valor) / 100) * dash;
  const cor = pct == null
    ? "#94a3b8"
    : pct >= 15 ? "#f43f5e"
    : pct >= 5 ? "#f59e0b"
    : "#10b981";

  return (
    <Card className="border-slate-200 relative overflow-hidden">
      <div className="absolute -right-6 -top-6 w-32 h-32 bg-rose-100 rounded-full opacity-40" />
      <CardContent className="pt-5 pb-5 relative">
        <h3 className="text-xs uppercase tracking-wider font-bold text-slate-500 mb-3">
          Inadimplência
        </h3>
        <div className="flex items-center gap-4">
          <div className="relative w-24 h-24 shrink-0">
            <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
              <circle cx="50" cy="50" r="42" fill="none" stroke="#fee2e2" strokeWidth="9" />
              <circle
                cx="50"
                cy="50"
                r="42"
                fill="none"
                stroke={cor}
                strokeWidth="9"
                strokeLinecap="round"
                strokeDasharray={dash}
                strokeDashoffset={offset}
                style={{ transition: "stroke-dashoffset 0.6s ease" }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <p className="text-2xl font-bold tabular-nums leading-none" style={{ color: cor }}>
                {pct != null ? pct.toFixed(1) : "—"}
                <span className="text-sm">%</span>
              </p>
              <p className="text-[9px] text-slate-500 uppercase tracking-wider">por valor</p>
            </div>
          </div>
          <div className="flex-1 space-y-1.5">
            <p className="text-[11px] text-slate-500">
              Total em aberto
            </p>
            <p className="text-lg font-bold text-rose-600 tabular-nums">{formatBRL(vencido)}</p>
            <p className="text-[10px] text-slate-400">
              {pct == null
                ? "Sem cobranças no período"
                : pct >= 15
                  ? "Alerta — taxa elevada"
                  : pct >= 5
                    ? "Atenção"
                    : "Sob controle"}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CardTopDevedores({ devedores }: { devedores: Array<{ nome: string; valor: number; qtd: number; maxDias: number }> }) {
  return (
    <Card className="border-slate-200">
      <CardContent className="pt-5 pb-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs uppercase tracking-wider font-bold text-slate-500">
            Top devedores
          </h3>
          <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-700">
            {devedores.length} {devedores.length === 1 ? "ativo" : "ativos"}
          </span>
        </div>
        {devedores.length === 0 ? (
          <p className="text-xs text-slate-400 italic py-4 text-center">
            Nenhum cliente em atraso.
          </p>
        ) : (
          <div className="space-y-2">
            {devedores.map((d) => (
              <div key={d.nome} className="flex items-center gap-2.5">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-[10px] text-white shrink-0 bg-gradient-to-br ${gradientAvatar(d.nome)}`}
                >
                  {gerarIniciais(d.nome)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate">{d.nome}</p>
                  <p className="text-[10px] text-slate-500">
                    {d.qtd} vencida{d.qtd !== 1 ? "s" : ""} · {d.maxDias}d atraso
                  </p>
                </div>
                <p className="text-sm font-bold text-rose-600 tabular-nums">
                  {formatBRLShort(d.valor)}
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CardReceitaPrevista({
  lista,
  total,
}: {
  lista: Array<{ id: number; nome: string; valor: number; forma: string; vencimento: string; diasAte: number }>;
  total: number;
}) {
  return (
    <Card className="border-slate-200">
      <CardContent className="pt-5 pb-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs uppercase tracking-wider font-bold text-slate-500">
            Receita esperada (7d)
          </h3>
          <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 tabular-nums">
            {formatBRLShort(total)}
          </span>
        </div>
        {lista.length === 0 ? (
          <p className="text-xs text-slate-400 italic py-4 text-center">
            Nenhuma cobrança nos próximos 7 dias.
          </p>
        ) : (
          <div className="space-y-2">
            {lista.map((c) => {
              const venc = c.vencimento ? new Date(c.vencimento + "T12:00:00") : null;
              const diaCurto = venc
                ? `${String(venc.getDate()).padStart(2, "0")}${"\n"}${venc.toLocaleDateString("pt-BR", { month: "short" }).toUpperCase()}`
                : "—";
              return (
                <div key={c.id} className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center text-[9px] font-bold text-emerald-700 tabular-nums leading-tight whitespace-pre text-center shrink-0">
                    {diaCurto}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate">{c.nome}</p>
                    <p className="text-[10px] text-slate-500">
                      {c.forma === "PIX" ? "PIX" : c.forma === "BOLETO" ? "Boleto" : c.forma === "CREDIT_CARD" ? "Cartão" : "—"}
                      {" · "}
                      {c.diasAte === 0 ? "vence hoje" : c.diasAte === 1 ? "vence amanhã" : `vence em ${c.diasAte}d`}
                    </p>
                  </div>
                  <p className="text-sm font-bold text-emerald-600 tabular-nums">
                    {formatBRLShort(c.valor)}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

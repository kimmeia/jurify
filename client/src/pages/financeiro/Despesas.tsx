/**
 * Aba "Despesas" do módulo Financeiro — contas a pagar do escritório.
 * Lista despesas com filtros, mostra KPIs e permite criar/editar/marcar paga.
 */

import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
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
  AlertCircle,
  CheckCircle2,
  Clock,
  DollarSign,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  Repeat,
  RotateCcw,
  Search,
  Tag,
  Trash2,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { formatBRL, useFinanceiroPerms } from "./helpers";
import { AnexosFinanceiro } from "./Anexos";

function hojeIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function inicioDoMesIso(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function fimDoMesIso(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0)
    .toISOString()
    .slice(0, 10);
}

function formatData(iso: string | null | undefined) {
  if (!iso) return "—";
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

const STATUS_LABEL: Record<string, string> = {
  pendente: "Pendente",
  parcial: "Parcial",
  pago: "Pago",
  vencido: "Vencido",
};

const RECORRENCIA_LABEL: Record<string, string> = {
  nenhuma: "—",
  semanal: "Semanal",
  mensal: "Mensal",
  anual: "Anual",
};

interface DespesaListItem {
  id: number;
  descricao: string;
  valor: string;
  valorPago: string;
  vencimento: string;
  dataPagamento: string | null;
  status: "pendente" | "parcial" | "pago" | "vencido";
  recorrencia: "nenhuma" | "semanal" | "mensal" | "anual";
  recorrenciaAtiva?: boolean;
  recorrenciaDeOrigemId?: number | null;
  origem?: "manual" | "taxa_asaas" | "recorrencia" | "extrato_asaas" | "comissao";
  observacoes: string | null;
  categoriaId: number | null;
  categoriaNome: string | null;
  createdAt: Date | string;
}

export function DespesasTab() {
  const utils = trpc.useUtils();
  const [periodoInicio, setPeriodoInicio] = useState(inicioDoMesIso());
  const [periodoFim, setPeriodoFim] = useState(fimDoMesIso());
  const [filtroStatus, setFiltroStatus] = useState<string>("todos");
  const [filtroCategorias, setFiltroCategorias] = useState<string[]>([]);
  const [filtroRecorrencia, setFiltroRecorrencia] = useState<"todas" | "recorrentes" | "pontuais">("todas");
  const [filtroOrigem, setFiltroOrigem] = useState<string>("todas");
  const [busca, setBusca] = useState("");
  const [valorMin, setValorMin] = useState<string>("");
  const [valorMax, setValorMax] = useState<string>("");
  const [ordem, setOrdem] = useState<{ col: "vencimento" | "valor"; dir: "asc" | "desc" }>({
    col: "vencimento",
    dir: "asc",
  });
  const [novaAberta, setNovaAberta] = useState(false);
  const [editando, setEditando] = useState<DespesaListItem | null>(null);
  const [pagando, setPagando] = useState<DespesaListItem | null>(null);
  const [despesaParaExcluir, setDespesaParaExcluir] = useState<DespesaListItem | null>(
    null,
  );
  // Bulk select + ações em massa
  const [selecionadas, setSelecionadas] = useState<Set<number>>(new Set());
  const [bulkCategoriaOpen, setBulkCategoriaOpen] = useState(false);
  const [bulkPagarOpen, setBulkPagarOpen] = useState(false);
  const [bulkExcluirOpen, setBulkExcluirOpen] = useState(false);
  const perms = useFinanceiroPerms();

  // Paginação server-side: 20 itens por página, reset ao mudar filtros.
  const ITENS_POR_PAGINA = 20;
  const [pagina, setPagina] = useState(0);
  useEffect(() => {
    setPagina(0);
    // Limpa seleção quando filtro muda (linhas selecionadas podem sair de vista).
    setSelecionadas(new Set());
  }, [periodoInicio, periodoFim, filtroStatus, filtroCategorias, filtroRecorrencia, filtroOrigem, busca, valorMin, valorMax, ordem]);

  const status = filtroStatus === "todos" ? undefined : (filtroStatus as any);
  const lista = trpc.despesas.listar.useQuery({
    periodoInicio,
    periodoFim,
    status,
    categoriaIds: filtroCategorias.length > 0
      ? filtroCategorias.map((s) => Number(s))
      : undefined,
    recorrencia: filtroRecorrencia === "todas" ? undefined : filtroRecorrencia,
    origem: filtroOrigem === "todas" ? undefined : (filtroOrigem as any),
    busca: busca.trim() || undefined,
    valorMinimo: valorMin.trim() !== "" && !isNaN(Number(valorMin))
      ? Number(valorMin)
      : undefined,
    valorMaximo: valorMax.trim() !== "" && !isNaN(Number(valorMax))
      ? Number(valorMax)
      : undefined,
    orderBy: ordem.col,
    orderDir: ordem.dir,
    limit: ITENS_POR_PAGINA,
    offset: pagina * ITENS_POR_PAGINA,
  });
  const itens = lista.data?.items ?? [];
  const total = lista.data?.total ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / ITENS_POR_PAGINA));
  const kpis = trpc.despesas.kpis.useQuery({ periodoInicio, periodoFim });
  const categoriasQ = trpc.financeiro.listarCategoriasDespesa.useQuery();
  const categorias = categoriasQ.data ?? [];

  // Helpers de bulk select.
  const toggleSelecionada = (id: number) => {
    setSelecionadas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleSelecionarTodas = () => {
    if (selecionadas.size === itens.length && itens.length > 0) {
      setSelecionadas(new Set());
    } else {
      setSelecionadas(new Set(itens.map((d) => d.id)));
    }
  };

  // Mutations bulk.
  const bulkCategoriaMut = (trpc as any).despesas.atribuirCategoriaEmMassa.useMutation({
    onSuccess: (r: { atualizadas: number }) => {
      toast.success(`${r.atualizadas} despesa(s) atualizada(s)`);
      utils.despesas.listar.invalidate();
      utils.despesas.kpis.invalidate();
      setSelecionadas(new Set());
      setBulkCategoriaOpen(false);
    },
    onError: (err: any) => toast.error("Erro", { description: err.message }),
  });
  const bulkPagarMut = (trpc as any).despesas.marcarPagoEmMassa.useMutation({
    onSuccess: (r: { atualizadas: number; jaPagas: number }) => {
      toast.success(
        `${r.atualizadas} despesa(s) marcada(s) como paga`,
        r.jaPagas > 0
          ? { description: `${r.jaPagas} já estavam pagas.` }
          : undefined,
      );
      utils.despesas.listar.invalidate();
      utils.despesas.kpis.invalidate();
      setSelecionadas(new Set());
      setBulkPagarOpen(false);
    },
    onError: (err: any) => toast.error("Erro", { description: err.message }),
  });
  const bulkExcluirMut = (trpc as any).despesas.excluirEmMassa.useMutation({
    onSuccess: (r: { excluidas: number; filhasRemovidas: number }) => {
      const desc =
        r.filhasRemovidas > 0
          ? `${r.filhasRemovidas} ocorrência(s) recorrente(s) também removida(s).`
          : undefined;
      toast.success(`${r.excluidas} despesa(s) excluída(s)`, desc ? { description: desc } : undefined);
      utils.despesas.listar.invalidate();
      utils.despesas.kpis.invalidate();
      setSelecionadas(new Set());
      setBulkExcluirOpen(false);
    },
    onError: (err: any) => toast.error("Erro", { description: err.message }),
  });

  const reabrirMut = trpc.despesas.reabrir.useMutation({
    onSuccess: () => {
      utils.despesas.listar.invalidate();
      utils.despesas.kpis.invalidate();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });
  const excluirMut = trpc.despesas.excluir.useMutation({
    onSuccess: () => {
      toast.success("Despesa removida");
      utils.despesas.listar.invalidate();
      utils.despesas.kpis.invalidate();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  // Mutations de recorrência — só fazem sentido em despesa-modelo
  // (recorrenciaDeOrigemId === null E recorrencia !== "nenhuma").
  const pausarRecMut = (trpc as any).despesas?.pausarRecorrencia?.useMutation?.({
    onSuccess: () => {
      toast.success("Recorrência pausada");
      utils.despesas.listar.invalidate();
    },
    onError: (err: any) => toast.error("Erro", { description: err.message }),
  });
  const retomarRecMut = (trpc as any).despesas?.retomarRecorrencia?.useMutation?.({
    onSuccess: () => {
      toast.success("Recorrência retomada");
      utils.despesas.listar.invalidate();
    },
    onError: (err: any) => toast.error("Erro", { description: err.message }),
  });
  const gerarRecAgoraMut = (trpc as any).despesas?.gerarRecorrenciasAgora?.useMutation?.({
    onSuccess: (r: any) => {
      toast.success(
        r.geradas > 0
          ? `${r.geradas} ocorrência(s) gerada(s)`
          : "Nenhuma ocorrência pendente — já está em dia.",
      );
      utils.despesas.listar.invalidate();
      utils.despesas.kpis.invalidate();
    },
    onError: (err: any) => toast.error("Erro", { description: err.message }),
  });

  return (
    <div className="space-y-4">
      {/* Filtros — 2 linhas: busca + período/ação na 1ª, filtros multi na 2ª */}
      <Card>
        <CardContent className="pt-5 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar descrição..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="pl-9 h-9 text-sm"
              />
            </div>
            <div className="space-y-0.5">
              <Label className="text-[10px] text-muted-foreground">De (venc.)</Label>
              <Input
                type="date"
                value={periodoInicio}
                onChange={(e) => setPeriodoInicio(e.target.value)}
                className="h-9 text-xs w-36"
              />
            </div>
            <div className="space-y-0.5">
              <Label className="text-[10px] text-muted-foreground">Até</Label>
              <Input
                type="date"
                value={periodoFim}
                onChange={(e) => setPeriodoFim(e.target.value)}
                className="h-9 text-xs w-36"
              />
            </div>
            <div className="flex-1" />
            {perms.podeCriar && (
              <Button onClick={() => setNovaAberta(true)}>
                <Plus className="h-4 w-4 mr-2" /> Nova despesa
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">Filtros:</span>
            <Select value={filtroStatus} onValueChange={setFiltroStatus}>
              <SelectTrigger className="h-9 text-xs w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Status: Todos</SelectItem>
                <SelectItem value="pendente">Pendente</SelectItem>
                <SelectItem value="parcial">Parcial</SelectItem>
                <SelectItem value="pago">Pago</SelectItem>
                <SelectItem value="vencido">Vencido</SelectItem>
              </SelectContent>
            </Select>
            <MultiSelectFilter
              placeholder="Categorias"
              value={filtroCategorias}
              onChange={setFiltroCategorias}
              className="w-44"
              options={categorias.map((c: any) => ({
                value: String(c.id),
                label: c.nome,
              }))}
            />
            <Select
              value={filtroRecorrencia}
              onValueChange={(v) => setFiltroRecorrencia(v as any)}
            >
              <SelectTrigger className="h-9 text-xs w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Recorrência: Todas</SelectItem>
                <SelectItem value="recorrentes">Só recorrentes</SelectItem>
                <SelectItem value="pontuais">Só pontuais</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filtroOrigem} onValueChange={setFiltroOrigem}>
              <SelectTrigger className="h-9 text-xs w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Origem: Todas</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="recorrencia">Recorrência (auto)</SelectItem>
                <SelectItem value="taxa_asaas">Taxa Asaas</SelectItem>
                <SelectItem value="extrato_asaas">Extrato Asaas</SelectItem>
                <SelectItem value="comissao">Comissão</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1.5 text-xs border rounded px-2 h-9 bg-background">
              <span className="text-muted-foreground">R$</span>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={valorMin}
                onChange={(e) => setValorMin(e.target.value)}
                placeholder="min"
                className="h-7 w-20 text-xs border-0 shadow-none px-1 focus-visible:ring-0 tabular-nums"
              />
              <span className="text-muted-foreground">→</span>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={valorMax}
                onChange={(e) => setValorMax(e.target.value)}
                placeholder="máx"
                className="h-7 w-20 text-xs border-0 shadow-none px-1 focus-visible:ring-0 tabular-nums"
              />
            </div>
            {(filtroStatus !== "todos" ||
              filtroCategorias.length > 0 ||
              filtroRecorrencia !== "todas" ||
              filtroOrigem !== "todas" ||
              busca.trim() !== "" ||
              valorMin !== "" ||
              valorMax !== "" ||
              ordem.col !== "vencimento" ||
              ordem.dir !== "asc") && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 text-xs"
                onClick={() => {
                  setFiltroStatus("todos");
                  setFiltroCategorias([]);
                  setFiltroRecorrencia("todas");
                  setFiltroOrigem("todas");
                  setBusca("");
                  setValorMin("");
                  setValorMax("");
                  setOrdem({ col: "vencimento", dir: "asc" });
                }}
              >
                Limpar
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Bulk action bar — visível só quando há seleções */}
      {selecionadas.size > 0 && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-50 border border-blue-200 dark:bg-blue-950/30 dark:border-blue-900">
          <span className="text-sm font-medium text-blue-900 dark:text-blue-200">
            {selecionadas.size} despesa(s) selecionada(s)
          </span>
          <div className="flex-1" />
          {perms.podeEditar && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setBulkCategoriaOpen(true)}
            >
              <Tag className="h-3.5 w-3.5 mr-1.5" />
              Mudar categoria
            </Button>
          )}
          {perms.podeEditar && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setBulkPagarOpen(true)}
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
              Marcar como pago
            </Button>
          )}
          {perms.podeExcluir && (
            <Button
              size="sm"
              variant="outline"
              className="text-destructive"
              onClick={() => setBulkExcluirOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Excluir
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelecionadas(new Set())}
          >
            Limpar seleção
          </Button>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Pendente"
          valor={kpis.data?.pendente ?? 0}
          icon={<Clock className="h-4 w-4" />}
          accent="text-amber-600"
        />
        <KpiCard
          label="Pago"
          valor={kpis.data?.pago ?? 0}
          icon={<CheckCircle2 className="h-4 w-4" />}
          accent="text-emerald-600"
        />
        <KpiCard
          label="Vencido"
          valor={kpis.data?.vencido ?? 0}
          icon={<AlertCircle className="h-4 w-4" />}
          accent="text-destructive"
        />
        <KpiCard
          label="Total no período"
          valor={kpis.data?.total ?? 0}
          icon={<Wallet className="h-4 w-4" />}
          destaque
        />
      </div>

      {/* Tabela */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Wallet className="h-4 w-4" />
            Despesas
            <Badge variant="outline" className="ml-2">
              {total}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {lista.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : itens.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">
              Nenhuma despesa no período. Clique em "Nova despesa" para começar.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs w-10">
                    <Checkbox
                      checked={
                        itens.length > 0 && selecionadas.size === itens.length
                      }
                      onCheckedChange={toggleSelecionarTodas}
                      aria-label="Selecionar todas"
                    />
                  </TableHead>
                  <TableHead className="text-xs">
                    <button
                      onClick={() =>
                        setOrdem((o) =>
                          o.col === "vencimento"
                            ? { col: "vencimento", dir: o.dir === "asc" ? "desc" : "asc" }
                            : { col: "vencimento", dir: "asc" },
                        )
                      }
                      className="inline-flex items-center gap-1 font-semibold hover:text-foreground"
                    >
                      Vencimento
                      <span className={ordem.col === "vencimento" ? "" : "text-muted-foreground/50"}>
                        {ordem.col !== "vencimento" ? "↕" : ordem.dir === "asc" ? "↑" : "↓"}
                      </span>
                    </button>
                  </TableHead>
                  <TableHead className="text-xs">Tipo</TableHead>
                  <TableHead className="text-xs">Descrição</TableHead>
                  <TableHead className="text-xs">Categoria</TableHead>
                  <TableHead className="text-xs">Recorrência</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs text-right">
                    <button
                      onClick={() =>
                        setOrdem((o) =>
                          o.col === "valor"
                            ? { col: "valor", dir: o.dir === "asc" ? "desc" : "asc" }
                            : { col: "valor", dir: "desc" },
                        )
                      }
                      className="inline-flex items-center gap-1 font-semibold hover:text-foreground"
                    >
                      Valor
                      <span className={ordem.col === "valor" ? "" : "text-muted-foreground/50"}>
                        {ordem.col !== "valor" ? "↕" : ordem.dir === "asc" ? "↑" : "↓"}
                      </span>
                    </button>
                  </TableHead>
                  <TableHead className="text-xs"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {itens.map((d) => {
                  const valorTotal = Number(d.valor);
                  const valorPago = Number(d.valorPago ?? 0);
                  const restante = Math.max(0, valorTotal - valorPago);
                  return (
                    <TableRow
                      key={d.id}
                      data-state={selecionadas.has(d.id) ? "selected" : undefined}
                    >
                      <TableCell>
                        <Checkbox
                          checked={selecionadas.has(d.id)}
                          onCheckedChange={() => toggleSelecionada(d.id)}
                          aria-label={`Selecionar despesa ${d.id}`}
                        />
                      </TableCell>
                      <TableCell className="text-xs">{formatData(d.vencimento)}</TableCell>
                      <TableCell className="text-xs">
                        <TipoBadge origem={d.origem} />
                      </TableCell>
                      <TableCell className="text-xs max-w-[260px] truncate">
                        {d.descricao}
                      </TableCell>
                      <TableCell className="text-xs">{d.categoriaNome ?? "—"}</TableCell>
                      <TableCell className="text-xs">
                        <RecorrenciaCell despesa={d} />
                      </TableCell>
                      <TableCell className="text-xs">
                        <StatusBadge status={d.status} />
                        {d.dataPagamento && d.status === "pago" && (
                          <span className="text-[10px] text-muted-foreground ml-1">
                            em {formatData(d.dataPagamento)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-right tabular-nums">
                        {formatBRL(valorTotal)}
                        {d.status === "parcial" && (
                          <div className="text-[10px] text-muted-foreground">
                            pago {formatBRL(valorPago)} · falta {formatBRL(restante)}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs flex gap-1">
                        {perms.podeEditar && (
                          d.status !== "pago" ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs text-emerald-600 hover:text-emerald-700"
                              onClick={() => setPagando(d)}
                            >
                              <DollarSign className="h-3.5 w-3.5 mr-1" />
                              {d.status === "parcial" ? "Pagar resto" : "Pagar"}
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs text-muted-foreground"
                              onClick={() => reabrirMut.mutate({ id: d.id })}
                              disabled={reabrirMut.isPending}
                            >
                              <RotateCcw className="h-3.5 w-3.5 mr-1" /> Reabrir
                            </Button>
                          )
                        )}
                        {/* Ações de recorrência: só aparecem na despesa-modelo
                            (recorrenciaDeOrigemId === null E recorrencia ≠ nenhuma).
                            Filhas geradas não têm controle próprio — herdam da
                            modelo. */}
                        {perms.podeEditar && d.recorrencia !== "nenhuma" && !d.recorrenciaDeOrigemId && (
                          <>
                            {d.recorrenciaAtiva ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-amber-600 hover:text-amber-700"
                                onClick={() => pausarRecMut?.mutate?.({ id: d.id })}
                                disabled={pausarRecMut?.isPending}
                                title="Pausar geração automática"
                              >
                                <Pause className="h-3.5 w-3.5" />
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-emerald-600 hover:text-emerald-700"
                                onClick={() => retomarRecMut?.mutate?.({ id: d.id })}
                                disabled={retomarRecMut?.isPending}
                                title="Retomar geração automática"
                              >
                                <Play className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              onClick={() => gerarRecAgoraMut?.mutate?.({ id: d.id })}
                              disabled={gerarRecAgoraMut?.isPending}
                              title="Gerar próximas ocorrências agora (sem esperar cron)"
                            >
                              <Repeat className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                        {perms.podeEditar && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            onClick={() => setEditando(d)}
                            title="Editar"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {perms.podeExcluir && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => setDespesaParaExcluir(d)}
                          disabled={excluirMut.isPending}
                          title="Excluir"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          {!lista.isLoading && total > ITENS_POR_PAGINA && (
            <div className="flex items-center justify-between pt-3 border-t mt-2">
              <p className="text-xs text-muted-foreground">
                Mostrando <b>{pagina * ITENS_POR_PAGINA + 1}</b>–
                <b>{Math.min((pagina + 1) * ITENS_POR_PAGINA, total)}</b> de{" "}
                <b>{total}</b> despesas
              </p>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => setPagina((p) => Math.max(0, p - 1))}
                  disabled={pagina === 0 || lista.isLoading}
                >
                  ← Anterior
                </Button>
                <span className="text-xs text-muted-foreground">
                  Página <b>{pagina + 1}</b> de <b>{totalPaginas}</b>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => setPagina((p) => p + 1)}
                  disabled={(pagina + 1) * ITENS_POR_PAGINA >= total || lista.isLoading}
                >
                  Próxima →
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <DespesaFormDialog
        open={novaAberta}
        modo="criar"
        onClose={() => setNovaAberta(false)}
        onSuccess={() => {
          utils.despesas.listar.invalidate();
          utils.despesas.kpis.invalidate();
        }}
      />

      {editando && (
        <DespesaFormDialog
          open
          modo="editar"
          despesa={editando}
          onClose={() => setEditando(null)}
          onSuccess={() => {
            utils.despesas.listar.invalidate();
            utils.despesas.kpis.invalidate();
          }}
        />
      )}

      {pagando && (
        <RegistrarPagamentoDialog
          despesa={pagando}
          onClose={() => setPagando(null)}
          onSuccess={() => {
            utils.despesas.listar.invalidate();
            utils.despesas.kpis.invalidate();
          }}
        />
      )}

      <AlertDialog
        open={despesaParaExcluir !== null}
        onOpenChange={(o) => !o && setDespesaParaExcluir(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir despesa?</AlertDialogTitle>
            <AlertDialogDescription>
              {despesaParaExcluir?.recorrencia !== "nenhuma" &&
              !despesaParaExcluir?.recorrenciaDeOrigemId ? (
                <>
                  <strong>{despesaParaExcluir?.descricao}</strong> é uma despesa
                  recorrente (modelo). Todas as filhas geradas
                  automaticamente também serão removidas. Esta ação não pode
                  ser desfeita.
                </>
              ) : (
                <>
                  <strong>{despesaParaExcluir?.descricao}</strong> será
                  excluída permanentemente. Esta ação não pode ser desfeita.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluirMut.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={excluirMut.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (!despesaParaExcluir) return;
                excluirMut.mutate({ id: despesaParaExcluir.id });
                setDespesaParaExcluir(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <BulkCategoriaDialog
        open={bulkCategoriaOpen}
        onOpenChange={setBulkCategoriaOpen}
        ids={Array.from(selecionadas)}
        categorias={categorias}
        onConfirm={(catId) =>
          bulkCategoriaMut.mutate({ ids: Array.from(selecionadas), categoriaId: catId })
        }
        isPending={bulkCategoriaMut.isPending}
      />

      <BulkPagarDialog
        open={bulkPagarOpen}
        onOpenChange={setBulkPagarOpen}
        ids={Array.from(selecionadas)}
        onConfirm={(dataPag) =>
          bulkPagarMut.mutate({ ids: Array.from(selecionadas), dataPagamento: dataPag })
        }
        isPending={bulkPagarMut.isPending}
      />

      <AlertDialog open={bulkExcluirOpen} onOpenChange={setBulkExcluirOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {selecionadas.size} despesa(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              Se alguma for despesa-modelo recorrente, todas as filhas pendentes
              também serão removidas. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                bulkExcluirMut.mutate({ ids: Array.from(selecionadas) })
              }
              disabled={bulkExcluirMut.isPending}
              className="bg-destructive hover:bg-destructive/90"
            >
              {bulkExcluirMut.isPending && (
                <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
              )}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function KpiCard({
  label,
  valor,
  icon,
  accent,
  destaque,
}: {
  label: string;
  valor: number;
  icon: React.ReactNode;
  accent?: string;
  destaque?: boolean;
}) {
  return (
    <Card className={destaque ? "border-primary/40" : ""}>
      <CardContent className="pt-5 pb-5">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
          <span className={accent ?? ""}>{icon}</span>
          {label}
        </div>
        <p className={`text-xl font-semibold mt-1 ${accent ?? ""}`}>
          {formatBRL(valor)}
        </p>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cores: Record<string, string> = {
    pendente: "text-amber-600 border-amber-200",
    parcial: "text-info-fg border-info/40 bg-info-bg/50",
    pago: "text-emerald-600 border-emerald-200",
    vencido: "text-destructive border-destructive/30",
  };
  return (
    <Badge variant="outline" className={cores[status] ?? ""}>
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

/** Badge visual do tipo de despesa baseado em `origem`. "comissao" tem
 *  destaque (rosa) pra separar de despesa operacional na lista
 *  unificada. As outras origens compartilham visual neutro. */
function TipoBadge({ origem }: { origem?: string }) {
  if (origem === "comissao") {
    return (
      <Badge variant="outline" className="text-pink-700 border-pink-200 bg-pink-50">
        Comissão
      </Badge>
    );
  }
  const labels: Record<string, string> = {
    manual: "Despesa",
    taxa_asaas: "Taxa Asaas",
    recorrencia: "Recorrente",
    extrato_asaas: "Extrato",
  };
  return (
    <Badge variant="outline" className="text-slate-600 border-slate-200">
      {labels[origem ?? "manual"] ?? "Despesa"}
    </Badge>
  );
}

/**
 * Mostra o status de recorrência da despesa. Visualizações distintas pra:
 *  - despesa-modelo ativa (gera próximas): badge sólido + ícone
 *  - despesa-modelo pausada (não gera mais): badge com cinza + Pause
 *  - despesa-filha (gerada automaticamente): badge "auto"
 *  - despesa única (sem recorrência): label "—"
 *
 * Tooltip explica cada estado pro usuário não-técnico.
 */
function RecorrenciaCell({ despesa }: { despesa: DespesaListItem }) {
  if (despesa.recorrencia === "nenhuma") {
    return <span className="text-muted-foreground">—</span>;
  }

  const label = RECORRENCIA_LABEL[despesa.recorrencia];
  const isFilha = !!despesa.recorrenciaDeOrigemId;
  const ativa = despesa.recorrenciaAtiva !== false;

  if (isFilha) {
    return (
      <Badge
        variant="outline"
        className="text-[10px] bg-violet-50 border-violet-200 text-violet-700 dark:bg-violet-950/30 dark:border-violet-800 dark:text-violet-300"
        title="Gerada automaticamente a partir de uma despesa recorrente"
      >
        <Repeat className="h-2.5 w-2.5 mr-1" />
        {label} (auto)
      </Badge>
    );
  }

  if (!ativa) {
    return (
      <Badge
        variant="outline"
        className="text-[10px] text-muted-foreground"
        title="Geração automática pausada — clique no botão Play pra retomar"
      >
        <Pause className="h-2.5 w-2.5 mr-1" />
        {label} (pausada)
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className="text-[10px] bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-950/30 dark:border-blue-800 dark:text-blue-300"
      title="Esta é a despesa-modelo. Próximas ocorrências serão geradas automaticamente."
    >
      <Repeat className="h-2.5 w-2.5 mr-1" />
      {label}
    </Badge>
  );
}

/** Dialog compartilhado entre criar e editar — props decidem o modo. */
function DespesaFormDialog({
  open,
  modo,
  despesa,
  onClose,
  onSuccess,
}: {
  open: boolean;
  modo: "criar" | "editar";
  despesa?: DespesaListItem;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const isEdit = modo === "editar" && despesa;
  const [descricao, setDescricao] = useState(isEdit ? despesa.descricao : "");
  const [valor, setValor] = useState(isEdit ? String(despesa.valor) : "");
  const [vencimento, setVencimento] = useState(isEdit ? despesa.vencimento : hojeIso());
  const [categoriaId, setCategoriaId] = useState<string>(
    isEdit && despesa.categoriaId ? String(despesa.categoriaId) : "none",
  );
  const [recorrencia, setRecorrencia] = useState<"nenhuma" | "semanal" | "mensal" | "anual">(
    isEdit ? despesa.recorrencia : "nenhuma",
  );
  const [observacoes, setObservacoes] = useState(isEdit ? despesa.observacoes ?? "" : "");

  const { data: categoriasList } = trpc.financeiro.listarCategoriasDespesa.useQuery();
  const ativas = useMemo(
    () => (categoriasList ?? []).filter((c) => c.ativo),
    [categoriasList],
  );

  const criarMut = trpc.despesas.criar.useMutation({
    onSuccess: () => {
      toast.success("Despesa criada");
      onSuccess();
      reset();
      onClose();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  const atualizarMut = trpc.despesas.atualizar.useMutation({
    onSuccess: () => {
      toast.success("Despesa atualizada");
      onSuccess();
      onClose();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  const isPending = criarMut.isPending || atualizarMut.isPending;

  function reset() {
    setDescricao("");
    setValor("");
    setVencimento(hojeIso());
    setCategoriaId("none");
    setRecorrencia("nenhuma");
    setObservacoes("");
  }

  function salvar() {
    const v = parseFloat(valor.replace(",", "."));
    if (!descricao.trim() || isNaN(v) || v <= 0 || vencimento.length !== 10) {
      toast.error("Preencha descrição, valor e vencimento.");
      return;
    }
    const payload = {
      descricao: descricao.trim(),
      valor: v,
      vencimento,
      categoriaId: categoriaId === "none" ? undefined : parseInt(categoriaId),
      recorrencia,
      observacoes: observacoes.trim() || undefined,
    };
    if (isEdit) {
      atualizarMut.mutate({
        id: despesa.id,
        ...payload,
        // Permite limpar categoria/observações quando voltam ao default
        categoriaId: categoriaId === "none" ? null : parseInt(categoriaId),
        observacoes: observacoes.trim() || null,
      });
    } else {
      criarMut.mutate(payload);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar despesa" : "Nova despesa"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Atualize os dados desta conta a pagar."
              : "Conta a pagar do escritório (aluguel, salários, tributos, etc.)."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label className="text-xs">Descrição *</Label>
            <Input
              placeholder="Ex: Aluguel maio/2026"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              className="mt-1"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Valor (R$) *</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="3000.00"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Vencimento *</Label>
              <Input
                type="date"
                value={vencimento}
                onChange={(e) => setVencimento(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Categoria</Label>
              <Select value={categoriaId} onValueChange={setCategoriaId}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem categoria</SelectItem>
                  {ativas.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Recorrência</Label>
              <Select value={recorrencia} onValueChange={(v) => setRecorrencia(v as any)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="nenhuma">Única</SelectItem>
                  <SelectItem value="semanal">Semanal</SelectItem>
                  <SelectItem value="mensal">Mensal</SelectItem>
                  <SelectItem value="anual">Anual</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs">Observações</Label>
            <Textarea
              rows={2}
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              className="mt-1 text-sm"
            />
          </div>
          {/* Anexos só aparecem após salvar (precisa ID). Em "nova despesa",
              user salva primeiro, abre de novo e anexa. Alternativa seria
              criar com placeholder ID -1 e anexar antes de salvar, mas isso
              vaza arquivos sem dono se user cancelar. */}
          {isEdit && (
            <div className="pt-2 border-t">
              <AnexosFinanceiro tipoEntidade="despesa" entidadeId={despesa.id} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={isPending}>
            {isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : isEdit ? (
              <CheckCircle2 className="h-4 w-4 mr-2" />
            ) : (
              <Plus className="h-4 w-4 mr-2" />
            )}
            {isEdit ? "Salvar" : "Criar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Dialog "Registrar pagamento": aceita parcial ou total. Default é
 *  o valor restante (atalho pra "marcar paga totalmente"). */
function RegistrarPagamentoDialog({
  despesa,
  onClose,
  onSuccess,
}: {
  despesa: DespesaListItem;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const valorTotal = Number(despesa.valor);
  const valorPago = Number(despesa.valorPago ?? 0);
  const restante = Math.max(0, valorTotal - valorPago);

  const [valor, setValor] = useState(restante.toFixed(2));
  const [data, setData] = useState(hojeIso());

  const registrarMut = (trpc as any).despesas.registrarPagamento.useMutation({
    onSuccess: (r: { quitou: boolean; valorPago: string; restante: string }) => {
      toast.success(
        r.quitou
          ? "Despesa quitada"
          : `Pagamento parcial registrado · falta R$ ${r.restante}`,
      );
      onSuccess();
      onClose();
    },
    onError: (err: any) => toast.error("Erro", { description: err.message }),
  });

  function salvar() {
    const v = parseFloat(valor.replace(",", "."));
    if (isNaN(v) || v <= 0) {
      toast.error("Informe um valor maior que zero");
      return;
    }
    if (v > restante + 0.01) {
      toast.error(`Valor excede o restante (R$ ${restante.toFixed(2)})`);
      return;
    }
    registrarMut.mutate({
      id: despesa.id,
      valor: v,
      dataPagamento: data,
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar pagamento</DialogTitle>
          <DialogDescription>
            {despesa.descricao}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="rounded-md border bg-muted/30 p-3 text-xs grid grid-cols-3 gap-2">
            <div>
              <div className="text-muted-foreground">Total</div>
              <div className="font-medium tabular-nums">{formatBRL(valorTotal)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Já pago</div>
              <div className="font-medium tabular-nums">{formatBRL(valorPago)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Restante</div>
              <div className="font-medium tabular-nums text-amber-600">
                {formatBRL(restante)}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Valor a pagar agora *</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                className="mt-1"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Default: restante (R$ {restante.toFixed(2)}).
                Informe menos pra registrar pagamento parcial.
              </p>
            </div>
            <div>
              <Label className="text-xs">Data do pagamento</Label>
              <Input
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={registrarMut.isPending}>
            {registrarMut.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <DollarSign className="h-4 w-4 mr-2" />
            )}
            Registrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Dialog: mudar categoria em massa ─────────────────────────────────────
function BulkCategoriaDialog({
  open,
  onOpenChange,
  ids,
  categorias,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ids: number[];
  categorias: Array<{ id: number; nome: string }>;
  onConfirm: (categoriaId: number | null) => void;
  isPending: boolean;
}) {
  const [valor, setValor] = useState<string>("");
  useEffect(() => {
    if (open) setValor("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Mudar categoria de {ids.length} despesa(s)</DialogTitle>
          <DialogDescription>
            As despesas selecionadas terão a categoria atualizada. Outras
            informações (valor, vencimento, status) não mudam.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label className="text-xs">Nova categoria</Label>
          <Select value={valor} onValueChange={setValor}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__null__">— Sem categoria —</SelectItem>
              {categorias.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              const id = valor === "__null__" ? null : Number(valor) || null;
              onConfirm(id);
            }}
            disabled={!valor || isPending}
          >
            {isPending && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}
            Atualizar {ids.length} despesa(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Dialog: marcar várias como pagas (integral, mesma data) ─────────────
function BulkPagarDialog({
  open,
  onOpenChange,
  ids,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ids: number[];
  onConfirm: (dataPagamento: string) => void;
  isPending: boolean;
}) {
  const [data, setData] = useState<string>(hojeIso());
  useEffect(() => {
    if (open) setData(hojeIso());
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Marcar {ids.length} despesa(s) como pagas</DialogTitle>
          <DialogDescription>
            Cada despesa será marcada como paga integralmente (<code>valorPago = valor</code>)
            na data informada. Despesas que já estão como "pago" são puladas
            sem erro. Pagamento parcial precisa ser feito uma por vez.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label className="text-xs">Data do pagamento</Label>
          <Input
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => onConfirm(data)}
            disabled={!data || isPending}
          >
            {isPending && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}
            Marcar como pago
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

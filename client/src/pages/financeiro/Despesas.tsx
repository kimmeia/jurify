/**
 * Aba "Despesas" do módulo Financeiro — contas a pagar do escritório.
 * Lista despesas com filtros, mostra KPIs e permite criar/editar/marcar paga.
 */

import { useState, useMemo } from "react";
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
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  Plus,
  RotateCcw,
  Trash2,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { formatBRL } from "./helpers";

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
  pago: "Pago",
  vencido: "Vencido",
};

const RECORRENCIA_LABEL: Record<string, string> = {
  nenhuma: "—",
  mensal: "Mensal",
  anual: "Anual",
};

export function DespesasTab() {
  const utils = trpc.useUtils();
  const [periodoInicio, setPeriodoInicio] = useState(inicioDoMesIso());
  const [periodoFim, setPeriodoFim] = useState(fimDoMesIso());
  const [filtroStatus, setFiltroStatus] = useState<string>("todos");
  const [novaAberta, setNovaAberta] = useState(false);

  const status = filtroStatus === "todos" ? undefined : (filtroStatus as any);
  const lista = trpc.despesas.listar.useQuery({
    periodoInicio,
    periodoFim,
    status,
    limit: 200,
  });
  const kpis = trpc.despesas.kpis.useQuery({ periodoInicio, periodoFim });

  const marcarPagaMut = trpc.despesas.marcarPaga.useMutation({
    onSuccess: () => {
      toast.success("Despesa marcada como paga");
      utils.despesas.listar.invalidate();
      utils.despesas.kpis.invalidate();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
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

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <Card>
        <CardContent className="pt-5">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
            <div className="space-y-1.5">
              <Label className="text-xs">De (vencimento)</Label>
              <Input
                type="date"
                value={periodoInicio}
                onChange={(e) => setPeriodoInicio(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Até</Label>
              <Input
                type="date"
                value={periodoFim}
                onChange={(e) => setPeriodoFim(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <Select value={filtroStatus} onValueChange={setFiltroStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="pendente">Pendente</SelectItem>
                  <SelectItem value="pago">Pago</SelectItem>
                  <SelectItem value="vencido">Vencido</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => setNovaAberta(true)}>
              <Plus className="h-4 w-4 mr-2" /> Nova despesa
            </Button>
          </div>
        </CardContent>
      </Card>

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
              {lista.data?.length ?? 0}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {lista.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (lista.data ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">
              Nenhuma despesa no período. Clique em "Nova despesa" para começar.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Vencimento</TableHead>
                  <TableHead className="text-xs">Descrição</TableHead>
                  <TableHead className="text-xs">Categoria</TableHead>
                  <TableHead className="text-xs">Recorrência</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs text-right">Valor</TableHead>
                  <TableHead className="text-xs"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(lista.data ?? []).map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="text-xs">{formatData(d.vencimento)}</TableCell>
                    <TableCell className="text-xs max-w-[260px] truncate">
                      {d.descricao}
                    </TableCell>
                    <TableCell className="text-xs">{d.categoriaNome ?? "—"}</TableCell>
                    <TableCell className="text-xs">{RECORRENCIA_LABEL[d.recorrencia]}</TableCell>
                    <TableCell className="text-xs">
                      <StatusBadge status={d.status} />
                      {d.dataPagamento && d.status === "pago" && (
                        <span className="text-[10px] text-muted-foreground ml-1">
                          em {formatData(d.dataPagamento)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-right tabular-nums">
                      {formatBRL(Number(d.valor))}
                    </TableCell>
                    <TableCell className="text-xs flex gap-1">
                      {d.status !== "pago" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-emerald-600 hover:text-emerald-700"
                          onClick={() => marcarPagaMut.mutate({ id: d.id })}
                          disabled={marcarPagaMut.isPending}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Marcar paga
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
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          if (confirm("Excluir esta despesa?")) {
                            excluirMut.mutate({ id: d.id });
                          }
                        }}
                        disabled={excluirMut.isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <NovaDespesaDialog
        open={novaAberta}
        onClose={() => setNovaAberta(false)}
        onSuccess={() => {
          utils.despesas.listar.invalidate();
          utils.despesas.kpis.invalidate();
        }}
      />
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
    pago: "text-emerald-600 border-emerald-200",
    vencido: "text-destructive border-destructive/30",
  };
  return (
    <Badge variant="outline" className={cores[status] ?? ""}>
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

function NovaDespesaDialog({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [vencimento, setVencimento] = useState(hojeIso());
  const [categoriaId, setCategoriaId] = useState<string>("none");
  const [recorrencia, setRecorrencia] = useState<"nenhuma" | "mensal" | "anual">(
    "nenhuma",
  );
  const [observacoes, setObservacoes] = useState("");

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
    criarMut.mutate({
      descricao: descricao.trim(),
      valor: v,
      vencimento,
      categoriaId: categoriaId === "none" ? undefined : parseInt(categoriaId),
      recorrencia,
      observacoes: observacoes.trim() || undefined,
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nova despesa</DialogTitle>
          <DialogDescription>
            Conta a pagar do escritório (aluguel, salários, tributos, etc.).
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} disabled={criarMut.isPending}>
            {criarMut.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Plus className="h-4 w-4 mr-2" />
            )}
            Criar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

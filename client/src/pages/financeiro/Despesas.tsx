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
  DollarSign,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  Repeat,
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
  origem?: "manual" | "taxa_asaas" | "recorrencia";
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
  const [novaAberta, setNovaAberta] = useState(false);
  const [editando, setEditando] = useState<DespesaListItem | null>(null);
  const [pagando, setPagando] = useState<DespesaListItem | null>(null);

  const status = filtroStatus === "todos" ? undefined : (filtroStatus as any);
  const lista = trpc.despesas.listar.useQuery({
    periodoInicio,
    periodoFim,
    status,
    limit: 200,
  });
  const kpis = trpc.despesas.kpis.useQuery({ periodoInicio, periodoFim });

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
                  <SelectItem value="parcial">Parcial</SelectItem>
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
                {(lista.data ?? []).map((d) => {
                  const valorTotal = Number(d.valor);
                  const valorPago = Number(d.valorPago ?? 0);
                  const restante = Math.max(0, valorTotal - valorPago);
                  return (
                    <TableRow key={d.id}>
                      <TableCell className="text-xs">{formatData(d.vencimento)}</TableCell>
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
                        {d.status !== "pago" ? (
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
                        )}
                        {/* Ações de recorrência: só aparecem na despesa-modelo
                            (recorrenciaDeOrigemId === null E recorrencia ≠ nenhuma).
                            Filhas geradas não têm controle próprio — herdam da
                            modelo. */}
                        {d.recorrencia !== "nenhuma" && !d.recorrenciaDeOrigemId && (
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
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          onClick={() => setEditando(d)}
                          title="Editar"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
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
                          title="Excluir"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
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

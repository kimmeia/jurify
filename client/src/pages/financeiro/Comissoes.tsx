/**
 * Aba "Comissões" do módulo Financeiro.
 * Permite simular comissões por atendente em um período arbitrário,
 * fechar o período (snapshot imutável) e consultar histórico de fechamentos.
 */

import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Calculator,
  History,
  Loader2,
  Lock,
  Receipt,
  Tags,
  Users,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { formatBRL } from "./helpers";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hojeIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function trintaDiasAtrasIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function formatData(iso: string | null | undefined) {
  if (!iso) return "—";
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

const MOTIVO_LABEL: Record<string, string> = {
  override_manual: "Desmarcada manualmente",
  categoria_nao_comissionavel: "Categoria não comissionável",
  abaixo_minimo: "Abaixo do valor mínimo",
};

// ─── Componente principal ────────────────────────────────────────────────────

export function ComissoesTab() {
  return (
    <Tabs defaultValue="calcular" className="space-y-4">
      <TabsList>
        <TabsTrigger value="calcular" className="gap-1.5">
          <Calculator className="h-3.5 w-3.5" />
          Calcular
        </TabsTrigger>
        <TabsTrigger value="atribuir" className="gap-1.5">
          <Tags className="h-3.5 w-3.5" />
          Atribuir cobranças
        </TabsTrigger>
        <TabsTrigger value="historico" className="gap-1.5">
          <History className="h-3.5 w-3.5" />
          Histórico de fechamentos
        </TabsTrigger>
      </TabsList>
      <TabsContent value="calcular">
        <CalcularSection />
      </TabsContent>
      <TabsContent value="atribuir">
        <AtribuirSection />
      </TabsContent>
      <TabsContent value="historico">
        <HistoricoSection />
      </TabsContent>
    </Tabs>
  );
}

// ─── Sub-tab: Calcular ───────────────────────────────────────────────────────

function CalcularSection() {
  const utils = trpc.useUtils();
  const { data: equipeData } = trpc.configuracoes.listarColaboradores.useQuery();
  const atendentes = useMemo(
    () =>
      (equipeData && "colaboradores" in equipeData
        ? equipeData.colaboradores
        : []
      ).filter((c) => c.cargo !== "estagiario"),
    [equipeData],
  );

  const [atendenteId, setAtendenteId] = useState<string>("");
  const [periodoInicio, setPeriodoInicio] = useState<string>(trintaDiasAtrasIso());
  const [periodoFim, setPeriodoFim] = useState<string>(hojeIso());
  const [confirmFechar, setConfirmFechar] = useState(false);

  const atendenteIdNum = atendenteId ? parseInt(atendenteId) : null;
  const podeSimular =
    atendenteIdNum !== null &&
    periodoInicio.length === 10 &&
    periodoFim.length === 10 &&
    periodoInicio <= periodoFim;

  const sim = trpc.comissoes.simular.useQuery(
    {
      atendenteId: atendenteIdNum ?? 0,
      periodoInicio,
      periodoFim,
    },
    { enabled: podeSimular, staleTime: 0 },
  );

  const fecharMut = trpc.comissoes.fechar.useMutation({
    onSuccess: () => {
      toast.success("Período fechado", {
        description: "Snapshot salvo no histórico.",
      });
      utils.comissoes.listarFechamentos.invalidate();
      setConfirmFechar(false);
    },
    onError: (err) =>
      toast.error("Erro ao fechar", { description: err.message }),
  });

  const totais = sim.data?.totais;
  const aliquotaAplicada = Number(sim.data?.aliquotaAplicada ?? 0);
  const valorMinimo = sim.data?.regra.valorMinimo ?? 0;
  const modo = sim.data?.regra.modo ?? "flat";
  const baseFaixa = sim.data?.regra.baseFaixa ?? "comissionavel";
  const faixaAplicada = sim.data?.faixaAplicada;

  return (
    <div className="space-y-4">
      {/* Controles */}
      <Card>
        <CardContent className="pt-5">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">Atendente</Label>
              <Select value={atendenteId} onValueChange={setAtendenteId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um atendente" />
                </SelectTrigger>
                <SelectContent>
                  {atendentes.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      Nenhum atendente cadastrado.
                    </div>
                  ) : (
                    atendentes.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.userName ?? "—"} ({c.cargo})
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">De</Label>
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
          </div>

          {!podeSimular && (
            <p className="text-xs text-muted-foreground mt-3">
              Selecione um atendente e um período válido para simular a comissão.
            </p>
          )}

          {sim.isLoading && podeSimular && (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Totais + Botão fechar */}
      {sim.data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard label="Bruto recebido" valor={totais?.bruto ?? 0} />
            <KpiCard
              label="Comissionável"
              valor={totais?.comissionavel ?? 0}
              accent="text-emerald-600"
            />
            <KpiCard
              label="Não comissionável"
              valor={totais?.naoComissionavel ?? 0}
              accent="text-muted-foreground"
            />
            <KpiCard
              label={`Comissão (${aliquotaAplicada}%)`}
              valor={totais?.valorComissao ?? 0}
              accent="text-primary"
              destaque
            />
          </div>

          {modo === "faixas" && faixaAplicada && (
            <Card className="bg-muted/30">
              <CardContent className="py-3 px-4 text-xs space-y-1">
                <div className="font-medium text-foreground">
                  Faixa atingida (cumulativo)
                </div>
                <div className="text-muted-foreground">
                  Base usada: <strong>{formatBRL(faixaAplicada.valorBaseClassificacao)}</strong>{" "}
                  ({baseFaixa === "bruto" ? "recebido bruto" : "recebido comissionável"})
                  {" → "}faixa de{" "}
                  <strong>
                    {faixaAplicada.limiteAte === null
                      ? "sem teto"
                      : `até ${formatBRL(Number(faixaAplicada.limiteAte))}`}
                  </strong>
                  {" → "}alíquota <strong>{faixaAplicada.aliquotaPercent}%</strong>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              Regra atual:{" "}
              {modo === "faixas"
                ? `faixas progressivas (cumulativo)`
                : `alíquota fixa ${aliquotaAplicada}%`}
              {" · "}valor mínimo {formatBRL(valorMinimo)}
            </span>
            <Button
              size="sm"
              className="ml-auto"
              disabled={
                !sim.data ||
                sim.data.comissionaveis.length + sim.data.naoComissionaveis.length === 0
              }
              onClick={() => setConfirmFechar(true)}
            >
              <Lock className="h-3.5 w-3.5 mr-2" />
              Fechar período
            </Button>
          </div>

          <ListaCobrancas
            titulo="Cobranças que entram na comissão"
            cor="emerald"
            itens={sim.data.comissionaveis.map((c) => ({ ...c, motivo: null }))}
          />
          <ListaCobrancas
            titulo="Cobranças que NÃO entram na comissão"
            cor="slate"
            itens={sim.data.naoComissionaveis}
          />
        </>
      )}

      <AlertDialog open={confirmFechar} onOpenChange={setConfirmFechar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fechar período de comissão?</AlertDialogTitle>
            <AlertDialogDescription>
              Os totais ficarão congelados no histórico. Mudanças posteriores em
              alíquota, categorias ou cobranças não afetam fechamentos passados.
              Você pode excluir um fechamento depois caso precise corrigir.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={fecharMut.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={fecharMut.isPending || atendenteIdNum === null}
              onClick={(e) => {
                e.preventDefault();
                if (atendenteIdNum === null) return;
                fecharMut.mutate({
                  atendenteId: atendenteIdNum,
                  periodoInicio,
                  periodoFim,
                });
              }}
            >
              {fecharMut.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Lock className="h-4 w-4 mr-2" />
              )}
              Confirmar fechamento
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
  accent,
  destaque,
}: {
  label: string;
  valor: number;
  accent?: string;
  destaque?: boolean;
}) {
  return (
    <Card className={destaque ? "border-primary/40" : ""}>
      <CardContent className="pt-5 pb-5">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className={`text-xl font-semibold mt-1 ${accent ?? ""}`}>
          {formatBRL(valor)}
        </p>
      </CardContent>
    </Card>
  );
}

function ListaCobrancas({
  titulo,
  cor,
  itens,
}: {
  titulo: string;
  cor: "emerald" | "slate";
  itens: Array<{
    id: number;
    valor: number;
    dataPagamento: string | null;
    descricao: string | null;
    categoriaNome: string | null;
    motivo?: string | null;
    motivoExclusao?: string | null;
  }>;
}) {
  const headerCor =
    cor === "emerald" ? "text-emerald-600" : "text-muted-foreground";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className={`text-sm flex items-center gap-2 ${headerCor}`}>
          <Receipt className="h-4 w-4" />
          {titulo} <Badge variant="outline" className="ml-2">{itens.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {itens.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3 text-center">
            Nenhuma cobrança neste grupo.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Pago em</TableHead>
                <TableHead className="text-xs">Descrição</TableHead>
                <TableHead className="text-xs">Categoria</TableHead>
                {cor === "slate" && (
                  <TableHead className="text-xs">Motivo</TableHead>
                )}
                <TableHead className="text-xs text-right">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {itens.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="text-xs">
                    {formatData(item.dataPagamento)}
                  </TableCell>
                  <TableCell className="text-xs max-w-xs truncate">
                    {item.descricao ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {item.categoriaNome ?? (
                      <span className="text-muted-foreground italic">
                        Sem categoria
                      </span>
                    )}
                  </TableCell>
                  {cor === "slate" && (
                    <TableCell className="text-xs">
                      {item.motivoExclusao
                        ? MOTIVO_LABEL[item.motivoExclusao] ?? item.motivoExclusao
                        : "—"}
                    </TableCell>
                  )}
                  <TableCell className="text-xs text-right tabular-nums">
                    {formatBRL(item.valor)}
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

// ─── Sub-tab: Histórico ──────────────────────────────────────────────────────

function HistoricoSection() {
  const { data, isLoading } = trpc.comissoes.listarFechamentos.useQuery();
  const [abertoId, setAbertoId] = useState<number | null>(null);

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!data || data.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          <Users className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          Nenhum fechamento ainda. Quando você fechar um período na aba Calcular,
          ele aparecerá aqui.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Atendente</TableHead>
              <TableHead className="text-xs">Período</TableHead>
              <TableHead className="text-xs">Alíquota</TableHead>
              <TableHead className="text-xs">Fechado em</TableHead>
              <TableHead className="text-xs text-right">Comissão</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((f) => (
              <TableRow key={f.id}>
                <TableCell className="text-xs">
                  {f.atendenteNome ?? "—"}
                </TableCell>
                <TableCell className="text-xs">
                  {formatData(f.periodoInicio)} – {formatData(f.periodoFim)}
                </TableCell>
                <TableCell className="text-xs">{Number(f.aliquotaUsada)}%</TableCell>
                <TableCell className="text-xs">
                  {new Date(f.fechadoEm).toLocaleDateString("pt-BR")}
                </TableCell>
                <TableCell className="text-xs text-right tabular-nums font-medium">
                  {formatBRL(Number(f.totalComissao))}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-7"
                    onClick={() => setAbertoId(f.id)}
                  >
                    Detalhar
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {abertoId !== null && (
        <FechamentoDetalheDialog
          fechamentoId={abertoId}
          onClose={() => setAbertoId(null)}
        />
      )}
    </div>
  );
}

// ─── Sub-tab: Atribuir ───────────────────────────────────────────────────────

function AtribuirSection() {
  const utils = trpc.useUtils();
  const [apenasSemAtribuicao, setApenasSemAtribuicao] = useState(true);
  const [selecionadas, setSelecionadas] = useState<Set<number>>(new Set());
  const [dialogAberto, setDialogAberto] = useState(false);

  const { data, isLoading } = trpc.financeiro.listarCobrancasParaAtribuicao.useQuery(
    { apenasSemAtribuicao, limit: 200 },
  );
  const { data: equipeData } = trpc.configuracoes.listarColaboradores.useQuery();
  const atendentes = useMemo(
    () =>
      (equipeData && "colaboradores" in equipeData
        ? equipeData.colaboradores
        : []
      ).filter((c) => c.cargo !== "estagiario"),
    [equipeData],
  );
  const { data: categoriasList } = trpc.financeiro.listarCategoriasCobranca.useQuery();
  const categoriasAtivas = (categoriasList ?? []).filter((c) => c.ativo);

  const reconciliarMut = trpc.financeiro.reconciliarCobrancasOrfas.useMutation({
    onSuccess: (r) => {
      toast.success(`${r.atribuidas} cobrança(s) atribuída(s)`, {
        description: r.atribuidas > 0 ? "Atendentes inferidos via cliente." : "Nenhuma órfã atribuível.",
      });
      utils.financeiro.listarCobrancasParaAtribuicao.invalidate();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  const linhas = data ?? [];
  const todasSelecionadas =
    linhas.length > 0 && linhas.every((l) => selecionadas.has(l.id));

  function toggleTodas() {
    if (todasSelecionadas) {
      setSelecionadas(new Set());
    } else {
      setSelecionadas(new Set(linhas.map((l) => l.id)));
    }
  }

  function toggleLinha(id: number) {
    const next = new Set(selecionadas);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelecionadas(next);
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="pt-5">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={apenasSemAtribuicao}
                onCheckedChange={(v) => setApenasSemAtribuicao(Boolean(v))}
              />
              Mostrar apenas cobranças sem atribuição
            </label>
            <div className="flex-1" />
            <Button
              variant="outline"
              size="sm"
              onClick={() => reconciliarMut.mutate({})}
              disabled={reconciliarMut.isPending}
              title="Re-aplica a cascata de inferência (externalReference + atendente do cliente) sobre cobranças órfãs"
            >
              {reconciliarMut.isPending ? (
                <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
              ) : (
                <Wand2 className="h-3.5 w-3.5 mr-2" />
              )}
              Reconciliar órfãs
            </Button>
            <Button
              size="sm"
              disabled={selecionadas.size === 0}
              onClick={() => setDialogAberto(true)}
            >
              Atribuir selecionadas ({selecionadas.size})
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : linhas.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {apenasSemAtribuicao
              ? "Nenhuma cobrança sem atribuição. Tudo organizado!"
              : "Nenhuma cobrança encontrada."}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={todasSelecionadas}
                    onCheckedChange={toggleTodas}
                  />
                </TableHead>
                <TableHead className="text-xs">Cliente</TableHead>
                <TableHead className="text-xs">Descrição</TableHead>
                <TableHead className="text-xs">Pago em</TableHead>
                <TableHead className="text-xs">Atendente</TableHead>
                <TableHead className="text-xs">Categoria</TableHead>
                <TableHead className="text-xs text-right">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((l) => {
                const atendNome = atendentes.find((a) => a.id === l.atendenteId)?.userName;
                return (
                  <TableRow key={l.id} data-state={selecionadas.has(l.id) ? "selected" : undefined}>
                    <TableCell>
                      <Checkbox
                        checked={selecionadas.has(l.id)}
                        onCheckedChange={() => toggleLinha(l.id)}
                      />
                    </TableCell>
                    <TableCell className="text-xs">{l.contatoNome ?? "—"}</TableCell>
                    <TableCell className="text-xs max-w-[220px] truncate">
                      {l.descricao ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs">{formatData(l.dataPagamento)}</TableCell>
                    <TableCell className="text-xs">
                      {l.atendenteId ? (
                        atendNome ?? `#${l.atendenteId}`
                      ) : (
                        <Badge variant="outline" className="text-amber-600 border-amber-200">
                          sem atendente
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {l.categoriaNome ?? (
                        <Badge variant="outline" className="text-muted-foreground">
                          sem categoria
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-right tabular-nums">
                      {formatBRL(Number(l.valor))}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <AtribuirEmMassaDialog
        open={dialogAberto}
        onClose={() => setDialogAberto(false)}
        cobrancaIds={[...selecionadas]}
        atendentes={atendentes}
        categorias={categoriasAtivas}
        onSuccess={() => {
          setSelecionadas(new Set());
          setDialogAberto(false);
          utils.financeiro.listarCobrancasParaAtribuicao.invalidate();
        }}
      />
    </div>
  );
}

function AtribuirEmMassaDialog({
  open,
  onClose,
  cobrancaIds,
  atendentes,
  categorias,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  cobrancaIds: number[];
  atendentes: Array<{ id: number; userName: string | null; cargo: string }>;
  categorias: Array<{ id: number; nome: string; comissionavel: boolean }>;
  onSuccess: () => void;
}) {
  const [atendente, setAtendente] = useState<string>("manter"); // manter | none | <id>
  const [categoria, setCategoria] = useState<string>("manter");
  const [override, setOverride] = useState<string>("manter"); // manter | padrao | sim | nao

  const aplicarMut = trpc.financeiro.atribuirCobrancasEmMassa.useMutation({
    onSuccess: (r) => {
      toast.success(`${r.atualizadas} cobrança(s) atualizada(s)`);
      onSuccess();
      reset();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  function reset() {
    setAtendente("manter");
    setCategoria("manter");
    setOverride("manter");
  }

  function aplicar() {
    const dados: {
      atendenteId?: number | null;
      categoriaId?: number | null;
      comissionavelOverride?: boolean | null;
    } = {};
    if (atendente !== "manter") {
      dados.atendenteId = atendente === "none" ? null : parseInt(atendente);
    }
    if (categoria !== "manter") {
      dados.categoriaId = categoria === "none" ? null : parseInt(categoria);
    }
    if (override !== "manter") {
      dados.comissionavelOverride =
        override === "padrao" ? null : override === "sim";
    }
    if (Object.keys(dados).length === 0) {
      toast.warning("Nenhum campo para alterar.");
      return;
    }
    aplicarMut.mutate({ cobrancaIds, ...dados });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Atribuir em massa</DialogTitle>
          <DialogDescription>
            {cobrancaIds.length} cobrança(s) selecionada(s). Campos definidos
            como "Manter" não são alterados.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label className="text-xs">Atendente</Label>
            <Select value={atendente} onValueChange={setAtendente}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="manter">Manter</SelectItem>
                <SelectItem value="none">Limpar (sem atendente)</SelectItem>
                {atendentes.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.userName ?? "—"} ({a.cargo})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Categoria</Label>
            <Select value={categoria} onValueChange={setCategoria}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="manter">Manter</SelectItem>
                <SelectItem value="none">Limpar (sem categoria)</SelectItem>
                {categorias.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.nome}
                    {c.comissionavel ? "" : " (não comissionável)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Conta na comissão?</Label>
            <Select value={override} onValueChange={setOverride}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="manter">Manter</SelectItem>
                <SelectItem value="padrao">Padrão da categoria</SelectItem>
                <SelectItem value="sim">Sim (forçar)</SelectItem>
                <SelectItem value="nao">Não (ignorar)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={aplicar} disabled={aplicarMut.isPending}>
            {aplicarMut.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : null}
            Aplicar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FechamentoDetalheDialog({
  fechamentoId,
  onClose,
}: {
  fechamentoId: number;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.comissoes.obterFechamento.useQuery({
    id: fechamentoId,
  });
  const excluirMut = trpc.comissoes.excluirFechamento.useMutation({
    onSuccess: () => {
      toast.success("Fechamento excluído");
      utils.comissoes.listarFechamentos.invalidate();
      onClose();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });

  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent className="max-w-3xl">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4" />
            Fechamento #{fechamentoId}
            <Badge variant="outline" className="ml-2 text-xs">
              FECHADO
            </Badge>
          </AlertDialogTitle>
          <AlertDialogDescription>
            {data && (
              <span>
                {data.atendenteNome} · {formatData(data.periodoInicio)} –{" "}
                {formatData(data.periodoFim)} ·{" "}
                {data.modoUsado === "faixas" ? (
                  <>
                    faixa atingida{" "}
                    <strong>{Number(data.aliquotaUsada)}%</strong> (base:{" "}
                    {data.baseFaixaUsada === "bruto"
                      ? "recebido bruto"
                      : "recebido comissionável"}
                    )
                  </>
                ) : (
                  <>alíquota fixa {Number(data.aliquotaUsada)}%</>
                )}
                {" · "}mínimo {formatBRL(Number(data.valorMinimoUsado))}
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {isLoading || !data ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-3 max-h-[400px] overflow-y-auto">
            <div className="grid grid-cols-4 gap-2 text-xs">
              <KpiCard label="Bruto" valor={Number(data.totalBrutoRecebido)} />
              <KpiCard
                label="Comissionável"
                valor={Number(data.totalComissionavel)}
                accent="text-emerald-600"
              />
              <KpiCard
                label="Não comiss."
                valor={Number(data.totalNaoComissionavel)}
                accent="text-muted-foreground"
              />
              <KpiCard
                label="Comissão"
                valor={Number(data.totalComissao)}
                accent="text-primary"
                destaque
              />
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Pago em</TableHead>
                  <TableHead className="text-xs">Descrição</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Motivo</TableHead>
                  <TableHead className="text-xs text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.itens.map((it) => (
                  <TableRow key={it.asaasCobrancaId}>
                    <TableCell className="text-xs">
                      {formatData(it.dataPagamento)}
                    </TableCell>
                    <TableCell className="text-xs max-w-xs truncate">
                      {it.descricao ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {it.foiComissionavel ? (
                        <Badge variant="outline" className="text-emerald-600">
                          comissionada
                        </Badge>
                      ) : (
                        <Badge variant="outline">excluída</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {it.motivoExclusao
                        ? MOTIVO_LABEL[it.motivoExclusao] ?? it.motivoExclusao
                        : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-right tabular-nums">
                      {formatBRL(Number(it.valor))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {data.observacoes && (
              <div className="text-xs">
                <span className="font-medium">Observações: </span>
                <span className="text-muted-foreground">{data.observacoes}</span>
              </div>
            )}
          </div>
        )}

        <AlertDialogFooter className="flex-row gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={excluirMut.isPending}
            onClick={() =>
              excluirMut.mutate({ id: fechamentoId })
            }
            className="text-destructive hover:text-destructive"
          >
            Excluir fechamento
          </Button>
          <div className="flex-1" />
          <AlertDialogAction onClick={onClose}>Fechar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

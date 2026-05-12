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
  CardDescription,
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  CalendarClock,
  CheckCircle2,
  History,
  Loader2,
  Lock,
  Receipt,
  Tags,
  Users,
  Wand2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { formatBRL } from "./helpers";
import {
  FiltrosAtribuir,
  filtrosParaInput,
  useFiltrosAtribuir,
} from "./FiltrosAtribuir";

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
        <TabsTrigger value="agendamento" className="gap-1.5">
          <CalendarClock className="h-3.5 w-3.5" />
          Agendamento
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
      <TabsContent value="agendamento">
        <AgendamentoSection />
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

  // Quando o backend detecta fechamento existente pro mesmo período,
  // retorna `status: "duplicado"` em vez de criar. Guardamos pra
  // mostrar dialog "Já existe — quer criar mesmo assim?".
  const [duplicadoInfo, setDuplicadoInfo] = useState<
    { existenteId: number; origem: "manual" | "automatico" } | null
  >(null);

  const fecharMut = (trpc.comissoes.fechar as any).useMutation({
    onSuccess: (r: { status: "criado"; id: number } | { status: "duplicado"; existenteId: number; origem: "manual" | "automatico" }) => {
      if (r.status === "duplicado") {
        setDuplicadoInfo({ existenteId: r.existenteId, origem: r.origem });
        setConfirmFechar(false);
        return;
      }
      toast.success("Período fechado", {
        description: "Snapshot salvo no histórico.",
      });
      utils.comissoes.listarFechamentos.invalidate();
      setConfirmFechar(false);
    },
    onError: (err: any) =>
      toast.error("Erro ao fechar", { description: err.message }),
  });

  const totais = sim.data?.totais;
  const aliquotaAplicada = Number(sim.data?.aliquotaAplicada ?? 0);
  const valorMinimo = sim.data?.regra.valorMinimo ?? 0;
  const modo = sim.data?.regra.modo ?? "flat";
  const baseFaixa = sim.data?.regra.baseFaixa ?? "comissionavel";
  const faixaAplicada = sim.data?.faixaAplicada;

  // Diagnóstico: compara cobranças pagas no período (de TODOS atendentes
  // do escritório) com o que entra na comissão do atendente filtrado.
  // Resposta detalhada pra "por que minha comissão tá menor que o
  // recebido".
  const [diagOpen, setDiagOpen] = useState(false);
  const diag = trpc.comissoes.diagnosticar.useQuery(
    {
      atendenteId: atendenteIdNum ?? 0,
      periodoInicio,
      periodoFim,
    },
    { enabled: podeSimular && diagOpen, staleTime: 0 },
  );

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
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDiagOpen(true)}
              title="Compara cobranças pagas no período com o que entra na comissão"
            >
              🔍 Diagnosticar diferença
            </Button>
          </div>

          {sim.data.comissionaveis.length + sim.data.naoComissionaveis.length === 0 ? (
            <Card className="border-violet-300 bg-violet-50/50 dark:border-violet-800 dark:bg-violet-950/20">
              <CardContent className="py-6 text-center text-sm space-y-2">
                <p className="font-medium text-violet-900 dark:text-violet-100">
                  Nenhuma cobrança disponível pra fechamento neste período
                </p>
                <p className="text-xs text-violet-700 dark:text-violet-300">
                  Pode ser que <b>todas as cobranças deste período já foram incluídas em
                  fechamentos anteriores</b> (proteção anti-duplicata). Use o botão{" "}
                  <b>🔍 Diagnosticar diferença</b> pra ver o histórico de cada uma e em
                  qual fechamento ela está.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
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

      {/* Dialog: diagnóstico — explica diferença entre cobranças pagas
          e o que entra na comissão. Lista cada cobrança com motivo. */}
      <AlertDialog open={diagOpen} onOpenChange={setDiagOpen}>
        <AlertDialogContent className="max-w-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>🔍 Diagnóstico — diferença entre cobranças pagas e comissão</AlertDialogTitle>
            <AlertDialogDescription>
              Lista TODAS as cobranças pagas no período (de qualquer atendente) e
              mostra o motivo de cada uma entrar ou não na comissão do atendente
              filtrado.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {diag.isLoading && (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {diag.data && (
            <div className="space-y-3 max-h-[60vh] overflow-y-auto">
              <div className="grid grid-cols-3 gap-3">
                <KpiCard label="Total pago no período" valor={diag.data.totalPago} />
                <KpiCard
                  label="Entra na comissão"
                  valor={diag.data.totalComissionavel}
                  accent="text-emerald-600"
                />
                <KpiCard
                  label="Diferença (não entra)"
                  valor={diag.data.diferenca}
                  accent={diag.data.diferenca > 0 ? "text-amber-600" : "text-muted-foreground"}
                  destaque
                />
              </div>

              <div className="rounded-md border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium">Cobrança</th>
                      <th className="px-2 py-1.5 text-right font-medium">Valor</th>
                      <th className="px-2 py-1.5 text-left font-medium">Pago em</th>
                      <th className="px-2 py-1.5 text-left font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diag.data.linhas.map((l) => {
                      const cor =
                        l.motivo === "comissionavel"
                          ? "text-emerald-700 bg-emerald-50/50 dark:text-emerald-300 dark:bg-emerald-950/20"
                          : l.motivo === "atendente_diferente"
                          ? "text-blue-700 bg-blue-50/50 dark:text-blue-300 dark:bg-blue-950/20"
                          : l.motivo === "ja_fechada"
                          ? "text-violet-700 bg-violet-50/50 dark:text-violet-300 dark:bg-violet-950/20"
                          : "text-amber-700 bg-amber-50/50 dark:text-amber-300 dark:bg-amber-950/20";
                      const labelMotivo = {
                        comissionavel: "✓ Entra",
                        atendente_diferente: "Outro atendente",
                        override_manual: "Override manual",
                        categoria_nao_comissionavel: "Categoria não comiss.",
                        abaixo_minimo: "Abaixo do mínimo",
                        ja_fechada: l.fechamentoExistenteId
                          ? `Já fechada (#${l.fechamentoExistenteId})`
                          : "Já fechada",
                      }[l.motivo];
                      return (
                        <tr key={l.id} className={`border-t ${cor}`}>
                          <td className="px-2 py-1.5">
                            {l.descricao || "—"}
                            {l.categoriaNome && (
                              <span className="ml-1 text-[10px] text-muted-foreground">
                                ({l.categoriaNome})
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono">
                            {formatBRL(l.valor)}
                          </td>
                          <td className="px-2 py-1.5 text-muted-foreground">
                            {l.dataPagamento}
                          </td>
                          <td className="px-2 py-1.5 font-medium" title={l.detalhe}>
                            {labelMotivo}
                          </td>
                        </tr>
                      );
                    })}
                    {diag.data.linhas.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-2 py-6 text-center text-muted-foreground">
                          Nenhuma cobrança paga no período.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <p className="text-[11px] text-muted-foreground italic">
                Passe o mouse sobre cada motivo pra ver o detalhe completo.
              </p>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel>Fechar</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialog: já existe fechamento pro período (manual ou cron) */}
      <AlertDialog
        open={!!duplicadoInfo}
        onOpenChange={(o) => !o && setDuplicadoInfo(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Já existe fechamento pra esse período</AlertDialogTitle>
            <AlertDialogDescription>
              Foi encontrado um fechamento de origem{" "}
              <b>{duplicadoInfo?.origem === "automatico" ? "automática (cron)" : "manual"}</b>{" "}
              pro mesmo atendente e período. Você pode ver o existente ou criar
              um adicional (re-fechamento após correção).
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
                  forcarDuplicado: true,
                });
                setDuplicadoInfo(null);
              }}
            >
              Criar mesmo assim
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

// ─── Célula "Comissão" da tabela Atribuir ───────────────────────────────────

/**
 * Chip clicável que mostra o estado de comissionável da cobrança e
 * permite alterar via popover sem abrir o dialog "Atribuir em massa".
 *
 * Estados (resolvidos a partir de override + categoria):
 *  - 🟢 Sim       → override=true OU (override=null E categoria.comissionavel=true)
 *  - 🔴 Não       → override=false OU (override=null E categoria.comissionavel=false)
 *  - ⚪ Indefinido → override=null E categoria=null (típico em PIX direto pro Asaas
 *                    via webhook que cria cobrança sem categoria)
 *
 * Click abre popover com 3 opções:
 *  - "Sim, comissionável" → override=true
 *  - "Não comissionável"  → override=false
 *  - "Herdar da categoria" → override=null (volta pro default)
 */
function CelulaComissao({
  comissionavelOverride,
  categoriaComissionavel,
  onChange,
  disabled,
}: {
  cobrancaId: number;
  comissionavelOverride: boolean | null;
  categoriaComissionavel: boolean | null;
  onChange: (novo: boolean | null) => void;
  disabled?: boolean;
}) {
  // Estado efetivo (o que o cálculo de comissão vai usar)
  const efetivo: "sim" | "nao" | "indefinido" =
    comissionavelOverride === true
      ? "sim"
      : comissionavelOverride === false
        ? "nao"
        : categoriaComissionavel === true
          ? "sim"
          : categoriaComissionavel === false
            ? "nao"
            : "indefinido";

  const fonte: "override" | "categoria" | "indefinido" =
    comissionavelOverride !== null
      ? "override"
      : categoriaComissionavel !== null
        ? "categoria"
        : "indefinido";

  const [aberto, setAberto] = useState(false);

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={[
            "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors",
            efetivo === "sim" && "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
            efetivo === "nao" && "bg-red-50 text-red-700 border-red-200 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900",
            efetivo === "indefinido" && "bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
            disabled && "opacity-50 cursor-not-allowed",
          ]
            .filter(Boolean)
            .join(" ")}
          title={
            fonte === "override"
              ? "Definido manualmente. Click pra alterar."
              : fonte === "categoria"
                ? "Herdado da categoria. Click pra sobrescrever."
                : "Sem decisão — defina ou atribua categoria."
          }
        >
          <span className="inline-block w-1.5 h-1.5 rounded-full" style={{
            background: efetivo === "sim" ? "#10b981" : efetivo === "nao" ? "#ef4444" : "#f59e0b",
          }} />
          {efetivo === "sim" ? "Sim" : efetivo === "nao" ? "Não" : "Indefinido"}
          {fonte === "categoria" && <span className="opacity-60 text-[9px] ml-0.5">(cat.)</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-1" align="start">
        <div className="text-[10px] text-muted-foreground px-2 pt-1.5 pb-1">
          Esta cobrança é comissionável?
        </div>
        <button
          type="button"
          onClick={() => {
            onChange(true);
            setAberto(false);
          }}
          className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-emerald-50 dark:hover:bg-emerald-950/40 flex items-center gap-2"
        >
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
          Sim, comissionável
          {comissionavelOverride === true && <span className="ml-auto text-[9px] text-muted-foreground">atual</span>}
        </button>
        <button
          type="button"
          onClick={() => {
            onChange(false);
            setAberto(false);
          }}
          className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-red-50 dark:hover:bg-red-950/40 flex items-center gap-2"
        >
          <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
          Não comissionável
          {comissionavelOverride === false && <span className="ml-auto text-[9px] text-muted-foreground">atual</span>}
        </button>
        <button
          type="button"
          onClick={() => {
            onChange(null);
            setAberto(false);
          }}
          className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-accent flex items-center gap-2"
        >
          <span className="inline-block w-2 h-2 rounded-full bg-muted-foreground/40" />
          Herdar da categoria
          {comissionavelOverride === null && <span className="ml-auto text-[9px] text-muted-foreground">atual</span>}
        </button>
      </PopoverContent>
    </Popover>
  );
}

// ─── Sub-tab: Atribuir ───────────────────────────────────────────────────────

function AtribuirSection() {
  const utils = trpc.useUtils();
  const { filtros, setFiltros, resetar } = useFiltrosAtribuir();
  const [selecionadas, setSelecionadas] = useState<Set<number>>(new Set());
  const [dialogAberto, setDialogAberto] = useState(false);

  const { data, isLoading } = trpc.financeiro.listarCobrancasParaAtribuicao.useQuery(
    filtrosParaInput(filtros),
  );

  // Mutation pra alterar override individual de uma cobrança — usa a
  // mesma `atribuirCobrancasEmMassa` mandando 1 ID. Otimização possível
  // futura: criar endpoint dedicado se virar gargalo, mas o existing
  // já é eficiente (single UPDATE).
  const overrideMut = trpc.financeiro.atribuirCobrancasEmMassa.useMutation({
    onSuccess: () => {
      utils.financeiro.listarCobrancasParaAtribuicao.invalidate();
    },
    onError: (err) => toast.error("Erro", { description: err.message }),
  });
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

  const linhas = data?.rows ?? [];
  const totalEncontrado = data?.totalEncontrado ?? 0;
  const truncado = totalEncontrado > linhas.length;
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
        <CardContent className="pt-5 space-y-3">
          <FiltrosAtribuir
            filtros={filtros}
            setFiltros={setFiltros}
            resetar={resetar}
            atendentes={atendentes}
            categorias={categoriasAtivas}
          />
          <div className="flex flex-wrap items-center gap-3 border-t pt-3">
            <div className="text-xs text-muted-foreground">
              {isLoading
                ? "Carregando…"
                : truncado
                ? `Mostrando ${linhas.length} de ${totalEncontrado}. Refine os filtros para ver os demais.`
                : `${totalEncontrado} cobrança(s)`}
            </div>
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
            {filtros.apenasSemAtribuicao
              ? "Nenhuma cobrança sem atribuição. Tudo organizado!"
              : "Nenhuma cobrança encontrada com os filtros atuais."}
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
                <TableHead className="text-xs">Comissão</TableHead>
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
                    <TableCell className="text-xs">
                      <CelulaComissao
                        cobrancaId={l.id}
                        comissionavelOverride={l.comissionavelOverride}
                        categoriaComissionavel={l.categoriaComissionavel}
                        onChange={(novo) =>
                          overrideMut.mutate({
                            cobrancaIds: [l.id],
                            comissionavelOverride: novo,
                          })
                        }
                        disabled={overrideMut.isPending}
                      />
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

// ─── Sub-tab: Agendamento (lançamento automático de comissões) ──────────────

/**
 * Configuração e histórico do lançamento automático de comissões.
 * O escritório define dia + hora local em que o cron deve fechar o
 * mês anterior calendário. Worker roda a cada 15 min e processa
 * todas as agendas ativas.
 */
function AgendamentoSection() {
  const utils = trpc.useUtils();
  const { data: config } = (trpc as any).comissoesAgenda.obter.useQuery(undefined, {
    retry: false,
  });
  const { data: log } = (trpc as any).comissoesAgenda.listarLog.useQuery(
    { limit: 20 },
    { retry: false },
  );

  const [ativo, setAtivo] = useState(true);
  const [diaDoMes, setDiaDoMes] = useState(1);
  const [horaLocal, setHoraLocal] = useState("18:00");
  const [carregouConfig, setCarregouConfig] = useState(false);

  // Hidrata estado a partir da config carregada (apenas 1x)
  if (config && !carregouConfig) {
    setAtivo(config.ativo);
    setDiaDoMes(config.diaDoMes);
    setHoraLocal(config.horaLocal);
    setCarregouConfig(true);
  }

  const salvar = (trpc as any).comissoesAgenda.salvar.useMutation({
    onSuccess: () => {
      toast.success("Agendamento salvo");
      utils.comissoesAgenda.obter.invalidate();
    },
    onError: (err: any) => toast.error("Erro", { description: err.message }),
  });

  function handleSalvar() {
    if (diaDoMes < 1 || diaDoMes > 31) {
      toast.error("Dia do mês deve ser entre 1 e 31");
      return;
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(horaLocal)) {
      toast.error("Hora deve estar no formato HH:MM (24h)");
      return;
    }
    salvar.mutate({ ativo, diaDoMes, horaLocal });
  }

  // Calcula próxima execução (UI puramente informativa)
  const proximaExecucao = (() => {
    if (!ativo) return null;
    const agora = new Date();
    const ano = agora.getFullYear();
    const mes = agora.getMonth();
    const [hh, mm] = horaLocal.split(":").map(Number);
    const tentativaEsteMes = new Date(ano, mes, diaDoMes, hh, mm);
    if (tentativaEsteMes > agora) return tentativaEsteMes;
    // Já passou — próxima é mês que vem
    return new Date(ano, mes + 1, diaDoMes, hh, mm);
  })();

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarClock className="h-4 w-4" />
            Lançamento automático
          </CardTitle>
          <CardDescription>
            O sistema fecha as comissões do <strong>mês anterior completo</strong> automaticamente
            no dia e hora configurados. Cobranças são identificadas pela data de pagamento (Asaas)
            — não há risco de duplicação.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded-md border bg-muted/30">
            <div>
              <Label className="text-sm font-medium cursor-pointer" htmlFor="ag-ativo">
                Ativar lançamento automático
              </Label>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Quando desligado, comissões só são fechadas manualmente.
              </p>
            </div>
            <input
              id="ag-ativo"
              type="checkbox"
              checked={ativo}
              onChange={(e) => setAtivo(e.target.checked)}
              className="h-5 w-9 accent-violet-600 cursor-pointer"
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Dia do mês</Label>
              <Input
                type="number"
                min={1}
                max={31}
                value={diaDoMes}
                onChange={(e) => setDiaDoMes(parseInt(e.target.value) || 1)}
                disabled={!ativo}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Se o mês não tem o dia (ex: 31 em fevereiro), roda no último dia.
              </p>
            </div>
            <div>
              <Label className="text-xs">Hora local</Label>
              <Input
                type="time"
                value={horaLocal}
                onChange={(e) => setHoraLocal(e.target.value)}
                disabled={!ativo}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                No fuso horário do escritório (configurável em Configurações).
              </p>
            </div>
          </div>

          {proximaExecucao && (
            <div className="rounded-md border border-violet-200 bg-violet-50 dark:bg-violet-950/30 dark:border-violet-900 p-3">
              <p className="text-xs text-violet-900 dark:text-violet-200">
                <strong>Próximo lançamento:</strong>{" "}
                {proximaExecucao.toLocaleDateString("pt-BR", {
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                })}{" "}
                às {horaLocal}
              </p>
              <p className="text-[10px] text-violet-700 dark:text-violet-400 mt-1">
                Vai fechar o mês anterior completo (1 ao último dia).
              </p>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <Button onClick={handleSalvar} disabled={salvar.isPending}>
              {salvar.isPending && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}
              Salvar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Histórico das execuções */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <History className="h-4 w-4" />
            Últimas execuções
          </CardTitle>
          <CardDescription>
            Histórico das 20 execuções mais recentes do cron — sucesso, falhas e quando rodou.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!log || log.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Nenhuma execução ainda. O cron começa quando você ativar e a hora configurada chegar.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Período</TableHead>
                  <TableHead className="text-xs">Atendente</TableHead>
                  <TableHead className="text-xs">Iniciado</TableHead>
                  <TableHead className="text-xs">Erro</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {log.map((row: any) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-xs">
                      {row.status === "concluido" && (
                        <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Concluído
                        </span>
                      )}
                      {row.status === "falhou" && (
                        <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-400">
                          <XCircle className="h-3.5 w-3.5" /> Falhou
                        </span>
                      )}
                      {row.status === "em_andamento" && (
                        <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Em andamento
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs font-mono">
                      {row.periodoInicio} a {row.periodoFim}
                    </TableCell>
                    <TableCell className="text-xs">#{row.atendenteId}</TableCell>
                    <TableCell className="text-xs">
                      {row.iniciadoEm
                        ? new Date(row.iniciadoEm).toLocaleString("pt-BR", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-red-600 max-w-[300px] truncate">
                      {row.mensagemErro || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * SmartFlow — página de listagem de cenários + execuções.
 * Criação/edição acontece na rota dedicada /smartflow/:id/editar
 * (editor visual ReactFlow).
 */

import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Activity, AlertTriangle, CheckCircle2, Clock,
  FileText, Filter, Loader2, Search, XCircle, Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import {
  TIPO_PASSO_META,
  GATILHO_META,
  TIPO_CANAL_META,
  type StatusExecucao,
} from "@shared/smartflow-types";
import { SmartFlowHero } from "./smartflow/smartflow-hero";
import {
  CenarioCard,
  categoriaDoGatilho,
  legendaCoresGatilho,
  type CenarioCardData,
} from "./smartflow/cenario-card";

function resumirGatilho(c: any): string | null {
  if (!c) return null;
  if (c.gatilho === "mensagem_canal") {
    let cfg: any = c.configGatilho;
    if (typeof cfg === "string") {
      try { cfg = JSON.parse(cfg); } catch { cfg = null; }
    }
    const canais = Array.isArray(cfg?.canais) ? (cfg.canais as string[]) : [];
    if (canais.length === 0) return "Qualquer canal";
    return canais
      .map((k) => TIPO_CANAL_META.find((m) => m.id === k)?.label || k)
      .join(", ");
  }
  if (c.gatilho === "pagamento_vencido") {
    let cfg: any = c.configGatilho;
    if (typeof cfg === "string") { try { cfg = JSON.parse(cfg); } catch { cfg = null; } }
    const d = Number(cfg?.diasAtraso ?? 0);
    return d > 0 ? `≥ ${d} dia(s) de atraso` : "Qualquer atraso";
  }
  if (c.gatilho === "pagamento_proximo_vencimento") {
    let cfg: any = c.configGatilho;
    if (typeof cfg === "string") { try { cfg = JSON.parse(cfg); } catch { cfg = null; } }
    const d = Number(cfg?.diasAntes ?? 3);
    return `${d} dia(s) antes`;
  }
  return null;
}

const STATUS_EXEC: Record<StatusExecucao, { label: string; cor: string; icon: LucideIcon }> = {
  rodando: { label: "Rodando", cor: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300", icon: Activity },
  concluido: { label: "Concluído", cor: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300", icon: CheckCircle2 },
  erro: { label: "Erro", cor: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300", icon: XCircle },
  cancelado: { label: "Cancelado", cor: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300", icon: AlertTriangle },
};

type FiltroCategoria = "todas" | "mensagem" | "asaas" | "calcom" | "crm" | "manual";

export default function SmartFlow() {
  const [tab, setTab] = useState("cenarios");
  const [detalheId, setDetalheId] = useState<number | null>(null);
  const [excluirCenario, setExcluirCenario] = useState<{ id: number; nome: string } | null>(null);
  const [busca, setBusca] = useState("");
  const [categoriaFilter, setCategoriaFilter] = useState<FiltroCategoria>("todas");
  const [statusFilter, setStatusFilter] = useState<"todos" | StatusExecucao>("todos");
  const [cenarioFilter, setCenarioFilter] = useState<number | "todos">("todos");

  const { data: cenarios, isLoading, refetch } = (trpc as any).smartflow.listar.useQuery();
  const { data: execucoes } = (trpc as any).smartflow.execucoes.useQuery(
    { limite: 200 },
    { refetchInterval: 10000 },
  );

  const criarTemplateMut = (trpc as any).smartflow.criarTemplateAtendimento.useMutation({
    onSuccess: () => { toast.success("Cenário de atendimento criado!"); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });
  const criarPgtoKanbanMut = (trpc as any).smartflow.criarTemplatePagamentoKanban.useMutation({
    onSuccess: () => { toast.success("Cenário Pagamento → Kanban criado!"); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });
  const toggleMut = (trpc as any).smartflow.toggleAtivo.useMutation({ onSuccess: () => refetch() });
  const deletarMut = (trpc as any).smartflow.deletar.useMutation({
    onSuccess: () => {
      toast.success("Cenário removido");
      setExcluirCenario(null);
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const executarMut = (trpc as any).smartflow.executar.useMutation({
    onSuccess: (r: any) => {
      if (r.success) toast.success("Execução disparada!");
      else toast.error(r.erro || "Falha na execução");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const lista = cenarios || [];
  const execs = execucoes || [];

  /**
   * Métricas agregadas por cenário (execuções e taxa de sucesso últimos 7 dias).
   * Computadas no client a partir da lista já buscada — economiza N queries.
   * Para escritórios com >200 execuções/dia o `execucoes` retorna no máx 200
   * itens, então a métrica vai subestimar; aceitável pra um dashboard de
   * "saúde rápida".
   */
  const metricasPorCenario = useMemo(() => {
    const seteDiasAtras = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const map = new Map<number, { execucoes7d: number; concluidos7d: number }>();
    for (const e of execs) {
      const ts = e.createdAt instanceof Date ? e.createdAt.getTime() : new Date(e.createdAt).getTime();
      if (!Number.isFinite(ts) || ts < seteDiasAtras) continue;
      const cur = map.get(e.cenarioId) ?? { execucoes7d: 0, concluidos7d: 0 };
      cur.execucoes7d++;
      if (e.status === "concluido") cur.concluidos7d++;
      map.set(e.cenarioId, cur);
    }
    return map;
  }, [execs]);

  const cenariosVisiveis: CenarioCardData[] = useMemo(() => {
    const buscaNorm = busca.trim().toLowerCase();
    return lista
      .filter((c: any) => {
        if (categoriaFilter !== "todas" && categoriaDoGatilho(c.gatilho) !== categoriaFilter) return false;
        if (buscaNorm) {
          const nome = (c.nome || "").toLowerCase();
          const desc = (c.descricao || "").toLowerCase();
          if (!nome.includes(buscaNorm) && !desc.includes(buscaNorm)) return false;
        }
        return true;
      })
      .map((c: any) => {
        const m = metricasPorCenario.get(c.id);
        const exec7d = m?.execucoes7d ?? 0;
        const taxaSucesso = exec7d > 0 ? Math.round(((m?.concluidos7d ?? 0) / exec7d) * 100) : 0;
        return {
          id: c.id,
          nome: c.nome,
          descricao: c.descricao,
          gatilho: c.gatilho,
          ativo: !!c.ativo,
          resumoGatilho: resumirGatilho(c),
          qtdPassos: Array.isArray(c.passos) ? c.passos.length : 0,
          execucoes7d: exec7d,
          taxaSucessoPct: taxaSucesso,
        };
      });
  }, [lista, busca, categoriaFilter, metricasPorCenario]);

  const execucoesVisiveis = useMemo(() => {
    return execs.filter((e: any) => {
      if (statusFilter !== "todos" && e.status !== statusFilter) return false;
      if (cenarioFilter !== "todos" && e.cenarioId !== cenarioFilter) return false;
      return true;
    });
  }, [execs, statusFilter, cenarioFilter]);

  const nomePorCenario = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of lista) m.set(c.id, c.nome);
    return m;
  }, [lista]);

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <SmartFlowHero
        onCriarAtendimento={() => criarTemplateMut.mutate()}
        onCriarPagamentoKanban={() => criarPgtoKanbanMut.mutate()}
        pendingAtendimento={criarTemplateMut.isPending}
        pendingPagamento={criarPgtoKanbanMut.isPending}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-2 h-9">
          <TabsTrigger value="cenarios" className="text-xs gap-1">
            <Zap className="h-3 w-3" /> Cenários
            {lista.length > 0 && (
              <span className="bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300 px-1.5 py-0.5 rounded text-[10px] ml-0.5">
                {lista.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="execucoes" className="text-xs gap-1">
            <Activity className="h-3 w-3" /> Execuções
            {execs.length > 0 && (
              <span className="text-muted-foreground text-[10px] ml-0.5">{execs.length}</span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ─── Aba Cenários ───────────────────────────────────────────── */}
        <TabsContent value="cenarios" className="mt-4 space-y-4">
          {!isLoading && lista.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[200px] max-w-xs">
                <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar cenário..."
                  className="h-9 pl-8 text-xs"
                />
              </div>
              <Select value={categoriaFilter} onValueChange={(v) => setCategoriaFilter(v as FiltroCategoria)}>
                <SelectTrigger className="h-9 w-44 text-xs">
                  <Filter className="h-3.5 w-3.5 mr-1.5" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas as categorias</SelectItem>
                  <SelectItem value="mensagem">💬 Mensagem</SelectItem>
                  <SelectItem value="asaas">💰 Asaas (financeiro)</SelectItem>
                  <SelectItem value="calcom">📅 Cal.com (agenda)</SelectItem>
                  <SelectItem value="crm">👥 CRM</SelectItem>
                  <SelectItem value="manual">▶ Manual</SelectItem>
                </SelectContent>
              </Select>
              {cenariosVisiveis.length !== lista.length && (
                <span className="text-[11px] text-muted-foreground">
                  {cenariosVisiveis.length} de {lista.length} cenários
                </span>
              )}
            </div>
          )}

          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              <Skeleton className="h-48" />
              <Skeleton className="h-48" />
              <Skeleton className="h-48" />
              <Skeleton className="h-48" />
            </div>
          ) : lista.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center py-16 text-center">
                <Zap className="h-12 w-12 text-muted-foreground/20 mb-4" />
                <h3 className="text-lg font-semibold">Nenhum cenário criado</h3>
                <p className="text-sm text-muted-foreground mt-1 max-w-md">
                  Use um template rápido no topo ou clique em <strong>Novo cenário</strong> para abrir o editor visual.
                </p>
              </CardContent>
            </Card>
          ) : cenariosVisiveis.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center py-12 text-center">
                <Search className="h-10 w-10 text-muted-foreground/20 mb-3" />
                <p className="text-sm font-medium">Nenhum cenário corresponde aos filtros</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Limpe a busca ou troque a categoria pra ver os cenários disponíveis.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  onClick={() => { setBusca(""); setCategoriaFilter("todas"); }}
                >
                  Limpar filtros
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {cenariosVisiveis.map((c) => (
                  <CenarioCard
                    key={c.id}
                    cenario={c}
                    onToggleAtivo={(id, ativo) => toggleMut.mutate({ id, ativo })}
                    onExcluir={(c) => setExcluirCenario({ id: c.id, nome: c.nome })}
                    onExecutar={(id) => executarMut.mutate({ cenarioId: id })}
                    onAbrirHistorico={(id) => {
                      setCenarioFilter(id);
                      setStatusFilter("todos");
                      setTab("execucoes");
                    }}
                    togglePending={toggleMut.isPending}
                    executarPending={executarMut.isPending}
                  />
                ))}
              </div>

              <LegendaCores />
            </>
          )}
        </TabsContent>

        {/* ─── Aba Execuções ──────────────────────────────────────────── */}
        <TabsContent value="execucoes" className="mt-4 space-y-3">
          {execs.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
                <SelectTrigger className="h-9 w-40 text-xs">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os status</SelectItem>
                  <SelectItem value="concluido">✓ Concluído</SelectItem>
                  <SelectItem value="rodando">⏵ Rodando</SelectItem>
                  <SelectItem value="erro">✗ Erro</SelectItem>
                  <SelectItem value="cancelado">⊘ Cancelado</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={String(cenarioFilter)}
                onValueChange={(v) => setCenarioFilter(v === "todos" ? "todos" : Number(v))}
              >
                <SelectTrigger className="h-9 w-56 text-xs">
                  <SelectValue placeholder="Cenário" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os cenários</SelectItem>
                  {lista.map((c: any) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(statusFilter !== "todos" || cenarioFilter !== "todos") && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-9 text-xs"
                  onClick={() => { setStatusFilter("todos"); setCenarioFilter("todos"); }}
                >
                  Limpar filtros
                </Button>
              )}
              {execucoesVisiveis.length !== execs.length && (
                <span className="text-[11px] text-muted-foreground ml-auto">
                  {execucoesVisiveis.length} de {execs.length}
                </span>
              )}
            </div>
          )}

          {execucoesVisiveis.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center py-12 text-center">
                <Activity className="h-10 w-10 text-muted-foreground/20 mb-3" />
                <p className="text-sm font-medium">
                  {execs.length === 0 ? "Nenhuma execução registrada" : "Nenhuma execução com esses filtros"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {execs.length === 0
                    ? "Quando um cenário for acionado, os logs aparecerão aqui."
                    : "Tente limpar os filtros pra ver mais resultados."}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {execucoesVisiveis.map((e: any) => {
                const st = STATUS_EXEC[e.status as StatusExecucao] || { label: e.status, cor: "bg-gray-100", icon: Clock };
                const StIcon = st.icon;
                const nomeCenario = nomePorCenario.get(e.cenarioId) || `Cenário #${e.cenarioId}`;
                return (
                  <Card
                    key={e.id}
                    className="hover:shadow-sm cursor-pointer"
                    onClick={() => setDetalheId(e.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(ev) => { if (ev.key === "Enter") setDetalheId(e.id); }}
                  >
                    <CardContent className="pt-3 pb-3">
                      <div className="flex items-center gap-3">
                        <StIcon className="h-4 w-4 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge className={`text-[9px] ${st.cor}`}>{st.label}</Badge>
                            <span className="text-xs font-medium truncate max-w-[280px]" title={nomeCenario}>
                              {nomeCenario}
                            </span>
                            <span className="text-xs text-muted-foreground">Passo {e.passoAtual}</span>
                            {e.retomarEm && (
                              <Badge variant="outline" className="text-[9px] gap-1 border-amber-500/30 text-amber-700">
                                <Clock className="h-2.5 w-2.5" /> Aguardando
                              </Badge>
                            )}
                          </div>
                          {e.erro && <p className="text-[10px] text-red-600 mt-0.5 line-clamp-1">{e.erro}</p>}
                        </div>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {new Date(e.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <ExecucaoDetalheDialog id={detalheId} onClose={() => setDetalheId(null)} />

      <AlertDialog
        open={excluirCenario !== null}
        onOpenChange={(open) => { if (!open) setExcluirCenario(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir cenário?</AlertDialogTitle>
            <AlertDialogDescription>
              O cenário <strong>{excluirCenario?.nome}</strong> será removido
              permanentemente. Execuções já registradas serão preservadas no
              histórico, mas o cenário não rodará mais. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletarMut.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={deletarMut.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (excluirCenario) deletarMut.mutate({ id: excluirCenario.id });
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletarMut.isPending ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />Excluindo...</>
              ) : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function LegendaCores() {
  return (
    <Card>
      <CardContent className="pt-3 pb-3">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
          Legenda das cores
        </p>
        <div className="flex flex-wrap gap-3 text-xs">
          {legendaCoresGatilho().map((l) => (
            <div key={l.label} className="flex items-center gap-1.5">
              <div className={`w-3 h-3 rounded ${l.cor}`}></div>
              <span className="text-muted-foreground">{l.label}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Drill-down de execução ───────────────────────────────────────────────

function ExecucaoDetalheDialog({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { data, isLoading } = (trpc as any).smartflow.execucaoDetalhe.useQuery(
    { id },
    { enabled: id != null },
  );

  if (id == null) return null;

  const ctx = data?.contexto || {};
  const status = (data?.status || "rodando") as StatusExecucao;
  const st = STATUS_EXEC[status] || { label: status, cor: "bg-gray-100", icon: Clock };

  return (
    <Dialog open={id != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-muted-foreground" />
            Execução #{id}
          </DialogTitle>
          <DialogDescription>
            Detalhes do contexto acumulado e das respostas geradas pelo fluxo.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : !data ? (
          <p className="text-sm text-muted-foreground py-4">Execução não encontrada.</p>
        ) : (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <InfoRow label="Cenário">{data.cenario?.nome || `#${data.cenarioId}`}</InfoRow>
              <InfoRow label="Gatilho">{data.cenario?.gatilho || "—"}</InfoRow>
              <InfoRow label="Status">
                <Badge className={`text-[10px] ${st.cor}`}>{st.label}</Badge>
              </InfoRow>
              <InfoRow label="Passos executados">{data.passoAtual ?? 0}</InfoRow>
              <InfoRow label="Criada em">
                {data.createdAt ? new Date(data.createdAt).toLocaleString("pt-BR") : "—"}
              </InfoRow>
              {data.retomarEm && (
                <InfoRow label="Retoma em">{new Date(data.retomarEm).toLocaleString("pt-BR")}</InfoRow>
              )}
            </div>

            {data.erro && (
              <div className="rounded-md border border-red-500/30 bg-red-50 dark:bg-red-900/20 p-3">
                <p className="text-xs font-semibold text-red-700 dark:text-red-300 mb-1">Erro</p>
                <p className="text-xs text-red-700 dark:text-red-300">{data.erro}</p>
              </div>
            )}

            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Contexto
              </p>
              <pre className="text-[11px] bg-muted/40 rounded-md p-3 overflow-x-auto max-h-64">
                {JSON.stringify(ctx, null, 2)}
              </pre>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">{label}</p>
      <div className="text-sm">{children}</div>
    </div>
  );
}

// Re-exporta constantes para compat com testes antigos (se houver).
export { TIPO_PASSO_META, GATILHO_META };

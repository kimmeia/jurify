/**
 * Roadmap público — clientes mandam ideias de melhoria e votam.
 *
 * Etapa 3/4 do checklist pré-lançamento. Auth: qualquer user logado.
 * Admin (role=admin) ganha um Select pra trocar status do item.
 */

import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  Card, CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Lightbulb, ThumbsUp, Plus, Search, ChevronLeft, ChevronRight, Loader2,
  List, LayoutGrid, X, Hammer, CalendarClock, CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { RoadmapKanban } from "./RoadmapKanban";

type Tone = "info" | "warning" | "success" | "neutral" | "accent" | "danger";

const CATEGORIA_META: Record<string, { label: string; tone: Tone }> = {
  feature: { label: "Funcionalidade", tone: "accent" },
  bug: { label: "Bug", tone: "danger" },
  melhoria: { label: "Melhoria", tone: "info" },
};

const STATUS_META: Record<string, { label: string; tone: Tone }> = {
  aguardando_aprovacao: { label: "Aguardando aprovação", tone: "warning" },
  novo: { label: "Novo", tone: "neutral" },
  em_analise: { label: "Em análise", tone: "warning" },
  planejado: { label: "Planejado", tone: "info" },
  em_desenvolvimento: { label: "Em desenvolvimento", tone: "accent" },
  lancado: { label: "Lançado", tone: "success" },
  recusado: { label: "Recusado", tone: "neutral" },
};

const TONE_BADGE: Record<Tone, string> = {
  info: "bg-info-bg text-info-fg",
  warning: "bg-warning-bg text-warning-fg",
  success: "bg-success-bg text-success-fg",
  neutral: "bg-neutral-bg text-neutral-fg",
  accent: "bg-accent-purple-bg text-accent-purple-fg",
  danger: "bg-danger-bg text-danger-fg",
};

const STATUS_VALORES = [
  "aguardando_aprovacao",
  "novo",
  "em_analise",
  "planejado",
  "em_desenvolvimento",
  "lancado",
  "recusado",
] as const;

const DESCRICAO_MAX = 2000;
const DESCRICAO_MIN = 10;
const PAGINA_SIZE = 20;

export default function Roadmap() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [view, setView] = useState<"kanban" | "lista">("kanban");
  const [status, setStatus] = useState<"todos" | typeof STATUS_VALORES[number]>("todos");
  const [categoria, setCategoria] = useState<"todos" | "feature" | "bug" | "melhoria">("todos");
  const [ordenacao, setOrdenacao] = useState<"votos" | "recente">("votos");
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1);
  const [novoOpen, setNovoOpen] = useState(false);
  const [novoTitulo, setNovoTitulo] = useState("");
  const [novaDescricao, setNovaDescricao] = useState("");
  const [novaCategoria, setNovaCategoria] = useState<"feature" | "bug" | "melhoria">("melhoria");
  const [votandoId, setVotandoId] = useState<number | null>(null);
  const [atualizandoId, setAtualizandoId] = useState<number | null>(null);

  // Kanban precisa de mais itens em uma página (50 = max do backend) e
  // status=todos pra agrupar nas colunas. Lista usa paginação normal.
  const queryParams = view === "kanban"
    ? { status: "todos", categoria: "todos", ordenacao: "recente", limite: 50, pagina: 1 }
    : { status, categoria, ordenacao, busca: busca || undefined, limite: PAGINA_SIZE, pagina };

  const { data, isLoading, refetch } = (trpc as any).roadmap.listar.useQuery(queryParams);

  const criarMut = (trpc as any).roadmap.criar.useMutation({
    onSuccess: () => {
      toast.success("Sugestão enviada! Aguarde aprovação do administrador.");
      setNovoOpen(false);
      setNovoTitulo("");
      setNovaDescricao("");
      setNovaCategoria("melhoria");
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const votarMut = (trpc as any).roadmap.votar.useMutation({
    onMutate: ({ itemId }: { itemId: number }) => setVotandoId(itemId),
    onSettled: () => setVotandoId(null),
    onSuccess: () => refetch(),
    onError: (e: any) => toast.error(e.message),
  });

  const atualizarStatusMut = (trpc as any).roadmap.atualizarStatus.useMutation({
    onMutate: ({ id }: { id: number }) => setAtualizandoId(id),
    onSettled: () => setAtualizandoId(null),
    onSuccess: () => { toast.success("Status atualizado"); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });

  const itens = data?.itens ?? [];
  const totalPaginas = data?.totalPaginas ?? 1;
  const totalItens = data?.totalItens ?? itens.length;

  // KPIs do header — calculados no kanban (que tem 50 itens) ou na lista.
  // Pode ficar levemente subestimado se houver >50 ideias no kanban, mas
  // pra escritórios reais isso não é problema antes de muitos meses.
  const kpis = useMemo(() => {
    const trintaDiasAtras = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return {
      emDev: itens.filter((i: any) => i.status === "em_desenvolvimento").length,
      planejados: itens.filter((i: any) => i.status === "planejado").length,
      lancados30d: itens.filter(
        (i: any) =>
          i.status === "lancado" && new Date(i.createdAt).getTime() >= trintaDiasAtras,
      ).length,
    };
  }, [itens]);

  const filtrosAtivos: Array<{ label: string; clear: () => void }> = [];
  if (view === "lista") {
    if (status !== "todos") {
      filtrosAtivos.push({
        label: STATUS_META[status]?.label ?? status,
        clear: () => { setStatus("todos"); setPagina(1); },
      });
    }
    if (categoria !== "todos") {
      filtrosAtivos.push({
        label: CATEGORIA_META[categoria]?.label ?? categoria,
        clear: () => { setCategoria("todos"); setPagina(1); },
      });
    }
    if (busca) {
      filtrosAtivos.push({
        label: `"${busca}"`,
        clear: () => { setBusca(""); setPagina(1); },
      });
    }
  }

  const inicioRange = totalItens === 0 ? 0 : (pagina - 1) * PAGINA_SIZE + 1;
  const fimRange = Math.min(pagina * PAGINA_SIZE, totalItens);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Lightbulb className="h-6 w-6 text-warning" />
            Roadmap
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl">
            Sugira melhorias e vote nas ideias de outros usuários. Os itens mais
            votados sobem na fila.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Toggle Lista / Kanban */}
          <div className="inline-flex rounded-lg border bg-background p-0.5">
            <button
              onClick={() => setView("kanban")}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                view === "kanban" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
              title="Visualização Kanban"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Kanban
            </button>
            <button
              onClick={() => setView("lista")}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                view === "lista" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
              title="Visualização em Lista"
            >
              <List className="h-3.5 w-3.5" />
              Lista
            </button>
          </div>
          <Button onClick={() => setNovoOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Sugerir melhoria
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiCard
          icon={<Hammer className="h-4 w-4" />}
          label="Em desenvolvimento"
          value={kpis.emDev}
          tone="accent"
        />
        <KpiCard
          icon={<CalendarClock className="h-4 w-4" />}
          label="Planejados"
          value={kpis.planejados}
          tone="info"
        />
        <KpiCard
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Lançados (30 dias)"
          value={kpis.lancados30d}
          tone="success"
        />
      </div>

      {/* Filtros — só na view de lista (kanban já agrupa por status) */}
      {view === "lista" && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2 items-center">
            <Select value={status} onValueChange={(v) => { setStatus(v as any); setPagina(1); }}>
              <SelectTrigger className="w-[180px] h-9"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os status</SelectItem>
                {STATUS_VALORES.map((s) => (
                  <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={categoria} onValueChange={(v) => { setCategoria(v as any); setPagina(1); }}>
              <SelectTrigger className="w-[180px] h-9"><SelectValue placeholder="Categoria" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todas as categorias</SelectItem>
                <SelectItem value="feature">Funcionalidade</SelectItem>
                <SelectItem value="melhoria">Melhoria</SelectItem>
                <SelectItem value="bug">Bug</SelectItem>
              </SelectContent>
            </Select>
            <Select value={ordenacao} onValueChange={(v) => { setOrdenacao(v as any); setPagina(1); }}>
              <SelectTrigger className="w-[160px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="votos">Mais votados</SelectItem>
                <SelectItem value="recente">Mais recentes</SelectItem>
              </SelectContent>
            </Select>
            <div className="relative flex-1 min-w-[200px]">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar..."
                value={busca}
                onChange={(e) => { setBusca(e.target.value); setPagina(1); }}
                className="pl-9 h-9"
              />
            </div>
          </div>

          {/* Chips de filtros ativos */}
          {filtrosAtivos.length > 0 && (
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-[11px] text-muted-foreground">Filtros:</span>
              {filtrosAtivos.map((f, idx) => (
                <button
                  key={idx}
                  onClick={f.clear}
                  className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-muted hover:bg-muted/70 text-[11px] transition-colors"
                  title="Remover filtro"
                >
                  {f.label}
                  <X className="h-3 w-3" />
                </button>
              ))}
              <button
                onClick={() => {
                  setStatus("todos");
                  setCategoria("todos");
                  setBusca("");
                  setPagina(1);
                }}
                className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline ml-1"
              >
                limpar todos
              </button>
            </div>
          )}
        </div>
      )}

      {/* Kanban view */}
      {view === "kanban" && (
        isLoading ? (
          <div className="flex gap-3 overflow-x-auto">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="flex-shrink-0 w-72 h-96" />)}
          </div>
        ) : (
          <RoadmapKanban
            itens={itens as any}
            isAdmin={isAdmin}
            userId={user?.id ?? 0}
            onAtualizarStatus={(id, novoStatus) => atualizarStatusMut.mutate({ id, status: novoStatus })}
            onVotar={(id) => votarMut.mutate({ itemId: id })}
            votandoId={votandoId}
            atualizandoId={atualizandoId}
          />
        )
      )}

      {/* Lista view */}
      {view === "lista" && (
      <>
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : itens.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Lightbulb className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground mb-4">
              {busca || status !== "todos" || categoria !== "todos"
                ? "Nada encontrado nos filtros atuais."
                : "Nenhuma sugestão ainda. Seja o primeiro!"}
            </p>
            <Button onClick={() => setNovoOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Sugerir melhoria
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {itens.map((item: any) => {
            const catMeta = CATEGORIA_META[item.categoria];
            const stMeta = STATUS_META[item.status];
            return (
              <Card key={item.id} className="hover:shadow-sm hover:border-foreground/20 transition-all">
                <CardContent className="py-3">
                  <div className="flex gap-3">
                    {/* Conteúdo */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {catMeta && (
                          <Badge className={`text-[10px] h-5 border-0 ${TONE_BADGE[catMeta.tone]}`}>
                            {catMeta.label}
                          </Badge>
                        )}
                        {stMeta && (
                          <Badge className={`text-[10px] h-5 border-0 ${TONE_BADGE[stMeta.tone]}`}>
                            {stMeta.label}
                          </Badge>
                        )}
                      </div>
                      <p className="font-semibold text-sm mt-1.5 leading-tight">{item.titulo}</p>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2 whitespace-pre-wrap leading-snug">
                        {item.descricao}
                      </p>
                      <div className="flex items-center gap-2 mt-2 text-[11px] text-muted-foreground">
                        <span>por <b className="font-medium text-foreground">{item.autorNome}</b></span>
                        <span>•</span>
                        <span>{formatDistanceToNow(new Date(item.createdAt), { addSuffix: true, locale: ptBR })}</span>
                      </div>

                      {/* Admin: trocar status */}
                      {isAdmin && (
                        <div className="mt-2">
                          <Select
                            value={item.status}
                            onValueChange={(v) => atualizarStatusMut.mutate({ id: item.id, status: v })}
                          >
                            <SelectTrigger className="h-7 w-[200px] text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {STATUS_VALORES.map((s) => (
                                <SelectItem key={s} value={s} className="text-xs">
                                  {STATUS_META[s].label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>

                    {/* Botão votar (vertical) */}
                    <button
                      onClick={() => votarMut.mutate({ itemId: item.id })}
                      disabled={votarMut.isPending}
                      className={`flex flex-col items-center justify-center gap-0.5 px-3 rounded-lg border self-start transition-all min-w-[52px] h-14 ${
                        item.jaVotou
                          ? "bg-warning-bg border-warning text-warning-fg"
                          : "hover:bg-muted/50 border-border text-muted-foreground hover:text-foreground"
                      }`}
                      title={item.jaVotou ? "Cancelar voto" : "Votar"}
                    >
                      <ThumbsUp className="h-3.5 w-3.5" />
                      <span className="text-sm font-bold leading-none">{item.contagemVotos}</span>
                    </button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Paginação */}
      {totalPaginas > 1 && (
        <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
          <span className="text-[11px] text-muted-foreground">
            {inicioRange}–{fimRange} de {totalItens}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
              disabled={pagina === 1}
            >
              <ChevronLeft className="h-4 w-4 mr-1" /> Anterior
            </Button>
            <span className="text-xs text-muted-foreground">
              Página {pagina} de {totalPaginas}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPagina((p) => p + 1)}
              disabled={pagina >= totalPaginas}
            >
              Próxima <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
      </>
      )}

      {/* Dialog nova sugestão */}
      <Dialog open={novoOpen} onOpenChange={setNovoOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Sugerir melhoria</DialogTitle>
            <DialogDescription>
              Descreva uma ideia de funcionalidade, melhoria ou bug. Outros usuários
              podem votar — as ideias mais votadas viram prioridade.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs">Categoria</Label>
              <Select value={novaCategoria} onValueChange={(v) => setNovaCategoria(v as any)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="feature">Funcionalidade nova</SelectItem>
                  <SelectItem value="melhoria">Melhoria de algo existente</SelectItem>
                  <SelectItem value="bug">Algo que está quebrado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Título *</Label>
              <Input
                value={novoTitulo}
                onChange={(e) => setNovoTitulo(e.target.value)}
                placeholder="Ex: Permitir importar contatos por planilha"
                maxLength={255}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Descrição *</Label>
              <Textarea
                value={novaDescricao}
                onChange={(e) => setNovaDescricao(e.target.value)}
                placeholder="O quê? Por quê? Cenário concreto?"
                rows={4}
                maxLength={DESCRICAO_MAX}
                className="mt-1"
              />
              <div className="mt-1.5 flex items-center gap-2">
                <Progress
                  value={Math.min(100, (novaDescricao.length / DESCRICAO_MAX) * 100)}
                  className="flex-1 h-1"
                />
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {novaDescricao.length}/{DESCRICAO_MAX}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                Mínimo {DESCRICAO_MIN} caracteres. Markdown básico funciona:
                <code className="mx-1 px-1 rounded bg-muted">**negrito**</code>
                <code className="mx-1 px-1 rounded bg-muted">*itálico*</code>
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNovoOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => criarMut.mutate({ titulo: novoTitulo, descricao: novaDescricao, categoria: novaCategoria })}
              disabled={
                criarMut.isPending ||
                novoTitulo.trim().length < 3 ||
                novaDescricao.trim().length < DESCRICAO_MIN
              }
            >
              {criarMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── KPI Card ──────────────────────────────────────────────────────────────

const KPI_TONE: Record<Tone, string> = {
  info: "bg-info-bg text-info-fg",
  warning: "bg-warning-bg text-warning-fg",
  success: "bg-success-bg text-success-fg",
  neutral: "bg-neutral-bg text-neutral-fg",
  accent: "bg-accent-purple-bg text-accent-purple-fg",
  danger: "bg-danger-bg text-danger-fg",
};

function KpiCard({
  icon, label, value, tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: Tone;
}) {
  return (
    <Card>
      <CardContent className="py-3 flex items-center gap-3">
        <div className={`flex items-center justify-center h-9 w-9 rounded-lg ${KPI_TONE[tone]}`}>
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-[11px] text-muted-foreground leading-none">{label}</p>
          <p className="text-2xl font-bold leading-tight tabular-nums mt-0.5">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

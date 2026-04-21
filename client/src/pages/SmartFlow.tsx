/**
 * SmartFlow — página de listagem de cenários + execuções.
 * A criação/edição acontece na rota dedicada /smartflow/:id/editar,
 * com um editor visual (canvas ReactFlow).
 */

import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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
  Zap, Plus, Trash2, Loader2, MessageCircle, Calendar,
  Play, Clock,
  Users, CheckCircle2, Activity, AlertTriangle, XCircle,
  DollarSign, Pencil, FileText,
  CalendarCheck, CalendarX, CalendarClock,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import {
  TIPO_PASSO_META,
  GATILHO_META,
  TIPO_CANAL_META,
  getGatilhoMeta,
  type GatilhoSmartflow,
  type StatusExecucao,
} from "@shared/smartflow-types";

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

// Ícone por gatilho (local ao frontend).
const GATILHO_ICON: Record<GatilhoSmartflow, LucideIcon> = {
  whatsapp_mensagem: MessageCircle,
  mensagem_canal: MessageCircle,
  pagamento_recebido: DollarSign,
  pagamento_vencido: AlertTriangle,
  pagamento_proximo_vencimento: Clock,
  novo_lead: Users,
  agendamento_criado: CalendarCheck,
  agendamento_cancelado: CalendarX,
  agendamento_remarcado: CalendarClock,
  agendamento_lembrete: Clock,
  manual: Play,
};

const STATUS_EXEC: Record<StatusExecucao, { label: string; cor: string; icon: LucideIcon }> = {
  rodando: { label: "Rodando", cor: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300", icon: Activity },
  concluido: { label: "Concluído", cor: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300", icon: CheckCircle2 },
  erro: { label: "Erro", cor: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300", icon: XCircle },
  cancelado: { label: "Cancelado", cor: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300", icon: AlertTriangle },
};

export default function SmartFlow() {
  const [tab, setTab] = useState("cenarios");
  const [detalheId, setDetalheId] = useState<number | null>(null);

  const { data: cenarios, isLoading, refetch } = (trpc as any).smartflow.listar.useQuery();
  const { data: execucoes } = (trpc as any).smartflow.execucoes.useQuery(
    { limite: 50 },
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
    onSuccess: () => { toast.success("Cenário removido"); refetch(); },
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

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="p-2.5 rounded-xl bg-gradient-to-br from-amber-100 to-orange-100 dark:from-amber-900/40 dark:to-orange-900/40">
          <Zap className="h-6 w-6 text-amber-600" />
        </div>
        <div className="flex-1 min-w-[200px]">
          <h1 className="text-2xl font-bold tracking-tight">SmartFlow</h1>
          <p className="text-sm text-muted-foreground">Automações inteligentes — WhatsApp + IA + Cal.com</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => criarTemplateMut.mutate()} disabled={criarTemplateMut.isPending}>
          {criarTemplateMut.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Zap className="h-3.5 w-3.5 mr-1" />}
          Atendimento
        </Button>
        <Button size="sm" variant="outline" onClick={() => criarPgtoKanbanMut.mutate()} disabled={criarPgtoKanbanMut.isPending}>
          {criarPgtoKanbanMut.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <DollarSign className="h-3.5 w-3.5 mr-1" />}
          Pagamento → Kanban
        </Button>
        <Button size="sm" asChild>
          <Link href="/smartflow/novo">
            <Plus className="h-3.5 w-3.5 mr-1" /> Novo cenário
          </Link>
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-2 h-9">
          <TabsTrigger value="cenarios" className="text-xs gap-1"><Zap className="h-3 w-3" /> Cenários</TabsTrigger>
          <TabsTrigger value="execucoes" className="text-xs gap-1"><Activity className="h-3 w-3" /> Execuções</TabsTrigger>
        </TabsList>

        <TabsContent value="cenarios" className="mt-4">
          {isLoading ? (
            <div className="space-y-3"><Skeleton className="h-32" /><Skeleton className="h-32" /></div>
          ) : lista.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center py-16 text-center">
                <Zap className="h-12 w-12 text-muted-foreground/20 mb-4" />
                <h3 className="text-lg font-semibold">Nenhum cenário criado</h3>
                <p className="text-sm text-muted-foreground mt-1 max-w-md">
                  Use um template rápido acima ou clique em <strong>Novo cenário</strong> para abrir o editor visual.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {lista.map((c: any) => {
                const gatilho = getGatilhoMeta(c.gatilho);
                const GIcon = GATILHO_ICON[c.gatilho as GatilhoSmartflow] ?? Play;
                const resumoGat = resumirGatilho(c);
                return (
                  <Card key={c.id} className="hover:shadow-sm transition-all flex flex-col">
                    <CardContent className="pt-4 pb-4 flex flex-col gap-3 h-full">
                      {/* Header: ícone + ações (editar, toggle ativo, excluir) */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-violet-500/10 to-indigo-500/10 flex items-center justify-center shrink-0">
                          <Zap className="h-4 w-4 text-violet-600" />
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Editar" asChild>
                            <Link href={`/smartflow/${c.id}/editar`}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Link>
                          </Button>
                          <Switch
                            checked={c.ativo}
                            onCheckedChange={(v: boolean) => toggleMut.mutate({ id: c.id, ativo: v })}
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive"
                            onClick={() => { if (confirm("Excluir este cenário?")) deletarMut.mutate({ id: c.id }); }}
                            title="Excluir"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>

                      {/* Nome + descrição */}
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate" title={c.nome}>{c.nome}</p>
                        {c.descricao && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{c.descricao}</p>
                        )}
                      </div>

                      {/* Badges (gatilho + config + ativo) — alinhadas no rodapé via mt-auto */}
                      <div className="flex items-center gap-1.5 flex-wrap mt-auto">
                        <Badge variant="outline" className="text-[9px] gap-1">
                          <GIcon className="h-2.5 w-2.5" />{gatilho.label}
                        </Badge>
                        {resumoGat && (
                          <Badge variant="secondary" className="text-[9px]">{resumoGat}</Badge>
                        )}
                        {c.ativo
                          ? <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30 text-[9px]">Ativo</Badge>
                          : <Badge variant="outline" className="text-[9px] text-muted-foreground">Inativo</Badge>}
                      </div>

                      {/* Botão "Executar agora" só pra gatilho manual */}
                      {c.gatilho === "manual" && c.ativo && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 text-xs w-full"
                          onClick={() => executarMut.mutate({ cenarioId: c.id })}
                          disabled={executarMut.isPending}
                          title="Executar este cenário agora"
                        >
                          {executarMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                          Executar agora
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="execucoes" className="mt-4">
          {execs.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center py-12 text-center">
                <Activity className="h-10 w-10 text-muted-foreground/20 mb-3" />
                <p className="text-sm font-medium">Nenhuma execução registrada</p>
                <p className="text-xs text-muted-foreground mt-1">Quando um cenário for acionado, os logs aparecerão aqui.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {execs.map((e: any) => {
                const st = STATUS_EXEC[e.status as StatusExecucao] || { label: e.status, cor: "bg-gray-100", icon: Clock };
                const StIcon = st.icon;
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
                            <span className="text-xs text-muted-foreground">Cenário #{e.cenarioId}</span>
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
    </div>
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

import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Calculator, TrendingUp, Clock, Zap, ArrowRight, DollarSign, Users,
  MessageCircle, CheckSquare, Wallet, Scale, Bell, Gavel, Sun,
  AlertTriangle, Activity, Sparkles, ArrowUpRight, CalendarDays,
  Landmark, Briefcase, ShieldCheck, Headphones, Settings,
} from "lucide-react";
import { useLocation } from "wouter";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBRL(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}
function formatBRLShort(v: number) {
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `R$ ${(v / 1_000).toFixed(1)}k`;
  return formatBRL(v);
}
function formatDateShort(d: Date | string) {
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}
function formatRelative(ts: string) {
  const diff = Date.now() - new Date(ts).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "agora";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(ts).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

const ACTIVITY_ICONS: Record<string, { icon: any; color: string; bg: string }> = {
  pagamento: { icon: DollarSign, color: "text-emerald-600", bg: "bg-emerald-50" },
  mensagem: { icon: MessageCircle, color: "text-blue-600", bg: "bg-blue-50" },
  movimentacao: { icon: Gavel, color: "text-indigo-600", bg: "bg-indigo-50" },
  tarefa: { icon: CheckSquare, color: "text-violet-600", bg: "bg-violet-50" },
  agendamento: { icon: CalendarDays, color: "text-amber-600", bg: "bg-amber-50" },
  lead: { icon: TrendingUp, color: "text-rose-600", bg: "bg-rose-50" },
};

// ─── Componente principal ────────────────────────────────────────────────────

export default function Dashboard() {
  const { user } = useAuth();
  const [, nav] = useLocation();
  const [periodo, setPeriodo] = useState<7 | 30 | 90>(30);

  const { data: subscription } = trpc.subscription.current.useQuery(undefined, { enabled: !!user, retry: false });
  const { data: credits } = trpc.dashboard.credits.useQuery(undefined, { enabled: !!user, retry: false });
  const { data: r } = trpc.dashboard.resumoEscritorio.useQuery(undefined, {
    enabled: !!user,
    retry: false,
    refetchInterval: 60_000,
  });
  const { data: cashFlow } = trpc.dashboard.cashFlow.useQuery(
    { days: periodo },
    { enabled: !!user, retry: false, refetchInterval: 120_000 },
  );
  const { data: feed } = trpc.dashboard.activityFeed.useQuery(
    { limit: 15 },
    { enabled: !!user, retry: false, refetchInterval: 30_000 },
  );

  const creditsUsed = credits?.creditsUsed ?? 0;
  const creditsTotal = credits?.creditsTotal ?? 50;
  const creditsRemaining = credits?.creditsRemaining ?? creditsTotal;
  const isUnlimited = creditsTotal >= 999_999;
  const ok = !!r;

  const totalHoje = ok ? r.agenda.compromissosHoje.length + r.agenda.tarefasHoje.length : 0;
  const saldoMes = cashFlow ? cashFlow.totalRecebido - cashFlow.totalVencido : 0;

  return (
    <div className="space-y-6">
      {/* ───────────────── Header ───────────────── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Olá, {user?.name?.split(" ")[0] || "Usuário"}
          </h1>
          <p className="text-muted-foreground mt-1 flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            Atualizado agora
          </p>
        </div>
        <div className="flex items-center gap-2">
          {ok && r.notificacoesNaoLidas > 0 && (
            <Badge
              variant="destructive"
              className="text-xs gap-1 cursor-pointer"
              onClick={() => nav("/atendimento")}
            >
              <Bell className="h-3 w-3" />
              {r.notificacoesNaoLidas}
            </Badge>
          )}
          {subscription && (
            <Badge
              variant={subscription.status === "active" ? "default" : "secondary"}
              className="text-xs"
            >
              {subscription.status === "active" ? "Plano Ativo" : subscription.status}
            </Badge>
          )}
        </div>
      </div>

      {/* ───────────────── Alertas urgentes ───────────────── */}
      {ok &&
        (r.agenda.atrasados > 0 ||
          r.crm.conversasAguardando > 0 ||
          r.financeiro.vencido > 0 ||
          r.processos.movimentacoesNaoLidas > 0) && (
          <div className="flex flex-wrap gap-2">
            {r.processos.movimentacoesNaoLidas > 0 && (
              <AlertChip
                icon={Gavel}
                color="blue"
                label={`${r.processos.movimentacoesNaoLidas} movimentação(ões) nova(s)`}
                onClick={() => nav("/processos")}
              />
            )}
            {r.agenda.atrasados > 0 && (
              <AlertChip
                icon={AlertTriangle}
                color="red"
                label={`${r.agenda.atrasados} atrasado(s)`}
                onClick={() => nav("/agenda")}
              />
            )}
            {r.crm.conversasAguardando > 0 && (
              <AlertChip
                icon={MessageCircle}
                color="amber"
                label={`${r.crm.conversasAguardando} conversa(s) aguardando`}
                onClick={() => nav("/atendimento")}
              />
            )}
            {r.financeiro.vencido > 0 && (
              <AlertChip
                icon={DollarSign}
                color="red"
                label={`${formatBRL(r.financeiro.vencido)} vencido`}
                onClick={() => nav("/financeiro")}
              />
            )}
          </div>
        )}

      {/* ───────────────── Hero: Receita + Gráfico + Período ───────────────── */}
      <Card className="overflow-hidden">
        <CardContent className="pt-6">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-6">
            <div>
              <p className="text-sm text-muted-foreground font-medium">
                Receita do período
              </p>
              <div className="flex items-baseline gap-3 mt-1">
                <h2 className="text-4xl font-bold tracking-tight">
                  {formatBRL(cashFlow?.totalRecebido ?? 0)}
                </h2>
                {saldoMes >= 0 ? (
                  <span className="flex items-center gap-1 text-sm text-emerald-600 font-medium">
                    <ArrowUpRight className="h-4 w-4" />
                    {formatBRLShort(cashFlow?.totalPendente ?? 0)} pendente
                  </span>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {cashFlow?.totalVencido
                  ? `${formatBRL(cashFlow.totalVencido)} vencido · `
                  : ""}
                Últimos {periodo} dias
              </p>
            </div>
            <Tabs
              value={String(periodo)}
              onValueChange={(v) => setPeriodo(Number(v) as 7 | 30 | 90)}
            >
              <TabsList className="h-8">
                <TabsTrigger value="7" className="text-xs px-3">7d</TabsTrigger>
                <TabsTrigger value="30" className="text-xs px-3">30d</TabsTrigger>
                <TabsTrigger value="90" className="text-xs px-3">90d</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Gráfico de área */}
          <div className="h-40 -mx-2">
            {cashFlow && cashFlow.pontos.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={cashFlow.pontos} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorRecebido" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorPendente" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                  <XAxis
                    dataKey="data"
                    tick={{ fontSize: 10, fill: "#9ca3af" }}
                    tickFormatter={(d) => formatDateShort(d)}
                    stroke="#e5e7eb"
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "#9ca3af" }}
                    tickFormatter={(v) => formatBRLShort(v)}
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
                    labelFormatter={(d) => formatDateShort(d)}
                    formatter={(v: number) => formatBRL(v)}
                  />
                  <Area
                    type="monotone"
                    dataKey="recebido"
                    stroke="#10b981"
                    strokeWidth={2}
                    fill="url(#colorRecebido)"
                    name="Recebido"
                  />
                  <Area
                    type="monotone"
                    dataKey="pendente"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    fill="url(#colorPendente)"
                    name="Pendente"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                Sem dados financeiros no período.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ───────────────── Sub-métricas organizadas por contexto ───────────────── */}
      {ok && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Hoje precisa atenção */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Sun className="h-4 w-4 text-amber-500" />
                Hoje precisa atenção
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-3">
                <SubMetric
                  value={totalHoje}
                  label="Compromissos"
                  color="text-amber-600"
                  onClick={() => nav("/agenda")}
                />
                <SubMetric
                  value={r.crm.conversasAguardando}
                  label="Aguardando"
                  color="text-blue-600"
                  onClick={() => nav("/atendimento")}
                />
                <SubMetric
                  value={r.processos.movimentacoesNaoLidas}
                  label="Mov. novas"
                  color="text-indigo-600"
                  onClick={() => nav("/processos")}
                />
              </div>
            </CardContent>
          </Card>

          {/* Pipeline (futuro) */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-violet-500" />
                Pipeline
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-3">
                <SubMetric
                  value={r.pipeline.leadsAbertos}
                  label="Leads"
                  color="text-violet-600"
                  onClick={() => nav("/atendimento")}
                />
                <SubMetric
                  value={formatBRLShort(r.pipeline.valorPipeline)}
                  label="Potencial"
                  color="text-emerald-600"
                  onClick={() => nav("/atendimento")}
                  isString
                />
                <SubMetric
                  value={formatBRLShort(r.financeiro.pendente)}
                  label="A receber"
                  color="text-amber-600"
                  onClick={() => nav("/financeiro")}
                  isString
                />
              </div>
            </CardContent>
          </Card>

          {/* Resultado (passado) */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Activity className="h-4 w-4 text-emerald-500" />
                Escritório
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-3">
                <SubMetric
                  value={r.processos.ativos}
                  label="Processos"
                  color="text-indigo-600"
                  onClick={() => nav("/processos")}
                />
                <SubMetric
                  value={r.crm.totalContatos}
                  label="Clientes"
                  color="text-blue-600"
                  onClick={() => nav("/clientes")}
                />
                <SubMetric
                  value={formatBRLShort(r.financeiro.recebido)}
                  label="Recebido"
                  color="text-emerald-600"
                  onClick={() => nav("/financeiro")}
                  isString
                />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ───────────────── 2 colunas: Agenda+Créditos | Activity Feed ───────────────── */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Coluna esquerda: Agenda + Créditos + Atalhos */}
        <div className="space-y-6 lg:col-span-2">
          {/* Atalhos rápidos */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Zap className="h-4 w-4 text-muted-foreground" />
                Acesso rápido
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { icon: Scale, label: "Processos", path: "/processos", color: "text-indigo-600" },
                  { icon: CalendarDays, label: "Agenda", path: "/agenda", color: "text-orange-600" },
                  { icon: Headphones, label: "Atendimento", path: "/atendimento", color: "text-sky-600" },
                  { icon: DollarSign, label: "Financeiro", path: "/financeiro", color: "text-emerald-600" },
                  { icon: Landmark, label: "Bancário", path: "/calculos/bancario", color: "text-blue-600" },
                  { icon: Briefcase, label: "Trabalhista", path: "/calculos/trabalhista", color: "text-amber-600" },
                  { icon: ShieldCheck, label: "Previdenciário", path: "/calculos/previdenciario", color: "text-rose-600" },
                  { icon: Settings, label: "Configurações", path: "/configuracoes", color: "text-gray-600" },
                ].map((m) => (
                  <Button
                    key={m.path}
                    variant="outline"
                    className="h-auto py-3 justify-start gap-2 text-left"
                    onClick={() => nav(m.path)}
                  >
                    <m.icon className={`h-4 w-4 ${m.color} shrink-0`} />
                    <span className="text-xs font-medium truncate">{m.label}</span>
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Agenda de hoje */}
          {ok && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-amber-500" />
                    Agenda de hoje
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => nav("/agenda")}
                  >
                    Ver tudo
                    <ArrowRight className="h-3 w-3 ml-1" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {totalHoje === 0 ? (
                  <div className="text-center py-6">
                    <Sun className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground">Dia tranquilo.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {r.agenda.compromissosHoje.map((c: any) => (
                      <div
                        key={`c-${c.id}`}
                        className="flex items-center gap-3 py-2 px-2 -mx-2 rounded hover:bg-muted/50 cursor-pointer"
                        onClick={() => nav("/agenda")}
                      >
                        <div
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: c.cor || "#3b82f6" }}
                        />
                        <span className="text-xs font-mono text-muted-foreground w-12 shrink-0">
                          {c.hora}
                        </span>
                        <span className="text-sm truncate flex-1">{c.titulo}</span>
                      </div>
                    ))}
                    {r.agenda.tarefasHoje.map((t: any) => (
                      <div
                        key={`t-${t.id}`}
                        className="flex items-center gap-3 py-2 px-2 -mx-2 rounded hover:bg-muted/50 cursor-pointer"
                        onClick={() => nav("/tarefas")}
                      >
                        <CheckSquare className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="text-xs text-muted-foreground w-12 shrink-0">Tarefa</span>
                        <span className="text-sm truncate flex-1">{t.titulo}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Créditos */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-muted-foreground" />
                Créditos de cálculo
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {isUnlimited ? (
                <div className="flex items-center gap-2">
                  <div className="h-2 w-full rounded-full bg-emerald-100">
                    <div className="h-2 rounded-full bg-emerald-500 w-full" />
                  </div>
                  <span className="text-xs text-emerald-600 font-medium">Ilimitado</span>
                </div>
              ) : (
                <>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>
                      {creditsUsed}/{creditsTotal} usados
                    </span>
                    <span>{creditsRemaining} restante(s)</span>
                  </div>
                  <Progress
                    value={
                      creditsTotal > 0
                        ? Math.min(100, Math.round((creditsUsed / creditsTotal) * 100))
                        : 0
                    }
                    className="h-2"
                  />
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Coluna direita: Activity Feed */}
        <Card className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] flex flex-col">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Activity className="h-4 w-4 text-muted-foreground" />
                Atividade recente
              </CardTitle>
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            </div>
          </CardHeader>
          <CardContent className="overflow-y-auto flex-1 pr-2">
            {!feed || feed.length === 0 ? (
              <div className="text-center py-8">
                <Activity className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">Nenhuma atividade recente.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {feed.map((item: any) => {
                  const cfg = ACTIVITY_ICONS[item.tipo] || ACTIVITY_ICONS.mensagem;
                  const Icon = cfg.icon;
                  return (
                    <div
                      key={item.id}
                      className="flex items-start gap-3 group cursor-pointer"
                      onClick={() => item.link && nav(item.link)}
                    >
                      <div className={`h-8 w-8 rounded-lg ${cfg.bg} flex items-center justify-center shrink-0`}>
                        <Icon className={`h-4 w-4 ${cfg.color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate group-hover:text-primary">
                          {item.titulo}
                        </p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {item.descricao}
                        </p>
                        <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                          {formatRelative(item.timestamp)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Sub-componentes ─────────────────────────────────────────────────────────

function AlertChip({
  icon: Icon,
  color,
  label,
  onClick,
}: {
  icon: any;
  color: "red" | "amber" | "blue";
  label: string;
  onClick: () => void;
}) {
  const colors = {
    red: "bg-red-50 border-red-200 text-red-700 hover:bg-red-100",
    amber: "bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100",
    blue: "bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100",
  };
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${colors[color]}`}
      onClick={onClick}
    >
      <Icon className="h-4 w-4" />
      <span className="text-sm font-medium">{label}</span>
      <ArrowRight className="h-3 w-3 opacity-60" />
    </div>
  );
}

function SubMetric({
  value,
  label,
  color,
  onClick,
  isString = false,
}: {
  value: number | string;
  label: string;
  color: string;
  onClick: () => void;
  isString?: boolean;
}) {
  return (
    <button
      className="text-center p-2 rounded-lg hover:bg-muted/50 transition-colors"
      onClick={onClick}
    >
      <p className={`${isString ? "text-base" : "text-2xl"} font-bold ${color}`}>
        {value}
      </p>
      <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
    </button>
  );
}

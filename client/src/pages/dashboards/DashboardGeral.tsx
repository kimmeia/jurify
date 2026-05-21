/**
 * Dashboard GERAL — visão consolidada pra dono/admin.
 *
 * Aplica o mesmo padrão visual dos painéis setoriais (hero card com
 * gradient, KPI cards modernos, avatares no feed) mas com tema "geral"
 * (slate executive) e dados agregados do escritório inteiro.
 *
 * Diferente dos painéis setoriais, aqui mostramos VALORES (R$ recebido,
 * vencido, pipeline) pra que o dono enxergue a saúde financeira de uma
 * vez só.
 */

import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  TrendingUp,
  Clock,
  ArrowRight,
  DollarSign,
  MessageCircle,
  CheckSquare,
  Gavel,
  Sun,
  AlertTriangle,
  Activity,
  Sparkles,
  CalendarDays,
  Target,
} from "lucide-react";
import { useLocation } from "wouter";
import { moduloOcultoNoMenu } from "@/config/visibility";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import {
  PainelSection,
  KPICard,
  PulseDot,
  formatBRL,
  formatBRLShort,
  formatPercent,
  formatDataCurta,
} from "./common";

// ─── Rota com fallback (módulos podem estar ocultos) ─────────────────────────

function rotaSegura(rotaOriginal: string, fallback: string): string {
  if (rotaOriginal.startsWith("/atendimento") && moduloOcultoNoMenu("atendimento")) return fallback;
  if (rotaOriginal.startsWith("/calculos") && moduloOcultoNoMenu("calculos")) return fallback;
  if (rotaOriginal.startsWith("/smartflow") && moduloOcultoNoMenu("smartflow")) return fallback;
  if (rotaOriginal.startsWith("/agentes-ia") && moduloOcultoNoMenu("agentesIa")) return fallback;
  return rotaOriginal;
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

export default function DashboardGeral() {
  const { user } = useAuth();
  const [, nav] = useLocation();

  // Dashboard mostra SEMPRE o mês civil corrente (dia 1 até hoje). Pra ver
  // outros períodos, o usuário vai em /relatorios — esta tela é "visão do
  // mês" e não tem seletor de range. Calculamos `days` como o nº de dias
  // decorridos no mês.
  const hojeData = new Date();
  const diasDoMesAteHoje = hojeData.getDate();

  const { data: credits } = trpc.dashboard.credits.useQuery(undefined, {
    enabled: !!user,
    retry: false,
  });
  const { data: clientesStats } = (trpc as any).clientes?.estatisticas?.useQuery?.(
    undefined,
    { enabled: !!user, retry: false, refetchInterval: 60_000 },
  ) || { data: null };
  const aguardandoDocs: number = clientesStats?.aguardandoDocumentacao ?? 0;

  const { data: r } = trpc.dashboard.resumoEscritorio.useQuery(undefined, {
    enabled: !!user,
    retry: false,
    refetchInterval: 60_000,
  });
  const { data: cashFlow } = trpc.dashboard.cashFlow.useQuery(
    { days: diasDoMesAteHoje },
    { enabled: !!user, retry: false, refetchInterval: 120_000 },
  );
  const { data: feed } = trpc.dashboard.activityFeed.useQuery(
    { limit: 5 },
    { enabled: !!user, retry: false, refetchInterval: 30_000 },
  );

  const creditsUsed = credits?.creditsUsed ?? 0;
  const creditsTotal = credits?.creditsTotal ?? 50;
  const creditsRemaining = credits?.creditsRemaining ?? creditsTotal;
  const isUnlimited = creditsTotal >= 999_999;
  const ok = !!r;

  const totalHoje = ok ? r.agenda.totalHojeCount : 0;
  const inadimplentes: number = clientesStats?.inadimplentes ?? 0;

  const recebido = cashFlow?.totalRecebido ?? 0;
  const pendente = cashFlow?.totalPendente ?? 0;
  const vencido = cashFlow?.totalVencido ?? 0;

  // Variação aproximada: saldo (recebido - vencido). Positiva se receita
  // supera inadimplência, negativa caso contrário. Não é variação MoM
  // (precisaria de segunda query) — fica como sinalizador grosseiro.
  const saldoLiquido = recebido - vencido;
  const taxaInadimplencia = recebido + vencido > 0
    ? +((vencido / (recebido + vencido)) * 100).toFixed(1)
    : 0;
  const nomeMesAtual = new Intl.DateTimeFormat("pt-BR", { month: "long" })
    .format(hojeData)
    .replace(/^./, (c) => c.toUpperCase());

  const nomeUser = user?.name?.split(" ")[0] || "Usuário";
  const dataInicio = cashFlow?.pontos[0]?.data;
  const dataFim = cashFlow?.pontos[cashFlow.pontos.length - 1]?.data;

  return (
    <PainelSection tema="geral">
      {/* ═══════════ HERO GERAL ═══════════ */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-800 via-slate-700 to-indigo-700 p-7 text-white shadow-lg">
        {/* Decoração */}
        <svg
          className="absolute -right-10 -bottom-12 w-56 h-56 opacity-10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M3 3v18h18" />
          <path d="M7 14l4-4 4 4 6-6" />
        </svg>
        <svg
          className="absolute right-12 top-6 w-20 h-20 opacity-10"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <circle cx="12" cy="12" r="10" />
        </svg>

        <div className="relative">
          <div className="flex items-start justify-between mb-2 flex-wrap gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <PulseDot />
                <p className="text-xs font-medium text-white/85 uppercase tracking-wider">
                  Painel Geral — {nomeMesAtual}
                </p>
              </div>
              {dataInicio && dataFim && (
                <p className="text-xs text-white/70 tabular-nums">
                  {formatDataCurta(dataInicio)} — {formatDataCurta(dataFim)}
                </p>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => nav("/relatorios")}
              className="text-[11px] h-8 text-white/85 hover:text-white hover:bg-white/15 border border-white/20"
            >
              Ver outros períodos →
            </Button>
          </div>

          <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-6 items-end">
            <div className="lg:col-span-6">
              <p className="text-sm font-medium text-white/85 mb-1">
                Olá, {nomeUser}
              </p>
              <p className="text-xs text-white/65 mb-3">
                Receita do mês
              </p>
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="text-5xl font-extrabold tracking-tight tabular-nums leading-none">
                  {formatBRL(recebido)}
                </span>
                {saldoLiquido >= 0 ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-400/25 text-emerald-50 border border-emerald-300/30">
                    <TrendingUp className="w-3 h-3" />
                    Saldo positivo
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-rose-400/30 text-rose-50 border border-rose-300/40">
                    <AlertTriangle className="w-3 h-3" />
                    Saldo negativo
                  </span>
                )}
              </div>
              <p className="text-xs text-white/65 mt-2 tabular-nums">
                {formatBRLShort(pendente)} pendente
                {vencido > 0 && (
                  <>
                    {" · "}
                    <b className="text-rose-200">{formatBRLShort(vencido)} vencido</b>
                    {" · "}
                    {formatPercent(taxaInadimplencia)} inadimplência
                  </>
                )}
              </p>
            </div>

            {/* Gráfico embutido no hero */}
            <div className="lg:col-span-6 h-32 -mx-2">
              {cashFlow && cashFlow.pontos.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={cashFlow.pontos}
                    margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="heroRec" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#fff" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#fff" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.1)" />
                    <XAxis
                      dataKey="data"
                      tick={{ fontSize: 9, fill: "rgba(255,255,255,0.6)" }}
                      tickFormatter={(d) => formatDataCurta(d)}
                      stroke="rgba(255,255,255,0.15)"
                    />
                    <YAxis
                      tick={{ fontSize: 9, fill: "rgba(255,255,255,0.6)" }}
                      tickFormatter={(v) => formatBRLShort(v)}
                      stroke="rgba(255,255,255,0.15)"
                      width={50}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "rgba(15,23,42,0.95)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: "8px",
                        fontSize: "12px",
                        color: "white",
                      }}
                      labelFormatter={(d) => formatDataCurta(d)}
                      formatter={(v: number) => formatBRL(v)}
                    />
                    <Area
                      type="monotone"
                      dataKey="recebido"
                      stroke="#fff"
                      strokeWidth={2}
                      fill="url(#heroRec)"
                      name="Recebido"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-xs text-white/50">
                  Sem dados no período.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════ ALERTAS URGENTES ═══════════ */}
      {ok &&
        (r.agenda.atrasados > 0 ||
          r.crm.conversasAguardando > 0 ||
          r.financeiro.vencido > 0 ||
          r.processos.movimentacoesNaoLidas > 0) && (
          <div className="flex flex-wrap gap-2">
            {r.processos.movimentacoesNaoLidas > 0 && (
              <AlertChip
                icon={Gavel}
                tom="blue"
                label={`${r.processos.movimentacoesNaoLidas} movimentação(ões) nova(s)`}
                onClick={() => nav("/processos?tab=movimentacoes")}
              />
            )}
            {r.agenda.atrasados > 0 && (
              <AlertChip
                icon={AlertTriangle}
                tom="rose"
                label={`${r.agenda.atrasados} atrasado(s)`}
                onClick={() => nav("/agenda")}
              />
            )}
            {r.crm.conversasAguardando > 0 && (
              <AlertChip
                icon={MessageCircle}
                tom="amber"
                label={`${r.crm.conversasAguardando} conversa(s) aguardando`}
                onClick={() => nav(rotaSegura("/atendimento", "/clientes"))}
              />
            )}
            {r.financeiro.vencido > 0 && (
              <AlertChip
                icon={DollarSign}
                tom="rose"
                label={`${formatBRL(r.financeiro.vencido)} vencido`}
                onClick={() => nav("/financeiro")}
              />
            )}
          </div>
        )}

      {/* ═══════════ 4 KPI CARDS ═══════════ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard
          label="Recebido no período"
          value={formatBRLShort(recebido)}
          valueColor="text-emerald-600"
          icon={DollarSign}
          iconBg="bg-emerald-50"
          iconFg="text-emerald-600"
          hint={formatBRL(recebido)}
        />
        <KPICard
          label="A receber (em dia)"
          value={formatBRLShort(pendente)}
          valueColor="text-blue-600"
          icon={Clock}
          iconBg="bg-blue-50"
          iconFg="text-blue-600"
          hint={formatBRL(pendente)}
        />
        <KPICard
          label="Vencido"
          value={formatBRLShort(vencido)}
          valueColor="text-rose-600"
          icon={AlertTriangle}
          iconBg="bg-rose-50"
          iconFg="text-rose-600"
          badge={
            vencido > 0 ? (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-rose-50 text-rose-700">
                {formatPercent(taxaInadimplencia, 0)}
              </span>
            ) : undefined
          }
        />
        <KPICard
          label="Pipeline aberto"
          value={ok ? formatBRLShort(r.pipeline.valorPipeline) : "—"}
          valueColor="text-violet-600"
          icon={Target}
          iconBg="bg-violet-50"
          iconFg="text-violet-600"
          hint={ok ? `${r.pipeline.leadsAbertos} leads em negociação` : undefined}
        />
      </div>

      {/* ═══════════ 3 CARDS CONTEXTUAIS ═══════════ */}
      {ok && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <CardContexto
            titulo="Hoje precisa atenção"
            icone={Sun}
            iconBg="bg-amber-50"
            iconFg="text-amber-500"
            itens={[
              {
                value: totalHoje,
                label: "Compromissos",
                color: "text-amber-600",
                onClick: () => nav("/agenda"),
              },
              {
                value: r.crm.conversasAguardando,
                label: "Aguardando",
                color: "text-blue-600",
                onClick: () => nav(rotaSegura("/atendimento", "/clientes")),
              },
              {
                value: r.processos.movimentacoesNaoLidas,
                label: "Mov. novas",
                color: "text-indigo-600",
                onClick: () => nav("/processos?tab=movimentacoes"),
              },
              ...(aguardandoDocs > 0
                ? [
                    {
                      value: aguardandoDocs,
                      label: "Aguard. docs",
                      color: "text-orange-600",
                      onClick: () => nav("/clientes?aguardandoDocs=1"),
                    },
                  ]
                : []),
            ]}
          />
          <CardContexto
            titulo="Pipeline"
            icone={TrendingUp}
            iconBg="bg-violet-50"
            iconFg="text-violet-500"
            itens={[
              {
                value: r.pipeline.leadsAbertos,
                label: "Leads",
                color: "text-violet-600",
                onClick: () => nav(rotaSegura("/atendimento", "/clientes")),
              },
              {
                value: formatBRLShort(r.pipeline.valorPipeline),
                label: "Potencial",
                color: "text-emerald-600",
                onClick: () => nav(rotaSegura("/atendimento", "/clientes")),
                isString: true,
              },
            ]}
          />
          <CardContexto
            titulo="Operação"
            icone={AlertTriangle}
            iconBg="bg-rose-50"
            iconFg="text-rose-500"
            itens={[
              {
                value: r.crm.conversasAbertas,
                label: "Conversas abertas",
                color: "text-blue-600",
                onClick: () => nav(rotaSegura("/atendimento", "/clientes")),
              },
              {
                value: r.agenda.atrasados,
                label: "Atrasados",
                color: "text-amber-600",
                onClick: () => nav("/agenda"),
              },
              {
                value: inadimplentes,
                label: "Inadimplentes",
                color: "text-rose-600",
                onClick: () => nav("/financeiro"),
              },
            ]}
          />
        </div>
      )}

      {/* ═══════════ 2 COLUNAS: AGENDA + ATIVIDADE ═══════════ */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          {/* Agenda de hoje */}
          {ok && (
            <Card className="border-slate-200">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-amber-500" />
                    Agenda de hoje
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => nav("/agenda")}
                  >
                    Ver tudo <ArrowRight className="h-3 w-3 ml-1" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {totalHoje === 0 ? (
                  <div className="text-center py-8">
                    <Sun className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground">Dia tranquilo.</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {r.agenda.compromissosHoje.map((c: any) => (
                      <div
                        key={`c-${c.id}`}
                        onClick={() => nav("/agenda")}
                        className="flex items-center gap-3 py-2 px-3 -mx-2 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors"
                      >
                        <div
                          className="h-2.5 w-2.5 rounded-full shrink-0 shadow-sm"
                          style={{ backgroundColor: c.cor || "#3b82f6" }}
                        />
                        <span className="text-xs font-mono text-muted-foreground w-14 shrink-0 tabular-nums">
                          {c.hora}
                        </span>
                        <span className="text-sm truncate flex-1">{c.titulo}</span>
                      </div>
                    ))}
                    {r.agenda.tarefasHoje.map((t: any) => (
                      <div
                        key={`t-${t.id}`}
                        onClick={() => nav("/tarefas")}
                        className="flex items-center gap-3 py-2 px-3 -mx-2 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors"
                      >
                        <div className="h-6 w-6 rounded-md bg-violet-50 flex items-center justify-center shrink-0">
                          <CheckSquare className="h-3 w-3 text-violet-600" />
                        </div>
                        <span className="text-xs text-muted-foreground w-14 shrink-0">Tarefa</span>
                        <span className="text-sm truncate flex-1">{t.titulo}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Créditos */}
          <Card className="border-slate-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-violet-500" />
                Créditos de cálculo
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {isUnlimited ? (
                <div className="flex items-center gap-3">
                  <div className="h-2 w-full rounded-full bg-emerald-100">
                    <div className="h-2 rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500 w-full" />
                  </div>
                  <span className="text-xs text-emerald-600 font-semibold whitespace-nowrap">
                    ∞ Ilimitado
                  </span>
                </div>
              ) : (
                <>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground tabular-nums">
                      <b className="text-slate-900">{creditsUsed}</b> usados de{" "}
                      <b className="text-slate-900">{creditsTotal}</b>
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      <b className="text-slate-900">{creditsRemaining}</b> restante(s)
                    </span>
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

        {/* Coluna direita: Activity feed */}
        <Card className="border-slate-200">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Activity className="h-4 w-4 text-slate-600" />
                Atividade recente
              </CardTitle>
              <PulseDot />
            </div>
          </CardHeader>
          <CardContent>
            {!feed || feed.length === 0 ? (
              <div className="text-center py-8">
                <Activity className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">Nenhuma atividade recente.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {feed.slice(0, 5).map((item: any) => {
                  const cfg = ACTIVITY_ICONS[item.tipo] || ACTIVITY_ICONS.mensagem;
                  const Icon = cfg.icon;
                  return (
                    <div
                      key={item.id}
                      onClick={() => item.link && nav(item.link)}
                      className="flex items-start gap-3 group cursor-pointer"
                    >
                      <div className={`h-9 w-9 rounded-lg ${cfg.bg} flex items-center justify-center shrink-0`}>
                        <Icon className={`h-4 w-4 ${cfg.color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold truncate group-hover:text-primary">
                          {item.titulo}
                        </p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {item.descricao}
                        </p>
                        <p className="text-[10px] text-muted-foreground/70 mt-0.5 tabular-nums">
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
    </PainelSection>
  );
}

// ─── Sub-componentes ─────────────────────────────────────────────────────────

function AlertChip({
  icon: Icon,
  tom,
  label,
  onClick,
}: {
  icon: any;
  tom: "rose" | "amber" | "blue";
  label: string;
  onClick: () => void;
}) {
  const cores = {
    rose: "bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100",
    amber: "bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100",
    blue: "bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100",
  };
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${cores[tom]}`}
    >
      <Icon className="h-4 w-4" />
      <span className="text-sm font-medium">{label}</span>
      <ArrowRight className="h-3 w-3 opacity-60" />
    </button>
  );
}

function CardContexto({
  titulo,
  icone: Icone,
  iconBg,
  iconFg,
  itens,
}: {
  titulo: string;
  icone: typeof Sun;
  iconBg: string;
  iconFg: string;
  itens: Array<{
    value: number | string;
    label: string;
    color: string;
    onClick: () => void;
    isString?: boolean;
  }>;
}) {
  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <span className={`w-7 h-7 rounded-lg ${iconBg} flex items-center justify-center`}>
            <Icone className={`h-4 w-4 ${iconFg}`} />
          </span>
          {titulo}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`grid gap-3 grid-cols-${Math.min(4, itens.length)}`}>
          {itens.map((item, i) => (
            <button
              key={i}
              onClick={item.onClick}
              className="text-center p-2 rounded-lg hover:bg-slate-50 transition-colors"
            >
              <p
                className={`${item.isString ? "text-base" : "text-2xl"} font-bold tracking-tight tabular-nums ${item.color}`}
              >
                {item.value}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5 uppercase tracking-wider">
                {item.label}
              </p>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

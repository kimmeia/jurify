import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users,
  CreditCard,
  TrendingDown,
  DollarSign,
  AlertCircle,
  Activity,
  Target,
  Zap,
  UserCheck,
  UserPlus,
  Crown,
} from "lucide-react";
import {
  HeroCard,
  KPICard,
  Avatar,
  formatBRL,
} from "./dashboards/common";

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dia}`;
}

export default function AdminDashboard() {
  const { data: stats, isLoading: statsLoading } = trpc.admin.stats.useQuery(undefined, {
    retry: false,
  });

  const { data: churn, isLoading: churnLoading } = trpc.admin.metricasChurn.useQuery(undefined, {
    retry: false,
  });

  const { data: recentUsers, isLoading: usersLoading } = trpc.admin.recentUsers.useQuery(undefined, {
    retry: false,
  });

  const { data: recentSubs, isLoading: subsLoading } = trpc.admin.recentSubscriptions.useQuery(undefined, {
    retry: false,
  });

  const now = new Date();
  const inicioMes = new Date(now.getFullYear(), now.getMonth(), 1);

  const mrr = stats?.mrr ?? 0;
  const arr = mrr * 12;
  const assinantesPagantes = stats?.activeSubscriptions ?? 0;
  const ticketMedio = assinantesPagantes > 0 ? mrr / assinantesPagantes : 0;
  const conversao = stats?.conversionRate ?? 0;
  const retencao = churn?.retencao12m ?? 0;

  return (
    <div className="space-y-6">
      {/* ─── Hero executivo ─── */}
      {statsLoading ? (
        <Skeleton className="h-56 w-full rounded-2xl" />
      ) : (
        <HeroCard
          tema="geral"
          setorLabel="Plataforma · Visão consolidada"
          periodo={{ dataInicio: ymd(inicioMes), dataFim: ymd(now) }}
          badgeDireito={
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-white/15 border border-white/20">
              <Zap className="h-3.5 w-3.5" /> Tempo real
            </span>
          }
          tituloPrincipal="Receita recorrente mensal (MRR)"
          valorPrincipal={formatBRL(mrr / 100)}
          legenda={
            <>
              ARR projetado: {formatBRL(arr / 100)}
              {ticketMedio > 0 && <> · ticket médio {formatBRL(ticketMedio / 100)}/mês</>}
            </>
          }
          progresso={{
            valor: conversao,
            labelDir: <span>{conversao}%</span>,
          }}
          ringValue={retencao}
          ringLabel={`${retencao}%`}
          ringSublabel="Retenção 12m"
          decoracaoIcon={Activity}
        />
      )}

      {/* ─── KPI cards ─── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          label="Receita mensal (MRR)"
          value={statsLoading ? <Skeleton className="h-7 w-24" /> : formatBRL(mrr / 100)}
          icon={DollarSign}
          iconBg="bg-emerald-500/10"
          iconFg="text-emerald-600"
        />
        <KPICard
          label="Assinaturas ativas"
          value={statsLoading ? <Skeleton className="h-7 w-16" /> : assinantesPagantes}
          icon={CreditCard}
          iconBg="bg-indigo-500/10"
          iconFg="text-indigo-600"
          hint={
            stats?.trialingSubscriptions
              ? `+ ${stats.trialingSubscriptions} em trial`
              : "Planos ativos no momento"
          }
        />
        <KPICard
          label="Total de clientes"
          value={statsLoading ? <Skeleton className="h-7 w-16" /> : (stats?.totalClients ?? 0)}
          icon={Users}
          iconBg="bg-violet-500/10"
          iconFg="text-violet-600"
          badge={
            stats?.newClientsThisMonth ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700">
                +{stats.newClientsThisMonth} este mês
              </span>
            ) : undefined
          }
        />
        <KPICard
          label="Conversão trial → pago"
          value={statsLoading ? <Skeleton className="h-7 w-16" /> : `${conversao}%`}
          icon={Target}
          iconBg="bg-amber-500/10"
          iconFg="text-amber-600"
          hint="Clientes com plano ativo"
        />
      </div>

      {/* ─── Churn & retenção ─── */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" /> Churn & retenção
        </h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <KPICard
            label="Média móvel de cancelamentos"
            value={
              churnLoading ? (
                <Skeleton className="h-7 w-20" />
              ) : (
                `${(churn?.churnAtual ?? 0).toFixed(2)}%`
              )
            }
            icon={TrendingDown}
            iconBg="bg-rose-500/10"
            iconFg="text-rose-600"
            valueColor={churnColor(churn?.churnAtual ?? 0)}
            hint="Churn (últimos 3 meses)"
          />
          <KPICard
            label="ARPU ÷ churn rate mensal"
            value={churnLoading ? <Skeleton className="h-7 w-28" /> : formatBRL((churn?.ltvEstimado ?? 0) / 100)}
            icon={Target}
            iconBg="bg-violet-500/10"
            iconFg="text-violet-600"
            hint="LTV estimado"
          />
          <KPICard
            label="Clientes antigos ainda ativos"
            value={churnLoading ? <Skeleton className="h-7 w-20" /> : `${retencao}%`}
            icon={Activity}
            iconBg="bg-indigo-500/10"
            iconFg="text-indigo-600"
            hint="Retenção 12 meses"
          />
        </div>
      </div>

      {/* ─── Distribuição por plano ─── */}
      <div className="grid gap-4 sm:grid-cols-3">
        <PlanoCard
          tom="emerald"
          icon={UserCheck}
          label="Plano Básico"
          value={stats?.planBreakdown?.basico ?? 0}
          loading={statsLoading}
        />
        <PlanoCard
          tom="blue"
          icon={UserPlus}
          label="Plano Intermediário"
          value={stats?.planBreakdown?.intermediario ?? 0}
          loading={statsLoading}
        />
        <PlanoCard
          tom="violet"
          icon={Crown}
          label="Plano Completo"
          value={stats?.planBreakdown?.completo ?? 0}
          loading={statsLoading}
        />
      </div>

      {/* ─── Tabelas: últimas assinaturas + novos clientes ─── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="px-5 pt-5 pb-3 border-b border-border">
            <h3 className="text-base font-semibold text-foreground">Últimas assinaturas</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Assinaturas mais recentes na plataforma.
            </p>
          </div>
          <CardContent className="p-0">
            {subsLoading ? (
              <div className="space-y-3 p-5">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : recentSubs && recentSubs.length > 0 ? (
              <ul className="divide-y divide-border">
                {recentSubs.map((sub) => (
                  <li key={sub.id} className="flex items-center gap-3 px-5 py-3">
                    <Avatar nome={sub.userName || "—"} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate text-foreground">
                        {sub.userName || "—"}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {sub.planName || "Sem plano"}
                      </p>
                    </div>
                    <SubscriptionStatusBadge status={sub.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState texto="Nenhuma assinatura encontrada." />
            )}
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <div className="px-5 pt-5 pb-3 border-b border-border">
            <h3 className="text-base font-semibold text-foreground">Novos clientes</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Últimos clientes registados na plataforma.
            </p>
          </div>
          <CardContent className="p-0">
            {usersLoading ? (
              <div className="space-y-3 p-5">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : recentUsers && recentUsers.length > 0 ? (
              <ul className="divide-y divide-border">
                {recentUsers.map((u) => (
                  <li key={u.id} className="flex items-center gap-3 px-5 py-3">
                    <Avatar nome={u.name || u.email || "—"} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate text-foreground">
                        {u.name || "—"}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {u.email || "—"}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {new Date(u.createdAt).toLocaleDateString("pt-BR", {
                        day: "2-digit",
                        month: "short",
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState texto="Nenhum cliente encontrado." />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function churnColor(rate: number): string {
  if (rate < 3) return "text-emerald-600";
  if (rate < 7) return "text-amber-600";
  return "text-rose-600";
}

const PLANO_TONS: Record<
  "emerald" | "blue" | "violet",
  { iconBg: string; iconFg: string }
> = {
  emerald: { iconBg: "bg-emerald-500/10", iconFg: "text-emerald-600" },
  blue: { iconBg: "bg-blue-500/10", iconFg: "text-blue-600" },
  violet: { iconBg: "bg-violet-500/10", iconFg: "text-violet-600" },
};

function PlanoCard({
  tom,
  icon: Icon,
  label,
  value,
  loading,
}: {
  tom: "emerald" | "blue" | "violet";
  icon: typeof UserCheck;
  label: string;
  value: number;
  loading: boolean;
}) {
  const c = PLANO_TONS[tom];
  return (
    <Card>
      <CardContent className="pt-5 pb-5">
        <div className="flex items-center gap-4">
          <div className={`h-10 w-10 rounded-xl ${c.iconBg} flex items-center justify-center`}>
            <Icon className={`h-5 w-5 ${c.iconFg}`} />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            {loading ? (
              <Skeleton className="h-6 w-10 mt-1" />
            ) : (
              <p className="text-xl font-bold text-foreground tabular-nums">{value}</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState({ texto }: { texto: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
      <AlertCircle className="h-8 w-8 mb-2 opacity-50" />
      <p className="text-sm">{texto}</p>
    </div>
  );
}

function SubscriptionStatusBadge({ status }: { status: string }) {
  const variants: Record<
    string,
    { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
  > = {
    active: { label: "Ativa", variant: "default" },
    trialing: { label: "Trial", variant: "secondary" },
    canceled: { label: "Cancelada", variant: "destructive" },
    past_due: { label: "Vencida", variant: "destructive" },
    incomplete: { label: "Incompleta", variant: "outline" },
    unpaid: { label: "Não paga", variant: "destructive" },
    paused: { label: "Pausada", variant: "secondary" },
  };

  const config = variants[status] || { label: status, variant: "outline" as const };

  return (
    <Badge variant={config.variant} className="text-[10px] shrink-0">
      {config.label}
    </Badge>
  );
}

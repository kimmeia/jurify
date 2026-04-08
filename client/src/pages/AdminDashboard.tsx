import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Users,
  CreditCard,
  TrendingUp,
  DollarSign,
  UserPlus,
  UserCheck,
  AlertCircle,
} from "lucide-react";

export default function AdminDashboard() {
  const { data: stats, isLoading: statsLoading } = trpc.admin.stats.useQuery(undefined, {
    retry: false,
  });

  const { data: recentUsers, isLoading: usersLoading } = trpc.admin.recentUsers.useQuery(undefined, {
    retry: false,
  });

  const { data: recentSubs, isLoading: subsLoading } = trpc.admin.recentSubscriptions.useQuery(undefined, {
    retry: false,
  });

  const formatCurrency = (cents: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Visão Geral
        </h1>
        <p className="text-muted-foreground mt-1">
          Acompanhe as vendas, assinaturas e crescimento da plataforma.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Receita Mensal (MRR)
            </CardTitle>
            <DollarSign className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <>
                <p className="text-2xl font-bold text-foreground">
                  {formatCurrency(stats?.mrr ?? 0)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Receita recorrente mensal
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Assinaturas Ativas
            </CardTitle>
            <CreditCard className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <p className="text-2xl font-bold text-foreground">
                  {stats?.activeSubscriptions ?? 0}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {stats?.trialingSubscriptions
                    ? `+ ${stats.trialingSubscriptions} em trial`
                    : "Planos ativos no momento"}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total de Clientes
            </CardTitle>
            <Users className="h-4 w-4 text-violet-500" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <p className="text-2xl font-bold text-foreground">
                  {stats?.totalClients ?? 0}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {stats?.newClientsThisMonth
                    ? `+${stats.newClientsThisMonth} este mês`
                    : "Utilizadores registados"}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Taxa de Conversão
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <p className="text-2xl font-bold text-foreground">
                  {stats?.conversionRate ?? 0}%
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Clientes com plano ativo
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Secondary stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="h-10 w-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <UserCheck className="h-5 w-5 text-emerald-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Plano Iniciante</p>
                {statsLoading ? (
                  <Skeleton className="h-6 w-10 mt-1" />
                ) : (
                  <p className="text-xl font-bold text-foreground">
                    {stats?.planBreakdown?.iniciante ?? 0}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <UserPlus className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Plano Profissional</p>
                {statsLoading ? (
                  <Skeleton className="h-6 w-10 mt-1" />
                ) : (
                  <p className="text-xl font-bold text-foreground">
                    {stats?.planBreakdown?.profissional ?? 0}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="h-10 w-10 rounded-lg bg-violet-500/10 flex items-center justify-center">
                <DollarSign className="h-5 w-5 text-violet-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Plano Escritório</p>
                {statsLoading ? (
                  <Skeleton className="h-6 w-10 mt-1" />
                ) : (
                  <p className="text-xl font-bold text-foreground">
                    {stats?.planBreakdown?.escritorio ?? 0}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Two-column layout: Recent Subscriptions + Recent Clients */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Subscriptions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Últimas Assinaturas</CardTitle>
            <CardDescription>
              Assinaturas mais recentes na plataforma.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {subsLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : recentSubs && recentSubs.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Plano</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentSubs.map((sub) => (
                    <TableRow key={sub.id}>
                      <TableCell className="font-medium text-sm">
                        {sub.userName || "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {sub.planName || "—"}
                      </TableCell>
                      <TableCell>
                        <SubscriptionStatusBadge status={sub.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <AlertCircle className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-sm">Nenhuma assinatura encontrada.</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Clients */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Novos Clientes</CardTitle>
            <CardDescription>
              Últimos clientes registados na plataforma.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {usersLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : recentUsers && recentUsers.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Registado em</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentUsers.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium text-sm">
                        {u.name || "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {u.email || "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(u.createdAt).toLocaleDateString("pt-BR")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <AlertCircle className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-sm">Nenhum cliente encontrado.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SubscriptionStatusBadge({ status }: { status: string }) {
  const variants: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    active: { label: "Ativa", variant: "default" },
    trialing: { label: "Trial", variant: "secondary" },
    canceled: { label: "Cancelada", variant: "destructive" },
    past_due: { label: "Vencida", variant: "destructive" },
    incomplete: { label: "Incompleta", variant: "outline" },
    unpaid: { label: "Não paga", variant: "destructive" },
    paused: { label: "Pausada", variant: "secondary" },
  };

  const config = variants[status] || { label: status, variant: "outline" as const };

  return <Badge variant={config.variant} className="text-[10px]">{config.label}</Badge>;
}

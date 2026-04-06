import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area,
} from "recharts";
import { BarChart3, TrendingUp, Users, Calculator } from "lucide-react";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

function formatMes(mes: string) {
  const [y, m] = mes.split("-");
  const nomes = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  return `${nomes[parseInt(m) - 1]}/${y.slice(2)}`;
}

function formatCurrency(value: number) {
  return `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function ChartSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-[220px] w-full rounded-lg" />
    </div>
  );
}

const tooltipStyle = {
  contentStyle: {
    background: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "8px",
    fontSize: "12px",
    boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
  },
  labelStyle: { fontWeight: 500, marginBottom: "4px" },
};

export default function AdminReports() {
  const { data: crescimento, isLoading: loadCrescimento } = trpc.admin.crescimentoUsuarios.useQuery(undefined, { retry: false });
  const { data: receita, isLoading: loadReceita } = trpc.admin.receitaMensal.useQuery(undefined, { retry: false });
  const { data: calculosModulo, isLoading: loadModulos } = trpc.admin.calculosPorModulo.useQuery(undefined, { retry: false });
  const { data: calculosMes, isLoading: loadCalcMes } = trpc.admin.calculosPorMes.useQuery(undefined, { retry: false });
  const { data: stats } = trpc.admin.stats.useQuery(undefined, { retry: false });

  const totalCalcModulos = calculosModulo?.reduce((acc, c) => acc + c.total, 0) ?? 0;
  const ultimoMesReceita = receita && receita.length > 0 ? receita[receita.length - 1].valor : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Relatórios</h1>
        <p className="text-muted-foreground mt-1">Acompanhe o crescimento, receita e utilização da plataforma.</p>
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-emerald-500/10 flex items-center justify-center"><TrendingUp className="h-4 w-4 text-emerald-500" /></div>
              <div><p className="text-xs text-muted-foreground">MRR atual</p><p className="text-lg font-bold">{formatCurrency(ultimoMesReceita)}</p></div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-blue-500/10 flex items-center justify-center"><Users className="h-4 w-4 text-blue-500" /></div>
              <div><p className="text-xs text-muted-foreground">Clientes totais</p><p className="text-lg font-bold">{stats?.totalClients ?? 0}</p></div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-violet-500/10 flex items-center justify-center"><Calculator className="h-4 w-4 text-violet-500" /></div>
              <div><p className="text-xs text-muted-foreground">Cálculos totais</p><p className="text-lg font-bold">{totalCalcModulos}</p></div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-amber-500/10 flex items-center justify-center"><BarChart3 className="h-4 w-4 text-amber-500" /></div>
              <div><p className="text-xs text-muted-foreground">Conversão</p><p className="text-lg font-bold">{stats?.conversionRate ?? 0}%</p></div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Receita */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Receita mensal (MRR)</CardTitle><CardDescription>Evolução nos últimos 12 meses</CardDescription></CardHeader>
          <CardContent>
            {loadReceita ? <ChartSkeleton /> : (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={receita?.map((r) => ({ ...r, mes: formatMes(r.mes) }))}>
                  <defs><linearGradient id="colorReceita" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.2} /><stop offset="95%" stopColor="#10b981" stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="mes" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `R$${v}`} />
                  <Tooltip {...tooltipStyle} formatter={(value: number) => [formatCurrency(value), "Receita"]} />
                  <Area type="monotone" dataKey="valor" stroke="#10b981" strokeWidth={2} fill="url(#colorReceita)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Crescimento */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Novos clientes por mês</CardTitle><CardDescription>Registros nos últimos 12 meses</CardDescription></CardHeader>
          <CardContent>
            {loadCrescimento ? <ChartSkeleton /> : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={crescimento?.map((c) => ({ ...c, mes: formatMes(c.mes) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="mes" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                  <Tooltip {...tooltipStyle} formatter={(value: number) => [value, "Clientes"]} />
                  <Bar dataKey="total" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Cálculos por mês */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Cálculos por mês</CardTitle><CardDescription>Volume nos últimos 12 meses</CardDescription></CardHeader>
          <CardContent>
            {loadCalcMes ? <ChartSkeleton /> : (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={calculosMes?.map((c) => ({ ...c, mes: formatMes(c.mes) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="mes" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                  <Tooltip {...tooltipStyle} formatter={(value: number) => [value, "Cálculos"]} />
                  <Line type="monotone" dataKey="total" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Cálculos por módulo */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Cálculos por módulo</CardTitle><CardDescription>Distribuição de uso</CardDescription></CardHeader>
          <CardContent>
            {loadModulos ? <ChartSkeleton /> : (
              calculosModulo && calculosModulo.length > 0 ? (
                <div className="flex items-center gap-6">
                  <ResponsiveContainer width="50%" height={220}>
                    <PieChart>
                      <Pie data={calculosModulo} dataKey="total" nameKey="nome" cx="50%" cy="50%" outerRadius={80} innerRadius={40} strokeWidth={2} stroke="hsl(var(--card))">
                        {calculosModulo.map((_, i) => (<Cell key={i} fill={COLORS[i % COLORS.length]} />))}
                      </Pie>
                      <Tooltip {...tooltipStyle} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex-1 space-y-2">
                    {calculosModulo.map((m, i) => (
                      <div key={m.tipo} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                          <span className="text-muted-foreground">{m.nome}</span>
                        </div>
                        <span className="font-medium tabular-nums">{m.total}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-[220px] text-sm text-muted-foreground">Nenhum cálculo registrado.</div>
              )
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

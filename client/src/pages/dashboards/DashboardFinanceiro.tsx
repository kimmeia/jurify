/**
 * Dashboard FINANCEIRO — pra setor financeiro.
 *
 * KPIs principais:
 *  - Recebido, Pendente, Vencido (R$)
 *  - % inadimplência por valor + por cliente
 *  - Quantidade de clientes inadimplentes
 *  - Top 5 devedores
 *
 * Mesmas definições do card "Inadimplência" da página Financeiro.
 */

import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DollarSign,
  AlertCircle,
  Clock,
  TrendingUp,
  Users,
  ArrowRight,
  Wallet,
} from "lucide-react";
import {
  KPICard,
  HeaderPeriodo,
  formatBRL,
  formatBRLShort,
  formatPercent,
} from "./common";

export default function DashboardFinanceiro() {
  const [, nav] = useLocation();
  const { data, isLoading } = (trpc as any).dashboard.financeiro.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Carregando dados financeiros…</div>;
  }
  if (!data) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            Sem permissão para ver o painel financeiro. Dados financeiros são
            transversais ao escritório e só ficam visíveis pra cargos com acesso
            total ao Dashboard.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
          <Wallet className="h-5 w-5 text-emerald-600" />
          Painel Financeiro
        </h2>
        <HeaderPeriodo periodo={data.periodo} />
      </div>

      {/* ─── KPIs principais ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          label="Recebido no período"
          value={formatBRLShort(data.recebido)}
          color="text-emerald-600"
          icon={<DollarSign className="h-3.5 w-3.5" />}
          hint={formatBRL(data.recebido)}
        />
        <KPICard
          label="A receber (em dia)"
          value={formatBRLShort(data.pendente)}
          color="text-blue-600"
          icon={<Clock className="h-3.5 w-3.5" />}
          hint={formatBRL(data.pendente)}
        />
        <KPICard
          label="Vencido"
          value={formatBRLShort(data.vencido)}
          color="text-rose-600"
          icon={<AlertCircle className="h-3.5 w-3.5" />}
          hint={formatBRL(data.vencido)}
        />
        <KPICard
          label="% Inadimplência (valor)"
          value={formatPercent(data.percentInadimplenciaValor)}
          color={corPercentual(data.percentInadimplenciaValor)}
          icon={<TrendingUp className="h-3.5 w-3.5" />}
          hint={
            data.totalEsperadoNoPeriodo > 0
              ? `Base: ${formatBRLShort(data.totalEsperadoNoPeriodo)}`
              : "Sem cobranças no período"
          }
        />
      </div>

      {/* ─── Inadimplência por cliente ─── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Users className="h-4 w-4 text-rose-600" />
            Clientes inadimplentes
          </CardTitle>
          <CardDescription className="text-xs">
            Clientes com pelo menos 1 cobrança vencida no período (mesma
            definição da página Financeiro).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <p className="text-3xl font-bold text-rose-600">
                {data.clientesInadimplentes}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Clientes com vencido
              </p>
            </div>
            <div>
              <p className="text-3xl font-bold text-foreground">
                {data.clientesComCobranca}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Total com cobrança
              </p>
            </div>
            <div>
              <p
                className={`text-3xl font-bold ${corPercentual(data.percentInadimplenciaClientes)}`}
              >
                {formatPercent(data.percentInadimplenciaClientes)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                % por cliente
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ─── Top devedores ─── */}
      {data.topDevedores.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-rose-600" />
                Top 5 devedores
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => nav("/financeiro?tab=clientes&chip=inadimplentes")}
              >
                Ver todos
                <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.topDevedores.map((d: any) => (
                <div
                  key={d.contatoId}
                  className="flex items-center justify-between py-2 px-3 -mx-3 rounded hover:bg-muted/50 cursor-pointer"
                  onClick={() => nav(`/clientes?id=${d.contatoId}`)}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{d.nome}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {d.cobrancasVencidas} cobrança(s) vencida(s)
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-rose-600 shrink-0 ml-3">
                    {formatBRL(d.valor)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {data.topDevedores.length === 0 && data.clientesInadimplentes === 0 && (
        <Card className="border-emerald-200 bg-emerald-50/30">
          <CardContent className="pt-6">
            <p className="text-sm text-emerald-700">
              Nenhum cliente inadimplente no período. Parabéns!
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function corPercentual(v: number | null): string {
  if (v == null) return "text-slate-400";
  if (v >= 20) return "text-rose-600";
  if (v >= 10) return "text-amber-600";
  if (v >= 5) return "text-blue-600";
  return "text-emerald-600";
}

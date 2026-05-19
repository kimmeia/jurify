/**
 * Dashboard FINANCEIRO — pra setor tipo='financeiro'.
 *
 * Foco em receita vs vencido. Clientes (não usuários) aparecem como
 * top devedores, com avatar gradient + cobranças vencidas + valor.
 */

import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Wallet,
  DollarSign,
  Clock,
  AlertTriangle,
  TrendingUp,
  Users,
  TrendingDown,
  ChevronRight,
} from "lucide-react";
import {
  Avatar,
  HeroCard,
  KPICard,
  MetaPill,
  NotaSetor,
  PainelSection,
  corTextoPercentual,
  formatBRL,
  formatBRLShort,
  formatPercent,
} from "./common";

export default function DashboardFinanceiro() {
  const [, nav] = useLocation();
  const { data, isLoading } = (trpc as any).dashboard.financeiro.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  if (isLoading) return <SkeletonPainel />;
  if (!data) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            Sem permissão para ver o painel financeiro.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <PainelSection tema="financeiro">
      <HeroCard
        tema="financeiro"
        setorLabel="Painel Financeiro"
        periodo={data.periodo}
        decoracaoIcon={DollarSign}
        badgeDireito={
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-white/15 text-white border border-white/20">
            <Wallet className="w-3 h-3" />
            Receita do escritório
          </span>
        }
        tituloPrincipal="Recebido no período"
        valorPrincipal={formatBRL(data.recebido)}
        legenda={
          <>
            {formatBRL(data.pendente)} ainda a receber
            {data.vencido > 0 && (
              <>
                {" · "}
                <b className="text-rose-200">{formatBRL(data.vencido)} vencido</b>
              </>
            )}
          </>
        }
        ringValue={data.percentInadimplenciaValor ?? 0}
        ringLabel={
          <>
            {(data.percentInadimplenciaValor ?? 0).toFixed(1)}
            <span className="text-xl">%</span>
          </>
        }
        ringSublabel="inadimpl."
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard
          label="Recebido"
          value={formatBRLShort(data.recebido)}
          icon={DollarSign}
          iconBg="bg-emerald-50"
          iconFg="text-emerald-600"
        />
        <KPICard
          label="A receber (em dia)"
          value={formatBRLShort(data.pendente)}
          icon={Clock}
          iconBg="bg-blue-50"
          iconFg="text-blue-600"
        />
        <KPICard
          label="Vencido"
          value={formatBRLShort(data.vencido)}
          valueColor="text-rose-600"
          icon={AlertTriangle}
          iconBg="bg-rose-50"
          iconFg="text-rose-600"
          badge={
            data.clientesInadimplentes > 0 ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-rose-50 text-rose-700">
                ⚠ {data.clientesInadimplentes} cliente{data.clientesInadimplentes !== 1 ? "s" : ""}
              </span>
            ) : undefined
          }
        />
        <KPICard
          label="Inadimplência (valor)"
          value={formatPercent(data.percentInadimplenciaValor)}
          valueColor={corTextoPercentual(data.percentInadimplenciaValor)}
          icon={TrendingDown}
          iconBg="bg-amber-50"
          iconFg="text-amber-600"
        />
      </div>

      {/* Inadimplência por cliente */}
      <Card className="border-slate-200">
        <CardContent className="pt-6 pb-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-rose-50 flex items-center justify-center">
                  <Users className="w-4 h-4 text-rose-600" />
                </span>
                Clientes inadimplentes
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Definição: cliente com pelo menos 1 cobrança vencida.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <p className="text-4xl font-bold tracking-tight tabular-nums text-rose-600">
                {data.clientesInadimplentes}
              </p>
              <p className="text-xs text-muted-foreground mt-1.5">Com vencido</p>
            </div>
            <div className="text-center border-x border-slate-100">
              <p className="text-4xl font-bold tracking-tight tabular-nums">
                {data.clientesComCobranca}
              </p>
              <p className="text-xs text-muted-foreground mt-1.5">Total com cobrança</p>
            </div>
            <div className="text-center">
              <p
                className={`text-4xl font-bold tracking-tight tabular-nums ${corTextoPercentual(data.percentInadimplenciaClientes)}`}
              >
                {(data.percentInadimplenciaClientes ?? 0).toFixed(1)}
                <span className="text-xl">%</span>
              </p>
              <p className="text-xs text-muted-foreground mt-1.5">% por cliente</p>
            </div>
          </div>

          <div className="mt-5 h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-amber-400 via-orange-500 to-rose-500"
              style={{ width: `${Math.min(100, data.percentInadimplenciaClientes ?? 0)}%` }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Top devedores */}
      {data.topDevedores.length > 0 && (
        <Card className="border-slate-200 overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-500" />
                Top 5 devedores
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Maior valor em aberto.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7"
              onClick={() => nav("/financeiro?tab=clientes&chip=inadimplentes")}
            >
              Ver todos <ChevronRight className="w-3 h-3 ml-1" />
            </Button>
          </div>
          <div className="p-2 divide-y divide-slate-100">
            {data.topDevedores.map((d: any) => (
              <div
                key={d.contatoId}
                onClick={() => nav(`/clientes?id=${d.contatoId}`)}
                className="grid grid-cols-[40px_1fr_auto] gap-3 items-center p-3 rounded-xl hover:bg-slate-50/70 cursor-pointer transition-colors"
              >
                <Avatar nome={d.nome} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{d.nome}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <MetaPill tom={d.cobrancasVencidas >= 2 ? "rose" : "amber"}>
                      {d.cobrancasVencidas} vencida{d.cobrancasVencidas !== 1 ? "s" : ""}
                    </MetaPill>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold tabular-nums text-rose-600">
                    {formatBRLShort(d.valor)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">em aberto</p>
                </div>
              </div>
            ))}
          </div>
          <NotaSetor>
            Dados financeiros são transversais ao escritório — não filtramos
            por setor aqui (todos os devedores aparecem).
          </NotaSetor>
        </Card>
      )}

      {data.topDevedores.length === 0 && data.clientesInadimplentes === 0 && (
        <Card className="border-emerald-200 bg-emerald-50/30">
          <CardContent className="pt-6">
            <p className="text-sm text-emerald-700 flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Nenhum cliente inadimplente no período. Parabéns!
            </p>
          </CardContent>
        </Card>
      )}
    </PainelSection>
  );
}

function SkeletonPainel() {
  return (
    <div className="space-y-4">
      <div className="h-48 rounded-2xl bg-gradient-to-br from-slate-200 to-slate-100 animate-pulse" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 rounded-xl bg-slate-100 animate-pulse" />
        ))}
      </div>
      <div className="h-40 rounded-xl bg-slate-100 animate-pulse" />
    </div>
  );
}

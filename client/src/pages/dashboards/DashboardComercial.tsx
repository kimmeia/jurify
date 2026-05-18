/**
 * Dashboard COMERCIAL — pra SDR/atendente/gestor do setor comercial.
 *
 * - SDR/atendente (sem verTodos): vê só o próprio card (contratos fechados,
 *   pagos e % da meta).
 * - Gestor (verTodos): vê o próprio card + ranking de toda a equipe.
 */

import { trpc } from "@/lib/trpc";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Target,
  Handshake,
  CheckCircle2,
  Trophy,
  ChevronUp,
} from "lucide-react";
import {
  KPICard,
  ProgressoMeta,
  HeaderPeriodo,
  formatBRLShort,
  formatPercent,
  corMeta,
} from "./common";

export default function DashboardComercial() {
  const { data, isLoading } = (trpc as any).dashboard.comercial.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Carregando dados comerciais…</div>;
  }
  if (!data) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            Sem permissão para ver o painel comercial.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!data.temSetor && data.modo === "individual") {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            Você não está atribuído a nenhum setor comercial. Solicite ao
            administrador para vincular você a um setor do tipo "Comercial".
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Handshake className="h-5 w-5 text-blue-600" />
            Painel Comercial
          </h2>
          <HeaderPeriodo periodo={data.periodo} />
        </div>
        {data.modo === "gestor" && (
          <Badge variant="secondary" className="text-xs">Visão Gestor</Badge>
        )}
      </div>

      {/* ─── Card do colaborador logado ─── */}
      {data.meu && <CardColaborador card={data.meu} destaque />}

      {/* ─── Ranking (só gestor) ─── */}
      {data.modo === "gestor" && data.ranking && data.ranking.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Trophy className="h-4 w-4 text-amber-500" />
              Ranking do time comercial
            </CardTitle>
            <CardDescription className="text-xs">
              Ordenado por faturado no período. Inclui todos os colaboradores
              do setor — quem não vendeu aparece com zero.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.ranking.map((c: any, i: number) => (
              <LinhaRanking key={c.atendenteId} colocacao={i + 1} card={c} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Sub-componentes ─────────────────────────────────────────────────────────

function CardColaborador({
  card,
  destaque = false,
}: {
  card: any;
  destaque?: boolean;
}) {
  return (
    <Card className={destaque ? "border-blue-200 bg-blue-50/30" : ""}>
      <CardHeader className="pb-3">
        <div className="flex items-baseline justify-between">
          <CardTitle className="text-sm font-medium">{card.nome}</CardTitle>
          {card.setorNome && (
            <Badge variant="outline" className="text-[10px] font-normal">
              {card.setorNome}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <KPICard
            label="Contratos fechados"
            value={card.contratosFechados}
            color="text-indigo-600"
            icon={<Handshake className="h-3.5 w-3.5" />}
          />
          <KPICard
            label="Contratos pagos"
            value={card.contratosPagos}
            color="text-emerald-600"
            icon={<CheckCircle2 className="h-3.5 w-3.5" />}
            hint={`Faturado: ${formatBRLShort(card.faturado)}`}
          />
          <KPICard
            label="% da meta"
            value={formatPercent(card.progressoMeta)}
            color={
              card.progressoMeta == null
                ? "text-slate-400"
                : card.progressoMeta >= 100
                  ? "text-emerald-600"
                  : card.progressoMeta >= 70
                    ? "text-blue-600"
                    : "text-amber-600"
            }
            icon={<Target className="h-3.5 w-3.5" />}
          />
        </div>
        <ProgressoMeta
          faturado={card.faturado}
          meta={card.metaPeriodo}
          progressoMeta={card.progressoMeta}
        />
      </CardContent>
    </Card>
  );
}

function LinhaRanking({ colocacao, card }: { colocacao: number; card: any }) {
  // Cor do número de posição: 1º ouro, 2º prata, 3º bronze, demais neutro
  const corPosicao =
    colocacao === 1
      ? "bg-amber-100 text-amber-700"
      : colocacao === 2
        ? "bg-slate-200 text-slate-700"
        : colocacao === 3
          ? "bg-orange-100 text-orange-700"
          : "bg-muted text-muted-foreground";

  return (
    <div className="grid grid-cols-12 gap-3 items-center py-2 px-3 rounded-lg hover:bg-muted/50 transition-colors">
      <div className="col-span-1">
        <div
          className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold ${corPosicao}`}
        >
          {colocacao}
        </div>
      </div>
      <div className="col-span-4 min-w-0">
        <p className="text-sm font-medium truncate">{card.nome}</p>
        {card.setorNome && (
          <p className="text-[10px] text-muted-foreground truncate">{card.setorNome}</p>
        )}
      </div>
      <div className="col-span-2 text-center">
        <p className="text-sm font-semibold text-indigo-600">{card.contratosFechados}</p>
        <p className="text-[10px] text-muted-foreground">fechados</p>
      </div>
      <div className="col-span-2 text-center">
        <p className="text-sm font-semibold text-emerald-600">{card.contratosPagos}</p>
        <p className="text-[10px] text-muted-foreground">pagos</p>
      </div>
      <div className="col-span-3">
        <div className="flex items-baseline gap-1.5 justify-end">
          <ChevronUp
            className={`h-3 w-3 ${
              card.progressoMeta != null && card.progressoMeta >= 100
                ? "text-emerald-500"
                : "text-muted-foreground/40"
            }`}
          />
          <span className="text-sm font-semibold">{formatPercent(card.progressoMeta)}</span>
        </div>
        {card.metaPeriodo && card.metaPeriodo > 0 && (
          <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-1">
            <div
              className={`h-full ${corMeta(card.progressoMeta)}`}
              style={{
                width: `${Math.min(100, Math.max(0, card.progressoMeta ?? 0))}%`,
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

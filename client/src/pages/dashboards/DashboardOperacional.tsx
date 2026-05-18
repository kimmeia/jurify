/**
 * Dashboard OPERACIONAL — pra estagiários, advogados, gestor operacional.
 *
 * - Individual (estagiário/advogado): vê só as próprias tarefas/agenda
 *   classificadas por prazo.
 * - Gestor: vê o card individual + visão da equipe + ranking.
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
import { Progress } from "@/components/ui/progress";
import {
  Briefcase,
  CalendarDays,
  CheckSquare,
  Clock,
  AlertTriangle,
  Trophy,
} from "lucide-react";
import { HeaderPeriodo, formatPercent } from "./common";

export default function DashboardOperacional() {
  const { data, isLoading } = (trpc as any).dashboard.operacional.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Carregando produção…</div>;
  }
  if (!data) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            Sem permissão para ver o painel operacional.
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
            <Briefcase className="h-5 w-5 text-indigo-600" />
            Painel Operacional
          </h2>
          <HeaderPeriodo periodo={data.periodo} />
        </div>
        {data.modo === "gestor" && (
          <Badge variant="secondary" className="text-xs">Visão Gestor</Badge>
        )}
      </div>

      {/* ─── Minha visão ─── */}
      <SecaoMinhaVisao data={data.meu} titulo="Meu Mês" destaque />

      {/* ─── Visão da equipe + ranking (só gestor) ─── */}
      {data.modo === "gestor" && data.equipe && (
        <>
          <SecaoMinhaVisao data={data.equipe} titulo="Equipe — Total do Escritório" />
          {data.ranking && data.ranking.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-amber-500" />
                  Ranking de produção
                </CardTitle>
                <CardDescription className="text-xs">
                  Por colaborador — ordenado por nº de tarefas concluídas no
                  prazo (maior primeiro).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.ranking.map((c: any) => (
                  <LinhaRanking key={c.colaboradorId} card={c} />
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ─── Sub-componentes ─────────────────────────────────────────────────────────

function SecaoMinhaVisao({
  data,
  titulo,
  destaque = false,
}: {
  data: any;
  titulo: string;
  destaque?: boolean;
}) {
  const tarefasConcluidas = data.tarefas.concluidasNoPrazo + data.tarefas.concluidasFora;
  return (
    <Card className={destaque ? "border-indigo-200 bg-indigo-50/30" : ""}>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">{titulo}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Tarefas */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <CheckSquare className="h-4 w-4 text-indigo-600" />
              Tarefas
            </h4>
            {data.taxaNoPrazo != null && (
              <Badge
                variant="outline"
                className={`text-[10px] ${
                  data.taxaNoPrazo >= 90
                    ? "border-emerald-200 text-emerald-700 bg-emerald-50"
                    : data.taxaNoPrazo >= 70
                      ? "border-blue-200 text-blue-700 bg-blue-50"
                      : "border-rose-200 text-rose-700 bg-rose-50"
                }`}
              >
                {formatPercent(data.taxaNoPrazo)} no prazo
              </Badge>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Numerinho
              valor={data.tarefas.noPrazo}
              label="No prazo"
              color="text-blue-600"
              icon={<Clock className="h-3 w-3" />}
            />
            <Numerinho
              valor={data.tarefas.atrasadas}
              label="Atrasadas"
              color="text-rose-600"
              icon={<AlertTriangle className="h-3 w-3" />}
            />
            <Numerinho
              valor={data.tarefas.concluidasNoPrazo}
              label="Concluídas (no prazo)"
              color="text-emerald-600"
              icon={<CheckSquare className="h-3 w-3" />}
            />
            <Numerinho
              valor={data.tarefas.concluidasFora}
              label="Concluídas (fora)"
              color="text-amber-600"
              icon={<CheckSquare className="h-3 w-3" />}
            />
          </div>
          {tarefasConcluidas > 0 && (
            <div className="mt-3">
              <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
                <span>Taxa de conclusão no prazo</span>
                <span>{formatPercent(data.taxaNoPrazo)}</span>
              </div>
              <Progress value={data.taxaNoPrazo ?? 0} className="h-1.5" />
            </div>
          )}
        </div>

        {/* Agenda */}
        <div>
          <h4 className="text-sm font-medium flex items-center gap-2 mb-3">
            <CalendarDays className="h-4 w-4 text-orange-600" />
            Agenda
          </h4>
          <div className="grid grid-cols-3 gap-3">
            <Numerinho
              valor={data.agenda.noPrazo}
              label="No prazo"
              color="text-blue-600"
            />
            <Numerinho
              valor={data.agenda.atrasadas}
              label="Atrasados"
              color="text-rose-600"
            />
            <Numerinho
              valor={data.agenda.concluidas}
              label="Concluídos"
              color="text-emerald-600"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Numerinho({
  valor,
  label,
  color,
  icon,
}: {
  valor: number;
  label: string;
  color: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="text-center p-3 rounded-lg bg-muted/30">
      <p className={`text-2xl font-bold ${color}`}>{valor}</p>
      <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center justify-center gap-1">
        {icon}
        {label}
      </p>
    </div>
  );
}

function LinhaRanking({ card }: { card: any }) {
  return (
    <div className="grid grid-cols-12 gap-2 items-center py-2 px-3 rounded-lg hover:bg-muted/50 transition-colors">
      <div className="col-span-4 min-w-0">
        <p className="text-sm font-medium truncate">{card.nome}</p>
        {card.setorNome && (
          <p className="text-[10px] text-muted-foreground truncate">{card.setorNome}</p>
        )}
      </div>
      <div className="col-span-2 text-center">
        <p className="text-sm font-semibold text-blue-600">{card.tarefas.noPrazo}</p>
        <p className="text-[10px] text-muted-foreground">no prazo</p>
      </div>
      <div className="col-span-2 text-center">
        <p className="text-sm font-semibold text-rose-600">{card.tarefas.atrasadas}</p>
        <p className="text-[10px] text-muted-foreground">atrasadas</p>
      </div>
      <div className="col-span-2 text-center">
        <p className="text-sm font-semibold text-emerald-600">
          {card.tarefas.concluidasNoPrazo}
        </p>
        <p className="text-[10px] text-muted-foreground">concluídas</p>
      </div>
      <div className="col-span-2 text-right">
        <p className="text-sm font-semibold">{formatPercent(card.taxaNoPrazo)}</p>
        <p className="text-[10px] text-muted-foreground">taxa</p>
      </div>
    </div>
  );
}

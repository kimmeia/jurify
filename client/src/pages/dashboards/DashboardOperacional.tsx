/**
 * Dashboard OPERACIONAL — pra setor tipo='operacional'.
 *
 * - Individual: hero (taxa pessoal) + Tarefas + Agenda.
 * - Gestor: hero (taxa do setor) + Meu Mês + Setor Operacional + Ranking.
 */

import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import {
  Briefcase,
  Trophy,
  CheckSquare,
  Calendar,
  User,
  Users,
  AlertTriangle,
  Clock,
  CheckCircle2,
  CircleAlert,
} from "lucide-react";
import {
  Avatar,
  HeroCard,
  MetaPill,
  MiniStat,
  NotaSetor,
  PainelSection,
  corPorPercentual,
  corTextoPercentual,
  formatPercent,
} from "./common";

export default function DashboardOperacional() {
  const { data, isLoading } = (trpc as any).dashboard.operacional.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  if (isLoading) return <SkeletonPainel />;
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

  const isGestor = data.modo === "gestor";
  const heroBase = isGestor ? data.equipe ?? data.meu : data.meu;
  const heroTaxa = heroBase?.taxaNoPrazo ?? 0;
  const tarefasAtrasadas = data.meu?.tarefas?.atrasadas ?? 0;

  // Legenda do hero
  const concluidasNoPrazo = heroBase?.tarefas?.concluidasNoPrazo ?? 0;
  const concluidasFora = heroBase?.tarefas?.concluidasFora ?? 0;
  const atrasadasHero = heroBase?.tarefas?.atrasadas ?? 0;

  return (
    <PainelSection tema="operacional">
      <HeroCard
        tema="operacional"
        setorLabel="Painel Operacional"
        periodo={data.periodo}
        decoracaoIcon={Briefcase}
        badgeDireito={
          tarefasAtrasadas > 0 && !isGestor ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-rose-400/30 text-white border border-rose-300/40">
              <AlertTriangle className="w-3 h-3" />
              {tarefasAtrasadas} atraso{tarefasAtrasadas !== 1 ? "s" : ""} pendente{tarefasAtrasadas !== 1 ? "s" : ""}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-white/15 text-white border border-white/20">
              {isGestor ? <Trophy className="w-3 h-3" /> : <User className="w-3 h-3" />}
              {isGestor ? "Visão Gestor" : "Visão individual"}
            </span>
          )
        }
        tituloPrincipal={
          isGestor
            ? "Taxa de entrega no prazo do setor"
            : "Sua taxa de entrega no prazo"
        }
        valorPrincipal={
          <>
            {heroTaxa != null ? heroTaxa.toFixed(1) : "—"}
            <span className="text-3xl">%</span>
          </>
        }
        legenda={
          <>
            {concluidasNoPrazo} concluídas no prazo · {concluidasFora} fora
            {atrasadasHero > 0 && (
              <>
                {" · "}
                <b className="text-amber-200">{atrasadasHero} em atraso</b>
              </>
            )}
          </>
        }
        ringValue={heroTaxa ?? 0}
        ringSublabel="no prazo"
      />

      {/* Cards Meu + Setor */}
      <div className={`grid gap-4 ${isGestor ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"}`}>
        <CardSecao
          titulo="Meu Mês"
          icone={User}
          iconBg="bg-indigo-50"
          iconFg="text-indigo-600"
          tarefas={data.meu.tarefas}
          agenda={data.meu.agenda}
          taxa={data.meu.taxaNoPrazo}
          destaque
        />
        {isGestor && data.equipe && (
          <CardSecao
            titulo="Setor Operacional"
            icone={Users}
            iconBg="bg-violet-50"
            iconFg="text-violet-600"
            tarefas={data.equipe.tarefas}
            agenda={data.equipe.agenda}
            taxa={data.equipe.taxaNoPrazo}
          />
        )}
      </div>

      {/* Ranking */}
      {isGestor && data.ranking && data.ranking.length > 0 && (
        <Card className="border-slate-200 overflow-hidden">
          <div className="p-5 border-b border-slate-100">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Trophy className="w-4 h-4 text-amber-500" />
              Ranking de produção
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Quem tem atrasos primeiro — atenção urgente.
            </p>
          </div>
          <div className="p-2 divide-y divide-slate-100">
            {data.ranking.map((c: any) => (
              <LinhaRanking key={c.colaboradorId} card={c} />
            ))}
          </div>
          <NotaSetor>
            Apenas usuários do setor <b>Operacional</b> aparecem. Quem é
            comercial, financeiro ou suporte fica fora.
          </NotaSetor>
        </Card>
      )}
    </PainelSection>
  );
}

// ─── Card de seção (Meu Mês / Setor Operacional) ─────────────────────────────

function CardSecao({
  titulo,
  icone: Icone,
  iconBg,
  iconFg,
  tarefas,
  agenda,
  taxa,
  destaque = false,
}: {
  titulo: string;
  icone: typeof User;
  iconBg: string;
  iconFg: string;
  tarefas: any;
  agenda: any;
  taxa: number | null;
  destaque?: boolean;
}) {
  return (
    <Card className={destaque ? "border-indigo-200 bg-indigo-50/20" : "border-slate-200"}>
      <CardContent className="pt-5 pb-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <span className={`w-7 h-7 rounded-lg ${iconBg} flex items-center justify-center`}>
              <Icone className={`w-4 h-4 ${iconFg}`} />
            </span>
            {titulo}
          </h3>
          {taxa != null && (
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${
                taxa >= 90
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : taxa >= 70
                    ? "bg-blue-50 text-blue-700 border-blue-200"
                    : "bg-rose-50 text-rose-700 border-rose-200"
              }`}
            >
              {formatPercent(taxa)} no prazo
            </span>
          )}
        </div>

        {/* Tarefas */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <MiniStat label="Em aberto" value={tarefas.noPrazo} hint="no prazo" tom="blue" />
          <MiniStat label="Atrasadas" value={tarefas.atrasadas} hint="urgente" tom="rose" />
          <MiniStat label="Entregues" value={tarefas.concluidasNoPrazo} hint="no prazo" tom="emerald" />
          <MiniStat label="Atrasou" value={tarefas.concluidasFora} hint="fora" tom="amber" />
        </div>

        <hr className="border-slate-100 my-4" />

        {/* Agenda */}
        <div>
          <p className="text-xs font-semibold text-slate-700 mb-3 flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-slate-500" />
            Agenda
          </p>
          <div className="grid grid-cols-3 gap-2">
            <MiniLabelStat label="No prazo" value={agenda.noPrazo} color="text-blue-600" />
            <MiniLabelStat label="Atrasados" value={agenda.atrasadas} color="text-rose-600" />
            <MiniLabelStat label="Concluídos" value={agenda.concluidas} color="text-emerald-600" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MiniLabelStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="text-center">
      <p className={`text-xl font-bold tracking-tight tabular-nums ${color}`}>{value}</p>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">{label}</p>
    </div>
  );
}

// ─── Linha do ranking ────────────────────────────────────────────────────────

function LinhaRanking({ card }: { card: any }) {
  const taxa = card.taxaNoPrazo;
  const atrasos = card.tarefas.atrasadas;

  const statusIcon =
    atrasos >= 3 ? (
      <span className="w-7 h-7 rounded-full bg-rose-50 text-rose-600 border border-rose-200 font-bold text-xs flex items-center justify-center">
        <CircleAlert className="w-4 h-4" />
      </span>
    ) : atrasos >= 1 ? (
      <span className="w-7 h-7 rounded-full bg-amber-50 text-amber-600 border border-amber-200 font-bold text-xs flex items-center justify-center">
        <Clock className="w-4 h-4" />
      </span>
    ) : (
      <span className="w-7 h-7 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 font-bold text-xs flex items-center justify-center">
        <CheckCircle2 className="w-4 h-4" />
      </span>
    );

  const corPercent = corTextoPercentual(taxa);
  const corBar = corPorPercentual(taxa);

  return (
    <div className="grid grid-cols-[28px_40px_1fr_180px] gap-4 items-center p-3 rounded-xl hover:bg-slate-50/70 transition-colors">
      <div className="flex justify-center">{statusIcon}</div>
      <Avatar nome={card.nome} />
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold truncate">{card.nome}</p>
          {atrasos >= 3 && <MetaPill tom="rose">{atrasos} atrasos</MetaPill>}
          {taxa != null && taxa >= 90 && atrasos === 0 && <MetaPill tom="emerald">TOP</MetaPill>}
          {card.setorNome && <MetaPill tom="slate">{card.setorNome}</MetaPill>}
        </div>
        <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground tabular-nums">
          <span><b className="text-blue-600 font-semibold">{card.tarefas.noPrazo}</b> no prazo</span>
          <span><b className="text-rose-600 font-semibold">{card.tarefas.atrasadas}</b> atrasadas</span>
          <span><b className="text-emerald-600 font-semibold">{card.tarefas.concluidasNoPrazo}</b> entregues no prazo</span>
        </div>
      </div>
      <div>
        <div className="flex items-baseline justify-end gap-1 mb-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Taxa</span>
          <span className={`text-lg font-semibold tabular-nums ${corPercent}`}>
            {formatPercent(taxa)}
          </span>
        </div>
        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full bg-gradient-to-r ${corBar}`}
            style={{ width: `${Math.max(0, Math.min(100, taxa ?? 0))}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function SkeletonPainel() {
  return (
    <div className="space-y-4">
      <div className="h-48 rounded-2xl bg-gradient-to-br from-slate-200 to-slate-100 animate-pulse" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="h-64 rounded-xl bg-slate-100 animate-pulse" />
        <div className="h-64 rounded-xl bg-slate-100 animate-pulse" />
      </div>
    </div>
  );
}

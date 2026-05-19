/**
 * Dashboard COMERCIAL — pra setor tipo='comercial' (SDR, atendente, gestor).
 *
 * Visualmente foca em três indicadores conforme o pedido do produto:
 *   - Contratos fechados (qtd)
 *   - Contratos pagos (qtd)
 *   - % da meta atingido
 *
 * NÃO mostra valores em R$ (faturado, meta em reais, ticket médio).
 * O cálculo do % usa `faturado / metaPeriodo` por baixo dos panos, mas
 * o número absoluto não aparece na UI — alinhado ao briefing.
 *
 * - Individual: hero (% meta) + 3 KPIs.
 * - Gestor: hero (% meta do time) + 3 KPIs do time + ranking.
 */

import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import {
  Handshake,
  CheckCircle2,
  Trophy,
  Target,
  User,
} from "lucide-react";
import {
  Avatar,
  HeroCard,
  KPICard,
  MetaPill,
  NotaSetor,
  PainelSection,
  corPorPercentual,
  corTextoPercentual,
  formatPercent,
} from "./common";

export default function DashboardComercial() {
  const { data, isLoading } = (trpc as any).dashboard.comercial.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  if (isLoading) return <SkeletonPainel />;
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

  const meu = data.meu;
  const ranking = data.ranking ?? [];
  const isGestor = data.modo === "gestor";

  // ── Agregados pro hero do gestor (somatório do setor) ──
  // Faturado é usado pra calcular o % de meta agregado, mas NÃO é exibido.
  const totais = isGestor
    ? ranking.reduce(
        (acc: any, c: any) => ({
          faturado: acc.faturado + c.faturado,
          contratosFechados: acc.contratosFechados + c.contratosFechados,
          contratosPagos: acc.contratosPagos + c.contratosPagos,
          metaPeriodo: acc.metaPeriodo + (c.metaPeriodo ?? 0),
        }),
        { faturado: 0, contratosFechados: 0, contratosPagos: 0, metaPeriodo: 0 },
      )
    : null;
  const progressoTime = totais && totais.metaPeriodo > 0
    ? +((totais.faturado / totais.metaPeriodo) * 100).toFixed(1)
    : null;

  const heroProgresso = isGestor ? progressoTime : meu?.progressoMeta ?? null;
  const fechados = isGestor ? totais!.contratosFechados : meu?.contratosFechados ?? 0;
  const pagos = isGestor ? totais!.contratosPagos : meu?.contratosPagos ?? 0;
  const taxaConversao = fechados > 0
    ? +((pagos / fechados) * 100).toFixed(1)
    : null;
  const temMeta = isGestor
    ? (totais!.metaPeriodo ?? 0) > 0
    : (meu?.metaPeriodo ?? 0) > 0;

  return (
    <PainelSection tema="comercial">
      <HeroCard
        tema="comercial"
        setorLabel="Painel Comercial"
        periodo={data.periodo}
        decoracaoIcon={Handshake}
        badgeDireito={
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-white/15 text-white border border-white/20">
            {isGestor ? <Trophy className="w-3 h-3" /> : <User className="w-3 h-3" />}
            {isGestor ? "Visão Gestor" : "Visão individual"}
          </span>
        }
        tituloPrincipal={
          isGestor ? "Progresso da meta do time" : "Progresso da sua meta"
        }
        valorPrincipal={
          temMeta ? (
            <>
              {(heroProgresso ?? 0).toFixed(1)}
              <span className="text-3xl">%</span>
            </>
          ) : (
            <span className="text-3xl">Sem meta</span>
          )
        }
        legenda={
          <>
            <b className="text-white">{fechados}</b> contrato{fechados !== 1 ? "s" : ""} fechado{fechados !== 1 ? "s" : ""}
            {" · "}
            <b className="text-white">{pagos}</b> pago{pagos !== 1 ? "s" : ""}
            {taxaConversao != null && (
              <>
                {" · "}
                <span className="text-emerald-200 font-medium">
                  {formatPercent(taxaConversao, 0)} de conversão
                </span>
              </>
            )}
          </>
        }
        progresso={
          temMeta
            ? {
                valor: heroProgresso ?? 0,
                labelDir: (
                  <span className="font-semibold text-white tabular-nums">
                    {formatPercent(heroProgresso)}
                  </span>
                ),
              }
            : undefined
        }
        ringValue={temMeta ? (heroProgresso ?? 0) : undefined}
        ringLabel={
          temMeta && heroProgresso != null ? (
            <>
              {Math.round(heroProgresso)}
              <span className="text-xl">%</span>
            </>
          ) : undefined
        }
        ringSublabel="da meta"
      />

      {/* 3 KPIs: fechados · pagos · % meta */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KPICard
          label="Contratos fechados"
          value={fechados}
          icon={Handshake}
          iconBg="bg-indigo-50"
          iconFg="text-indigo-600"
        />
        <KPICard
          label="Contratos pagos"
          value={pagos}
          icon={CheckCircle2}
          iconBg="bg-emerald-50"
          iconFg="text-emerald-600"
          badge={
            taxaConversao != null ? (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700">
                {formatPercent(taxaConversao, 0)} conv
              </span>
            ) : undefined
          }
        />
        <KPICard
          label="% da meta"
          value={temMeta ? formatPercent(heroProgresso) : "—"}
          valueColor={corTextoPercentual(heroProgresso)}
          icon={Target}
          iconBg="bg-amber-50"
          iconFg="text-amber-600"
          hint={
            !temMeta
              ? "Configure a meta mensal do colaborador em Configurações → Equipe."
              : undefined
          }
        />
      </div>

      {/* Ranking (só gestor) */}
      {isGestor && ranking.length > 0 && (
        <Card className="border-slate-200 overflow-hidden p-0">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Trophy className="w-4 h-4 text-amber-500" />
                Ranking do time comercial
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {ranking.length} colaborador(es) do setor — ordenado por % da meta
              </p>
            </div>
          </div>
          <div className="p-2 divide-y divide-slate-100">
            {[...ranking]
              .sort((a: any, b: any) => {
                // Quem tem meta primeiro; dentro disso, maior % primeiro
                const pa = a.progressoMeta ?? -1;
                const pb = b.progressoMeta ?? -1;
                if (pa === pb) return b.contratosPagos - a.contratosPagos;
                return pb - pa;
              })
              .map((c: any, i: number) => (
                <LinhaRanking key={c.atendenteId} colocacao={i + 1} card={c} />
              ))}
          </div>
          <NotaSetor>
            Apenas usuários do setor <b>Comercial</b> aparecem aqui — quem é
            operacional, financeiro ou suporte fica fora.
          </NotaSetor>
        </Card>
      )}
    </PainelSection>
  );
}

// ─── Linha do ranking ────────────────────────────────────────────────────────

function LinhaRanking({ colocacao, card }: { colocacao: number; card: any }) {
  const pillCol =
    colocacao === 1
      ? "bg-gradient-to-br from-amber-200 to-yellow-400 text-amber-900"
      : colocacao === 2
        ? "bg-gradient-to-br from-slate-200 to-slate-400 text-slate-700"
        : colocacao === 3
          ? "bg-gradient-to-br from-orange-200 to-orange-400 text-orange-900"
          : "bg-slate-100 text-slate-500";

  const progresso = card.progressoMeta;
  const temMeta = card.metaPeriodo != null && card.metaPeriodo > 0;
  const corBar = corPorPercentual(progresso);
  const corPercent = corTextoPercentual(progresso);

  return (
    <div className="grid grid-cols-[28px_40px_1fr_180px] gap-4 items-center p-3 rounded-xl hover:bg-slate-50/70 transition-colors">
      <div className="flex justify-center">
        <div className={`w-7 h-7 rounded-full ${pillCol} font-bold text-xs flex items-center justify-center shadow-sm`}>
          {colocacao}
        </div>
      </div>
      <Avatar nome={card.nome} />
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold truncate">{card.nome}</p>
          {colocacao === 1 && progresso != null && progresso >= 100 && (
            <MetaPill tom="amber">TOP</MetaPill>
          )}
          {progresso != null && progresso >= 100 && colocacao !== 1 && (
            <MetaPill tom="emerald">META</MetaPill>
          )}
          {temMeta && progresso != null && progresso < 40 && (
            <MetaPill tom="rose">ATENÇÃO</MetaPill>
          )}
          {!temMeta && <MetaPill tom="slate">SEM META</MetaPill>}
        </div>
        <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground tabular-nums">
          <span><b className="text-indigo-600 font-semibold">{card.contratosFechados}</b> fechados</span>
          <span><b className="text-emerald-600 font-semibold">{card.contratosPagos}</b> pagos</span>
        </div>
      </div>
      <div>
        <div className="flex items-baseline justify-end gap-1 mb-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Meta</span>
          <span className={`text-lg font-semibold tabular-nums ${corPercent}`}>
            {temMeta ? formatPercent(progresso) : "—"}
          </span>
        </div>
        {temMeta && (
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full bg-gradient-to-r ${corBar}`}
              style={{ width: `${Math.max(0, Math.min(100, progresso ?? 0))}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function SkeletonPainel() {
  return (
    <div className="space-y-4">
      <div className="h-48 rounded-2xl bg-gradient-to-br from-slate-200 to-slate-100 animate-pulse" />
      <div className="grid grid-cols-3 gap-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-xl bg-slate-100 animate-pulse" />
        ))}
      </div>
    </div>
  );
}

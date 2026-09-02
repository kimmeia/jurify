import { trpc } from "@/lib/trpc";
import { Zap, Activity, CheckCircle2, Clock, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

function formatTempo(seg: number): string {
  if (seg <= 0) return "—";
  if (seg < 60) return `${seg}s`;
  if (seg < 3600) return `${Math.round(seg / 60)}min`;
  return `${(seg / 3600).toFixed(1)}h`;
}

export function SmartFlowHero({
  onNovoCenario,
}: {
  onNovoCenario: () => void;
}) {
  const { data } = (trpc as any).smartflow.metricasResumo.useQuery(undefined, {
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  return (
    <div
      className="relative overflow-hidden rounded-2xl p-5 border"
      style={{
        background:
          "color-mix(in oklab, var(--primary) 7%, transparent)",
        borderColor: "rgba(139,92,246,0.18)",
      }}
    >
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="w-11 h-11 rounded-xl bg-info flex items-center justify-center shadow-md">
          <Zap className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">SmartFlow</h1>
          <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-0.5">
            <Sparkles className="h-3 w-3 text-info" />
            <span>Automações inteligentes · WhatsApp · Asaas · Agenda</span>
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            size="sm"
            onClick={onNovoCenario}
            className="bg-info shadow-md"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Novo cenário
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <KpiCard
          icon={<Zap className="h-4 w-4" />}
          cor="violet"
          valor={data?.cenariosAtivos ?? 0}
          label="Cenários ativos"
        />
        <KpiCard
          icon={<Activity className="h-4 w-4" />}
          cor="emerald"
          valor={data?.execucoes30d ?? 0}
          label="Execuções · 30d"
        />
        <KpiCard
          icon={<CheckCircle2 className="h-4 w-4" />}
          cor="amber"
          valor={`${data?.taxaSucessoPct ?? 0}%`}
          label="Taxa de sucesso"
        />
        <KpiCard
          icon={<Clock className="h-4 w-4" />}
          cor="fuchsia"
          valor={formatTempo(data?.tempoMedioSeg ?? 0)}
          label="Tempo médio · execução"
        />
      </div>
    </div>
  );
}

function KpiCard({
  icon,
  cor,
  valor,
  label,
}: {
  icon: React.ReactNode;
  cor: "violet" | "emerald" | "amber" | "fuchsia";
  valor: number | string;
  label: string;
}) {
  const cores = {
    violet: { bg: "bg-info-bg", text: "text-info-fg" },
    emerald: { bg: "bg-success-bg", text: "text-success-fg" },
    amber: { bg: "bg-warning-bg", text: "text-warning-fg" },
    fuchsia: { bg: "bg-danger-bg", text: "text-danger-fg" },
  } as const;
  const c = cores[cor];
  return (
    <div className="bg-card rounded-xl border border-border/60 px-3 py-2.5 flex items-center gap-2.5">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${c.bg} ${c.text}`}>
        {icon}
      </div>
      <div className="leading-tight min-w-0">
        <p className={`text-base font-bold leading-none tabular-nums truncate ${c.text}`}>{valor}</p>
        <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wide mt-1">{label}</p>
      </div>
    </div>
  );
}

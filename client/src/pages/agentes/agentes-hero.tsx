import { trpc } from "@/lib/trpc";
import { Bot, MessageSquare, Zap, DollarSign, Plus, BrainCircuit, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

function formatNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}
function formatBRL(cent: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cent / 100);
}

/**
 * Hero card com KPIs do módulo Agentes IA — substitui o header simples,
 * mostrando de cara o uso e custo no escritório (transparência + saúde
 * de cost guard).
 */
export function AgentesHero({ onNovo }: { onNovo: () => void }) {
  const { data } = trpc.agentesIa.metricasResumo.useQuery(undefined, {
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  return (
    <div
      className="relative overflow-hidden rounded-2xl p-5 border"
      style={{
        background:
          "linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(139,92,246,0.08) 50%, rgba(236,72,153,0.06) 100%)",
        borderColor: "rgba(139,92,246,0.18)",
      }}
    >
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-600 via-indigo-600 to-blue-600 flex items-center justify-center shadow-md">
          <BrainCircuit className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Agentes de IA</h1>
          <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-0.5">
            <Sparkles className="h-3 w-3 text-violet-500" />
            <span>Templates prontos · Agentes do escritório · Analytics em tempo real</span>
          </p>
        </div>
        <Button
          size="sm"
          onClick={onNovo}
          className="bg-gradient-to-br from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 shadow-md"
        >
          <Plus className="h-4 w-4 mr-1.5" />
          Novo agente
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <KpiCard
          icon={<Bot className="h-4 w-4" />}
          cor="violet"
          valor={data?.ativos ?? 0}
          label="Ativos"
        />
        <KpiCard
          icon={<MessageSquare className="h-4 w-4" />}
          cor="emerald"
          valor={data?.conversasMes ?? 0}
          label="Conversas · 30d"
        />
        <KpiCard
          icon={<Zap className="h-4 w-4" />}
          cor="amber"
          valor={formatNum(data?.tokensMes ?? 0)}
          label="Tokens · 30d"
        />
        <KpiCard
          icon={<DollarSign className="h-4 w-4" />}
          cor="fuchsia"
          valor={formatBRL(data?.custoEstimadoCent ?? 0)}
          label="Custo estimado · 30d"
        />
      </div>
    </div>
  );
}

function KpiCard({
  icon, cor, valor, label,
}: {
  icon: React.ReactNode;
  cor: "violet" | "emerald" | "amber" | "fuchsia";
  valor: number | string;
  label: string;
}) {
  const cores = {
    violet: { bg: "bg-violet-100 dark:bg-violet-950/40", text: "text-violet-700 dark:text-violet-300" },
    emerald: { bg: "bg-emerald-100 dark:bg-emerald-950/40", text: "text-emerald-700 dark:text-emerald-300" },
    amber: { bg: "bg-amber-100 dark:bg-amber-950/40", text: "text-amber-700 dark:text-amber-300" },
    fuchsia: { bg: "bg-fuchsia-100 dark:bg-fuchsia-950/40", text: "text-fuchsia-700 dark:text-fuchsia-300" },
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

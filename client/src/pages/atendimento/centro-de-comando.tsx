import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  Clock,
  CheckCircle,
  Inbox,
  Plus,
  Sparkles,
  Shield,
  Search,
  ChevronRight,
} from "lucide-react";
import type { StatusConversa } from "@shared/crm-types";

type Conv = {
  id: number;
  contatoId: number | null;
  contatoNome?: string | null;
  status?: StatusConversa;
  ultimaMensagemAt?: string | null;
  ultimaMensagemPreview?: string | null;
  naoLidas?: number;
  temAtraso?: boolean;
};

const AVATAR_GRADIENTS = [
  "from-violet-500 to-pink-500",
  "from-blue-500 to-cyan-500",
  "from-amber-500 to-red-500",
  "from-emerald-500 to-teal-600",
  "from-indigo-500 to-violet-500",
  "from-pink-500 to-rose-500",
  "from-teal-500 to-emerald-500",
];
function gradientFromName(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h) + name.charCodeAt(i);
  return AVATAR_GRADIENTS[Math.abs(h) % AVATAR_GRADIENTS.length];
}
function initials(n: string) { return n.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase(); }

function saudacao(): string {
  const h = new Date().getHours();
  if (h < 6) return "Boa madrugada";
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

/**
 * Centro de Comando — substitui a tela vazia "selecione uma conversa".
 *
 * Mostra ao atendente, assim que ele abre o módulo:
 *  - Saudação personalizada
 *  - 4 KPIs do dia (aguardando · SLA crítico · tempo médio · resolvidas hoje)
 *  - Top 3 conversas que precisam de atenção AGORA (com razão)
 *  - Atalhos visuais (⌘K · / · features ativas)
 */
export function CentroDeComando({
  convs,
  onAbrirConversa,
  onIniciar,
}: {
  convs: Conv[];
  onAbrirConversa: (id: number) => void;
  onIniciar: () => void;
}) {
  const { data: me } = trpc.auth.me.useQuery(undefined, { staleTime: 60_000 });
  const primeiroNome = ((me as any)?.name || "").split(" ")[0] || "";

  const { data: metricas } = trpc.crm.metricasDetalhadas.useQuery(undefined, {
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  // Prioridade: SLA crítico primeiro, depois aguardando há mais tempo
  const prioritarias = [...convs]
    .filter((c) => c.status === "aguardando" || c.status === "em_atendimento")
    .sort((a, b) => {
      if (a.temAtraso && !b.temAtraso) return -1;
      if (!a.temAtraso && b.temAtraso) return 1;
      const ta = a.ultimaMensagemAt ? new Date(a.ultimaMensagemAt).getTime() : 0;
      const tb = b.ultimaMensagemAt ? new Date(b.ultimaMensagemAt).getTime() : 0;
      return ta - tb;
    })
    .slice(0, 3);

  const aguardando = convs.filter((c) => c.status === "aguardando").length;
  const slaCritico = convs.filter((c) => c.temAtraso).length;

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      <div className="p-6 space-y-5 max-w-3xl mx-auto w-full">

        {/* SAUDAÇÃO + KPIs */}
        <div
          className="relative overflow-hidden rounded-2xl p-5 border"
          style={{
            background:
              "linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(139,92,246,0.08) 50%, rgba(236,72,153,0.06) 100%)",
            borderColor: "rgba(139,92,246,0.18)",
          }}
        >
          <h2 className="text-xl font-bold tracking-tight">
            {saudacao()}{primeiroNome ? `, ${primeiroNome}` : ""}! ☀️
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Você tem <strong className="text-foreground">{convs.length}</strong> conversa{convs.length === 1 ? "" : "s"}
            {aguardando > 0 && <> · <strong className="text-amber-600">{aguardando} aguardando</strong></>}
            {slaCritico > 0 && <> · <strong className="text-red-600">{slaCritico} com SLA crítico</strong></>}
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
            <KpiCard
              icon={<Clock className="h-4 w-4" />}
              cor="amber"
              valor={aguardando}
              label="Aguardando"
            />
            <KpiCard
              icon={<AlertTriangle className="h-4 w-4" />}
              cor="rose"
              valor={slaCritico}
              label="SLA crítico"
            />
            <KpiCard
              icon={<Clock className="h-4 w-4" />}
              cor="violet"
              valor={metricas?.tempoMedioResposta ? `${metricas.tempoMedioResposta}min` : "—"}
              label="Tempo médio"
            />
            <KpiCard
              icon={<CheckCircle className="h-4 w-4" />}
              cor="emerald"
              valor={metricas?.resolvidasHoje ?? 0}
              label="Resolvidas hoje"
            />
          </div>
        </div>

        {/* PRECISAM DE ATENÇÃO */}
        {prioritarias.length > 0 && (
          <div>
            <SectionTitle icon="🚨">Precisam de atenção agora</SectionTitle>
            <div className="space-y-1.5">
              {prioritarias.map((c) => (
                <PriorityRow
                  key={c.id}
                  conv={c}
                  onClick={() => onAbrirConversa(c.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* AÇÕES E ATALHOS */}
        <div>
          <SectionTitle icon="⌨️">Atalhos rápidos</SectionTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={onIniciar}
              className="bg-gradient-to-br from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 shadow-sm"
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> Nova conversa
            </Button>
            <ShortcutPill icon={<Search className="h-3 w-3" />} label="Buscar tudo" kbd="⌘ K" />
            <ShortcutPill icon="/" label="Respostas rápidas" />
            <ShortcutPill icon={<Sparkles className="h-3 w-3 text-violet-500" />} label="Brief Instantâneo (auto)" />
            <ShortcutPill icon={<Shield className="h-3 w-3 text-rose-500" />} label="Compliance Guard (auto)" />
          </div>
        </div>

        {/* Empty state se NÃO tem conversa alguma */}
        {convs.length === 0 && (
          <div className="text-center py-8">
            <div className="h-16 w-16 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-3">
              <Inbox className="h-8 w-8 text-muted-foreground/30" />
            </div>
            <p className="text-sm text-muted-foreground mb-3">Nenhuma conversa ainda. Comece iniciando a primeira.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function KpiCard({
  icon, cor, valor, label,
}: {
  icon: React.ReactNode;
  cor: "amber" | "rose" | "violet" | "emerald";
  valor: number | string;
  label: string;
}) {
  const corMap = {
    amber: { bg: "bg-amber-100", text: "text-amber-700", valor: "text-amber-700" },
    rose: { bg: "bg-rose-100", text: "text-rose-700", valor: "text-rose-700" },
    violet: { bg: "bg-violet-100", text: "text-violet-700", valor: "text-violet-700" },
    emerald: { bg: "bg-emerald-100", text: "text-emerald-700", valor: "text-emerald-700" },
  } as const;
  const c = corMap[cor];
  return (
    <div className="bg-background rounded-xl border border-border/60 px-3 py-2.5 flex items-center gap-2.5">
      <div className={"w-8 h-8 rounded-lg flex items-center justify-center " + c.bg + " " + c.text}>
        {icon}
      </div>
      <div className="leading-tight">
        <p className={"text-base font-bold leading-none tabular-nums " + c.valor}>{valor}</p>
        <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wide mt-1">{label}</p>
      </div>
    </div>
  );
}

function SectionTitle({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5 mb-2">
      <span>{icon}</span> {children}
    </h3>
  );
}

function PriorityRow({ conv, onClick }: { conv: Conv; onClick: () => void }) {
  const nome = conv.contatoNome || "Cliente";
  const corBorda = conv.temAtraso ? "border-l-rose-500" : "border-l-amber-500";
  const razao = conv.temAtraso
    ? <span className="text-red-700 font-semibold">⏰ SLA crítico</span>
    : <span className="text-amber-700">Aguardando resposta</span>;
  return (
    <button
      onClick={onClick}
      className={
        "w-full text-left bg-background rounded-xl border border-border " + corBorda + " border-l-4 px-3 py-2.5 flex items-center gap-3 hover:shadow-md hover:-translate-y-0.5 transition-all"
      }
    >
      <div className={"w-9 h-9 rounded-lg flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0 bg-gradient-to-br " + gradientFromName(nome)}>
        {initials(nome)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">{nome}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
          {razao}
          {conv.ultimaMensagemPreview ? <> · {conv.ultimaMensagemPreview.slice(0, 80)}</> : null}
        </p>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
    </button>
  );
}

function ShortcutPill({
  icon, label, kbd,
}: {
  icon: React.ReactNode | string;
  label: string;
  kbd?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-background border border-border text-xs">
      {kbd && (
        <kbd className="font-mono text-[10px] px-1 py-0.5 rounded bg-muted/50 border border-border/60">
          {kbd}
        </kbd>
      )}
      {typeof icon === "string"
        ? <span className="font-mono text-violet-600 font-bold">{icon}</span>
        : icon}
      <span className="text-foreground/80">{label}</span>
    </span>
  );
}

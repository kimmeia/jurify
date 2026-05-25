/**
 * Hero da Landing Page (Direção A — Light Premium).
 *
 * Headline centrada + 2 CTAs + screenshot fiel do Dashboard Geral
 * (sidebar real + painel com KPIs, fluxo de caixa e atividade).
 */

import { Button } from "@/components/ui/button";
import {
  Sparkles,
  ArrowRight,
  LayoutDashboard,
  Calculator,
  Users,
  FileText,
  CalendarDays,
  FileSearch,
  Headphones,
  BrainCircuit,
  Zap,
  BarChart3,
  DollarSign,
  Clock,
  AlertTriangle,
  Target,
  TrendingUp,
  MessageCircle,
  Activity,
} from "lucide-react";

interface Props {
  onCta: (modo: "login" | "signup") => void;
}

export function Hero({ onCta }: Props) {
  return (
    <section className="relative overflow-hidden">
      {/* Glow violeta sutil atrás do hero */}
      <div className="pointer-events-none absolute left-1/2 top-[-120px] h-[420px] w-[760px] -translate-x-1/2 rounded-full bg-violet-500/15 blur-3xl" />

      <div className="relative mx-auto max-w-6xl px-4 pt-16 pb-2 text-center lg:pt-24">
        <span className="inline-flex items-center gap-2 rounded-full bg-violet-100 px-3.5 py-1.5 text-sm font-semibold text-violet-700">
          <Sparkles className="h-4 w-4" />
          O sistema operacional do escritório moderno
        </span>

        <h1 className="font-display mx-auto mt-6 max-w-4xl text-4xl font-extrabold leading-[1.05] tracking-tight text-[#0f1115] md:text-5xl lg:text-[55px]">
          Todo o seu escritório{" "}
          <span className="whitespace-nowrap bg-gradient-to-r from-violet-600 to-violet-500 bg-clip-text text-transparent">
            num só lugar
          </span>
          .
          <br />
          Do primeiro contato ao recebimento.
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground md:text-xl">
          CRM, atendimento no WhatsApp, contratos automáticos, financeiro com Asaas,
          comissões, processos e cálculos jurídicos. Integrados de verdade — não 5
          ferramentas remendadas.
        </p>

        <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
          <Button
            size="lg"
            className="bg-violet-600 px-8 text-base shadow-lg shadow-violet-600/25 hover:bg-violet-700"
            onClick={() => onCta("signup")}
          >
            Começar grátis
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="px-8 text-base"
            onClick={() => document.getElementById("demo")?.scrollIntoView({ behavior: "smooth" })}
          >
            Ver demonstração
          </Button>
        </div>

        <p className="mt-4 text-sm text-muted-foreground">
          <strong className="text-foreground">14 dias grátis</strong> em qualquer plano · Sem
          cartão de crédito · Configura em 5 minutos
        </p>
      </div>

      {/* Screenshot do Dashboard */}
      <div className="relative mx-auto mt-12 max-w-5xl px-4 pb-4">
        <div className="absolute inset-x-16 top-10 -bottom-8 -z-10 rounded-[40px] bg-violet-500/20 blur-3xl" />
        <DashboardMockup />
      </div>
    </section>
  );
}

/* ─── Screenshot fiel do Dashboard Geral ──────────────────────────────── */

const NAV_ITEMS: { icon: React.ComponentType<{ className?: string }>; label: string; active?: boolean }[] = [
  { icon: LayoutDashboard, label: "Dashboard", active: true },
  { icon: Calculator, label: "Cálculos" },
  { icon: Users, label: "Clientes" },
  { icon: FileText, label: "Modelos" },
  { icon: CalendarDays, label: "Agenda" },
  { icon: FileSearch, label: "Processos" },
  { icon: Headphones, label: "Atendimento" },
  { icon: BrainCircuit, label: "Agentes IA" },
  { icon: Zap, label: "SmartFlow" },
  { icon: BarChart3, label: "Relatórios" },
  { icon: DollarSign, label: "Financeiro" },
];

function DashboardMockup() {
  return (
    <div className="overflow-hidden rounded-2xl border bg-white shadow-2xl">
      {/* Browser chrome */}
      <div className="flex h-9 items-center gap-2 border-b bg-slate-100 px-4">
        <span className="flex gap-1.5">
          <i className="h-2.5 w-2.5 rounded-full bg-red-400" />
          <i className="h-2.5 w-2.5 rounded-full bg-amber-400" />
          <i className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        </span>
        <span className="flex-1 text-center font-mono text-[11px] text-slate-400">
          app.juridflow.com.br/dashboard
        </span>
      </div>

      <div className="flex min-h-[460px] bg-[#fafaff]">
        {/* Sidebar */}
        <aside className="hidden w-[200px] shrink-0 flex-col border-r bg-white p-3 sm:flex">
          <div className="mb-3 flex items-center gap-2.5 border-b pb-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-violet-400 text-xs font-bold text-white">
              SA
            </div>
            <div className="leading-tight">
              <div className="text-[13px] font-bold text-slate-900">Silva &amp; Associados</div>
              <div className="text-[10px] text-slate-400">Escritório</div>
            </div>
          </div>
          <nav className="flex flex-col gap-0.5">
            {NAV_ITEMS.map((item) => (
              <span
                key={item.label}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] font-medium ${
                  item.active ? "bg-violet-100 font-semibold text-violet-700" : "text-slate-600"
                }`}
              >
                <item.icon className={`h-4 w-4 ${item.active ? "text-violet-600" : "text-slate-400"}`} />
                {item.label}
              </span>
            ))}
          </nav>
        </aside>

        {/* Conteúdo */}
        <div className="min-w-0 flex-1">
          {/* Band */}
          <div className="bg-gradient-to-br from-slate-800 via-slate-700 to-indigo-700 px-6 py-5 text-white">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-display text-lg font-bold">Painel Geral — Outubro</div>
                <div className="mt-0.5 text-[11.5px] text-white/75">
                  1 out — 31 out 2026 · Ver outros períodos →
                </div>
              </div>
              <BarChart3 className="h-7 w-7 text-white/60" />
            </div>
            <div className="mt-3.5 flex flex-wrap gap-2 text-[10.5px] font-semibold">
              <span className="flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1">
                <i className="h-1.5 w-1.5 rounded-full bg-red-300" /> 3 movimentações novas
              </span>
              <span className="flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1">
                <i className="h-1.5 w-1.5 rounded-full bg-amber-300" /> 2 cobranças atrasadas
              </span>
              <span className="flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1">
                <i className="h-1.5 w-1.5 rounded-full bg-blue-300" /> 1 conversa aguardando
              </span>
            </div>
          </div>

          {/* KPIs + cards */}
          <div className="space-y-3.5 p-5">
            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              <Kpi icon={DollarSign} accent="emerald" label="Recebido" valor="R$ 47.350" sub="no período" />
              <Kpi icon={Clock} accent="blue" label="A receber" valor="R$ 12.100" sub="em dia" />
              <Kpi icon={AlertTriangle} accent="rose" label="Vencido" valor="R$ 1.800" sub="3,7% inadimplência" />
              <Kpi icon={Target} accent="violet" label="Pipeline" valor="R$ 89.400" sub="14 leads" />
            </div>

            <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
              <div className="rounded-xl border bg-white p-3.5">
                <div className="mb-2.5 flex items-center gap-2 text-xs font-bold">
                  <BarChart3 className="h-3.5 w-3.5 text-violet-600" />
                  Fluxo de caixa — recebido por dia
                </div>
                <div className="flex h-[70px] items-end gap-1.5">
                  {[42, 58, 35, 70, 52, 88, 64, 95, 78, 60, 82, 100, 71, 90].map((h, i) => (
                    <div
                      key={i}
                      className="flex-1 rounded-sm bg-gradient-to-t from-violet-600 to-violet-400"
                      style={{ height: `${h}%` }}
                    />
                  ))}
                </div>
              </div>

              <div className="rounded-xl border bg-white p-3.5">
                <div className="mb-2.5 flex items-center gap-2 text-xs font-bold">
                  <Activity className="h-3.5 w-3.5 text-violet-600" />
                  Atividade recente
                </div>
                <div className="space-y-2.5">
                  <ActivityRow icon={DollarSign} accent="emerald" titulo="Maria S. pagou R$ 1.500" desc="Pix via Asaas · há 8 min" />
                  <ActivityRow icon={MessageCircle} accent="blue" titulo="Nova conversa no WhatsApp" desc="Carlos M. · há 21 min" />
                  <ActivityRow icon={FileSearch} accent="violet" titulo="Movimentação no proc. 0801…" desc="TJCE · Despacho · há 1 h" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const ACCENT: Record<string, { box: string; icon: string; val: string }> = {
  emerald: { box: "bg-emerald-50", icon: "text-emerald-600", val: "text-emerald-600" },
  blue: { box: "bg-blue-50", icon: "text-blue-600", val: "text-blue-600" },
  rose: { box: "bg-rose-50", icon: "text-rose-600", val: "text-rose-600" },
  violet: { box: "bg-violet-100", icon: "text-violet-600", val: "text-violet-600" },
};

function Kpi({
  icon: Icon,
  accent,
  label,
  valor,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  accent: keyof typeof ACCENT;
  label: string;
  valor: string;
  sub: string;
}) {
  const c = ACCENT[accent];
  return (
    <div className="rounded-xl border bg-white p-3">
      <div className={`mb-2 flex h-7 w-7 items-center justify-center rounded-md ${c.box}`}>
        <Icon className={`h-4 w-4 ${c.icon}`} />
      </div>
      <div className="text-[9.5px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-lg font-extrabold tabular-nums ${c.val}`}>{valor}</div>
      <div className="text-[10px] text-slate-400">{sub}</div>
    </div>
  );
}

function ActivityRow({
  icon: Icon,
  accent,
  titulo,
  desc,
}: {
  icon: React.ComponentType<{ className?: string }>;
  accent: keyof typeof ACCENT;
  titulo: string;
  desc: string;
}) {
  const c = ACCENT[accent];
  return (
    <div className="flex items-center gap-2.5">
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${c.box}`}>
        <Icon className={`h-3 w-3 ${c.icon}`} />
      </span>
      <div className="min-w-0">
        <div className="truncate text-[11px] font-semibold text-slate-800">{titulo}</div>
        <div className="text-[9.5px] text-slate-400">{desc}</div>
      </div>
    </div>
  );
}

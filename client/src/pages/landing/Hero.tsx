/**
 * Hero da Landing Page (Direção Híbrida — dark cinematográfico).
 *
 * Fundo escuro com aurora, headline em gradiente, CTAs e um screenshot
 * fiel do Dashboard Geral numa moldura de vidro com glow, cercado por
 * cards flutuantes (Pix recebido, WhatsApp, comissão) que respiram.
 */

import { motion } from "framer-motion";
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
  MessageCircle,
  Activity,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Aurora, CountUp } from "./lpkit";

interface Props {
  onCta: (modo: "login" | "signup") => void;
}

const ease = [0.22, 1, 0.36, 1] as const;

export function Hero({ onCta }: Props) {
  return (
    <section className="relative overflow-hidden bg-[#07060f] pt-28 pb-24 text-center lg:pt-36">
      <div
        className="absolute inset-0 z-0"
        style={{ background: "radial-gradient(120% 90% at 50% -10%, #1a1140 0%, #0d0a1c 45%, #07060f 100%)" }}
      />
      <Aurora className="z-0" intensity={0.85} />
      <div
        className="absolute inset-0 z-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.04) 1px, transparent 1px)",
          backgroundSize: "54px 54px",
          maskImage: "radial-gradient(110% 80% at 50% 0%, #000 30%, transparent 75%)",
          WebkitMaskImage: "radial-gradient(110% 80% at 50% 0%, #000 30%, transparent 75%)",
        }}
      />

      <div className="relative z-10 mx-auto max-w-6xl px-4">
        <motion.span
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease }}
          className="inline-flex items-center gap-2 rounded-full border border-violet-400/30 bg-violet-500/15 px-4 py-1.5 text-sm font-semibold text-violet-200 shadow-[0_0_30px_-8px_rgba(124,58,237,0.6)]"
        >
          <Sparkles className="h-4 w-4" />
          O sistema operacional do escritório moderno
        </motion.span>

        <motion.h1
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, delay: 0.08, ease }}
          className="font-display mx-auto mt-6 max-w-4xl text-4xl font-extrabold leading-[1.04] tracking-tight text-white md:text-5xl lg:text-[58px]"
        >
          Todo o seu escritório{" "}
          <span className="bg-gradient-to-r from-violet-300 via-fuchsia-300 to-fuchsia-400 bg-clip-text text-transparent">
            num só lugar
          </span>
          .
          <br />
          Do primeiro contato ao recebimento.
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, delay: 0.16, ease }}
          className="mx-auto mt-6 max-w-2xl text-lg text-violet-100/70 md:text-xl"
        >
          CRM, atendimento no WhatsApp, contratos automáticos, financeiro com Asaas, comissões,
          processos e cálculos jurídicos. Integrados de verdade — não 5 ferramentas remendadas.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, delay: 0.24, ease }}
          className="mt-9 flex flex-col justify-center gap-3 sm:flex-row"
        >
          <Button
            size="lg"
            onClick={() => onCta("signup")}
            className="border-0 bg-gradient-to-r from-violet-600 to-purple-600 px-8 text-base text-white shadow-[0_12px_40px_-8px_rgba(147,51,234,0.8)] hover:from-violet-500 hover:to-purple-500"
          >
            Começar grátis
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={() => document.getElementById("smartflow")?.scrollIntoView({ behavior: "smooth" })}
            className="border-white/20 bg-white/10 px-8 text-base text-white backdrop-blur hover:bg-white/20 hover:text-white"
          >
            Ver demonstração
          </Button>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.65, delay: 0.34, ease }}
          className="mt-4 text-sm text-violet-100/60"
        >
          <strong className="text-white">14 dias grátis</strong> em qualquer plano · Sem cartão de
          crédito · Configura em 5 minutos
        </motion.p>
      </div>

      {/* Stage: dashboard + floats */}
      <motion.div
        initial={{ opacity: 0, y: 48, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.9, delay: 0.3, ease }}
        className="relative z-10 mx-auto mt-14 max-w-5xl px-4"
      >
        <div
          className="absolute inset-x-12 -bottom-10 top-8 -z-10 rounded-[40px] blur-3xl"
          style={{ background: "radial-gradient(ellipse at center, rgba(124,58,237,.55), transparent 66%)" }}
        />

        {/* floats */}
        <FloatCard className="-left-6 top-[14%] lg:-left-12" tone="emerald" icon={DollarSign} title="+ R$ 1.500 recebido" sub="Pix · Maria S. · agora" />
        <FloatCard className="-right-4 top-[4%] lg:-right-10" tone="wa" icon={MessageCircle} title="Nova mensagem" sub="WhatsApp · Carlos M." delay={0.4} />
        <FloatCard className="-right-2 bottom-[10%] lg:-right-8" tone="violet" icon={Check} title="Comissão lançada" sub="R$ 225 · Ana (atendente)" delay={0.8} />

        <div className="rounded-2xl border border-white/14 bg-gradient-to-b from-white/15 to-white/5 p-2 shadow-[0_50px_100px_-30px_rgba(0,0,0,0.7)]">
          <DashboardMockup />
        </div>
      </motion.div>
    </section>
  );
}

/* ---------- Floating card ---------- */
const FLOAT_TONE: Record<string, string> = {
  emerald: "bg-emerald-500/20 text-emerald-300",
  wa: "bg-[#25d366] text-white",
  violet: "bg-violet-500/25 text-violet-200",
};

function FloatCard({
  className,
  tone,
  icon: Icon,
  title,
  sub,
  delay = 0,
}: {
  className?: string;
  tone: keyof typeof FLOAT_TONE;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  sub: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, delay: 0.9 + delay, ease }}
      className={`lp-bob absolute z-20 hidden items-center gap-3 rounded-2xl border border-white/15 bg-[#161228]/75 px-3.5 py-2.5 shadow-[0_20px_50px_-16px_rgba(0,0,0,0.7)] backdrop-blur-xl sm:flex ${className ?? ""}`}
      style={{ animationDelay: `${delay}s` }}
    >
      <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${FLOAT_TONE[tone]}`}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="text-left">
        <span className="block text-xs font-bold leading-tight text-white">{title}</span>
        <span className="block text-[10.5px] text-white/60">{sub}</span>
      </span>
    </motion.div>
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
    <div className="overflow-hidden rounded-xl border border-black/5 bg-white">
      <div className="flex h-9 items-center gap-2 border-b bg-slate-100 px-4">
        <span className="flex gap-1.5">
          <i className="h-2.5 w-2.5 rounded-full bg-red-400" />
          <i className="h-2.5 w-2.5 rounded-full bg-amber-400" />
          <i className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        </span>
        <span className="flex-1 text-center font-mono text-[11px] text-slate-400">app.juridflow.com.br/dashboard</span>
      </div>

      <div className="flex min-h-[460px] bg-[#fafaff]">
        <aside className="hidden w-[200px] shrink-0 flex-col border-r bg-white p-3 sm:flex">
          <div className="mb-3 flex items-center gap-2.5 border-b pb-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-violet-400 text-xs font-bold text-white">SA</div>
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

        <div className="min-w-0 flex-1">
          <div className="bg-gradient-to-br from-slate-800 via-slate-700 to-indigo-700 px-6 py-5 text-white">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-display text-lg font-bold">Painel Geral — Outubro</div>
                <div className="mt-0.5 text-[11.5px] text-white/75">1 out — 31 out 2026 · Ver outros períodos →</div>
              </div>
              <BarChart3 className="h-7 w-7 text-white/60" />
            </div>
            <div className="mt-3.5 flex flex-wrap gap-2 text-[10.5px] font-semibold">
              <span className="flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1"><i className="h-1.5 w-1.5 rounded-full bg-red-300" /> 3 movimentações novas</span>
              <span className="flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1"><i className="h-1.5 w-1.5 rounded-full bg-amber-300" /> 2 cobranças atrasadas</span>
              <span className="flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1"><i className="h-1.5 w-1.5 rounded-full bg-blue-300" /> 1 conversa aguardando</span>
            </div>
          </div>

          <div className="space-y-3.5 p-5">
            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              <Kpi icon={DollarSign} accent="emerald" label="Recebido" value={47350} prefix="R$ " sub="no período" />
              <Kpi icon={Clock} accent="blue" label="A receber" value={12100} prefix="R$ " sub="em dia" />
              <Kpi icon={AlertTriangle} accent="rose" label="Vencido" value={1800} prefix="R$ " sub="3,7% inadimplência" />
              <Kpi icon={Target} accent="violet" label="Pipeline" value={89400} prefix="R$ " sub="14 leads" />
            </div>

            <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
              <div className="rounded-xl border bg-white p-3.5">
                <div className="mb-2.5 flex items-center gap-2 text-xs font-bold"><BarChart3 className="h-3.5 w-3.5 text-violet-600" /> Fluxo de caixa — recebido por dia</div>
                <div className="flex h-[70px] items-end gap-1.5">
                  {[42, 58, 35, 70, 52, 88, 64, 95, 78, 60, 82, 100, 71, 90].map((h, i) => (
                    <motion.div
                      key={i}
                      initial={{ height: 0 }}
                      whileInView={{ height: `${h}%` }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.6, delay: i * 0.03, ease }}
                      className="flex-1 rounded-sm bg-gradient-to-t from-violet-600 to-violet-400"
                    />
                  ))}
                </div>
              </div>

              <div className="rounded-xl border bg-white p-3.5">
                <div className="mb-2.5 flex items-center gap-2 text-xs font-bold"><Activity className="h-3.5 w-3.5 text-violet-600" /> Atividade recente</div>
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
  value,
  prefix,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  accent: keyof typeof ACCENT;
  label: string;
  value: number;
  prefix: string;
  sub: string;
}) {
  const c = ACCENT[accent];
  return (
    <div className="rounded-xl border bg-white p-3">
      <div className={`mb-2 flex h-7 w-7 items-center justify-center rounded-md ${c.box}`}>
        <Icon className={`h-4 w-4 ${c.icon}`} />
      </div>
      <div className="text-[9.5px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-lg font-extrabold tabular-nums ${c.val}`}>
        <CountUp value={value} prefix={prefix} />
      </div>
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

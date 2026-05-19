/**
 * Helpers e primitivos visuais compartilhados pelos dashboards por setor.
 *
 * Os componentes aqui são pensados pra dar identidade visual coerente
 * entre Comercial, Operacional e Financeiro — hero card com gradient
 * setorial, KPI cards, ring de progresso SVG, ranking com avatar e
 * progress bar colorida.
 */

import { Card, CardContent } from "@/components/ui/card";
import type { LucideIcon } from "lucide-react";
import { TrendingUp, TrendingDown, Info } from "lucide-react";
import type { ReactNode } from "react";

// ─── Formatadores ────────────────────────────────────────────────────────────

export function formatBRL(v: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

export function formatBRLShort(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `R$ ${(v / 1_000).toFixed(1)}k`;
  return formatBRL(v);
}

export function formatPercent(v: number | null, casas = 1): string {
  if (v == null) return "—";
  return `${v.toFixed(casas)}%`;
}

export function formatDataCurta(d: string | Date): string {
  const dt = typeof d === "string" ? new Date(`${d}T00:00:00`) : d;
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(dt);
}

// ─── Utils de cor ────────────────────────────────────────────────────────────

export type SetorTema = "comercial" | "operacional" | "financeiro" | "geral";

export const TEMA: Record<SetorTema, { gradient: string; bg: string; accent: string; ring: string }> = {
  comercial: {
    gradient: "bg-gradient-to-br from-indigo-500 via-violet-500 to-purple-600",
    bg: "bg-gradient-to-br from-indigo-50/40 via-white to-violet-50/30",
    accent: "text-indigo-600",
    ring: "ring-indigo-200",
  },
  operacional: {
    gradient: "bg-gradient-to-br from-indigo-600 via-indigo-500 to-violet-600",
    bg: "bg-gradient-to-br from-indigo-50/40 via-white to-violet-50/30",
    accent: "text-indigo-600",
    ring: "ring-indigo-200",
  },
  financeiro: {
    gradient: "bg-gradient-to-br from-emerald-600 via-emerald-500 to-teal-500",
    bg: "bg-gradient-to-br from-emerald-50/40 via-white to-teal-50/30",
    accent: "text-emerald-600",
    ring: "ring-emerald-200",
  },
  geral: {
    // Tom "executivo" — slate escuro com toque de blue/indigo. Visualmente
    // mais sóbrio que os painéis setoriais (que são coloridos/temáticos).
    // Sinaliza "visão consolidada" pra Dono/Admin.
    gradient: "bg-gradient-to-br from-slate-800 via-slate-700 to-indigo-700",
    bg: "bg-gradient-to-br from-slate-50/40 via-white to-blue-50/20",
    accent: "text-slate-700",
    ring: "ring-slate-200",
  },
};

/** Cor do progresso de uma meta/percentual conforme atingimento. */
export function corPorPercentual(v: number | null): string {
  if (v == null) return "from-slate-300 to-slate-400";
  if (v >= 100) return "from-emerald-400 to-green-500";
  if (v >= 70) return "from-blue-500 to-indigo-500";
  if (v >= 40) return "from-amber-400 to-orange-500";
  return "from-rose-400 to-rose-500";
}

/** Tom de texto pra valores de % conforme severidade. */
export function corTextoPercentual(v: number | null): string {
  if (v == null) return "text-slate-400";
  if (v >= 100) return "text-emerald-600";
  if (v >= 70) return "text-blue-600";
  if (v >= 40) return "text-amber-600";
  return "text-rose-600";
}

// ─── Avatar (iniciais com gradient) ──────────────────────────────────────────

/** Gera iniciais do nome (max 2 chars). */
export function gerarIniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0]!.slice(0, 2).toUpperCase();
  return (partes[0]![0]! + partes[partes.length - 1]![0]!).toUpperCase();
}

const GRADIENT_AVATARES = [
  "from-indigo-500 to-purple-600",
  "from-emerald-500 to-teal-600",
  "from-pink-500 to-rose-500",
  "from-amber-500 to-orange-600",
  "from-cyan-500 to-blue-600",
  "from-violet-500 to-fuchsia-600",
  "from-slate-500 to-slate-700",
  "from-lime-500 to-emerald-600",
];

/** Hash determinístico do nome → gradient consistente entre re-renders. */
export function gradientAvatar(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return GRADIENT_AVATARES[Math.abs(h) % GRADIENT_AVATARES.length]!;
}

export function Avatar({ nome, size = "md" }: { nome: string; size?: "sm" | "md" | "lg" }) {
  const dims = size === "sm" ? "w-8 h-8 text-[11px]" : size === "lg" ? "w-12 h-12 text-base" : "w-10 h-10 text-[13px]";
  return (
    <div
      className={`${dims} rounded-xl bg-gradient-to-br ${gradientAvatar(nome)} flex items-center justify-center font-semibold text-white tracking-tight shrink-0 shadow-sm`}
    >
      {gerarIniciais(nome)}
    </div>
  );
}

// ─── Pulse dot (status "ao vivo") ────────────────────────────────────────────

export function PulseDot() {
  return (
    <span className="relative inline-flex items-center justify-center w-1.5 h-1.5 mr-1">
      <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-300 opacity-75 animate-ping" />
      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
    </span>
  );
}

// ─── Ring de progresso SVG ───────────────────────────────────────────────────

export function ProgressRing({
  value,
  size = 144,
  strokeWidth = 9,
  label,
  sublabel,
  trackColor = "rgba(255,255,255,0.18)",
  fillColor = "white",
}: {
  value: number; // 0–100+
  size?: number;
  strokeWidth?: number;
  label: ReactNode;
  sublabel?: string;
  trackColor?: string;
  fillColor?: string;
}) {
  const r = (size - strokeWidth) / 2 - 1;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, value));
  const offset = c - (clamped / 100) * c;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
      >
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={trackColor} strokeWidth={strokeWidth} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={fillColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold tabular-nums leading-none text-white">
          {label}
        </span>
        {sublabel && (
          <span className="text-[10px] text-white/75 uppercase tracking-wider mt-1.5">
            {sublabel}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Hero card setorial ──────────────────────────────────────────────────────

export function HeroCard({
  tema,
  setorLabel,
  periodo,
  badgeDireito,
  tituloPrincipal,
  valorPrincipal,
  variacaoBadge,
  legenda,
  progresso,
  ringValue,
  ringLabel,
  ringSublabel,
  decoracaoIcon: DecoIcon,
}: {
  tema: SetorTema;
  setorLabel: string;
  periodo: { dataInicio: string; dataFim: string };
  badgeDireito?: ReactNode;
  tituloPrincipal: string;
  valorPrincipal: ReactNode;
  variacaoBadge?: ReactNode;
  legenda?: ReactNode;
  progresso?: { valor: number; labelDir?: ReactNode };
  ringValue?: number;
  ringLabel?: ReactNode;
  ringSublabel?: string;
  decoracaoIcon?: LucideIcon;
}) {
  const t = TEMA[tema];
  return (
    <div className={`relative overflow-hidden rounded-2xl ${t.gradient} p-7 text-white shadow-lg`}>
      {DecoIcon && (
        <DecoIcon className="absolute -right-10 -bottom-12 w-56 h-56 opacity-10" />
      )}
      <div className="relative">
        <div className="flex items-start justify-between mb-2">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <PulseDot />
              <p className="text-xs font-medium text-white/85 uppercase tracking-wider">
                {setorLabel}
              </p>
            </div>
            <p className="text-xs text-white/70">
              {formatDataCurta(periodo.dataInicio)} — {formatDataCurta(periodo.dataFim)}
            </p>
          </div>
          {badgeDireito}
        </div>

        <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-6 items-end">
          <div className={ringValue != null ? "lg:col-span-7" : "lg:col-span-12"}>
            <p className="text-sm font-medium text-white/80 mb-1">{tituloPrincipal}</p>
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="text-5xl font-extrabold tracking-tight tabular-nums leading-none">
                {valorPrincipal}
              </span>
              {variacaoBadge}
            </div>
            {legenda && (
              <p className="text-xs text-white/65 mt-2 tabular-nums">{legenda}</p>
            )}
            {progresso && (
              <div className="mt-4">
                <div className="flex justify-between text-[11px] text-white/75 mb-1.5">
                  <span>Progresso</span>
                  {progresso.labelDir}
                </div>
                <div className="h-2 bg-white/15 rounded-full overflow-hidden">
                  <div
                    style={{ width: `${Math.max(0, Math.min(100, progresso.valor))}%` }}
                    className="h-full rounded-full bg-gradient-to-r from-emerald-300 via-emerald-200 to-white"
                  />
                </div>
              </div>
            )}
          </div>

          {ringValue != null && (
            <div className="lg:col-span-5 flex items-center justify-center lg:justify-end">
              <ProgressRing
                value={ringValue}
                label={ringLabel ?? `${Math.round(ringValue)}%`}
                sublabel={ringSublabel}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Badge de variação (↑ +12% / ↓ −3pp) ─────────────────────────────────────

export function VariacaoBadge({
  delta,
  sufixo = "%",
  noHero = false,
}: {
  delta: number | null;
  sufixo?: string;
  noHero?: boolean;
}) {
  if (delta == null) return null;
  const positivo = delta > 0;
  const neutro = delta === 0;
  if (noHero) {
    const baseUp = "bg-emerald-400/25 text-emerald-50 border border-emerald-300/30";
    const baseDown = "bg-rose-400/30 text-rose-50 border border-rose-300/40";
    const baseNeutro = "bg-white/15 text-white border border-white/20";
    return (
      <span
        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium ${
          neutro ? baseNeutro : positivo ? baseUp : baseDown
        }`}
      >
        {positivo ? <TrendingUp className="w-3 h-3" /> : !neutro ? <TrendingDown className="w-3 h-3" /> : null}
        {positivo ? "+" : ""}
        {delta.toFixed(1)}
        {sufixo}
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
        neutro ? "bg-slate-100 text-slate-600" : positivo ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
      }`}
    >
      {positivo ? <TrendingUp className="w-3 h-3" /> : !neutro ? <TrendingDown className="w-3 h-3" /> : null}
      {positivo ? "+" : ""}
      {delta.toFixed(1)}
      {sufixo}
    </span>
  );
}

// ─── KPI card pequeno (com icon-bg) ──────────────────────────────────────────

export function KPICard({
  label,
  value,
  icon: Icon,
  iconBg = "bg-slate-100",
  iconFg = "text-slate-600",
  valueColor = "text-slate-900",
  badge,
  hint,
}: {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  iconBg?: string;
  iconFg?: string;
  valueColor?: string;
  badge?: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <Card className="border-slate-200">
      <CardContent className="pt-5 pb-5">
        <div className="flex items-start justify-between mb-3">
          {Icon && (
            <div className={`w-10 h-10 rounded-xl ${iconBg} flex items-center justify-center`}>
              <Icon className={`w-5 h-5 ${iconFg}`} />
            </div>
          )}
          {badge}
        </div>
        <p className={`text-2xl font-bold tracking-tight tabular-nums leading-none ${valueColor}`}>
          {value}
        </p>
        <p className="text-xs text-muted-foreground mt-1.5">{label}</p>
        {hint && <p className="text-[10px] text-muted-foreground/80 mt-1">{hint}</p>}
      </CardContent>
    </Card>
  );
}

// ─── Mini pill (TOP, META, SDR, etc.) ────────────────────────────────────────

export function MetaPill({ children, tom }: { children: ReactNode; tom: "amber" | "emerald" | "blue" | "rose" | "slate" | "violet" }) {
  const cores = {
    amber: "bg-amber-50 text-amber-700",
    emerald: "bg-emerald-50 text-emerald-700",
    blue: "bg-blue-50 text-blue-700",
    rose: "bg-rose-50 text-rose-700",
    slate: "bg-slate-100 text-slate-600",
    violet: "bg-violet-50 text-violet-700",
  };
  return (
    <span className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full tracking-wide ${cores[tom]}`}>
      {children}
    </span>
  );
}

// ─── Card de mini-KPI colorido (usado dentro do operacional) ─────────────────

export function MiniStat({
  label,
  value,
  hint,
  tom,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tom: "blue" | "rose" | "emerald" | "amber";
}) {
  const cores = {
    blue: { wrap: "bg-blue-50/60 border-blue-100", chip: "text-blue-700", num: "text-blue-600" },
    rose: { wrap: "bg-rose-50/60 border-rose-100", chip: "text-rose-700", num: "text-rose-600" },
    emerald: { wrap: "bg-emerald-50/60 border-emerald-100", chip: "text-emerald-700", num: "text-emerald-600" },
    amber: { wrap: "bg-amber-50/60 border-amber-100", chip: "text-amber-700", num: "text-amber-600" },
  };
  const c = cores[tom];
  return (
    <div className={`rounded-xl p-3 border ${c.wrap}`}>
      <p className={`text-[10px] uppercase tracking-wider font-semibold ${c.chip}`}>{label}</p>
      <div className="flex items-baseline gap-1.5 mt-1">
        <span className={`text-2xl font-bold tracking-tight tabular-nums leading-none ${c.num}`}>{value}</span>
        {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
      </div>
    </div>
  );
}

// ─── Rodapé informativo (nota explicativa do filtro de setor) ────────────────

export function NotaSetor({ children }: { children: ReactNode }) {
  return (
    <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/50 text-[11px] text-muted-foreground flex items-start gap-2">
      <Info className="w-3 h-3 mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

// ─── Banner amarelo (sem setor configurado, etc.) ────────────────────────────

export function AvisoBanner({
  titulo,
  descricao,
  acao,
}: {
  titulo: string;
  descricao: string;
  acao?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex flex-wrap items-start gap-3">
      <Info className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-amber-900">{titulo}</p>
        <p className="text-xs text-amber-800 mt-1">{descricao}</p>
      </div>
      {acao}
    </div>
  );
}

// ─── Wrapper de seção de painel (bg sutil setorial) ──────────────────────────

export function PainelSection({
  tema,
  children,
}: {
  tema: SetorTema;
  children: ReactNode;
}) {
  return (
    <div className={`rounded-2xl ${TEMA[tema].bg} p-6 space-y-6`}>
      {children}
    </div>
  );
}

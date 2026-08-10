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
import { ArrowRight, TrendingUp, TrendingDown, Info } from "lucide-react";
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

/**
 * Rótulo de eixo Y, sem unidade.
 *
 * Repetir "R$" em cada marca do eixo gasta metade da largura reservada pra
 * ele com a mesma informação cinco vezes — e no tamanho de fonte do eixo o
 * texto quebrava em duas linhas, empilhando "R$" em cima do número. A moeda
 * já está no valor grande do topo e no tooltip.
 */
export function formatEixoValor(v: number): string {
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (abs >= 1_000) return `${Math.round(v / 1_000)}k`;
  return String(Math.round(v));
}

export function formatPercent(v: number | null, casas = 1): string {
  if (v == null) return "—";
  return `${v.toFixed(casas)}%`;
}

export function formatDataCurta(d: string | Date): string {
  const dt = typeof d === "string" ? new Date(`${d}T00:00:00`) : d;
  // Intl.DateTimeFormat.format() lança RangeError em data inválida — um
  // periodo vazio (ex: sentinel ZERO do dashboard sem permissão) derruba
  // o painel inteiro. Devolve fallback em vez de propagar o throw.
  if (!dt || Number.isNaN(dt.getTime())) return "—";
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
    <div className={`relative overflow-hidden rounded-lg ${t.gradient} p-7 text-white shadow-lg`}>
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
    <div className="rounded-md border border-amber-200 bg-amber-50 p-4 flex flex-wrap items-start gap-3">
      <Info className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-amber-900">{titulo}</p>
        <p className="text-xs text-amber-800 mt-1">{descricao}</p>
      </div>
      {acao}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Linguagem nova dos painéis
//
// O painel antigo repetia o mesmo número três e quatro vezes: conversas
// aguardando no chip colorido E no card de contexto, vencido no chip E no
// KPI, recebido no hero E no KPI logo abaixo. Repetido em cinco cores de
// mesmo peso, nada lê como importante — e a tela fica do dobro do tamanho
// que precisa.
//
// Os primitivos abaixo assumem o oposto: cada número aparece UMA vez, no
// lugar onde se age sobre ele; cor só onde ela significa alguma coisa; e o
// violeta reservado pra ação, nunca pra dado.
// ═══════════════════════════════════════════════════════════════════════════

/** Cor da série de dados. Vem dos tokens de visualização do app, que passam
 *  na checagem de daltonismo — não trocar por uma cor "que combina". */
export const COR_SERIE = "var(--viz-1)";

export function PainelTopo({
  titulo,
  subtitulo,
  acao,
}: {
  titulo: ReactNode;
  subtitulo?: ReactNode;
  acao?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[22px] font-bold tracking-tight leading-tight">{titulo}</h1>
        {subtitulo && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{subtitulo}</p>}
      </div>
      {acao}
    </div>
  );
}

/**
 * Uma coisa que precisa da atenção de alguém.
 *
 * `critico` é o único que ganha cor. Quando os quatro gritam em quatro cores
 * diferentes — que é como estava — o olho não tem por onde começar, e a
 * urgência real se perde no meio.
 */
export function AcaoCard({
  icone: Icone,
  valor,
  label,
  critico,
  onClick,
}: {
  icone: LucideIcon;
  valor: ReactNode;
  label: string;
  critico?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-3 rounded-md border px-3.5 py-3 text-left transition-colors ${
        critico
          ? "border-rose-200 bg-rose-50 hover:bg-rose-100/70 dark:border-rose-900 dark:bg-rose-950/30 dark:hover:bg-rose-950/50"
          : "bg-card hover:bg-accent"
      }`}
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
          critico ? "bg-rose-100 dark:bg-rose-900/50" : "bg-muted"
        }`}
      >
        <Icone className={`h-4 w-4 ${critico ? "text-rose-700 dark:text-rose-300" : "text-muted-foreground"}`} />
      </span>
      <span className="min-w-0">
        <span
          className={`block text-[19px] font-bold leading-none tabular-nums ${
            critico ? "text-rose-700 dark:text-rose-300" : ""
          }`}
        >
          {valor}
        </span>
        <span
          className={`mt-1 block text-[11.5px] leading-tight ${
            critico ? "text-rose-800/80 dark:text-rose-200/80" : "text-muted-foreground"
          }`}
        >
          {label}
        </span>
      </span>
      <ArrowRight
        className={`ml-auto h-3.5 w-3.5 shrink-0 ${critico ? "text-rose-500" : "text-muted-foreground/50"}`}
      />
    </button>
  );
}

export function FaixaAcoes({ children }: { children: ReactNode }) {
  return <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">{children}</div>;
}

/** Um número do rodapé do bloco principal — o contexto que o número grande
 *  sozinho não dá ("R$ 240 mil" vs "R$ 240 mil em 62 parcelas a vencer"). */
export function SubNumero({
  label,
  valor,
  hint,
  tag,
  ruim,
}: {
  label: string;
  valor: ReactNode;
  hint?: ReactNode;
  tag?: ReactNode;
  ruim?: boolean;
}) {
  return (
    <div className="px-4 py-3">
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {label}
        {tag}
      </p>
      <p
        className={`mt-1 text-[19px] font-bold tracking-tight tabular-nums ${
          ruim ? "text-rose-700 dark:text-rose-400" : ""
        }`}
      >
        {valor}
      </p>
      {hint && <p className="mt-0.5 text-[10.5px] text-muted-foreground/80">{hint}</p>}
    </div>
  );
}

export function SubNumeros({ children }: { children: ReactNode }) {
  return (
    <div className="grid divide-y border-t sm:grid-cols-3 sm:divide-x sm:divide-y-0">{children}</div>
  );
}

/**
 * O bloco do número principal. Card branco com borda de 1px — o gradiente
 * roxo que vivia aqui dava impacto na primeira olhada e datava a tela em
 * todas as seguintes, além de comer um terço do painel pra mostrar um número
 * que se repetia logo abaixo.
 */
export function BlocoPrincipal({
  rotulo,
  valor,
  badge,
  grafico,
  children,
}: {
  rotulo: string;
  valor: ReactNode;
  badge?: ReactNode;
  grafico?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-md border bg-card">
      <div className="flex flex-wrap items-end justify-between gap-3 px-4 pt-4">
        <div>
          <p className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
            {rotulo}
          </p>
          <p className="mt-1.5 text-[34px] font-bold leading-none tracking-tight tabular-nums">
            {valor}
          </p>
        </div>
        {badge}
      </div>
      {grafico && <div className="px-2 pt-3">{grafico}</div>}
      {children}
    </div>
  );
}

export function ListaCard({
  titulo,
  subtitulo,
  acaoLabel,
  onAcao,
  topo,
  rodape,
  children,
  esticar,
}: {
  titulo: ReactNode;
  subtitulo?: ReactNode;
  acaoLabel?: string;
  onAcao?: () => void;
  /** Faixa fixa entre o cabeçalho e a lista (ex: a semana do calendário).
   *  Fica fora da área rolável de propósito — é referência, não conteúdo. */
  topo?: ReactNode;
  rodape?: ReactNode;
  children: ReactNode;
  /** Ocupa a altura da linha do grid e rola por dentro.
   *
   *  O `min-h-0` + `overflow-y-auto` na lista é o que faz o card CABER na
   *  altura do vizinho em vez de esticar a linha inteira: com overflow
   *  automático a contribuição de altura mínima da lista é zero, então quem
   *  define a altura da linha é o card do lado. */
  esticar?: boolean;
}) {
  return (
    <div
      className={`flex min-h-0 flex-col overflow-hidden rounded-md border bg-card ${esticar ? "h-full" : ""}`}
    >
      <div className="flex items-start justify-between gap-2 px-4 pt-3.5">
        <div className="min-w-0">
          <p className="text-sm font-bold leading-tight">{titulo}</p>
          {subtitulo && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitulo}</p>
          )}
        </div>
        {acaoLabel && (
          <button
            onClick={onAcao}
            className="flex shrink-0 items-center gap-1 pt-0.5 text-[11.5px] font-semibold text-violet-600 hover:text-violet-700 dark:text-violet-400"
          >
            {acaoLabel}
            <ArrowRight className="h-3 w-3" />
          </button>
        )}
      </div>
      {topo}
      <div
        className={`flex flex-col px-2 pb-2 pt-1 ${esticar ? "min-h-0 flex-1 overflow-y-auto" : ""}`}
      >
        {children}
      </div>
      {rodape && (
        <div className="mt-auto flex items-center justify-between border-t px-4 py-2.5 text-[11px] text-muted-foreground">
          {rodape}
        </div>
      )}
    </div>
  );
}

const INICIAIS_SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];

/**
 * A semana civil como num calendário: domingo a sábado, hoje destacado, um
 * ponto nos dias que têm algo marcado.
 *
 * O ponto é presença, não quantidade — o número de cada dia caberia mas
 * viraria sete números competindo com os da lista logo abaixo, que é onde a
 * pessoa realmente lê o que tem pra fazer.
 */
export function FaixaSemana({
  dias,
  diaAberto,
  onDia,
}: {
  dias: Array<{ data: string; total: number; hoje: boolean }>;
  /** Dia sendo exibido na lista. Sem isso o destaque fica preso em "hoje" e
   *  clicar em outro dia troca o conteúdo sem mover a marcação — a pessoa
   *  perde de vista qual dia está lendo. */
  diaAberto?: string;
  onDia?: (data: string) => void;
}) {
  return (
    <div className="grid grid-cols-7 gap-1 border-b px-2.5 pb-2.5 pt-2">
      {dias.map((d, i) => {
        const aberto = diaAberto ? d.data === diaAberto : d.hoje;
        return (
          <button
            key={d.data}
            onClick={() => onDia?.(d.data)}
            title={d.total > 0 ? `${d.total} na agenda` : "Nada marcado"}
            className={`flex flex-col items-center gap-1 rounded-md py-1.5 transition-colors ${
              aberto ? "bg-violet-600 text-white" : "hover:bg-accent"
            }`}
          >
            <span
              className={`text-[9px] font-bold uppercase leading-none tracking-[0.06em] ${
                aberto ? "text-white/70" : "text-muted-foreground/70"
              }`}
            >
              {INICIAIS_SEMANA[i]}
            </span>
            <span
              className={`text-[12.5px] font-semibold leading-none tabular-nums ${
                // Hoje segue reconhecível mesmo quando outro dia está aberto —
                // senão o calendário perde a âncora de "onde estamos".
                !aberto && d.hoje ? "underline decoration-2 underline-offset-2" : ""
              }`}
            >
              {Number(d.data.slice(8, 10))}
            </span>
            <span
              className="h-1 w-1 rounded-full"
              style={{
                background: d.total > 0 ? (aberto ? "#fff" : COR_SERIE) : "transparent",
              }}
            />
          </button>
        );
      })}
    </div>
  );
}

export function LinhaLista({
  cor,
  quando,
  texto,
  meta,
  onClick,
}: {
  cor: string;
  quando: ReactNode;
  texto: ReactNode;
  meta?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2.5 rounded-lg px-2 py-[7px] text-left hover:bg-accent"
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: cor }} />
      <span className="w-[42px] shrink-0 text-[11.5px] font-semibold tabular-nums text-muted-foreground">
        {quando}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground/90">{texto}</span>
      {meta && <span className="shrink-0 text-[10.5px] text-muted-foreground/70">{meta}</span>}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Primitivos dos painéis setoriais
//
// Os três setores respondem perguntas diferentes com a mesma gramática: um
// número grande com uma referência ao lado, uma lista de pessoas comparáveis,
// e uma lista de valores. Ter isso aqui é o que impede as três telas de virarem
// três interpretações do mesmo layout.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Barra de progresso com marcador de referência.
 *
 * O marcador é o que transforma o número em informação: 78% da meta no dia 10
 * é ótimo, no dia 28 é problema, e o anel de progresso que vivia no hero
 * desenhava a mesma figura bonita nos dois casos.
 *
 * O rótulo da referência mora na legenda, não flutuando sobre a barra —
 * solto ali em cima ele colidia com o badge do canto sempre que a referência
 * caía perto do fim, e rótulo que às vezes colide é pior que rótulo fixo.
 */
export function BarraMeta({
  percentual,
  referencia,
  legendaReferencia,
  legendaDireita,
  cor,
}: {
  percentual: number;
  /** Onde está a linha de comparação, em % da barra. */
  referencia?: number | null;
  legendaReferencia?: ReactNode;
  legendaDireita?: ReactNode;
  cor?: string;
}) {
  const preenchido = Math.max(0, Math.min(100, percentual));
  return (
    <div className="px-4 pb-4 pt-4">
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full"
          style={{ width: `${preenchido}%`, background: cor ?? COR_SERIE }}
        />
        {referencia != null && (
          <span
            className="absolute inset-y-0 w-px bg-foreground/60"
            style={{ left: `${Math.max(0, Math.min(100, referencia))}%` }}
          />
        )}
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
        <span className="flex min-w-0 items-center gap-1.5">
          {referencia != null && <span className="inline-block h-3 w-px shrink-0 bg-foreground/60" />}
          <span className="truncate">{legendaReferencia}</span>
        </span>
        <span className="shrink-0">{legendaDireita}</span>
      </div>
    </div>
  );
}

/** Selo curto ao lado de um nome. */
export function Selo({
  children,
  tom = "neutro",
}: {
  children: ReactNode;
  tom?: "ok" | "ruim" | "neutro";
}) {
  const tons = {
    ok: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
    ruim: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300",
    neutro: "border-border bg-muted text-muted-foreground",
  };
  return (
    <span className={`shrink-0 rounded border px-1 text-[9px] font-bold uppercase ${tons[tom]}`}>
      {children}
    </span>
  );
}

const CORES_AVATAR = ["#7c3aed", "#0891b2", "#eda100", "#1baf7a", "#e87ba4", "#eb6834"];

function iniciaisDe(nome: string): string {
  return nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

export function AvatarIniciais({ nome, indice }: { nome: string; indice: number }) {
  return (
    <span
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
      style={{ background: CORES_AVATAR[indice % CORES_AVATAR.length] }}
    >
      {iniciaisDe(nome)}
    </span>
  );
}

/**
 * Uma pessoa no ranking.
 *
 * A barra ocupa a sobra da linha em vez de uma faixa estreita no canto: barra
 * curta demais faz todo mundo parecer igual, que é o oposto do que um ranking
 * precisa mostrar — e ainda deixa um vão branco no meio da linha.
 *
 * `percentual: null` é ausência de referência (ninguém cadastrou a meta), não
 * zero. Mostrar "0%" acusa a pessoa por uma configuração que ninguém fez.
 */
export function LinhaRanking({
  posicao,
  nome,
  detalhe,
  percentual,
  indice,
  selo,
  ruim,
  onClick,
}: {
  posicao?: number;
  nome: string;
  detalhe: ReactNode;
  percentual: number | null;
  indice: number;
  selo?: ReactNode;
  ruim?: boolean;
  onClick?: () => void;
}) {
  const semReferencia = percentual == null;
  const corPercentual = semReferencia
    ? "text-muted-foreground"
    : ruim
      ? "text-rose-600 dark:text-rose-400"
      : percentual >= 100
        ? "text-emerald-600 dark:text-emerald-400"
        : "";
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-accent"
    >
      {posicao != null && (
        <span className="w-4 shrink-0 text-center text-[11px] font-bold tabular-nums text-muted-foreground/70">
          {posicao}
        </span>
      )}
      <AvatarIniciais nome={nome} indice={indice} />
      <span className="w-[190px] shrink-0 sm:w-[240px]">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[12.5px] font-semibold">{nome}</span>
          {selo}
        </span>
        <span className="mt-0.5 block truncate text-[10.5px] text-muted-foreground">{detalhe}</span>
      </span>
      <span className="hidden min-w-0 flex-1 sm:block">
        <span className="block h-1.5 w-full overflow-hidden rounded-full bg-muted">
          {!semReferencia && (
            <span
              className="block h-full rounded-full"
              style={{
                width: `${Math.max(0, Math.min(100, percentual))}%`,
                background: ruim ? "var(--viz-2)" : COR_SERIE,
              }}
            />
          )}
        </span>
      </span>
      <span className={`w-[52px] shrink-0 text-right text-[12px] font-bold tabular-nums ${corPercentual}`}>
        {semReferencia ? "—" : formatPercent(percentual, 1)}
      </span>
    </button>
  );
}

/**
 * Uma linha de valor (devedor, contrato, cobrança).
 *
 * Sem barra de propósito: a barra do ranking compara contra uma meta, e aqui
 * não existe meta. Transformar reais em "100%, 68%, 51%" inventaria uma escala
 * que o número não tem.
 */
export function LinhaValor({
  nome,
  detalhe,
  valor,
  rodapeValor,
  indice,
  onClick,
}: {
  nome: string;
  detalhe: ReactNode;
  valor: ReactNode;
  rodapeValor?: ReactNode;
  indice: number;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-accent"
    >
      <AvatarIniciais nome={nome} indice={indice} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-semibold">{nome}</span>
        <span className="mt-0.5 block truncate text-[10.5px] text-muted-foreground">{detalhe}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-[13.5px] font-bold tabular-nums text-rose-700 dark:text-rose-400">
          {valor}
        </span>
        {rodapeValor && (
          <span className="mt-0.5 block text-[10px] text-muted-foreground">{rodapeValor}</span>
        )}
      </span>
    </button>
  );
}

/** Um número com rótulo e contexto, para os cards laterais. */
export function LinhaNumero({
  label,
  valor,
  hint,
  ruim,
}: {
  label: ReactNode;
  valor: ReactNode;
  hint?: ReactNode;
  ruim?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 rounded-lg px-2 py-2">
      <span className="min-w-0">
        <span className="block text-[12px]">{label}</span>
        {hint && <span className="mt-0.5 block text-[10.5px] text-muted-foreground">{hint}</span>}
      </span>
      <span
        className={`shrink-0 text-[18px] font-bold tabular-nums ${
          ruim ? "text-rose-700 dark:text-rose-400" : ""
        }`}
      >
        {valor}
      </span>
    </div>
  );
}

/**
 * Quanto do período já passou, em %.
 *
 * É a referência do "ritmo" nas barras de meta. Antes de o mês acabar, comparar
 * o atingido com o esperado A ESTA ALTURA é a única leitura honesta — 60% da
 * meta no dia 5 e 60% no dia 28 são situações opostas.
 */
export function percentualDecorrido(
  dataInicio: string,
  dataFim: string,
  hoje = new Date(),
): number | null {
  if (!dataInicio || !dataFim) return null;
  const inicio = new Date(`${dataInicio}T00:00:00`).getTime();
  const fim = new Date(`${dataFim}T23:59:59`).getTime();
  if (Number.isNaN(inicio) || Number.isNaN(fim) || fim <= inicio) return null;
  const agora = hoje.getTime();
  if (agora <= inicio) return 0;
  if (agora >= fim) return 100;
  return +(((agora - inicio) / (fim - inicio)) * 100).toFixed(1);
}

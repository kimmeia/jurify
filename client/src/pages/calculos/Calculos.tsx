/**
 * Hub central do módulo Cálculos.
 *
 * Página inicial em /calculos que substitui o salto direto pros submódulos.
 * Replica o padrão visual de Clientes / Modelos de Contrato (hero gradient,
 * stats, chips, cards) — antes dessa página, clicar em "Cálculos" no menu
 * lateral só abria o accordion e o usuário ainda tinha que escolher um
 * submódulo "às cegas".
 */

import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PulseDot } from "../dashboards/common";
import {
  Calculator,
  TrendingUp,
  Search,
  Plus,
  History,
  ArrowRight,
  Landmark,
  Briefcase,
  Building2,
  ShieldCheck,
  Receipt,
  Gift,
  MoreVertical,
} from "lucide-react";

type TipoCalculo =
  | "bancario"
  | "trabalhista"
  | "imobiliario"
  | "tributario"
  | "previdenciario"
  | "atualizacao_monetaria";

type FiltroChip = "todos" | TipoCalculo;

const SUBMODULOS: Array<{
  tipo: TipoCalculo;
  label: string;
  descricao: string;
  fundamentacao: string;
  icone: React.ComponentType<{ className?: string }>;
  cor: { bg: string; iconBg: string; iconFg: string; hoverBorder: string; hoverFg: string; chipBg: string; chipFg: string };
  path: string;
  livre?: boolean;
  emBreve?: boolean;
}> = [
  {
    tipo: "bancario",
    label: "Bancário",
    descricao: "Revisão de financiamento",
    fundamentacao: "PRICE · SAC · CET · Anatocismo",
    icone: Landmark,
    cor: { bg: "bg-blue-100", iconBg: "bg-blue-100", iconFg: "text-blue-600", hoverBorder: "hover:border-blue-400", hoverFg: "group-hover:text-blue-600", chipBg: "bg-blue-50", chipFg: "text-blue-700" },
    path: "/calculos/bancario",
  },
  {
    tipo: "trabalhista",
    label: "Trabalhista",
    descricao: "Rescisão · HE · FGTS",
    fundamentacao: "CLT · Lei 12.506 · Súmulas TST",
    icone: Briefcase,
    cor: { bg: "bg-amber-100", iconBg: "bg-amber-100", iconFg: "text-amber-600", hoverBorder: "hover:border-amber-400", hoverFg: "group-hover:text-amber-600", chipBg: "bg-amber-50", chipFg: "text-amber-700" },
    path: "/calculos/trabalhista",
  },
  {
    tipo: "imobiliario",
    label: "Imobiliário",
    descricao: "Financiamento habitacional",
    fundamentacao: "SFH · SFI · MIP · DFI · Indexadores",
    icone: Building2,
    cor: { bg: "bg-emerald-100", iconBg: "bg-emerald-100", iconFg: "text-emerald-600", hoverBorder: "hover:border-emerald-400", hoverFg: "group-hover:text-emerald-600", chipBg: "bg-emerald-50", chipFg: "text-emerald-700" },
    path: "/calculos/imobiliario",
  },
  {
    tipo: "previdenciario",
    label: "Previdenciário",
    descricao: "Aposentadoria · RMI · GPS",
    fundamentacao: "EC 103 · 10 regras de aposentadoria",
    icone: ShieldCheck,
    cor: { bg: "bg-violet-100", iconBg: "bg-violet-100", iconFg: "text-violet-600", hoverBorder: "hover:border-violet-400", hoverFg: "group-hover:text-violet-600", chipBg: "bg-violet-50", chipFg: "text-violet-700" },
    path: "/calculos/previdenciario",
  },
  {
    tipo: "atualizacao_monetaria",
    label: "Cálculos Diversos",
    descricao: "Taxas · Juros · Atualização · Prazos",
    fundamentacao: "IPCA · IGPM · SELIC · CDI · Prescrição",
    icone: TrendingUp,
    cor: { bg: "bg-teal-100", iconBg: "bg-teal-100", iconFg: "text-teal-600", hoverBorder: "hover:border-teal-400", hoverFg: "group-hover:text-teal-600", chipBg: "bg-teal-50", chipFg: "text-teal-700" },
    path: "/calculos/atualizacao-monetaria",
    livre: true,
  },
  {
    tipo: "tributario",
    label: "Tributário",
    descricao: "CTN · Repetição de indébito",
    fundamentacao: "Em breve",
    icone: Receipt,
    cor: { bg: "bg-purple-100", iconBg: "bg-purple-100", iconFg: "text-purple-600", hoverBorder: "", hoverFg: "", chipBg: "bg-purple-50", chipFg: "text-purple-700" },
    path: "/calculos/tributario",
    emBreve: true,
  },
];

const LABEL_TIPO: Record<TipoCalculo, string> = {
  bancario: "Bancário",
  trabalhista: "Trabalhista",
  imobiliario: "Imobiliário",
  tributario: "Tributário",
  previdenciario: "Previdenciário",
  atualizacao_monetaria: "Cálculos Diversos",
};

function tempoRelativo(d: Date | string): string {
  const data = typeof d === "string" ? new Date(d) : d;
  const diffMs = Date.now() - data.getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const dias = Math.floor(h / 24);
  if (dias === 1) return "ontem";
  if (dias < 7) return `há ${dias} dias`;
  return data.toLocaleDateString("pt-BR");
}

function formatBRL(valor: string | number | null | undefined): string | null {
  if (valor == null) return null;
  const n = typeof valor === "string" ? parseFloat(valor) : valor;
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function Calculos() {
  const [, setLocation] = useLocation();
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<FiltroChip>("todos");

  const { data: stats } = trpc.dashboard.stats.useQuery();
  const { data: historico } = trpc.dashboard.historico.useQuery();
  const { data: credits } = trpc.dashboard.credits.useQuery();

  const submoduloPorTipo = useMemo(() => {
    const map: Partial<Record<TipoCalculo, typeof SUBMODULOS[number]>> = {};
    for (const s of SUBMODULOS) map[s.tipo] = s;
    return map;
  }, []);

  const totalCalculos = stats?.totalCalculos ?? 0;
  const totalPareceres = stats?.totalPareceres ?? 0;
  const porTipo: Record<string, number> = (stats?.porTipo ?? {}) as Record<string, number>;

  const historicoFiltrado = useMemo(() => {
    let lista = (historico ?? []) as Array<{
      id: number;
      tipo: TipoCalculo;
      titulo: string;
      protocolo: string | null;
      diferencaTotal: string | null;
      temParecer: boolean;
      createdAt: Date | string;
    }>;
    if (filtro !== "todos") lista = lista.filter((h) => h.tipo === filtro);
    if (busca.trim()) {
      const q = busca.toLowerCase();
      lista = lista.filter(
        (h) =>
          h.titulo.toLowerCase().includes(q) ||
          (h.protocolo ?? "").toLowerCase().includes(q),
      );
    }
    return lista;
  }, [historico, filtro, busca]);

  const diasAteReset = useMemo(() => {
    if (!credits?.resetAt) return null;
    const reset = new Date(credits.resetAt);
    const diff = Math.ceil((reset.getTime() - Date.now()) / 86400000);
    return diff > 0 ? diff : 0;
  }, [credits?.resetAt]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="rounded-2xl bg-gradient-to-br from-slate-50/40 via-white to-amber-50/20 p-6 space-y-5">
        {/* ═══════════ HERO ═══════════ */}
        <div className="rounded-2xl bg-gradient-to-br from-amber-600 via-orange-600 to-rose-700 p-7 text-white relative overflow-hidden shadow-lg">
          <Calculator className="absolute -right-10 -bottom-12 w-56 h-56 opacity-10" strokeWidth={1.2} />
          <TrendingUp className="absolute right-12 top-6 w-20 h-20 opacity-10" strokeWidth={1.2} />
          <div className="relative">
            <div className="flex items-start justify-between mb-2 flex-wrap gap-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <PulseDot />
                  <p className="text-xs font-medium text-white/85 uppercase tracking-wider">
                    Cálculos jurídicos
                  </p>
                </div>
                <p className="text-xs text-white/70">
                  Bancário · Trabalhista · Imobiliário · Previdenciário · Diversos
                </p>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-6 items-end">
              <div className="lg:col-span-6">
                <p className="text-sm font-medium text-white/85 mb-1">Total de cálculos</p>
                <div className="flex items-baseline gap-3 flex-wrap">
                  <span className="text-5xl font-extrabold tracking-tight tabular-nums leading-none">
                    {totalCalculos}
                  </span>
                  {totalPareceres > 0 && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-white/15 text-white border border-white/20">
                      {totalPareceres} parecer{totalPareceres !== 1 ? "es" : ""}
                    </span>
                  )}
                </div>
                <p className="text-xs text-white/65 mt-2 tabular-nums">
                  Histórico completo dos cálculos realizados pela sua equipe
                </p>
              </div>

              <div className="lg:col-span-6">
                <p className="text-[10px] text-white/65 uppercase tracking-wider mb-2">Créditos</p>
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-white/10 rounded-lg px-3 py-2 border border-white/15">
                    <p className="text-xs text-white/70 mb-1">Disponíveis</p>
                    <p className="text-2xl font-bold tabular-nums leading-none text-emerald-200">
                      {credits?.creditsRemaining ?? "—"}
                    </p>
                  </div>
                  <div className="bg-white/10 rounded-lg px-3 py-2 border border-white/15">
                    <p className="text-xs text-white/70 mb-1">Usados</p>
                    <p className="text-2xl font-bold tabular-nums leading-none">
                      {credits?.creditsUsed ?? "—"}
                    </p>
                  </div>
                  <div className="bg-white/10 rounded-lg px-3 py-2 border border-white/15">
                    <p className="text-xs text-white/70 mb-1">Renova em</p>
                    <p className="text-2xl font-bold tabular-nums leading-none">
                      {diasAteReset != null ? `${diasAteReset}d` : "—"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ═══════════ BUSCA + CHIPS ═══════════ */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[260px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Buscar no histórico de cálculos..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="pl-10 h-10 bg-white"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            <ChipFiltro ativo={filtro === "todos"} onClick={() => setFiltro("todos")}>
              Todos <CountPill ativo={filtro === "todos"}>{totalCalculos}</CountPill>
            </ChipFiltro>
            {(["trabalhista", "bancario", "imobiliario", "previdenciario", "atualizacao_monetaria"] as TipoCalculo[]).map(
              (t) => {
                const count = Number(porTipo[t] ?? 0);
                if (count === 0) return null;
                return (
                  <ChipFiltro key={t} ativo={filtro === t} onClick={() => setFiltro(t)}>
                    {LABEL_TIPO[t]} <CountPill ativo={filtro === t}>{count}</CountPill>
                  </ChipFiltro>
                );
              },
            )}
          </div>
        </div>

        {/* ═══════════ CARDS DOS SUBMÓDULOS ═══════════ */}
        <div>
          <p className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-3">
            Tipos de cálculo
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {SUBMODULOS.map((s) => {
              const Icone = s.icone;
              const count = s.tipo === "atualizacao_monetaria"
                ? Number(porTipo["atualizacao_monetaria"] ?? 0)
                : Number(porTipo[s.tipo] ?? 0);
              if (s.emBreve) {
                return (
                  <div
                    key={s.tipo}
                    className="bg-slate-50 rounded-xl p-5 border border-dashed border-slate-300 opacity-60"
                  >
                    <div className="flex items-start gap-3 mb-3">
                      <div className={`p-2.5 ${s.cor.iconBg} rounded-lg`}>
                        <Icone className={`w-5 h-5 ${s.cor.iconFg}`} />
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold text-slate-900">{s.label}</p>
                        <p className="text-xs text-slate-500">Em breve</p>
                      </div>
                      <span className="text-[10px] uppercase font-bold bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">
                        Em breve
                      </span>
                    </div>
                    <div className="text-xs text-slate-500">{s.descricao}</div>
                  </div>
                );
              }
              return (
                <button
                  key={s.tipo}
                  onClick={() => setLocation(s.path)}
                  className={`group text-left bg-white rounded-xl p-5 border border-slate-200 ${s.cor.hoverBorder} hover:shadow-lg transition-all`}
                >
                  <div className="flex items-start gap-3 mb-3">
                    <div
                      className={`p-2.5 ${s.cor.iconBg} rounded-lg transition-colors group-hover:${s.cor.iconFg.replace("text-", "bg-")} group-hover:text-white`}
                    >
                      <Icone className={`w-5 h-5 ${s.cor.iconFg} group-hover:text-white`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-900">{s.label}</p>
                      <p className="text-xs text-slate-500 truncate">{s.descricao}</p>
                    </div>
                    <ArrowRight className={`w-4 h-4 text-slate-300 ${s.cor.hoverFg} group-hover:translate-x-1 transition-all`} />
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    {s.livre ? (
                      <span className="text-emerald-600 font-medium flex items-center gap-1">
                        <Gift className="w-3 h-3" /> Grátis (sem créditos)
                      </span>
                    ) : (
                      <span className="text-slate-500 truncate">{s.fundamentacao}</span>
                    )}
                    <span className="font-bold tabular-nums text-slate-700">{count}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ═══════════ HISTÓRICO RECENTE ═══════════ */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">
              Cálculos recentes
            </p>
            {totalCalculos > (historico?.length ?? 0) && (
              <span className="text-xs text-slate-500">
                Mostrando {historico?.length ?? 0} de {totalCalculos}
              </span>
            )}
          </div>
          {historicoFiltrado.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <History className="h-10 w-10 text-muted-foreground/20 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">
                  {totalCalculos === 0
                    ? "Nenhum cálculo realizado ainda."
                    : "Nenhum cálculo encontrado neste filtro."}
                </p>
                {totalCalculos === 0 && (
                  <button
                    onClick={() => setLocation("/calculos/trabalhista")}
                    className="mt-3 inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-md bg-amber-600 text-white hover:bg-amber-700"
                  >
                    <Plus className="h-3.5 w-3.5" /> Fazer primeiro cálculo
                  </button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
              {historicoFiltrado.map((h) => {
                const sub = submoduloPorTipo[h.tipo];
                if (!sub) return null;
                const Icone = sub.icone;
                const valor = formatBRL(h.diferencaTotal);
                return (
                  <button
                    key={h.id}
                    onClick={() => setLocation(sub.path)}
                    className="w-full flex items-center gap-3 p-4 hover:bg-slate-50 text-left"
                  >
                    <div className={`p-2 ${sub.cor.iconBg} rounded-lg shrink-0`}>
                      <Icone className={`w-4 h-4 ${sub.cor.iconFg}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{h.titulo}</p>
                      <p className="text-xs text-slate-500 truncate">
                        {tempoRelativo(h.createdAt)}
                        {h.protocolo ? ` · ${h.protocolo}` : ""}
                        {h.temParecer ? " · com parecer" : ""}
                      </p>
                    </div>
                    {valor && (
                      <span className="text-sm font-bold tabular-nums text-slate-800">{valor}</span>
                    )}
                    <MoreVertical className="w-4 h-4 text-slate-300 shrink-0" />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-componentes ─────────────────────────────────────────────────────────

function ChipFiltro({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const base =
    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all";
  if (ativo) {
    return (
      <button onClick={onClick} className={`${base} bg-slate-900 text-white border-slate-900`}>
        {children}
      </button>
    );
  }
  return (
    <button
      onClick={onClick}
      className={`${base} bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900`}
    >
      {children}
    </button>
  );
}

function CountPill({ children, ativo }: { children: React.ReactNode; ativo: boolean }) {
  if (ativo) {
    return (
      <span className="bg-white/20 px-1.5 rounded-full text-[10px] tabular-nums">{children}</span>
    );
  }
  return (
    <span className="bg-slate-100 text-slate-600 px-1.5 rounded-full text-[10px] tabular-nums">
      {children}
    </span>
  );
}

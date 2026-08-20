/**
 * Casca compartilhada dos relatórios: seletor de relatório, barra de filtro
 * e blocos visuais reusados pelas abas.
 *
 * O período mora aqui (e no pai, `Relatorios`) e não em cada aba, porque o
 * uso real é comparar o mesmo intervalo entre relatórios — antes cada aba
 * montava a própria barra e trocar de aba jogava o período fora.
 */

import { createContext, useContext, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ArrowDownRight, ArrowUpRight, ChevronDown } from "lucide-react";
import { type DeltaKpi, formatarDelta } from "@shared/relatorios-comparativo";

export {
  calcularDelta, calcularDeltaPontos, periodoAnterior,
  type DeltaKpi,
} from "@shared/relatorios-comparativo";

// ─────────────────────────── período ───────────────────────────

export type PresetPeriodo = "7d" | "30d" | "90d" | "mes" | "custom";

export interface Periodo {
  preset: PresetPeriodo;
  inicio: string;
  fim: string;
}

const iso = (d: Date) => {
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
};

export function rangeDoPreset(preset: Exclude<PresetPeriodo, "custom">): {
  inicio: string;
  fim: string;
} {
  const hoje = new Date();
  if (preset === "mes") {
    return { inicio: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), fim: iso(hoje) };
  }
  const dias = preset === "7d" ? 7 : preset === "30d" ? 30 : 90;
  const ini = new Date(hoje.getTime() - (dias - 1) * 24 * 60 * 60 * 1000);
  return { inicio: iso(ini), fim: iso(hoje) };
}

export function periodoInicial(preset: Exclude<PresetPeriodo, "custom"> = "30d"): Periodo {
  return { preset, ...rangeDoPreset(preset) };
}

/** Rótulo humano do intervalo — usado no rodapé e nos exports. */
export function rotuloPeriodo(p: Periodo): string {
  const br = (s: string) => s.split("-").reverse().join("/");
  return `${br(p.inicio)} a ${br(p.fim)}`;
}

interface CtxRelatorios {
  periodo: Periodo;
  setPeriodo: (p: Periodo) => void;
  comparar: boolean;
  setComparar: (v: boolean) => void;
  /** Div na linha das abas onde as ações (PDF/e-mail/programar) se penduram
   *  via portal. Null enquanto a linha não montou → as ações caem no lugar
   *  antigo, acima da barra de filtros. */
  slotAcoes: HTMLElement | null;
  setSlotAcoes: (el: HTMLElement | null) => void;
}

const Ctx = createContext<CtxRelatorios | null>(null);

export function useRelatorios(): CtxRelatorios {
  const v = useContext(Ctx);
  if (!v) throw new Error("useRelatorios fora do ProvedorRelatorios");
  return v;
}

export function ProvedorRelatorios({ children }: { children: React.ReactNode }) {
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoInicial());
  const [comparar, setComparar] = useState(true);
  const [slotAcoes, setSlotAcoes] = useState<HTMLElement | null>(null);
  const valor = useMemo(
    () => ({ periodo, setPeriodo, comparar, setComparar, slotAcoes, setSlotAcoes }),
    [periodo, comparar, slotAcoes],
  );
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

// ─────────────────────────── barra de filtro ───────────────────────────

const PRESETS: Array<{ id: PresetPeriodo; label: string }> = [
  { id: "7d", label: "7 dias" },
  { id: "30d", label: "30 dias" },
  { id: "90d", label: "90 dias" },
  { id: "mes", label: "Este mês" },
  { id: "custom", label: "Personalizado" },
];

/**
 * Barra única: presets de período à esquerda, filtros do relatório no meio
 * (via `children`) e o comparativo à direita.
 */
export function BarraFiltro({ children }: { children?: React.ReactNode }) {
  const { periodo, setPeriodo, comparar, setComparar } = useRelatorios();

  const escolher = (id: PresetPeriodo) => {
    if (id === "custom") {
      setPeriodo({ ...periodo, preset: "custom" });
      return;
    }
    setPeriodo({ preset: id, ...rangeDoPreset(id) });
  };

  return (
    <Card className="border-border/70">
      <CardContent className="p-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => escolher(p.id)}
                className={`h-7 rounded-md px-2.5 text-xs font-medium transition-colors ${
                  periodo.preset === p.id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {periodo.preset === "custom" && (
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={periodo.inicio}
                max={periodo.fim}
                onChange={(e) => setPeriodo({ ...periodo, preset: "custom", inicio: e.target.value })}
                className="h-7 rounded-md border bg-background px-2 text-xs"
              />
              <span className="text-xs text-muted-foreground">até</span>
              <input
                type="date"
                value={periodo.fim}
                min={periodo.inicio}
                onChange={(e) => setPeriodo({ ...periodo, preset: "custom", fim: e.target.value })}
                className="h-7 rounded-md border bg-background px-2 text-xs"
              />
            </div>
          )}

          {children}

          <div className="flex-1" />

          <label className="flex items-center gap-2 rounded-lg border px-2.5 h-8 cursor-pointer select-none">
            <Checkbox
              checked={comparar}
              onCheckedChange={(v) => setComparar(v === true)}
              className="h-3.5 w-3.5"
            />
            <span className="text-xs">Comparar com período anterior</span>
          </label>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Filtro de marcar vários — o padrão aprovado no mockup dos Relatórios:
 * botão com rótulo + contagem, popover com busca, "marcar todos · limpar",
 * linhas com checkbox e o rodapé com Aplicar. Lista vazia = "Todos".
 *
 * A seleção só sai do popover no Aplicar (rascunho local): cada clique num
 * checkbox NÃO dispara query — quem marca 4 atendentes paga uma consulta,
 * não quatro.
 */
export function FiltroMulti({
  rotulo,
  selecionados,
  onAplicar,
  opcoes,
  placeholderBusca,
}: {
  rotulo: string;
  /** Ids marcados. Vazio = sem filtro (todos). */
  selecionados: number[];
  onAplicar: (ids: number[]) => void;
  opcoes: Array<{ id: number; label: string; extra?: string }>;
  placeholderBusca?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [rascunho, setRascunho] = useState<Set<number>>(new Set());

  const abrir = (v: boolean) => {
    if (v) {
      setRascunho(new Set(selecionados));
      setBusca("");
    }
    setAberto(v);
  };
  const alternar = (id: number) => {
    setRascunho((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  };
  const aplicar = () => {
    // Marcar todos = mesmo efeito de nenhum: normaliza pra "sem filtro" e a
    // query não carrega uma lista de ids que não restringe nada.
    const ids = rascunho.size >= opcoes.length ? [] : [...rascunho];
    onAplicar(ids);
    setAberto(false);
  };

  const visiveis = busca.trim()
    ? opcoes.filter((o) => o.label.toLowerCase().includes(busca.trim().toLowerCase()))
    : opcoes;

  const nomesSel = selecionados
    .map((id) => opcoes.find((o) => o.id === id)?.label)
    .filter(Boolean) as string[];
  const resumo = !selecionados.length
    ? "Todos"
    : nomesSel.length <= 2
      ? nomesSel.join(", ")
      : `${nomesSel.slice(0, 2).join(", ")} +${nomesSel.length - 2}`;

  return (
    <Popover open={aberto} onOpenChange={abrir}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`flex h-8 items-center gap-1.5 rounded-lg border pl-2.5 pr-2 text-xs transition-colors ${
            selecionados.length ? "border-violet-400 dark:border-violet-700" : ""
          }`}
        >
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {rotulo}
          </span>
          {selecionados.length > 0 && (
            <span className="rounded-full bg-violet-600 px-1.5 text-[10px] font-bold text-white">
              {selecionados.length}
            </span>
          )}
          <span className={`max-w-[180px] truncate font-medium ${selecionados.length ? "" : "text-muted-foreground"}`}>
            {resumo}
          </span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2.5">
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder={placeholderBusca ?? "Buscar…"}
          className="h-8 text-xs"
        />
        <div className="mt-2 mb-1 flex items-center justify-between px-1">
          <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            {rotulo}
          </span>
          <span className="text-[11px] font-semibold text-violet-600 dark:text-violet-400">
            <button type="button" onClick={() => setRascunho(new Set(opcoes.map((o) => o.id)))}>
              marcar todos
            </button>
            {" · "}
            <button type="button" onClick={() => setRascunho(new Set())}>limpar</button>
          </span>
        </div>
        <div className="max-h-64 overflow-y-auto">
          {visiveis.length === 0 && (
            <p className="px-1 py-3 text-xs text-muted-foreground">Nada com esse nome.</p>
          )}
          {visiveis.map((o) => (
            <label
              key={o.id}
              className={`flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1.5 ${
                rascunho.has(o.id) ? "bg-violet-50 dark:bg-violet-950/40" : "hover:bg-muted/60"
              }`}
            >
              <Checkbox
                checked={rascunho.has(o.id)}
                onCheckedChange={() => alternar(o.id)}
                className="h-3.5 w-3.5"
              />
              <span className="flex-1 truncate text-xs font-medium">{o.label}</span>
              {o.extra && <span className="text-[11px] text-muted-foreground">{o.extra}</span>}
            </label>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between border-t pt-2">
          <span className="text-[11px] font-semibold text-muted-foreground">
            {rascunho.size === 0 || rascunho.size >= opcoes.length
              ? "Todos"
              : `${rascunho.size} de ${opcoes.length} selecionados`}
          </span>
          <Button size="sm" className="h-7 px-4 text-xs" onClick={aplicar}>
            Aplicar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Select compacto pra dentro da barra — rótulo embutido, sem label solta. */
export function FiltroSelect({
  rotulo,
  valor,
  onChange,
  opcoes,
}: {
  rotulo: string;
  valor: string;
  onChange: (v: string) => void;
  opcoes: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="flex items-center gap-1.5 rounded-lg border h-8 pl-2.5 pr-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {rotulo}
      </span>
      <select
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className="h-full bg-transparent text-xs outline-none cursor-pointer max-w-[150px]"
      >
        {opcoes.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

// ─────────────────────────── KPI comparativo ───────────────────────────

export function Delta({ delta }: { delta: DeltaKpi | null }) {
  if (!delta) return null;
  const Icone = delta.valor > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${
        delta.bom
          ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400"
          : "bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400"
      }`}
    >
      <Icone className="h-3 w-3" />
      {formatarDelta(delta).replace(/^[+-]/, "")}
    </span>
  );
}

export function KpiRel({
  label,
  valor,
  delta,
  anterior,
  cor,
}: {
  label: string;
  valor: string;
  delta?: DeltaKpi | null;
  /** Linha de apoio — normalmente "X no período anterior". */
  anterior?: React.ReactNode;
  cor?: string;
}) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="mt-1 flex items-baseline gap-2 flex-wrap">
        <span className={`text-2xl font-bold tracking-tight ${cor || ""}`}>{valor}</span>
        {delta !== undefined && <Delta delta={delta ?? null} />}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground min-h-[16px]">{anterior}</p>
    </div>
  );
}

// ─────────────────────────── blocos ───────────────────────────

export function CardRel({
  icone,
  titulo,
  aviso,
  children,
  className,
}: {
  icone?: React.ReactNode;
  titulo: string;
  /** Texto discreto à direita do título — contexto do número, não ação. */
  aviso?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border bg-card ${className || ""}`}>
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-2.5">
        {icone}
        <h3 className="text-sm font-semibold">{titulo}</h3>
        <div className="flex-1" />
        {aviso && <span className="text-[11px] text-muted-foreground">{aviso}</span>}
      </div>
      {children}
    </div>
  );
}

export function TituloSecao({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {children}
      </span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

/** Barras horizontais rotuladas — ranking simples com valor e percentual. */
export function BarrasRotuladas({
  itens,
  cor,
  mostrarPercentual = true,
}: {
  itens: Array<{ rotulo: string; valor: number; formatado?: string }>;
  cor: string;
  mostrarPercentual?: boolean;
}) {
  const max = Math.max(...itens.map((i) => i.valor), 1);
  const soma = itens.reduce((a, i) => a + i.valor, 0);
  return (
    <div className="px-4 pb-3.5 space-y-2">
      {itens.map((i, idx) => (
        <div key={idx} className="flex items-center gap-3">
          <span className="w-[42%] shrink-0 truncate text-xs">{i.rotulo}</span>
          <div className="flex-1 h-2.5 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full ${cor}`}
              style={{ width: `${Math.max((i.valor / max) * 100, 2)}%` }}
            />
          </div>
          <span className="w-12 shrink-0 text-right text-xs font-semibold tabular-nums">
            {i.formatado ?? i.valor.toLocaleString("pt-BR")}
          </span>
          {mostrarPercentual && (
            <span className="w-9 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
              {soma > 0 ? `${Math.round((i.valor / soma) * 100)}%` : "—"}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Série diária em barras. Fim de semana entra esmaecido — sem isso o vale
 * de sábado/domingo parece queda de desempenho.
 */
export function BarrasDiarias({
  dados,
  cor,
  altura = "h-40",
}: {
  dados: Array<{ dia: string; total: number }>;
  cor: string;
  altura?: string;
}) {
  const max = Math.max(...dados.map((d) => d.total), 1);
  if (dados.length === 0) {
    return (
      <p className="px-4 pb-6 pt-2 text-xs text-muted-foreground">Sem movimento no período.</p>
    );
  }
  return (
    <div className="px-4 pb-3.5">
      <div className={`flex items-end gap-[3px] ${altura}`}>
        {dados.map((d) => {
          const dt = new Date(`${d.dia}T12:00:00`);
          const fds = dt.getDay() === 0 || dt.getDay() === 6;
          return (
            <div
              key={d.dia}
              title={`${d.dia.slice(8, 10)}/${d.dia.slice(5, 7)} · ${d.total}`}
              className={`flex-1 min-w-[4px] rounded-t-[3px] ${cor} ${fds ? "opacity-30" : ""}`}
              style={{ height: `${Math.max((d.total / max) * 100, 2)}%` }}
            />
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground tabular-nums">
        <span>{dados[0].dia.slice(8, 10)}/{dados[0].dia.slice(5, 7)}</span>
        <span>
          {dados[dados.length - 1].dia.slice(8, 10)}/{dados[dados.length - 1].dia.slice(5, 7)}
        </span>
      </div>
    </div>
  );
}

/** Iniciais pro avatar do ranking — no máximo duas letras. */
export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

const CORES_AVATAR = [
  "bg-violet-500", "bg-sky-500", "bg-amber-500",
  "bg-emerald-500", "bg-rose-500", "bg-indigo-500",
];

export function Avatar({ nome, indice }: { nome: string; indice: number }) {
  return (
    <span
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white ${
        CORES_AVATAR[indice % CORES_AVATAR.length]
      }`}
    >
      {iniciais(nome)}
    </span>
  );
}

/**
 * Pastilha de taxa colorida **em relação à média do escritório**, não a um
 * corte fixo. Conversão típica varia demais entre escritórios (e entre
 * áreas do mesmo escritório) pra um "30% é bom" fazer sentido: o que a
 * tabela precisa responder é quem está acima e quem está abaixo da casa.
 * Sem referência, fica neutra.
 */
export function PastilhaTaxa({ taxa, referencia }: { taxa: number | null; referencia?: number | null }) {
  if (taxa == null) return <span className="text-muted-foreground">—</span>;
  const classe =
    referencia == null || referencia === 0
      ? "bg-muted text-foreground"
      : taxa >= referencia
        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400"
        : taxa >= referencia * 0.7
          ? "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400"
          : "bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-400";
  return (
    <span
      className={`inline-block rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${classe}`}
      title={referencia != null ? `Média do escritório no período: ${referencia}%` : undefined}
    >
      {taxa}%
    </span>
  );
}

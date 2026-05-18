/**
 * Helpers e sub-componentes compartilhados pelos dashboards por setor.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { ReactNode } from "react";

export function formatBRL(v: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

export function formatBRLShort(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `R$ ${(v / 1_000).toFixed(1)}k`;
  return formatBRL(v);
}

export function formatPercent(v: number | null): string {
  if (v == null) return "—";
  return `${v.toFixed(1)}%`;
}

/** Cor do indicador de progresso conforme % atingido. */
export function corMeta(progresso: number | null): string {
  if (progresso == null) return "bg-slate-400";
  if (progresso >= 100) return "bg-emerald-500";
  if (progresso >= 70) return "bg-blue-500";
  if (progresso >= 40) return "bg-amber-500";
  return "bg-rose-500";
}

/** KPI card grande — número + label + cor opcional. */
export function KPICard({
  label,
  value,
  hint,
  color = "text-foreground",
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  color?: string;
  icon?: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
          {icon}
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className={`text-3xl font-bold tracking-tight ${color}`}>{value}</p>
        {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
      </CardContent>
    </Card>
  );
}

/** Barra de progresso com label de % */
export function ProgressoMeta({
  faturado,
  meta,
  progressoMeta,
}: {
  faturado: number;
  meta: number | null;
  progressoMeta: number | null;
}) {
  if (meta == null || meta <= 0) {
    return (
      <div className="text-xs text-muted-foreground italic">
        Sem meta configurada para o período.
      </div>
    );
  }
  const valueClampado = Math.min(100, Math.max(0, progressoMeta ?? 0));
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-baseline gap-2">
        <span className="text-sm font-medium">{formatPercent(progressoMeta)}</span>
        <span className="text-xs text-muted-foreground">
          {formatBRLShort(faturado)} / {formatBRLShort(meta)}
        </span>
      </div>
      <Progress value={valueClampado} className="h-2" />
    </div>
  );
}

/** Linha de info simples — label esq, valor dir. */
export function InfoLinha({
  label,
  value,
  color,
}: {
  label: string;
  value: ReactNode;
  color?: string;
}) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-semibold ${color || ""}`}>{value}</span>
    </div>
  );
}

/** Banner amarelo de aviso (ex: "configure seu setor"). */
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
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 flex flex-wrap items-start gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-amber-900">{titulo}</p>
        <p className="text-xs text-amber-800 mt-1">{descricao}</p>
      </div>
      {acao}
    </div>
  );
}

/** Período do dashboard (mês vigente é o default). */
export function HeaderPeriodo({
  periodo,
}: {
  periodo: { dataInicio: string; dataFim: string };
}) {
  const ini = new Date(`${periodo.dataInicio}T00:00:00`);
  const fim = new Date(`${periodo.dataFim}T00:00:00`);
  const fmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });
  return (
    <p className="text-xs text-muted-foreground">
      Período: {fmt.format(ini)} — {fmt.format(fim)}
    </p>
  );
}

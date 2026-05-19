/**
 * Helpers compartilhados do módulo Financeiro.
 */
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { Check, Clock, AlertTriangle, RotateCcw, XCircle, Zap, CreditCard, Receipt, HelpCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Hook que retorna as permissões do usuário atual no módulo Financeiro.
 * Bate com `exigirAcaoFinanceiro` do backend — todas as procedures de
 * escrita verificam essa matriz. Default: tudo `true` durante o load
 * pra evitar flicker dos botões.
 *
 * Dono e admin do sistema sempre veem tudo (lógica idêntica ao AppLayout).
 */
export function useFinanceiroPerms(): {
  podeVer: boolean;
  podeCriar: boolean;
  podeEditar: boolean;
  podeExcluir: boolean;
} {
  const { data: minhasPerms } = (trpc as any).permissoes?.minhasPermissoes?.useQuery?.(
    undefined,
    { retry: false, refetchInterval: 5 * 60_000 },
  ) || { data: null };

  // Dono → tudo liberado, sem esperar carregar
  if (minhasPerms?.cargo === "Dono") {
    return { podeVer: true, podeCriar: true, podeEditar: true, podeExcluir: true };
  }
  // Loading → otimista (evita flicker de botões sumindo + reaparecendo)
  if (!minhasPerms?.permissoes) {
    return { podeVer: true, podeCriar: true, podeEditar: true, podeExcluir: true };
  }
  const p = minhasPerms.permissoes.financeiro;
  if (!p) {
    return { podeVer: false, podeCriar: false, podeEditar: false, podeExcluir: false };
  }
  return {
    podeVer: !!(p.verTodos || p.verProprios),
    podeCriar: !!p.criar,
    podeEditar: !!p.editar,
    podeExcluir: !!p.excluir,
  };
}

export function formatBRL(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

export function formatBRLShort(v: number) {
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `R$ ${(v / 1_000).toFixed(1)}k`;
  return formatBRL(v);
}

export function formatMes(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  const names = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  return `${names[m - 1]}/${String(y).slice(2)}`;
}

/** Formata "YYYY-MM-DD" → "DD/MM" pra ticks curtos de eixo. */
export function formatDiaCurto(iso: string): string {
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  return `${parts[2]}/${parts[1]}`;
}

/** Formata "YYYY-MM-DD" → "DD/MM/YYYY" pra tooltip/labels. */
export function formatDiaCompleto(iso: string): string {
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

/**
 * Pill com gradient sutil + ícone semântico. Mais "executivo" que o
 * Badge padrão — usado nas linhas da tabela de cobranças/despesas.
 */
export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; icon: LucideIcon }> = {
    PENDING: {
      label: "Pendente",
      cls: "bg-gradient-to-br from-amber-100 to-amber-200 text-amber-800 border-amber-300",
      icon: Clock,
    },
    RECEIVED: {
      label: "Recebido",
      cls: "bg-gradient-to-br from-emerald-100 to-emerald-200 text-emerald-800 border-emerald-300",
      icon: Check,
    },
    CONFIRMED: {
      label: "Confirmado",
      cls: "bg-gradient-to-br from-emerald-100 to-emerald-200 text-emerald-800 border-emerald-300",
      icon: Check,
    },
    RECEIVED_IN_CASH: {
      label: "Em dinheiro",
      cls: "bg-gradient-to-br from-emerald-100 to-emerald-200 text-emerald-800 border-emerald-300",
      icon: Check,
    },
    OVERDUE: {
      label: "Vencido",
      cls: "bg-gradient-to-br from-rose-100 to-rose-200 text-rose-800 border-rose-300",
      icon: AlertTriangle,
    },
    REFUNDED: {
      label: "Estornado",
      cls: "bg-slate-100 text-slate-600 border-slate-200",
      icon: RotateCcw,
    },
    CANCELLED: {
      label: "Cancelado",
      cls: "bg-slate-100 text-slate-600 border-slate-200",
      icon: XCircle,
    },
    ACTIVE: {
      label: "Ativa",
      cls: "bg-gradient-to-br from-emerald-100 to-emerald-200 text-emerald-800 border-emerald-300",
      icon: Check,
    },
    INACTIVE: {
      label: "Inativa",
      cls: "bg-slate-100 text-slate-600 border-slate-200",
      icon: XCircle,
    },
    EXPIRED: {
      label: "Expirada",
      cls: "bg-gradient-to-br from-rose-100 to-rose-200 text-rose-800 border-rose-300",
      icon: AlertTriangle,
    },
  };
  const cfg = map[status] || { label: status, cls: "bg-slate-100 text-slate-600 border-slate-200", icon: HelpCircle };
  const Icon = cfg.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${cfg.cls}`}
    >
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

/**
 * Forma de pagamento como ícone colorido + label.
 * Ícone bate com o canal (raio pra PIX, recibo pra boleto, etc.) —
 * mais rápido de bater olho na tabela do que letra abreviada.
 */
export function FormaBadge({ forma }: { forma: string }) {
  const map: Record<string, { label: string; icon: LucideIcon; color: string; bg: string }> = {
    PIX: { label: "PIX", icon: Zap, color: "text-cyan-600", bg: "bg-cyan-50" },
    BOLETO: { label: "Boleto", icon: Receipt, color: "text-amber-600", bg: "bg-amber-50" },
    CREDIT_CARD: { label: "Cartão", icon: CreditCard, color: "text-violet-600", bg: "bg-violet-50" },
    UNDEFINED: { label: "—", icon: HelpCircle, color: "text-slate-400", bg: "bg-slate-50" },
  };
  const cfg = map[forma] || { label: forma, icon: HelpCircle, color: "text-slate-400", bg: "bg-slate-50" };
  const Icon = cfg.icon;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-5 h-5 rounded ${cfg.bg} flex items-center justify-center shrink-0`}>
        <Icon className={`w-3 h-3 ${cfg.color}`} />
      </span>
      <span className="text-xs text-slate-700 font-medium">{cfg.label}</span>
    </span>
  );
}

export const CICLO_LABELS: Record<string, string> = {
  WEEKLY: "Semanal",
  BIWEEKLY: "Quinzenal",
  MONTHLY: "Mensal",
  BIMONTHLY: "Bimestral",
  QUARTERLY: "Trimestral",
  SEMIANNUALLY: "Semestral",
  YEARLY: "Anual",
};

/** Exporta cobranças para CSV (download no navegador) */
export function exportCobrancasCSV(cobrancas: any[]) {
  const headers = ["Cliente", "Valor", "Vencimento", "Forma", "Status", "Descrição"];
  const rows = cobrancas.map((c) => [
    `"${(c.nomeContato || "").replace(/"/g, '""')}"`,
    c.valor || "",
    c.vencimento || "",
    c.formaPagamento || "",
    c.status || "",
    `"${(c.descricao || "").replace(/"/g, '""')}"`,
  ]);
  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `cobrancas-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

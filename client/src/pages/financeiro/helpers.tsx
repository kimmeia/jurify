/**
 * Helpers compartilhados do módulo Financeiro.
 */
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";

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

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    PENDING: { label: "Pendente", cls: "bg-amber-500/15 text-amber-700 border-amber-500/25" },
    RECEIVED: { label: "Recebido", cls: "bg-emerald-500/15 text-emerald-700 border-emerald-500/25" },
    CONFIRMED: { label: "Confirmado", cls: "bg-emerald-500/15 text-emerald-700 border-emerald-500/25" },
    RECEIVED_IN_CASH: { label: "Em dinheiro", cls: "bg-emerald-500/15 text-emerald-700 border-emerald-500/25" },
    OVERDUE: { label: "Vencido", cls: "bg-red-500/15 text-red-700 border-red-500/25" },
    REFUNDED: { label: "Estornado", cls: "bg-gray-500/15 text-gray-600 border-gray-500/25" },
    CANCELLED: { label: "Cancelado", cls: "bg-gray-500/15 text-gray-600 border-gray-500/25" },
    ACTIVE: { label: "Ativa", cls: "bg-emerald-500/15 text-emerald-700 border-emerald-500/25" },
    INACTIVE: { label: "Inativa", cls: "bg-gray-500/15 text-gray-600 border-gray-500/25" },
    EXPIRED: { label: "Expirada", cls: "bg-red-500/15 text-red-700 border-red-500/25" },
  };
  const cfg = map[status] || { label: status, cls: "" };
  return <Badge className={`${cfg.cls} hover:${cfg.cls} text-[10px] font-normal`}>{cfg.label}</Badge>;
}

export function FormaBadge({ forma }: { forma: string }) {
  const icons: Record<string, string> = { BOLETO: "B", PIX: "P", CREDIT_CARD: "C", UNDEFINED: "?" };
  const labels: Record<string, string> = { BOLETO: "Boleto", PIX: "Pix", CREDIT_CARD: "Cartão", UNDEFINED: "Indef." };
  return <span className="text-xs text-muted-foreground">{icons[forma] || "?"} {labels[forma] || forma}</span>;
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

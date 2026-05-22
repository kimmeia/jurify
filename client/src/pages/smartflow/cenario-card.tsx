import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  AlertTriangle,
  CalendarCheck, CalendarClock, CalendarX,
  CheckCircle2,
  Clock,
  DollarSign,
  Edit, History, Loader2,
  MessageCircle,
  Play,
  Trash2,
  Users,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  getGatilhoMeta,
  type GatilhoSmartflow,
} from "@shared/smartflow-types";

/**
 * Cor da borda esquerda do card e gradient do avatar, mapeados por gatilho.
 * Mantém alinhamento com o "padrão de categoria" usado no SmartFlowHero:
 *   - mensagem  → azul
 *   - asaas     → verde/âmbar (varia por evento: recebido=verde, vencido=âmbar)
 *   - cal.com   → laranja
 *   - crm       → violeta
 *   - manual    → cinza
 */
function visualPorGatilho(gatilho: GatilhoSmartflow): {
  borderClass: string;
  avatarGradient: string;
  Icon: LucideIcon;
  badgeCor: string;
} {
  switch (gatilho) {
    case "whatsapp_mensagem":
    case "mensagem_canal":
      return {
        borderClass: "border-l-blue-500",
        avatarGradient: "from-blue-500 to-cyan-500",
        Icon: MessageCircle,
        badgeCor: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
      };
    case "pagamento_recebido":
      return {
        borderClass: "border-l-emerald-500",
        avatarGradient: "from-emerald-500 to-teal-600",
        Icon: DollarSign,
        badgeCor: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
      };
    case "pagamento_vencido":
      return {
        borderClass: "border-l-emerald-500",
        avatarGradient: "from-amber-500 to-red-500",
        Icon: AlertTriangle,
        badgeCor: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
      };
    case "pagamento_proximo_vencimento":
      return {
        borderClass: "border-l-emerald-500",
        avatarGradient: "from-amber-400 to-orange-500",
        Icon: Clock,
        badgeCor: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
      };
    case "novo_lead":
      return {
        borderClass: "border-l-violet-500",
        avatarGradient: "from-violet-500 to-pink-500",
        Icon: Users,
        badgeCor: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
      };
    case "agendamento_criado":
      return {
        borderClass: "border-l-orange-500",
        avatarGradient: "from-emerald-500 to-green-600",
        Icon: CalendarCheck,
        badgeCor: "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300",
      };
    case "agendamento_cancelado":
      return {
        borderClass: "border-l-orange-500",
        avatarGradient: "from-rose-500 to-pink-600",
        Icon: CalendarX,
        badgeCor: "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300",
      };
    case "agendamento_remarcado":
      return {
        borderClass: "border-l-orange-500",
        avatarGradient: "from-cyan-500 to-blue-500",
        Icon: CalendarClock,
        badgeCor: "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300",
      };
    case "agendamento_lembrete":
      return {
        borderClass: "border-l-orange-500",
        avatarGradient: "from-orange-500 to-amber-500",
        Icon: Clock,
        badgeCor: "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300",
      };
    case "manual":
      return {
        borderClass: "border-l-slate-500",
        avatarGradient: "from-slate-600 to-slate-800",
        Icon: Play,
        badgeCor: "bg-slate-100 text-slate-700 dark:bg-slate-900/60 dark:text-slate-300",
      };
  }
}

export interface CenarioCardData {
  id: number;
  nome: string;
  descricao?: string | null;
  gatilho: GatilhoSmartflow;
  ativo: boolean;
  /** Resumo do `configGatilho` em texto curto (ex: "≥ 3 dias de atraso"). */
  resumoGatilho?: string | null;
  /** Quantidade de passos cadastrados. */
  qtdPassos: number;
  /** Execuções últimos 7 dias. */
  execucoes7d?: number;
  /** Taxa de sucesso (concluído/total) últimos 7 dias, 0-100. */
  taxaSucessoPct?: number;
}

export function CenarioCard({
  cenario,
  onToggleAtivo,
  onExcluir,
  onExecutar,
  onAbrirHistorico,
  togglePending,
  executarPending,
}: {
  cenario: CenarioCardData;
  onToggleAtivo: (id: number, ativo: boolean) => void;
  onExcluir: (c: CenarioCardData) => void;
  onExecutar?: (id: number) => void;
  onAbrirHistorico?: (id: number) => void;
  togglePending?: boolean;
  executarPending?: boolean;
}) {
  const v = visualPorGatilho(cenario.gatilho);
  const metaGatilho = getGatilhoMeta(cenario.gatilho);
  const Icon = v.Icon;
  const isManual = cenario.gatilho === "manual";

  return (
    <div
      className={`relative rounded-xl border border-l-4 ${v.borderClass} bg-card p-4 transition-all hover:shadow-md hover:-translate-y-px ${
        !cenario.ativo ? "opacity-60" : ""
      }`}
    >
      <div className="absolute top-3 right-3">
        <Switch
          checked={cenario.ativo}
          onCheckedChange={(v: boolean) => onToggleAtivo(cenario.id, v)}
          disabled={togglePending}
          aria-label="Ativar/desativar cenário"
        />
      </div>

      <div className="flex items-start gap-2.5 mb-2 pr-12">
        <div
          className={`w-10 h-10 rounded-lg flex items-center justify-center text-white shrink-0 shadow-sm bg-gradient-to-br ${v.avatarGradient}`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold truncate" title={cenario.nome}>
            {cenario.nome}
          </p>
          <p className="text-[10px] text-muted-foreground truncate">
            {metaGatilho.label}
          </p>
        </div>
      </div>

      {cenario.descricao && (
        <p className="text-xs text-muted-foreground line-clamp-2 mb-3 leading-snug">
          {cenario.descricao}
        </p>
      )}

      <div className="flex flex-wrap gap-1 mb-3">
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${v.badgeCor}`}>
          {cenario.qtdPassos} {cenario.qtdPassos === 1 ? "passo" : "passos"}
        </span>
        {cenario.resumoGatilho && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
            {cenario.resumoGatilho}
          </span>
        )}
        {!cenario.ativo && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-400">
            Inativo
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 text-[10px] text-muted-foreground border-t pt-2.5 mb-2.5 min-h-[24px]">
        {cenario.execucoes7d !== undefined && (
          <div className="flex items-center gap-1">
            <strong className="text-foreground">{cenario.execucoes7d}</strong>
            <span>exec · 7d</span>
          </div>
        )}
        {cenario.taxaSucessoPct !== undefined && cenario.execucoes7d !== undefined && cenario.execucoes7d > 0 && (
          <div className="flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-3 w-3" />
            <span>{cenario.taxaSucessoPct}%</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1">
        {isManual && cenario.ativo && onExecutar ? (
          <Button
            size="sm"
            className="flex-1 text-[11px] h-7 bg-gradient-to-br from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700"
            onClick={() => onExecutar(cenario.id)}
            disabled={executarPending}
            title="Executar este cenário agora"
          >
            {executarPending ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <Play className="h-3 w-3 mr-1" />
            )}
            Executar agora
          </Button>
        ) : (
          <Button
            asChild
            size="sm"
            className="flex-1 text-[11px] h-7 bg-gradient-to-br from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700"
          >
            <Link href={`/smartflow/${cenario.id}/editar`}>
              <Edit className="h-3 w-3 mr-1" />
              Editar
            </Link>
          </Button>
        )}
        {isManual && cenario.ativo && onExecutar && (
          <Button
            asChild
            size="sm"
            variant="outline"
            className="text-[11px] h-7 px-2"
            title="Editar cenário"
          >
            <Link href={`/smartflow/${cenario.id}/editar`}>
              <Edit className="h-3 w-3" />
            </Link>
          </Button>
        )}
        {onAbrirHistorico && (
          <Button
            size="sm"
            variant="outline"
            className="text-[11px] h-7 px-2"
            title="Ver execuções deste cenário"
            onClick={() => onAbrirHistorico(cenario.id)}
          >
            <History className="h-3 w-3" />
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="text-[11px] h-7 px-2 text-destructive hover:text-destructive"
          title="Excluir cenário"
          onClick={() => onExcluir(cenario)}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

export function legendaCoresGatilho(): Array<{ cor: string; label: string }> {
  return [
    { cor: "bg-blue-500", label: "Mensagem (WhatsApp · Instagram · Facebook)" },
    { cor: "bg-emerald-500", label: "Asaas (recebido · vencido · próximo)" },
    { cor: "bg-orange-500", label: "Cal.com (agendamento)" },
    { cor: "bg-violet-500", label: "CRM (novo lead)" },
    { cor: "bg-slate-500", label: "Manual" },
  ];
}

/** Categoria normalizada por gatilho — usada pelo filtro de categoria na lista. */
export function categoriaDoGatilho(gatilho: GatilhoSmartflow): "mensagem" | "asaas" | "calcom" | "crm" | "manual" {
  if (gatilho === "whatsapp_mensagem" || gatilho === "mensagem_canal") return "mensagem";
  if (gatilho === "pagamento_recebido" || gatilho === "pagamento_vencido" || gatilho === "pagamento_proximo_vencimento") return "asaas";
  if (gatilho.startsWith("agendamento_")) return "calcom";
  if (gatilho === "novo_lead") return "crm";
  return "manual";
}

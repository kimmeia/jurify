import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarCheck, CalendarClock, CalendarX,
  Clock,
  DollarSign,
  Loader2,
  MessageCircle,
  Play,
  Save,
  Trash2,
  Users,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { getGatilhoMeta, type GatilhoSmartflow } from "@shared/smartflow-types";

const GATILHO_ICON: Record<GatilhoSmartflow, LucideIcon> = {
  whatsapp_mensagem: MessageCircle,
  mensagem_canal: MessageCircle,
  pagamento_recebido: DollarSign,
  pagamento_vencido: AlertTriangle,
  pagamento_proximo_vencimento: Clock,
  novo_lead: Users,
  agendamento_criado: CalendarCheck,
  agendamento_cancelado: CalendarX,
  agendamento_remarcado: CalendarClock,
  agendamento_lembrete: Clock,
  manual: Play,
};

const COR_ICONE_GATILHO: Record<GatilhoSmartflow, string> = {
  whatsapp_mensagem: "text-blue-500",
  mensagem_canal: "text-blue-500",
  pagamento_recebido: "text-emerald-500",
  pagamento_vencido: "text-amber-500",
  pagamento_proximo_vencimento: "text-amber-500",
  novo_lead: "text-violet-500",
  agendamento_criado: "text-orange-500",
  agendamento_cancelado: "text-orange-500",
  agendamento_remarcado: "text-orange-500",
  agendamento_lembrete: "text-orange-500",
  manual: "text-slate-500",
};

/**
 * Top bar do editor — identidade visual do módulo + meta-info inline
 * + controles primários (testar, salvar, ativar, excluir).
 *
 * Layout:
 *   [← Voltar] | [🪄 ícone] [Nome editável + meta] ... [⬤ Ativo] [▶ Testar] [🗑] [💾 Salvar]
 *
 * O switch Ativo e o botão Testar só aparecem em cenários já salvos
 * (`cenarioId` definido). Antes do primeiro save não há nada pra ativar
 * ou testar — o motor precisa dos passos persistidos no banco.
 */
export function EditorTopbar({
  nome,
  onNomeChange,
  gatilho,
  nPassos,
  dirty,
  ultimoSalvado,
  ativo,
  cenarioId,
  salvando,
  togglePending,
  onSalvar,
  onAtivoChange,
  onTestar,
  onExcluir,
}: {
  nome: string;
  onNomeChange: (n: string) => void;
  gatilho: GatilhoSmartflow;
  nPassos: number;
  dirty: boolean;
  ultimoSalvado: Date | null;
  ativo: boolean;
  cenarioId: number | null;
  salvando: boolean;
  togglePending?: boolean;
  onSalvar: () => void;
  onAtivoChange: (ativo: boolean) => void;
  onTestar: () => void;
  onExcluir: () => void;
}) {
  const meta = getGatilhoMeta(gatilho);
  const Icon = GATILHO_ICON[gatilho] ?? Zap;
  const corIcone = COR_ICONE_GATILHO[gatilho] ?? "text-slate-500";
  const novo = !cenarioId;

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b bg-background">
      <Button variant="ghost" size="sm" className="gap-1" asChild>
        <Link href="/smartflow">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Link>
      </Button>
      <div className="h-6 w-px bg-border" />

      {/* Ícone gradient do módulo */}
      <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-600 via-indigo-600 to-blue-600 flex items-center justify-center shadow-sm shrink-0">
        <Zap className="h-4 w-4 text-white" />
      </div>

      {/* Nome + meta-info */}
      <div className="flex-1 min-w-0">
        <Input
          value={nome}
          onChange={(e) => onNomeChange(e.target.value)}
          placeholder={novo ? "Dê um nome ao cenário..." : "Nome do cenário"}
          className="text-base font-bold border-none shadow-none bg-transparent focus-visible:bg-muted/50 px-1 h-auto py-0.5"
        />
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground px-1 mt-0.5 flex-wrap">
          <span className="flex items-center gap-1">
            <Icon className={`h-3 w-3 ${corIcone}`} />
            <span className="truncate max-w-[180px]">{meta.label}</span>
          </span>
          <span className="text-border">·</span>
          <span>{nPassos} {nPassos === 1 ? "passo" : "passos"}</span>
          <span className="text-border">·</span>
          <SaveStatus dirty={dirty} ultimoSalvado={ultimoSalvado} novo={novo} />
        </div>
      </div>

      {/* Switch Ativo (só em cenários salvos) */}
      {!novo && (
        <div
          className={`flex items-center gap-2 px-2 py-1.5 rounded-md border ${
            ativo
              ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-900"
              : "bg-slate-50 border-slate-200 dark:bg-slate-900/50 dark:border-slate-800"
          }`}
        >
          <Switch
            checked={ativo}
            onCheckedChange={onAtivoChange}
            disabled={togglePending}
            aria-label="Ativar/desativar cenário"
          />
          <span
            className={`text-[11px] font-semibold ${
              ativo
                ? "text-emerald-700 dark:text-emerald-300"
                : "text-slate-600 dark:text-slate-400"
            }`}
          >
            {ativo ? "Ativo" : "Inativo"}
          </span>
        </div>
      )}

      {/* Testar (só em cenários salvos) */}
      {!novo && (
        <Button
          variant="outline"
          size="sm"
          onClick={onTestar}
          className="gap-1.5"
          title="Executar cenário com contexto de teste"
        >
          <Play className="h-3.5 w-3.5" />
          Testar
        </Button>
      )}

      {/* Excluir (só em cenários salvos) */}
      {!novo && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onExcluir}
          className="text-destructive hover:text-destructive hover:bg-destructive/10 px-2"
          title="Excluir cenário"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}

      {/* Salvar */}
      <Button
        onClick={onSalvar}
        disabled={salvando}
        size="sm"
        className="gap-1.5 bg-gradient-to-br from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 shadow-md font-semibold px-4"
      >
        {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        {novo ? "Criar" : "Salvar"}
      </Button>
    </div>
  );
}

/** Indicador de "Salvo há X" / "Alterações não salvas" / "Sem salvar". */
function SaveStatus({
  dirty,
  ultimoSalvado,
  novo,
}: {
  dirty: boolean;
  ultimoSalvado: Date | null;
  novo: boolean;
}) {
  // Recomputa a cada 30s pra atualizar "há X min".
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(i);
  }, []);
  void tick; // referência só pra re-render

  if (novo && !ultimoSalvado) {
    return (
      <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
        <div className="w-1.5 h-1.5 rounded-full bg-amber-500"></div>
        Cenário novo
      </span>
    );
  }

  if (dirty) {
    return (
      <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
        <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></div>
        Alterações não salvas
      </span>
    );
  }

  if (!ultimoSalvado) {
    return null;
  }

  return (
    <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
      Salvo {formatRelativeTime(ultimoSalvado)}
    </span>
  );
}

/**
 * Formato em pt-BR pra "há X min / há X h / há X dias / agora mesmo".
 * Não usa libs externas (date-fns já está no projeto mas mantemos local
 * pra desacoplar). Recebe Date e retorna string sem prefixo "há".
 */
function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const seg = Math.floor(diffMs / 1000);
  if (seg < 30) return "agora mesmo";
  if (seg < 90) return "há 1 min";
  const min = Math.floor(seg / 60);
  if (min < 60) return `há ${min} min`;
  const horas = Math.floor(min / 60);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.floor(horas / 24);
  return `há ${dias} dia${dias > 1 ? "s" : ""}`;
}

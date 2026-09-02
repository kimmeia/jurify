import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Bot, Edit, Trash2, FileIcon, KeyRound, MessageSquare, BrainCircuit, Copy, BarChart3,
} from "lucide-react";

export type AgenteOrigem = "template" | "escritorio" | "pessoal";

export interface AgenteCardData {
  id: number;
  nome: string;
  descricao?: string | null;
  areaConhecimento?: string | null;
  modelo: string;
  modulosPermitidos?: string[];
  totalDocumentos: number;
  ativo?: boolean;
  temApiKey?: boolean;
  origem: AgenteOrigem;
  /** Apenas para templates */
  badge?: "popular" | "novo" | "verificado" | null;
  /** Métricas dos últimos 7 dias (escritório/pessoal) */
  metricas?: {
    usos7d?: number;
    tokens7d?: number;
    satisfacaoPct?: number;
  };
}

const AVATAR_GRADIENTS = [
  "from-info to-danger",
  "from-info to-info",
  "from-warning to-danger",
  "from-success to-success",
  "from-info to-info",
  "from-danger to-danger",
  "from-success to-success",
  "from-danger to-info",
];
function gradientFromName(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h) + name.charCodeAt(i);
  return AVATAR_GRADIENTS[Math.abs(h) % AVATAR_GRADIENTS.length];
}

function modeloLabel(modelo: string): { label: string; cor: string } {
  if (modelo.includes("claude")) {
    return { label: modelo.includes("haiku") ? "Claude Haiku" : modelo.includes("opus") ? "Claude Opus" : "Claude Sonnet", cor: "bg-danger-bg text-danger-fg dark:text-danger" };
  }
  if (modelo.includes("gpt")) {
    return { label: modelo.includes("mini") ? "GPT-4o mini" : modelo.includes("turbo") ? "GPT-4 Turbo" : "GPT-4o", cor: "bg-success-bg text-success-fg dark:text-success" };
  }
  return { label: modelo, cor: "bg-muted text-foreground" };
}

const MODULO_ICONS: Record<string, string> = {
  atendimento: "💬",
  analiseProcessual: "⚖️",
  resumos: "📋",
  documentos: "📜",
  pesquisa: "🔍",
  calculos: "🧮",
};

const BADGE_INFO: Record<NonNullable<AgenteCardData["badge"]>, { text: string; cor: string }> = {
  popular: { text: "🏆 Popular", cor: "bg-warning text-warning-on" },
  novo: { text: "✨ Novo", cor: "bg-success text-success-on" },
  verificado: { text: "✓ Verificado", cor: "bg-info text-info-on" },
};

/**
 * Card uniforme para qualquer agente — templates da plataforma, agentes
 * do escritório ou pessoais. O `origem` define a cor da border-left e o
 * botão primário (Clonar para templates, Conversar para os já criados).
 */
export function AgenteCard({
  agente,
  onClone,
  onEditar,
  onTreinar,
  onExcluir,
  onToggleAtivo,
}: {
  agente: AgenteCardData;
  onClone?: (id: number) => void;
  onEditar?: (id: number) => void;
  onTreinar?: (id: number) => void;
  onExcluir?: (a: AgenteCardData) => void;
  onToggleAtivo?: (id: number, ativo: boolean) => void;
}) {
  const isTemplate = agente.origem === "template";
  const isPessoal = agente.origem === "pessoal";
  const borderColor =
    isTemplate ? "border-l-warning"
      : isPessoal ? "border-l-success"
        : "border-l-info";

  const modelo = modeloLabel(agente.modelo);

  return (
    <div className={`relative rounded-xl border border-l-4 ${borderColor} bg-card p-4 transition-all hover:shadow-md hover:-translate-y-px ${!agente.ativo && !isTemplate ? "opacity-60" : ""}`}>
      {/* Badge no canto superior direito (apenas templates) */}
      {agente.badge && BADGE_INFO[agente.badge] && (
        <span className={`absolute top-2.5 right-2.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${BADGE_INFO[agente.badge].cor}`}>
          {BADGE_INFO[agente.badge].text}
        </span>
      )}
      {!isTemplate && onToggleAtivo && (
        <div className="absolute top-3 right-3">
          <Switch
            checked={!!agente.ativo}
            onCheckedChange={(v) => onToggleAtivo(agente.id, v)}
            aria-label="Ativar/desativar agente"
          />
        </div>
      )}

      {/* Header com avatar + nome */}
      <div className="flex items-start gap-2.5 mb-2 pr-12">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-white text-base shrink-0 shadow-sm bg-gradient-to-br ${gradientFromName(agente.nome)}`}>
          <Bot className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold truncate">{agente.nome}</p>
          <p className="text-[10px] text-muted-foreground truncate">
            {agente.areaConhecimento || "Geral"}
          </p>
        </div>
      </div>

      {/* Descrição */}
      {agente.descricao && (
        <p className="text-xs text-muted-foreground line-clamp-2 mb-3 leading-snug">
          {agente.descricao}
        </p>
      )}

      {/* Tags: modelo + módulos */}
      <div className="flex flex-wrap gap-1 mb-3">
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${modelo.cor}`}>
          {modelo.label}
        </span>
        {(agente.modulosPermitidos || []).slice(0, 3).map((m) => (
          <span
            key={m}
            className="text-[9px] px-1.5 py-0.5 rounded bg-info-bg text-info-fg dark:text-info"
            title={m}
          >
            {MODULO_ICONS[m] || ""} {m}
          </span>
        ))}
        {(agente.modulosPermitidos || []).length > 3 && (
          <span className="text-[9px] px-1.5 py-0.5 rounded text-muted-foreground">
            +{agente.modulosPermitidos!.length - 3}
          </span>
        )}
      </div>

      {/* Métricas */}
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground border-t pt-2.5 mb-2.5">
        <div className="flex items-center gap-1">
          <FileIcon className="h-3 w-3" />
          <span>{agente.totalDocumentos} {agente.totalDocumentos === 1 ? "doc" : "docs"}</span>
        </div>
        {agente.metricas?.usos7d !== undefined && (
          <div className="flex items-center gap-1">
            <strong className="text-foreground">{agente.metricas.usos7d}</strong>
            <span>usos · 7d</span>
          </div>
        )}
        {agente.metricas?.satisfacaoPct !== undefined && (
          <div className="flex items-center gap-1 text-success-fg">
            <strong>{agente.metricas.satisfacaoPct}%</strong>
            <span>👍</span>
          </div>
        )}
        {!isTemplate && agente.temApiKey && (
          <div className="flex items-center gap-1 text-success-fg ml-auto">
            <KeyRound className="h-3 w-3" />
            <span>Key própria</span>
          </div>
        )}
      </div>

      {/* Ações */}
      <div className="flex items-center gap-1">
        {isTemplate ? (
          <>
            <Button
              size="sm"
              className="flex-1 text-[11px] h-7 bg-info"
              onClick={() => onClone?.(agente.id)}
            >
              <Copy className="h-3 w-3 mr-1" />
              Clonar p/ escritório
            </Button>
          </>
        ) : (
          <>
            <Button
              asChild
              size="sm"
              className="flex-1 text-[11px] h-7 bg-info"
              disabled={!agente.ativo}
            >
              <Link href={`/agentes-ia/${agente.id}/chat`}>
                <MessageSquare className="h-3 w-3 mr-1" />
                Conversar
              </Link>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-[11px] h-7 px-2"
              title="Treinar (docs + links + texto)"
              onClick={() => onTreinar?.(agente.id)}
            >
              <BrainCircuit className="h-3 w-3" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-[11px] h-7 px-2"
              title="Editar"
              onClick={() => onEditar?.(agente.id)}
            >
              <Edit className="h-3 w-3" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-[11px] h-7 px-2 text-destructive hover:text-destructive"
              title="Excluir"
              onClick={() => onExcluir?.(agente)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

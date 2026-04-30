/**
 * Visualização Kanban do Roadmap.
 *
 * 7 colunas (uma por status). Admin pode arrastar cards entre colunas
 * pra mudar status. Usuário comum vê em modo read-only.
 *
 * Status:
 *  - aguardando_aprovacao: "Sugestão" — visível só pra criador + admin
 *  - novo: aprovado, recém entrou
 *  - em_analise: time olhando
 *  - planejado: vai entrar no roadmap
 *  - em_desenvolvimento: sendo construído
 *  - lancado: pronto, em produção
 *  - recusado: não vai ser feito (collapsed por default — não polui o board)
 */

import { useState } from "react";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  ThumbsUp,
  AlertCircle,
  Loader2,
  Inbox,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

const STATUS_KANBAN = [
  "aguardando_aprovacao",
  "novo",
  "em_analise",
  "planejado",
  "em_desenvolvimento",
  "lancado",
  "recusado",
] as const;

type StatusKanban = typeof STATUS_KANBAN[number];
type Tone = "info" | "warning" | "success" | "neutral" | "accent" | "danger";

const STATUS_META: Record<StatusKanban, { label: string; tone: Tone }> = {
  aguardando_aprovacao: { label: "Sugestão", tone: "warning" },
  novo: { label: "Novo", tone: "neutral" },
  em_analise: { label: "Em análise", tone: "warning" },
  planejado: { label: "Planejado", tone: "info" },
  em_desenvolvimento: { label: "Em desenvolvimento", tone: "accent" },
  lancado: { label: "Lançado", tone: "success" },
  recusado: { label: "Recusado", tone: "neutral" },
};

const CATEGORIA_META: Record<string, { label: string; tone: Tone }> = {
  feature: { label: "Funcionalidade", tone: "accent" },
  bug: { label: "Bug", tone: "danger" },
  melhoria: { label: "Melhoria", tone: "info" },
};

/** Classes Tailwind por tone — usa tokens semânticos do `index.css`,
 *  então respeita light/dark automaticamente. */
const TONE_BADGE: Record<Tone, string> = {
  info: "bg-info-bg text-info-fg",
  warning: "bg-warning-bg text-warning-fg",
  success: "bg-success-bg text-success-fg",
  neutral: "bg-neutral-bg text-neutral-fg",
  accent: "bg-accent-purple-bg text-accent-purple-fg",
  danger: "bg-danger-bg text-danger-fg",
};

const TONE_BORDER: Record<Tone, string> = {
  info: "border-l-info",
  warning: "border-l-warning",
  success: "border-l-success",
  neutral: "border-l-neutral",
  accent: "border-l-accent-purple",
  danger: "border-l-danger",
};

interface RoadmapItem {
  id: number;
  titulo: string;
  descricao: string;
  categoria: string;
  status: StatusKanban;
  contagemVotos: number;
  autorNome: string;
  createdAt: string;
  jaVotou: boolean;
  criadoPor: number;
}

interface Props {
  itens: RoadmapItem[];
  isAdmin: boolean;
  userId: number;
  onAtualizarStatus: (id: number, status: StatusKanban) => void;
  onVotar: (id: number) => void;
  votandoId: number | null;
  atualizandoId: number | null;
}

export function RoadmapKanban({
  itens,
  isAdmin,
  userId,
  onAtualizarStatus,
  onVotar,
  votandoId,
  atualizandoId,
}: Props) {
  const sensors = useSensors(
    // 5px de tolerância pra clique não virar drag por engano (botão votar etc.)
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // "Recusado" começa collapsed — não polui o board com ideias mortas.
  const [recusadoAberto, setRecusadoAberto] = useState(false);

  // Decide quais colunas mostrar:
  // - Admin: TODAS (ele precisa ver e moderar "Sugestão")
  // - User comum: esconde "aguardando_aprovacao" SE não tem item próprio
  //   nesta coluna (não polui o board com coluna vazia).
  const temItemAguardando = itens.some((i) => i.status === "aguardando_aprovacao");
  const colunas = STATUS_KANBAN.filter((s) => {
    if (s !== "aguardando_aprovacao") return true;
    return isAdmin || temItemAguardando;
  });

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || !isAdmin) return;
    const itemId = Number(active.id);
    const novoStatus = over.id as StatusKanban;
    const item = itens.find((i) => i.id === itemId);
    if (!item || item.status === novoStatus) return;
    onAtualizarStatus(itemId, novoStatus);
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-4">
        {colunas.map((status) => {
          const meta = STATUS_META[status];
          const itensColuna = itens.filter((i) => i.status === status);
          const isRecusado = status === "recusado";
          const colapsada = isRecusado && !recusadoAberto;
          return (
            <Coluna
              key={status}
              status={status}
              label={meta.label}
              tone={meta.tone}
              count={itensColuna.length}
              isAdmin={isAdmin}
              colapsada={colapsada}
              onToggle={isRecusado ? () => setRecusadoAberto((v) => !v) : undefined}
            >
              {!colapsada && itensColuna.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  isAdmin={isAdmin}
                  userId={userId}
                  onVotar={onVotar}
                  votandoId={votandoId}
                  atualizandoId={atualizandoId}
                />
              ))}
              {!colapsada && itensColuna.length === 0 && (
                <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground/70">
                  <Inbox className="h-5 w-5" />
                  <p className="text-[11px]">
                    {status === "aguardando_aprovacao" && isAdmin
                      ? "Sem sugestões pendentes"
                      : "Vazio"}
                  </p>
                </div>
              )}
            </Coluna>
          );
        })}
      </div>
    </DndContext>
  );
}

// ─── Coluna ───────────────────────────────────────────────────────────────

function Coluna({
  status,
  label,
  tone,
  count,
  isAdmin,
  colapsada,
  onToggle,
  children,
}: {
  status: StatusKanban;
  label: string;
  tone: Tone;
  count: number;
  isAdmin: boolean;
  colapsada: boolean;
  onToggle?: () => void;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const colapsavel = !!onToggle;
  return (
    <div
      ref={setNodeRef}
      className={`
        flex-shrink-0 ${colapsada ? "w-44" : "w-72"} rounded-lg border bg-card
        border-l-4 ${TONE_BORDER[tone]}
        transition-all
        ${isOver && isAdmin ? "ring-2 ring-ring/50" : ""}
      `}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={!colapsavel}
        className={`
          w-full px-3 py-2 border-b flex items-center justify-between gap-2
          ${colapsavel ? "hover:bg-muted/50 cursor-pointer" : "cursor-default"}
          rounded-t-lg
        `}
      >
        <div className="flex items-center gap-2 min-w-0">
          {colapsavel && (colapsada ? (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          ))}
          <span className="text-sm font-semibold truncate">{label}</span>
          <Badge variant="secondary" className="text-[10px] h-5">{count}</Badge>
        </div>
        {status === "aguardando_aprovacao" && isAdmin && !colapsada && (
          <Badge className="text-[9px] h-5 bg-warning-bg text-warning-fg border-0">
            Modere
          </Badge>
        )}
      </button>
      {!colapsada && (
        <div className="p-2 space-y-2 max-h-[calc(100vh-280px)] overflow-y-auto">
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────

function ItemCard({
  item,
  isAdmin,
  userId,
  onVotar,
  votandoId,
  atualizandoId,
}: {
  item: RoadmapItem;
  isAdmin: boolean;
  userId: number;
  onVotar: (id: number) => void;
  votandoId: number | null;
  atualizandoId: number | null;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: item.id,
    disabled: !isAdmin,
  });

  const ehProprio = item.criadoPor === userId;
  const aguardando = item.status === "aguardando_aprovacao";
  const catMeta = CATEGORIA_META[item.categoria];

  return (
    <Card
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`
        ${isAdmin ? "cursor-grab active:cursor-grabbing" : ""}
        ${isDragging ? "opacity-30" : ""}
        ${aguardando ? "border-dashed" : ""}
        hover:shadow-md hover:border-foreground/20 transition-all
      `}
    >
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {catMeta && (
            <Badge className={`text-[9px] h-5 border-0 ${TONE_BADGE[catMeta.tone]}`}>
              {catMeta.label}
            </Badge>
          )}
          {aguardando && ehProprio && !isAdmin && (
            <Badge variant="outline" className="text-[9px] h-5 border-warning text-warning-fg">
              <AlertCircle className="h-2.5 w-2.5 mr-1" /> Aguardando
            </Badge>
          )}
          {atualizandoId === item.id && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-auto" />
          )}
        </div>

        <p className="text-sm font-semibold leading-tight">{item.titulo}</p>
        <p className="text-[11px] text-muted-foreground line-clamp-2 whitespace-pre-wrap leading-snug">
          {item.descricao}
        </p>

        <div className="flex items-center justify-between pt-2 border-t border-border/60">
          <div className="text-[10px] text-muted-foreground min-w-0 flex-1">
            <div className="font-medium truncate">{item.autorNome}</div>
            <div className="truncate">
              {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true, locale: ptBR })}
            </div>
          </div>
          {!aguardando && (
            <Button
              variant={item.jaVotou ? "default" : "outline"}
              size="sm"
              className="h-6 px-2 text-[11px] gap-1"
              onPointerDown={(e) => e.stopPropagation()} // não inicia drag ao clicar votar
              onClick={(e) => {
                e.stopPropagation();
                onVotar(item.id);
              }}
              disabled={votandoId === item.id}
            >
              {votandoId === item.id ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ThumbsUp className="h-3 w-3" />
              )}
              {item.contagemVotos}
            </Button>
          )}
          {aguardando && ehProprio && !isAdmin && (
            <span className="text-[10px] text-muted-foreground italic">aguardando admin</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

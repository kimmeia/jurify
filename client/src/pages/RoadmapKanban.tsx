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
 *  - recusado: não vai ser feito
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
import { ThumbsUp, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
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

const STATUS_META: Record<StatusKanban, { label: string; cor: string; corColuna: string }> = {
  aguardando_aprovacao: {
    label: "Sugestão",
    cor: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    corColuna: "bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900",
  },
  novo: {
    label: "Novo",
    cor: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
    corColuna: "bg-slate-50/50 dark:bg-slate-950/20 border-slate-200 dark:border-slate-800",
  },
  em_analise: {
    label: "Em análise",
    cor: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    corColuna: "bg-amber-50/30 dark:bg-amber-950/10 border-amber-200 dark:border-amber-900",
  },
  planejado: {
    label: "Planejado",
    cor: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
    corColuna: "bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900",
  },
  em_desenvolvimento: {
    label: "Em desenvolvimento",
    cor: "bg-orange-500/10 text-orange-700 dark:text-orange-300",
    corColuna: "bg-orange-50/50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-900",
  },
  lancado: {
    label: "Lançado",
    cor: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    corColuna: "bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900",
  },
  recusado: {
    label: "Recusado",
    cor: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
    corColuna: "bg-zinc-50/50 dark:bg-zinc-950/20 border-zinc-200 dark:border-zinc-800",
  },
};

const CATEGORIA_META: Record<string, { label: string; cor: string }> = {
  feature: { label: "Funcionalidade", cor: "bg-violet-500/10 text-violet-700" },
  bug: { label: "Bug", cor: "bg-red-500/10 text-red-700" },
  melhoria: { label: "Melhoria", cor: "bg-sky-500/10 text-sky-700" },
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

export function RoadmapKanban({ itens, isAdmin, userId, onAtualizarStatus, onVotar, votandoId, atualizandoId }: Props) {
  const sensors = useSensors(
    // 5px de tolerância pra clique não virar drag por engano (botão votar etc.)
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

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
          return (
            <Coluna
              key={status}
              status={status}
              label={meta.label}
              cor={meta.corColuna}
              count={itensColuna.length}
              isAdmin={isAdmin}
            >
              {itensColuna.map((item) => (
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
              {itensColuna.length === 0 && (
                <p className="text-[11px] text-muted-foreground text-center py-6">
                  {status === "aguardando_aprovacao" && isAdmin
                    ? "Sem sugestões pendentes."
                    : "Vazio."}
                </p>
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
  cor,
  count,
  isAdmin,
  children,
}: {
  status: StatusKanban;
  label: string;
  cor: string;
  count: number;
  isAdmin: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div
      ref={setNodeRef}
      className={`flex-shrink-0 w-72 rounded-lg border ${cor} ${isOver && isAdmin ? "ring-2 ring-violet-400" : ""}`}
    >
      <div className="px-3 py-2 border-b bg-background/50 rounded-t-lg flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{label}</span>
          <Badge variant="secondary" className="text-[10px] h-5">{count}</Badge>
        </div>
        {status === "aguardando_aprovacao" && isAdmin && (
          <Badge variant="outline" className="text-[9px] h-5 border-amber-400 text-amber-700">
            Modere
          </Badge>
        )}
      </div>
      <div className="p-2 space-y-2 max-h-[calc(100vh-280px)] overflow-y-auto">
        {children}
      </div>
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

  return (
    <Card
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`
        ${isAdmin ? "cursor-grab active:cursor-grabbing" : ""}
        ${isDragging ? "opacity-30" : ""}
        ${aguardando ? "border-dashed" : ""}
        hover:shadow-sm transition-shadow
      `}
    >
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start gap-1.5 flex-wrap">
          <Badge variant="secondary" className={`text-[9px] h-5 ${CATEGORIA_META[item.categoria]?.cor}`}>
            {CATEGORIA_META[item.categoria]?.label}
          </Badge>
          {aguardando && ehProprio && !isAdmin && (
            <Badge variant="outline" className="text-[9px] h-5 border-amber-400 text-amber-700">
              <AlertCircle className="h-2.5 w-2.5 mr-1" /> Aguardando aprovação
            </Badge>
          )}
          {atualizandoId === item.id && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-auto" />
          )}
        </div>

        <p className="text-sm font-medium leading-tight">{item.titulo}</p>
        <p className="text-[11px] text-muted-foreground line-clamp-2 whitespace-pre-wrap">
          {item.descricao}
        </p>

        <div className="flex items-center justify-between pt-1 border-t mt-2">
          <div className="text-[10px] text-muted-foreground">
            <div className="font-medium truncate max-w-[120px]">{item.autorNome}</div>
            <div>{formatDistanceToNow(new Date(item.createdAt), { addSuffix: true, locale: ptBR })}</div>
          </div>
          {!aguardando && (
            <Button
              variant={item.jaVotou ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs gap-1.5"
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

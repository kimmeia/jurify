/**
 * Timeline do card — agrega criação, movimentações entre colunas,
 * mudanças de responsável, comentários e conclusão num feed cronológico.
 *
 * Substitui o "HISTÓRICO" antigo que mostrava só movimentações.
 */

import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  MessageSquare,
  Sparkles,
  UserCog,
} from "lucide-react";

function formatarData(d: Date | string): string {
  const data = typeof d === "string" ? new Date(d) : d;
  return data.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TimelineCard({
  cardId,
  prazo,
}: {
  cardId: number;
  prazo?: Date | string | null;
}) {
  const { data, isLoading } = (trpc as any).kanban.historicoCard.useQuery(
    { cardId },
    {
      enabled: !!cardId,
      // Real-time: polling de 5s. Movimentações de outros usuários aparecem
      // sem precisar fechar+abrir o card.
      refetchInterval: 5000,
      refetchOnWindowFocus: true,
    },
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!data) return null;

  const eventos = data.eventos || [];

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
          Histórico
        </p>
        {data.concluido && (
          <Badge
            className={
              data.concluidoEmAtraso
                ? "bg-red-500/15 text-red-700 border-red-500/30 text-[10px]"
                : "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 text-[10px]"
            }
          >
            {data.concluidoEmAtraso ? "Concluído em atraso" : "Concluído no prazo"}
          </Badge>
        )}
      </div>

      {eventos.length === 0 && (
        <p className="text-[11px] text-muted-foreground italic">Sem histórico.</p>
      )}

      <div className="space-y-2">
        {eventos.map((ev: any, i: number) => {
          if (ev.tipo === "criado") {
            return (
              <div key={i} className="flex gap-2 text-xs">
                <div className="w-1 bg-slate-300 rounded shrink-0 self-stretch" />
                <Sparkles className="h-3.5 w-3.5 text-slate-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-foreground">Card criado</p>
                  <p className="text-[10px] text-muted-foreground">
                    {formatarData(ev.createdAt)}
                    {prazo && (
                      <>
                        {" · "}
                        Prazo: {new Date(prazo).toLocaleDateString("pt-BR")}
                      </>
                    )}
                  </p>
                </div>
              </div>
            );
          }

          if (ev.tipo === "movimentacao") {
            const ehConclusao = ev.destinoTipo === "conclusao";
            const corBar = ehConclusao
              ? ev.concluidoEmAtraso
                ? "bg-red-500"
                : "bg-emerald-500"
              : "bg-amber-400";
            const icone = ehConclusao ? (
              <CheckCircle2
                className={
                  ev.concluidoEmAtraso
                    ? "h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5"
                    : "h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5"
                }
              />
            ) : (
              <ArrowRight className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
            );

            return (
              <div key={i} className="flex gap-2 text-xs">
                <div className={`w-1 ${corBar} rounded shrink-0 self-stretch`} />
                {icone}
                <div className="flex-1">
                  <p>
                    <strong>{ehConclusao ? "Concluído" : "Movido"}</strong>
                    {": "}
                    <span className="text-muted-foreground">
                      {ev.origemNome} → {ev.destinoNome}
                    </span>
                    {ehConclusao && ev.concluidoEmAtraso === true && (
                      <span className="ml-2 text-[10px] text-red-600 font-semibold">
                        EM ATRASO
                      </span>
                    )}
                    {ehConclusao && ev.concluidoEmAtraso === false && (
                      <span className="ml-2 text-[10px] text-emerald-600 font-semibold">
                        NO PRAZO
                      </span>
                    )}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {ev.porNome && `Por ${ev.porNome} · `}
                    {formatarData(ev.createdAt)}
                  </p>
                </div>
              </div>
            );
          }

          if (ev.tipo === "responsavel") {
            return (
              <div key={i} className="flex gap-2 text-xs">
                <div className="w-1 bg-violet-400 rounded shrink-0 self-stretch" />
                <UserCog className="h-3.5 w-3.5 text-violet-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p>
                    <strong>Responsável:</strong>{" "}
                    <span className="text-muted-foreground">
                      {ev.anteriorNome ?? "(sem responsável)"} →{" "}
                      {ev.novoNome ?? "(removido)"}
                    </span>
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {ev.porNome && `Por ${ev.porNome} · `}
                    {formatarData(ev.createdAt)}
                  </p>
                </div>
              </div>
            );
          }

          if (ev.tipo === "comentario") {
            return (
              <div key={i} className="flex gap-2 text-xs">
                <div className="w-1 bg-blue-400 rounded shrink-0 self-stretch" />
                <MessageSquare className="h-3.5 w-3.5 text-blue-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-muted-foreground italic line-clamp-2">
                    "{ev.texto}"
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {ev.autorNome && `${ev.autorNome} · `}
                    {formatarData(ev.createdAt)}
                  </p>
                </div>
              </div>
            );
          }

          return null;
        })}
      </div>
    </div>
  );
}

import { trpc } from "@/lib/trpc";
import { Sparkles, AlertTriangle, Calendar, DollarSign, Clock, Loader2 } from "lucide-react";

function formatBRL(c: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(c / 100);
}

function diffDias(dateStr: any): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const diff = Math.floor((d.getTime() - Date.now()) / 86400000);
  if (diff < 0) return `${Math.abs(diff)}d atrás`;
  if (diff === 0) return "hoje";
  if (diff === 1) return "amanhã";
  return `em ${diff}d`;
}

/**
 * Magic Brief — prediz o motivo da conversa em 1 linha, com contexto
 * cross-module (processo + financeiro + agenda) em chips abaixo.
 */
export function MagicBrief({ conversaId }: { conversaId: number }) {
  const { data, isLoading } = trpc.atendimentoIa.briefInstantaneo.useQuery(
    { conversaId },
    { staleTime: 60_000, retry: false },
  );

  if (isLoading) {
    return (
      <div className="mx-4 mt-3 rounded-xl px-3.5 py-2.5 border border-violet-200/60 bg-gradient-to-br from-violet-50/50 to-indigo-50/30 flex items-center gap-2">
        <Loader2 className="h-3.5 w-3.5 text-violet-500 animate-spin" />
        <span className="text-xs text-violet-700">Analisando contexto…</span>
      </div>
    );
  }
  if (!data) return null;

  const ctx = data.contexto;
  const semIA = !data.ia;

  return (
    <div
      className="mx-4 mt-3 rounded-xl px-3.5 py-2.5 border border-violet-200 relative overflow-hidden"
      style={{
        background:
          "linear-gradient(135deg, rgba(139,92,246,0.04) 0%, rgba(99,102,241,0.04) 50%, rgba(236,72,153,0.04) 100%)",
      }}
    >
      <div className="flex items-start gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center flex-shrink-0 shadow-sm">
          <Sparkles className="h-3.5 w-3.5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] font-bold text-violet-700 uppercase tracking-wide">
              Brief Instantâneo
            </span>
            {semIA && (
              <span className="text-[9px] px-1.5 py-0 rounded bg-amber-100 text-amber-700 font-semibold">
                heurístico (IA não configurada)
              </span>
            )}
          </div>
          <p className="text-sm font-medium text-foreground leading-snug">{data.motivo}</p>

          {(ctx.proximaAudiencia || ctx.financeiro || ctx.ultimoAto || ctx.processos > 0) && (
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              {ctx.proximaAudiencia && (
                <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/80 border border-blue-200 text-[10px] font-medium">
                  <Calendar className="h-3 w-3 text-blue-600" />
                  <span className="text-blue-800">
                    {ctx.proximaAudiencia.titulo} · {diffDias(ctx.proximaAudiencia.data)}
                  </span>
                </div>
              )}
              {ctx.financeiro && (ctx.financeiro.vencidos > 0 || ctx.financeiro.pendentes > 0 || ctx.financeiro.pagos > 0) && (
                <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/80 border border-emerald-200 text-[10px] font-medium">
                  <DollarSign className="h-3 w-3 text-emerald-600" />
                  <span className="text-emerald-800">
                    {ctx.financeiro.pagos}/{ctx.financeiro.total} pagos
                    {ctx.financeiro.vencidos > 0 && (
                      <>
                        {" · "}
                        <span className="text-red-700 font-semibold">{ctx.financeiro.vencidos} vencido(s)</span>
                      </>
                    )}
                  </span>
                </div>
              )}
              {ctx.ultimoAto && (
                <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/80 border border-amber-200 text-[10px] font-medium">
                  <Clock className="h-3 w-3 text-amber-600" />
                  <span className="text-amber-800">
                    Último ato: {ctx.ultimoAto.tipo} · {diffDias(ctx.ultimoAto.data)}
                  </span>
                </div>
              )}
              {ctx.processos > 0 && (
                <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/80 border border-violet-200 text-[10px] font-medium">
                  <AlertTriangle className="h-3 w-3 text-violet-600" />
                  <span className="text-violet-800">{ctx.processos} processo(s) ativo(s)</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

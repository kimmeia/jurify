import { trpc } from "@/lib/trpc";
import { Sparkles, AlertTriangle, Calendar, DollarSign, Clock, Loader2, X, ChevronDown } from "lucide-react";

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
export function MagicBrief({
  conversaId,
  onRecolher,
}: {
  conversaId: number;
  onRecolher?: () => void;
}) {
  const { data, isLoading } = trpc.atendimentoIa.briefInstantaneo.useQuery(
    { conversaId },
    { staleTime: 60_000, retry: false },
  );

  if (isLoading) {
    return (
      <div className="mx-4 mt-3 rounded-xl px-3.5 py-2.5 border border-info/30 bg-gradient-to-br from-info-bg/50 to-info-bg/30 flex items-center gap-2">
        <Loader2 className="h-3.5 w-3.5 text-info animate-spin" />
        <span className="text-xs text-info-fg">Analisando contexto…</span>
      </div>
    );
  }
  if (!data) return null;

  const ctx = data.contexto;
  const semIA = !data.ia;

  return (
    <div
      className="mx-4 mt-3 rounded-xl px-3.5 py-2.5 border border-info/30 relative overflow-hidden"
      style={{
        background:
          "color-mix(in oklab, var(--primary) 4%, transparent)",
      }}
    >
      {onRecolher && (
        <button
          onClick={onRecolher}
          title="Recolher contexto (Brief, eventos e SLA)"
          className="absolute top-2 right-2 w-5 h-5 rounded-md border border-info/30 bg-white/90 text-info-fg hover:bg-info-bg flex items-center justify-center z-10"
        >
          <X className="h-3 w-3" />
        </button>
      )}
      <div className="flex items-start gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-info flex items-center justify-center flex-shrink-0 shadow-sm">
          <Sparkles className="h-3.5 w-3.5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] font-bold text-info-fg uppercase tracking-wide">
              Brief Instantâneo
            </span>
            {semIA && (
              <span className="text-[9px] px-1.5 py-0 rounded bg-warning-bg text-warning-fg font-semibold">
                heurístico (IA não configurada)
              </span>
            )}
          </div>
          <p className="text-sm font-medium text-foreground leading-snug">{data.motivo}</p>

          {(ctx.proximaAudiencia || ctx.financeiro || ctx.ultimoAto || ctx.processos > 0) && (
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              {ctx.proximaAudiencia && (
                <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/80 border border-info/30 text-[10px] font-medium">
                  <Calendar className="h-3 w-3 text-info-fg" />
                  <span className="text-info-fg">
                    {ctx.proximaAudiencia.titulo} · {diffDias(ctx.proximaAudiencia.data)}
                  </span>
                </div>
              )}
              {ctx.financeiro && (ctx.financeiro.vencidos > 0 || ctx.financeiro.pendentes > 0 || ctx.financeiro.pagos > 0) && (
                <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/80 border border-success/30 text-[10px] font-medium">
                  <DollarSign className="h-3 w-3 text-success-fg" />
                  <span className="text-success-fg">
                    {ctx.financeiro.pagos}/{ctx.financeiro.total} pagos
                    {ctx.financeiro.vencidos > 0 && (
                      <>
                        {" · "}
                        <span className="text-danger-fg font-semibold">{ctx.financeiro.vencidos} vencido(s)</span>
                      </>
                    )}
                  </span>
                </div>
              )}
              {ctx.ultimoAto && (
                <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/80 border border-warning/30 text-[10px] font-medium">
                  <Clock className="h-3 w-3 text-warning-fg" />
                  <span className="text-warning-fg">
                    Último ato: {ctx.ultimoAto.tipo} · {diffDias(ctx.ultimoAto.data)}
                  </span>
                </div>
              )}
              {ctx.processos > 0 && (
                <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/80 border border-info/30 text-[10px] font-medium">
                  <AlertTriangle className="h-3 w-3 text-info-fg" />
                  <span className="text-info-fg">{ctx.processos} processo(s) ativo(s)</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Barra compacta do contexto recolhido — substitui Brief + Diff + Action
 * Cards quando o atendente fecha o bloco (✕). Resume o essencial em uma
 * linha clicável; SLA crítico continua em vermelho mesmo recolhido.
 * Reusa a query do brief (mesmo cache — sem request extra).
 */
export function ContextoRecolhidoBar({
  conversaId,
  slaCritico,
  onExpandir,
}: {
  conversaId: number;
  slaCritico?: boolean;
  onExpandir: () => void;
}) {
  const { data } = trpc.atendimentoIa.briefInstantaneo.useQuery(
    { conversaId },
    { staleTime: 60_000, retry: false },
  );
  const ctx = data?.contexto;

  return (
    <button
      onClick={onExpandir}
      title="Expandir contexto (Brief, eventos e SLA)"
      className="mx-4 mt-3 flex items-center gap-2 flex-wrap rounded-full border border-dashed border-info/30 bg-info-bg/70 hover:bg-info-bg/70 px-3 py-1.5 text-[10px] transition-colors text-left"
    >
      <span className="inline-flex items-center gap-1 font-bold text-info-fg">
        <Sparkles className="h-3 w-3" /> Brief
      </span>
      {ctx?.proximaAudiencia && (
        <span className="inline-flex items-center gap-1 font-semibold text-info-fg">
          <Calendar className="h-3 w-3" /> {diffDias(ctx.proximaAudiencia.data)}
        </span>
      )}
      {ctx?.financeiro && ctx.financeiro.total > 0 && (
        <span className="inline-flex items-center gap-1 font-semibold text-success-fg">
          <DollarSign className="h-3 w-3" />
          {ctx.financeiro.pagos}/{ctx.financeiro.total}
          {ctx.financeiro.vencidos > 0 && (
            <span className="text-danger-fg font-bold">· {ctx.financeiro.vencidos} venc.</span>
          )}
        </span>
      )}
      {slaCritico && (
        <span className="inline-flex items-center gap-1 font-bold text-danger-fg">
          <Clock className="h-3 w-3" /> SLA crítico
        </span>
      )}
      <ChevronDown className="h-3.5 w-3.5 text-info-fg ml-auto shrink-0" />
    </button>
  );
}

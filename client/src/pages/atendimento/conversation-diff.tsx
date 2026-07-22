import { trpc } from "@/lib/trpc";
import { Zap, ArrowUpRight, X } from "lucide-react";
import { useState } from "react";

function formatBRL(c: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(c / 100);
}

/** Chave por conversa no localStorage — guarda a "impressão digital" do
 *  estado dispensado. Novidade nova muda a impressão e o banner reaparece. */
const dismissKey = (conversaId: number) => `jurify_convdiff_dismiss_${conversaId}`;

function lerDispensado(conversaId: number): string | null {
  try {
    return localStorage.getItem(dismissKey(conversaId));
  } catch {
    return null;
  }
}

/**
 * Conversation Diff — banner âmbar mostrando o que mudou desde a última
 * mensagem enviada pelo atendente. Reduz tempo de re-contextualização.
 *
 * Dispensável por conversa (X): guarda a impressão digital do estado atual
 * (desde + contadores) no localStorage. Enquanto nada muda, fica oculto;
 * qualquer novidade nova (outra mensagem, ato, pagamento, prazo) altera a
 * impressão e o banner volta sozinho.
 */
export function ConversationDiff({ conversaId }: { conversaId: number }) {
  const [expandido, setExpandido] = useState(false);
  const [, forcarRender] = useState(0);
  const { data } = trpc.atendimentoIa.conversationDiff.useQuery(
    { conversaId },
    { staleTime: 30_000, retry: false },
  );

  if (!data || data.primeiraInteracao) return null;
  const e = data.eventos;
  const haNovidades = e.mensagens > 0 || e.atos > 0 || e.pagosCent > 0 || e.prazos > 0;
  if (!haNovidades) return null;

  const impressao = `${data.desde ?? ""}|${e.mensagens}|${e.atos}|${e.pagosCent}|${e.prazos}`;
  if (lerDispensado(conversaId) === impressao) return null;

  const dispensar = () => {
    try {
      localStorage.setItem(dismissKey(conversaId), impressao);
    } catch { /* storage indisponível — só não persiste */ }
    forcarRender((v) => v + 1);
  };

  const atos = data.atos || [];
  const prazos = data.prazos || [];
  const diasDesde = data.diasDesde || 0;

  return (
    <div className="mx-4 mt-2 rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50/80 to-orange-50/40 overflow-hidden">
      <div className="flex items-stretch">
        <button
          onClick={() => setExpandido((v) => !v)}
          className="flex-1 min-w-0 px-3.5 py-2 flex items-center gap-2.5 hover:bg-amber-100/40 transition-colors text-left"
        >
          <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center flex-shrink-0">
            <Zap className="h-3 w-3 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-[10px] font-bold text-amber-700 uppercase tracking-wide">
              Desde sua última resposta
              {diasDesde > 0 && <span className="text-amber-600">· há {diasDesde}d</span>}
            </div>
            <div className="flex items-center gap-3 text-xs text-foreground mt-0.5 flex-wrap">
              {e.mensagens > 0 && (
                <span>
                  <strong>+{e.mensagens}</strong> mensagens
                </span>
              )}
              {e.atos > 0 && (
                <span>
                  <strong>+{e.atos}</strong> atos processuais
                </span>
              )}
              {e.pagosCent > 0 && (
                <span className="text-emerald-700">
                  <strong>{formatBRL(e.pagosCent)}</strong> pagos
                </span>
              )}
              {e.prazos > 0 && (
                <span className="text-rose-700 font-semibold">
                  ⚠️ {e.prazos} prazo(s) em 48h
                </span>
              )}
            </div>
          </div>
          <ArrowUpRight
            className={"h-3.5 w-3.5 text-amber-700 transition-transform " + (expandido ? "rotate-90" : "")}
          />
        </button>
        <button
          onClick={dispensar}
          title="Dispensar — volta quando houver novidade nova"
          aria-label="Dispensar resumo"
          className="px-2.5 flex items-center justify-center text-amber-700/70 hover:text-amber-900 hover:bg-amber-100/60 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {expandido && (
        <div className="border-t border-amber-200 px-3.5 py-2.5 bg-white/60 space-y-2">
          {atos.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-amber-700 uppercase mb-1">Atos processuais</p>
              <div className="space-y-1">
                {atos.map((a: any, i: number) => (
                  <div key={i} className="text-[11px] text-foreground">
                    <span className="font-semibold">{a.tipo}</span>{" "}
                    <span className="text-muted-foreground">
                      · {new Date(a.data).toLocaleDateString("pt-BR")}
                    </span>
                    <p className="text-muted-foreground ml-2 mt-0.5">{a.resumo}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {prazos.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-rose-700 uppercase mb-1">Prazos próximos (48h)</p>
              <div className="space-y-1">
                {prazos.map((p: any) => (
                  <div key={p.id} className="text-[11px] text-rose-900">
                    <strong>{p.titulo}</strong>{" "}
                    <span className="text-muted-foreground">
                      · {new Date(p.data).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

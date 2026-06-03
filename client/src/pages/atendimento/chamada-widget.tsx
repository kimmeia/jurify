/**
 * Widget flutuante de chamadas na fila — aparece em qualquer tela quando há
 * chamada tocando. Clica e leva pra aba "Chamadas" do Atendimento.
 */

import { Phone } from "lucide-react";

function abrirFila() {
  if (window.location.pathname.startsWith("/atendimento")) {
    window.dispatchEvent(new CustomEvent("jurify:abrir-chamadas"));
  } else {
    sessionStorage.setItem("jurify_abrir_chamadas", "1");
    window.location.href = "/atendimento";
  }
}

export function ChamadaFilaWidget({ total }: { total: number }) {
  if (total <= 0) return null;
  return (
    <button
      onClick={abrirFila}
      title="Ver fila de chamadas"
      className="fixed bottom-4 right-4 z-50 flex items-center gap-2.5 rounded-full bg-slate-900 text-white pl-3 pr-4 py-2.5 shadow-xl hover:bg-slate-800 transition-colors"
    >
      <span className="relative">
        <Phone className="h-5 w-5" />
        <span className="absolute -top-2 -right-2 h-4 w-4 rounded-full bg-red-500 text-[10px] font-bold flex items-center justify-center animate-pulse">
          {total}
        </span>
      </span>
      <span className="text-sm font-semibold">{total === 1 ? "1 chamada na fila" : `${total} na fila`}</span>
    </button>
  );
}

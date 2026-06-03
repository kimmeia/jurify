/**
 * Widget flutuante de chamada na fila (Opção A — modo discreto).
 *
 * Aparece em qualquer tela quando há chamada tocando E o atendente está livre
 * (no modo overlay, quem pipoca é a tela cheia, então este fica oculto). Mostra
 * o contato + "Atender" (assume direto) e um atalho pra fila.
 */

import { Phone, Users } from "lucide-react";
import type { UseWhatsappCall } from "@/hooks/useWhatsappCall";

function abrirFila() {
  if (window.location.pathname.startsWith("/atendimento")) {
    window.dispatchEvent(new CustomEvent("jurify:abrir-chamadas"));
  } else {
    sessionStorage.setItem("jurify_abrir_chamadas", "1");
    window.location.href = "/atendimento";
  }
}

function iniciais(nome: string): string {
  return (nome || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function ChamadaFilaWidget({ chamada }: { chamada: UseWhatsappCall }) {
  const { filaAoVivo, estado, assumir } = chamada;
  const ocupado = estado !== "idle" && estado !== "encerrada";
  // Em chamada / com overlay aberto → não mostra (a outra UI cuida).
  if (filaAoVivo.length === 0 || ocupado) return null;

  const principal = filaAoVivo[0];
  const nome = principal.contatoNome || principal.telefone || "Contato";
  const extras = filaAoVivo.length - 1;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[264px] rounded-2xl bg-slate-900 text-white shadow-2xl ring-2 ring-emerald-400/60 animate-pulse p-3">
      <div className="flex items-center gap-2.5">
        <div className="relative shrink-0">
          <div className="h-10 w-10 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center font-bold text-sm">
            {iniciais(nome)}
          </div>
          <span className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-red-500 text-[10px] font-bold flex items-center justify-center">
            {filaAoVivo.length}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{nome}</p>
          <p className="text-[11px] text-slate-300">
            chamada recebida{extras > 0 ? ` · +${extras} na fila` : ""}
          </p>
        </div>
      </div>
      <div className="flex gap-2 mt-2.5">
        <button
          onClick={() => void assumir(principal.callId)}
          className="flex-1 h-9 rounded-lg bg-green-600 hover:bg-green-700 text-sm font-semibold flex items-center justify-center gap-1.5"
        >
          <Phone className="h-4 w-4" /> Atender
        </button>
        <button
          onClick={abrirFila}
          title="Ver fila de chamadas"
          className="h-9 px-3 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs font-semibold flex items-center gap-1.5"
        >
          <Users className="h-3.5 w-3.5" /> Fila
        </button>
      </div>
    </div>
  );
}

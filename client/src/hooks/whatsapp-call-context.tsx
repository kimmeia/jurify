/**
 * Provider global da ligação WhatsApp. Mantém UMA instância do useWhatsappCall
 * (um RTCPeerConnection, um listener de SSE) e renderiza o overlay app-wide —
 * assim a chamada toca em qualquer tela, não só no Atendimento. As páginas
 * consomem a mesma instância via useChamadaWhatsapp() (ex.: botão "Ligar").
 */

import { createContext, useContext, type ReactNode } from "react";
import { useWhatsappCall, type UseWhatsappCall } from "./useWhatsappCall";
import { ChamadaOverlay } from "@/pages/atendimento/chamada-overlay";
import { ChamadaFilaWidget } from "@/pages/atendimento/chamada-widget";

const ChamadaWhatsappContext = createContext<UseWhatsappCall | null>(null);

export function ChamadaWhatsappProvider({ children }: { children: ReactNode }) {
  const chamada = useWhatsappCall();
  return (
    <ChamadaWhatsappContext.Provider value={chamada}>
      {children}
      <ChamadaOverlay chamada={chamada} />
      <ChamadaFilaWidget total={chamada.filaAoVivo.length} />
    </ChamadaWhatsappContext.Provider>
  );
}

export function useChamadaWhatsapp(): UseWhatsappCall {
  const ctx = useContext(ChamadaWhatsappContext);
  if (!ctx) {
    throw new Error("useChamadaWhatsapp precisa estar dentro de <ChamadaWhatsappProvider>");
  }
  return ctx;
}

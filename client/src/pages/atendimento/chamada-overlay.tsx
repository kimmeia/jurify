/**
 * Overlay da ligação WhatsApp (Calling API): toque de chamada recebida +
 * painel da chamada em andamento. Dirigido pelo hook useWhatsappCall.
 */

import { Button } from "@/components/ui/button";
import { Loader2, Mic, MicOff, Phone, PhoneOff, User } from "lucide-react";
import type { UseWhatsappCall } from "@/hooks/useWhatsappCall";

function fmtDuracao(s: number): string {
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function ChamadaOverlay({ chamada }: { chamada: UseWhatsappCall }) {
  const { estado, chamada: ativa, duracaoSegundos, erro, mudo, precisaPermissao, permissaoEnviada, enviandoPermissao } =
    chamada;

  if (estado === "idle" || !ativa) return null;

  const tocandoEntrada = estado === "tocando" && ativa.direcao === "entrada";
  const emChamada = estado === "em_chamada";
  const conectando = estado === "conectando";

  const corCirculo = emChamada
    ? "bg-gradient-to-br from-green-500 to-emerald-600 animate-pulse"
    : tocandoEntrada
      ? "bg-gradient-to-br from-emerald-500 to-emerald-600 animate-pulse"
      : "bg-gradient-to-br from-blue-500 to-blue-600";

  const legenda = tocandoEntrada
    ? "Chamada recebida · WhatsApp"
    : conectando
      ? ativa.direcao === "saida"
        ? "Chamando..."
        : "Conectando..."
      : emChamada
        ? fmtDuracao(duracaoSegundos)
        : "Chamada encerrada";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
      <div className="bg-background rounded-2xl shadow-2xl w-[340px] p-8 text-center space-y-6">
        <div className={"h-20 w-20 rounded-full flex items-center justify-center mx-auto shadow-lg " + corCirculo}>
          <Phone className="h-10 w-10 text-white" />
        </div>

        <div>
          <p className="text-lg font-bold truncate flex items-center justify-center gap-1.5">
            <User className="h-4 w-4 text-muted-foreground shrink-0" />
            {ativa.contatoNome}
          </p>
          {ativa.telefone && <p className="text-xs text-muted-foreground mt-0.5">+{ativa.telefone}</p>}
          <p className="text-sm text-muted-foreground mt-1">{legenda}</p>
          {erro && <p className="text-xs text-red-500 mt-2">{erro}</p>}
        </div>

        {conectando && <Loader2 className="h-6 w-6 animate-spin text-blue-500 mx-auto" />}

        {/* Chamada recebida tocando: atender / recusar */}
        {tocandoEntrada && (
          <div className="flex justify-center gap-6">
            <div className="flex flex-col items-center gap-1">
              <Button
                variant="destructive"
                size="lg"
                className="rounded-full h-14 w-14 p-0"
                onClick={() => void chamada.recusar()}
                title="Recusar"
              >
                <PhoneOff className="h-6 w-6" />
              </Button>
              <span className="text-[10px] text-muted-foreground">Recusar</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <Button
                size="lg"
                className="rounded-full h-14 w-14 p-0 bg-green-600 hover:bg-green-700"
                onClick={() => void chamada.atender()}
                title="Atender"
              >
                <Phone className="h-6 w-6" />
              </Button>
              <span className="text-[10px] text-muted-foreground">Atender</span>
            </div>
          </div>
        )}

        {/* Em chamada: mudo + desligar */}
        {emChamada && (
          <div className="flex justify-center gap-4">
            <Button
              variant={mudo ? "default" : "outline"}
              size="lg"
              className="rounded-full h-14 w-14 p-0"
              onClick={chamada.alternarMudo}
              title={mudo ? "Ativar microfone" : "Silenciar microfone"}
            >
              {mudo ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
            </Button>
            <Button
              variant="destructive"
              size="lg"
              className="rounded-full h-14 w-14 p-0"
              onClick={() => void chamada.desligar()}
              title="Desligar"
            >
              <PhoneOff className="h-6 w-6" />
            </Button>
          </div>
        )}

        {/* Conectando (qualquer direção): permite desistir */}
        {conectando && (
          <Button variant="destructive" size="lg" className="rounded-full h-14 w-14 p-0 mx-auto" onClick={() => void chamada.desligar()} title="Cancelar">
            <PhoneOff className="h-6 w-6" />
          </Button>
        )}

        {estado === "encerrada" && (
          <div className="space-y-3">
            {/* Saída barrada por falta de permissão: oferece o pedido. */}
            {precisaPermissao && !permissaoEnviada && (
              <p className="text-xs text-muted-foreground">
                Para ligar, o cliente precisa autorizar. Envie o pedido de permissão pelo WhatsApp.
              </p>
            )}
            {permissaoEnviada && (
              <p className="text-xs text-emerald-600">
                Pedido enviado! Quando o cliente aprovar, você poderá ligar (válido por 7 dias).
              </p>
            )}
            <div className="flex justify-center gap-2">
              {precisaPermissao && !permissaoEnviada && (
                <Button onClick={() => void chamada.pedirPermissao()} disabled={enviandoPermissao}>
                  {enviandoPermissao && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Pedir permissão
                </Button>
              )}
              <Button variant="outline" onClick={chamada.fechar}>
                Fechar
              </Button>
            </div>
          </div>
        )}

        <p className="text-[10px] text-muted-foreground">WhatsApp · Ligação oficial via Meta</p>
      </div>
    </div>
  );
}

/**
 * Central de Chamadas — fila de atendimento da ligação WhatsApp.
 *
 * Mostra: tocando agora (qualquer um pode "Assumir"), em atendimento, e
 * perdidas (com "Ligar de volta"). A lista autoritativa vem da query `fila`
 * (com nomes); o SDP pra assumir vem do `filaAoVivo` do hook (via SSE).
 */

import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Phone,
  PhoneMissed,
  PhoneOutgoing,
  Hand,
  AudioLines,
  Loader2,
  MessageCircle,
  Inbox,
} from "lucide-react";
import type { UseWhatsappCall } from "@/hooks/useWhatsappCall";

function timeAgo(d: string | Date | null): string {
  if (!d) return "";
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function initials(nome: string): string {
  return (nome || "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
}

export function FilaChamadas({ chamada }: { chamada: UseWhatsappCall }) {
  const { data, isLoading } = trpc.whatsappCalling.fila.useQuery(undefined, {
    refetchInterval: 4000,
    refetchOnWindowFocus: true,
  });

  const tocando = (data?.ativas || []).filter((c) => c.status === "tocando" || c.status === "conectando");
  const emAtendimento = (data?.ativas || []).filter((c) => c.status === "em_andamento");
  const perdidas = data?.perdidas || [];
  const ocupado = chamada.estado !== "idle" && chamada.estado !== "encerrada";

  const podeAssumir = (callId: string) =>
    !ocupado && chamada.filaAoVivo.some((f) => f.callId === callId);

  return (
    <div className="mt-4 max-w-3xl mx-auto space-y-5">

      {/* ── TOCANDO AGORA ─────────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Tocando agora</h2>
          {tocando.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
              {tocando.length}
            </span>
          )}
        </div>
        {tocando.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">Nenhuma chamada tocando.</p>
        ) : (
          <div className="space-y-2">
            {tocando.map((c) => (
              <div key={c.callId} className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white flex items-center justify-center font-bold text-sm shrink-0 animate-pulse">
                  {initials(c.contatoNome || c.telefone || "?")}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{c.contatoNome || c.telefone}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {c.telefone ? `+${c.telefone}` : ""}
                    {c.atendenteNome ? ` · Resp.: ${c.atendenteNome}` : " · sem responsável"}
                  </p>
                </div>
                <Button
                  size="sm"
                  className="h-9 bg-green-600 hover:bg-green-700 gap-1.5"
                  disabled={!podeAssumir(c.callId)}
                  title={podeAssumir(c.callId) ? "Assumir e atender" : ocupado ? "Você está em chamada" : "Recebida em outro dispositivo"}
                  onClick={() => void chamada.assumir(c.callId)}
                >
                  <Hand className="h-3.5 w-3.5" /> Assumir
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── EM ATENDIMENTO ────────────────────────────────────────── */}
      {emAtendimento.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-2">
            <span className="h-2 w-2 rounded-full bg-green-500"></span>
            <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Em atendimento</h2>
          </div>
          <div className="space-y-2">
            {emAtendimento.map((c) => (
              <div key={c.callId} className="rounded-xl border bg-card p-3 flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 text-white flex items-center justify-center font-bold text-xs shrink-0">
                  {initials(c.contatoNome || c.telefone || "?")}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">
                    {c.contatoNome || c.telefone}
                    {c.atendenteNome && <span className="text-[11px] font-normal text-muted-foreground"> · {c.atendenteNome}</span>}
                  </p>
                  <p className="text-[11px] text-green-600 font-semibold flex items-center gap-1">
                    <AudioLines className="h-3 w-3" /> ao vivo
                  </p>
                </div>
                <span className="text-[10px] text-muted-foreground">não interromper</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── PERDIDAS / RETORNAR ───────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <span className="h-2 w-2 rounded-full bg-red-500"></span>
          <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Perdidas — retornar</h2>
        </div>
        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
          </div>
        ) : perdidas.length === 0 ? (
          <div className="text-center text-muted-foreground py-6">
            <Inbox className="h-7 w-7 mx-auto mb-1 opacity-40" />
            <p className="text-xs">Nenhuma chamada perdida nas últimas 24h.</p>
          </div>
        ) : (
          <div className="rounded-xl border divide-y overflow-hidden">
            {perdidas.map((c) => (
              <div key={c.callId} className="p-3 flex items-center gap-3">
                <PhoneMissed className="h-4 w-4 text-red-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">
                    {c.contatoNome || c.telefone || "Desconhecido"}
                    {c.atendenteNome && <span className="text-[11px] font-normal text-muted-foreground"> · Resp.: {c.atendenteNome}</span>}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {c.direcao === "saida" ? "saída não conectada" : "perdida"} · {timeAgo(c.createdAt as any)}
                  </p>
                </div>
                {c.telefone && (
                  <>
                    <Button
                      size="sm"
                      className="h-8 bg-green-600 hover:bg-green-700 gap-1"
                      disabled={ocupado}
                      onClick={() =>
                        void chamada.ligar({
                          canalId: c.canalId,
                          telefone: c.telefone as string,
                          contatoId: c.contatoId ?? undefined,
                          contatoNome: c.contatoNome ?? undefined,
                          conversaId: c.conversaId ?? undefined,
                        })
                      }
                    >
                      <PhoneOutgoing className="h-3.5 w-3.5" /> Ligar de volta
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1"
                      onClick={() => window.open("https://wa.me/" + (c.telefone as string).replace(/\D/g, ""), "_blank")}
                    >
                      <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <p className="text-center text-[10px] text-muted-foreground pt-1">
        <Phone className="h-3 w-3 inline mr-1" />
        Recebida é grátis · "Ligar de volta" usa a ligação oficial (pede permissão se preciso).
      </p>
    </div>
  );
}

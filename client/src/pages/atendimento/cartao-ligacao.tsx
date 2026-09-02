/**
 * Cartão de ligação na conversa do Atendimento — registro de chamada
 * (feita / recebida / perdida / recusada) no meio da timeline, centralizado
 * como o separador de data. Lê os dados estruturados do `payload` da mensagem
 * (gravados pelo webhook de chamadas); cai pro `conteudo` salvo se faltar.
 */
import { PhoneIncoming, PhoneMissed, PhoneOutgoing } from "lucide-react";
import { descreverLigacao } from "@shared/whatsapp-calling-types";

type PayloadLigacao = {
  direcao?: "entrada" | "saida";
  status?: string;
  duracaoSegundos?: number | null;
  atendenteNome?: string | null;
};

export function CartaoLigacao({ m, tz }: { m: any; tz: string }) {
  let p: PayloadLigacao = {};
  try {
    p = m.payload ? JSON.parse(m.payload) : {};
  } catch {
    /* payload ausente/inválido — cai no fallback de conteudo */
  }

  const direcao = p.direcao === "saida" ? "saida" : "entrada";
  const status = p.status || "encerrada";
  const perdida = status === "perdida" || status === "falha";
  const recusada = status === "rejeitada";
  const andamento = status === "em_andamento" || status === "tocando" || status === "conectando";

  const rotulo = p.status
    ? descreverLigacao(direcao, status as any, p.duracaoSegundos)
    : (m.conteudo || "").replace(/^📞\s*/, "") || "Ligação";

  const tom = perdida
    ? "bg-danger-bg border-danger/30 text-danger-fg"
    : recusada
      ? "bg-warning-bg border-warning/30 text-warning-fg"
      : andamento
        ? "bg-info-bg border-info/30 text-info-fg"
        : "bg-success-bg border-success/30 text-success-fg";

  const iconeTom = perdida
    ? "bg-danger-bg text-danger-fg"
    : recusada
      ? "bg-warning-bg text-warning-fg"
      : andamento
        ? "bg-info-bg text-info-fg"
        : "bg-success-bg text-success-fg";

  const Icone = perdida ? PhoneMissed : direcao === "saida" ? PhoneOutgoing : PhoneIncoming;
  const mostrarAtendente = !!p.atendenteNome && status === "encerrada";
  const hora = m.createdAt
    ? new Date(m.createdAt).toLocaleTimeString("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <div className={"inline-flex items-center gap-2 rounded-full border pl-1.5 pr-3 py-1 text-[12px] shadow-sm " + tom}>
      <span className={"h-6 w-6 rounded-full flex items-center justify-center shrink-0 " + iconeTom}>
        <Icone className="h-3.5 w-3.5" />
      </span>
      <span className="font-medium">{rotulo}</span>
      {mostrarAtendente && (
        <span className="opacity-70">· {direcao === "saida" ? "por" : "atendida por"} {p.atendenteNome}</span>
      )}
      {hora && <span className="opacity-60">· {hora}</span>}
    </div>
  );
}

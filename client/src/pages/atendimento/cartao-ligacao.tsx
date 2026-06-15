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
    ? "bg-red-50 border-red-200 text-red-800"
    : recusada
      ? "bg-amber-50 border-amber-200 text-amber-800"
      : andamento
        ? "bg-blue-50 border-blue-200 text-blue-800"
        : "bg-emerald-50 border-emerald-200 text-emerald-800";

  const iconeTom = perdida
    ? "bg-red-100 text-red-600"
    : recusada
      ? "bg-amber-100 text-amber-600"
      : andamento
        ? "bg-blue-100 text-blue-600"
        : "bg-emerald-100 text-emerald-600";

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

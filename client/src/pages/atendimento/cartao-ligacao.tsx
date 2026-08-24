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
    ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800/50 text-red-800 dark:text-red-200"
    : recusada
      ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-200"
      : andamento
        ? "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800/50 text-blue-800 dark:text-blue-200"
        : "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/50 text-emerald-800 dark:text-emerald-200";

  const iconeTom = perdida
    ? "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
    : recusada
      ? "bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400"
      : andamento
        ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
        : "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400";

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

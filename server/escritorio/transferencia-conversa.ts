/**
 * Texto da mensagem de sistema gravada quando uma conversa muda de dono.
 *
 * A frase antiga era "Conversa transferida para outro atendente" — sem de
 * quem, sem pra quem, sem quem mandou. Quem abria o histórico meses depois
 * pra entender por que o cliente ficou sem resposta não tinha o que ler.
 */

/** Primeiro + último nome. O nome completo estoura a bolha da conversa. */
export function nomeCurto(nome: string | null | undefined): string {
  const p = (nome ?? "").trim().split(/\s+/).filter(Boolean);
  if (p.length === 0) return "alguém";
  if (p.length === 1) return p[0];
  return `${p[0]} ${p[p.length - 1]}`;
}

/**
 * Três frases porque são três eventos diferentes na cabeça de quem lê:
 * pegar pra si, entregar pra outro, e atribuir uma conversa que não tinha
 * dono. Uma frase genérica pros três esconde justamente o que se procura.
 */
export function mensagemTransferencia(args: {
  autor: string | null;
  de: string | null;
  para: string | null;
}): string {
  const autor = nomeCurto(args.autor);
  const para = nomeCurto(args.para);
  const de = args.de ? nomeCurto(args.de) : null;

  if (autor === para) {
    return de
      ? `[Sistema] ${autor} assumiu a conversa, antes com ${de}.`
      : `[Sistema] ${autor} assumiu a conversa.`;
  }
  return de
    ? `[Sistema] ${autor} transferiu a conversa de ${de} para ${para}.`
    : `[Sistema] ${autor} atribuiu a conversa a ${para}.`;
}

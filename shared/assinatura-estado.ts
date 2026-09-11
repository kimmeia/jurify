/**
 * Em que pé está um documento de assinatura — e, principalmente, o que a tela
 * tem direito de afirmar.
 *
 * O motivo de existir: quando o carimbo do PDF falha, a assinatura é
 * registrada assim mesmo (é o certo — o cliente assinou de verdade, a falha é
 * nossa) e o motivo só ia para o log. A tela mostrava o MESMO selo verde de
 * um documento com comprovante, então "assinado com prova" e "assinado sem
 * prova" eram indistinguíveis.
 *
 * Aqui o estado é derivado dos dados, não do campo `status` sozinho: status
 * "assinado" sem data ou sem assinante é contradição, e contradição aparece
 * em vermelho em vez de virar um selo verde.
 */

export const ESTADOS_ASSINATURA = [
  "pendente",
  "enviado",
  "visualizado",
  "assinado",
  "assinado_externo",
  "sem_comprovante",
  "inconsistente",
  "expirado",
  "recusado",
] as const;
export type EstadoAssinatura = (typeof ESTADOS_ASSINATURA)[number];

export const ROTULO_ESTADO: Record<EstadoAssinatura, string> = {
  pendente: "Pendente",
  enviado: "Enviado",
  visualizado: "Visualizado",
  assinado: "Assinado",
  assinado_externo: "Assinado · documento externo",
  sem_comprovante: "Sem comprovante",
  inconsistente: "Inconsistente",
  expirado: "Expirado",
  recusado: "Cancelado",
};

/** Uma linha curta que explica o estado sem precisar abrir nada. */
export const EXPLICACAO_ESTADO: Record<EstadoAssinatura, string> = {
  pendente: "Ainda não foi enviado ao cliente.",
  enviado: "O link foi enviado e o cliente ainda não assinou.",
  visualizado: "O cliente abriu o link e ainda não assinou.",
  assinado: "Assinado, com o PDF carimbado disponível.",
  assinado_externo: "Assinado. O documento é um link externo, então não existe PDF nosso para carimbar.",
  sem_comprovante: "Assinado, mas o PDF carimbado não foi gerado. Os dados da assinatura estão guardados.",
  inconsistente: "Marcado como assinado sem registro de quem assinou. Confira antes de usar este documento.",
  expirado: "O prazo do link terminou sem assinatura.",
  recusado: "Cancelado pelo escritório.",
};

export type AssinaturaParaEstado = {
  status: string | null | undefined;
  assinadoAt: string | Date | null | undefined;
  /**
   * O desenho e o IP são a prova de que alguém assinou de verdade: só o
   * /assinar/:token grava os dois, e o desenho é obrigatório lá. `assinantNome`
   * NÃO serve — ele é pré-preenchido com o nome do contato no momento em que o
   * documento é criado, antes de existir qualquer assinatura.
   */
  assinaturaImagemUrl?: string | null;
  ipAssinatura?: string | null;
  documentoAssinadoUrl?: string | null;
  /** Motivo gravado quando o carimbo falhou. */
  comprovanteErro?: string | null;
  /** true quando o documento original é link externo (Google Docs e afins). */
  documentoExterno?: boolean;
};

function temValor(v: unknown): boolean {
  return typeof v === "string" ? v.trim().length > 0 : v != null;
}

/**
 * A regra, em ordem — a primeira que casa vence:
 *   1. status não-assinado devolve o próprio status (nada a derivar);
 *   2. assinado sem NENHUM vestígio de assinante é contradição;
 *   3. com PDF carimbado é assinado, ponto;
 *   4. documento externo nunca teria carimbo — não é falha;
 *   5. o resto é assinado sem comprovante, que é o caso a mostrar em âmbar.
 */
export function estadoDaAssinatura(a: AssinaturaParaEstado): EstadoAssinatura {
  const status = String(a.status ?? "").trim();
  if (status === "expirado") return "expirado";
  if (status === "recusado") return "recusado";
  if (status !== "assinado") {
    if (status === "visualizado") return "visualizado";
    if (status === "enviado") return "enviado";
    return "pendente";
  }

  const assinou = temValor(a.assinadoAt) && (temValor(a.assinaturaImagemUrl) || temValor(a.ipAssinatura));
  if (!assinou) return "inconsistente";
  if (temValor(a.documentoAssinadoUrl)) return "assinado";
  if (a.documentoExterno) return "assinado_externo";
  return "sem_comprovante";
}

/** Só estes dois pedem ação de quem cuida do escritório. */
export function pedeAtencao(estado: EstadoAssinatura): boolean {
  return estado === "sem_comprovante" || estado === "inconsistente";
}

/** O botão "Gerar comprovante" só faz sentido quando há desenho guardado. */
export function podeGerarComprovante(a: AssinaturaParaEstado): boolean {
  return estadoDaAssinatura(a) === "sem_comprovante" && temValor(a.assinaturaImagemUrl);
}

/**
 * Contrato cancelado — regras puras compartilhadas por tela, servidor e PDF.
 *
 * Um fechamento (lead em fechado_ganho) pode ser cancelado depois. A etapa
 * NÃO muda: o fechamento aconteceu e continua contando no mês em que
 * fechou. O cancelamento é outro evento, com data, motivo e autor próprios.
 */

export const MOTIVOS_CANCELAMENTO = [
  { id: "desistencia", label: "Desistência do cliente" },
  { id: "inadimplencia", label: "Inadimplência" },
  { id: "outro_escritorio", label: "Fechou com outro escritório" },
  { id: "sem_retorno", label: "Sem retorno do cliente" },
  { id: "engano", label: "Lançado por engano" },
  { id: "outro", label: "Outro" },
] as const;

export type MotivoCancelamento = (typeof MOTIVOS_CANCELAMENTO)[number]["id"];

export const MOTIVO_CANCELAMENTO_IDS = MOTIVOS_CANCELAMENTO.map((m) => m.id) as [MotivoCancelamento, ...MotivoCancelamento[]];

/** "Lançado por engano" fica fora do card, da barra e da lista de cancelados:
 *  engano não é churn. Continua marcado na ficha e nas linhas de origem. */
export const MOTIVO_CANCELAMENTO_ENGANO: MotivoCancelamento = "engano";

export function rotuloMotivoCancelamento(motivo: string | null | undefined): string {
  return MOTIVOS_CANCELAMENTO.find((m) => m.id === motivo)?.label ?? (motivo || "—");
}

/** Conta como cancelamento nas métricas (card, barra, lista)? */
export function contaComoCancelamento(motivo: string | null | undefined): boolean {
  return motivo !== MOTIVO_CANCELAMENTO_ENGANO;
}

export function contratoCancelado(lead: { etapaFunil?: string | null; canceladoEm?: string | Date | null }): boolean {
  return lead.etapaFunil === "fechado_ganho" && lead.canceladoEm != null && lead.canceladoEm !== "";
}

/** Motivo e detalhe numa linha só, pra badge e tabela. */
export function descricaoCancelamento(motivo: string | null | undefined, detalhe?: string | null): string {
  const base = rotuloMotivoCancelamento(motivo);
  const extra = (detalhe || "").trim();
  return extra ? `${base} — ${extra}` : base;
}

/** Texto gravado na Situação do serviço quando o cancelamento do contrato
 *  também encerra o serviço do cliente. */
export function motivoServicoAoCancelar(motivo: string | null | undefined, detalhe?: string | null): string {
  return `Contrato cancelado: ${descricaoCancelamento(motivo, detalhe)}`.slice(0, 500);
}

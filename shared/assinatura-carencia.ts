/**
 * Carência de cancelamento (cláusula 5 dos Termos): assinatura cancelada
 * continua liberando o acesso até o fim do período que o cliente já pagou.
 *
 * Regra pura, compartilhada entre o servidor (que decide o acesso) e a tela
 * "Meu plano" (que mostra "Acesso até <data>" e o botão de reativar).
 */
export interface AssinaturaCarenciaShape {
  status?: string | null;
  cancelAtPeriodEnd?: boolean | null;
  fimPeriodoPagoEm?: number | null;
  cortesia?: boolean | null;
}

export function emCarenciaDeCancelamento(
  sub: AssinaturaCarenciaShape | null | undefined,
  agora: number = Date.now(),
): boolean {
  if (!sub) return false;
  if (sub.cortesia) return false;
  if (sub.status !== "canceled") return false;
  if (!sub.cancelAtPeriodEnd) return false;
  if (sub.fimPeriodoPagoEm == null) return false;
  return sub.fimPeriodoPagoEm > agora;
}

/**
 * Até quando o acesso fica de pé se a assinatura for cancelada agora.
 * `fimPeriodoPagoEm` é a fonte; assinatura antiga (sem o campo) cai em
 * `currentPeriodEnd` quando ainda está no futuro. `null` = encerra na hora.
 */
export function fimDoAcessoAoCancelar(
  sub: { fimPeriodoPagoEm?: number | null; currentPeriodEnd?: number | null },
  agora: number = Date.now(),
): number | null {
  if (sub.fimPeriodoPagoEm != null && sub.fimPeriodoPagoEm > agora) return sub.fimPeriodoPagoEm;
  if (sub.currentPeriodEnd != null && sub.currentPeriodEnd > agora) return sub.currentPeriodEnd;
  return null;
}

/**
 * Status do Asaas que representam pagamento efetivado.
 *
 * Antes vivia duplicado em router-relatorios.ts (2x) e dre.ts. Centralizado
 * aqui pra que mudanças de semântica (ex: incluir RECEIVED_PARTIAL) afetem
 * todos os relatórios ao mesmo tempo.
 */
export const STATUS_PAGO_ASAAS = [
  "RECEIVED",
  "CONFIRMED",
  "RECEIVED_IN_CASH",
] as const;

export type StatusPagoAsaas = (typeof STATUS_PAGO_ASAAS)[number];

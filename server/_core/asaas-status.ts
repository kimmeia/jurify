/**
 * Status do Asaas agrupados pela semântica que importa pro painel financeiro:
 * pagos, pendentes (a receber) e vencidos. Os 3 cards do hero financeiro
 * somam SOMENTE os status listados aqui — qualquer status do Asaas que não
 * apareça nessas listas é IGNORADO (intencionalmente, no caso de estornos e
 * chargebacks em disputa, que merecem visualização separada).
 *
 * Lista completa de status que o Asaas retorna está em `AsaasPaymentStatus`
 * (asaas-client.ts).
 */

/**
 * Pagamento efetivado — entra no card "Recebido".
 *  - RECEIVED: pago e creditado
 *  - CONFIRMED: pago mas ainda não creditado (D+1 / D+30)
 *  - RECEIVED_IN_CASH: pago fora do Asaas (PIX manual / dinheiro / TED)
 *  - DUNNING_RECEIVED: pago após processo de cobrança/negativação
 */
export const STATUS_PAGO_ASAAS = [
  "RECEIVED",
  "CONFIRMED",
  "RECEIVED_IN_CASH",
  "DUNNING_RECEIVED",
] as const;

export type StatusPagoAsaas = (typeof STATUS_PAGO_ASAAS)[number];

/**
 * Aguardando pagamento (não venceu) — entra no card "A receber" quando
 * vencimento >= hoje. PENDING vencido (vencimento < hoje) vira "Vencido"
 * por inferência, mesmo sem o Asaas ter mandado PAYMENT_OVERDUE ainda.
 *  - PENDING: aguardando pagamento do cliente
 *  - AWAITING_RISK_ANALYSIS: gateway analisando antes de aprovar
 *  - AUTHORIZED: cartão autorizado, captura pendente
 */
export const STATUS_PENDENTE_ASAAS = [
  "PENDING",
  "AWAITING_RISK_ANALYSIS",
  "AUTHORIZED",
] as const;

export type StatusPendenteAsaas = (typeof STATUS_PENDENTE_ASAAS)[number];

/**
 * Vencido — entra no card "Vencido".
 *  - OVERDUE: vencida (status próprio, disparado pelo Asaas em D+1)
 *  - DUNNING_REQUESTED: negativação/protesto solicitado pelo dono
 *
 * Chargebacks (CHARGEBACK_REQUESTED, CHARGEBACK_DISPUTE,
 * AWAITING_CHARGEBACK_REVERSAL) e estornos (REFUNDED, REFUND_REQUESTED,
 * REFUND_IN_PROGRESS) NÃO entram em nenhum dos 3 cards — são casos
 * excepcionais que precisam ser tratados em fluxo separado.
 */
export const STATUS_VENCIDO_ASAAS = [
  "OVERDUE",
  "DUNNING_REQUESTED",
] as const;

export type StatusVencidoAsaas = (typeof STATUS_VENCIDO_ASAAS)[number];

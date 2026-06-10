/**
 * Mapeia o `billingType` devolvido pela API do Asaas pro enum local
 * `formaPagAsaas` de `asaas_cobrancas`.
 *
 * O Asaas devolve em payments históricos valores além dos 4 "clássicos"
 * (BOLETO/CREDIT_CARD/PIX/UNDEFINED): DEBIT_CARD, TRANSFER e DEPOSIT.
 * Antes deste helper o valor era persistido com cast `as any` — MySQL em
 * strict mode rejeita valor fora do enum ("Data truncated") e o INSERT
 * derrubava a janela inteira do sync histórico, travando a importação no
 * mesmo dia pra sempre.
 */

import { createLogger } from "../_core/logger";

const log = createLogger("asaas-forma-pagamento");

export type FormaPagamentoLocal =
  | "BOLETO"
  | "CREDIT_CARD"
  | "PIX"
  | "UNDEFINED"
  | "DINHEIRO"
  | "TRANSFERENCIA"
  | "OUTRO";

const DIRETOS: ReadonlySet<string> = new Set([
  "BOLETO",
  "CREDIT_CARD",
  "PIX",
  "UNDEFINED",
  "DINHEIRO",
  "TRANSFERENCIA",
  "OUTRO",
]);

export function mapearFormaPagamento(
  billingType: string | null | undefined,
): FormaPagamentoLocal {
  const v = (billingType || "").trim().toUpperCase();
  if (!v) return "UNDEFINED";
  if (DIRETOS.has(v)) return v as FormaPagamentoLocal;
  if (v === "TRANSFER" || v === "DEPOSIT") return "TRANSFERENCIA";
  // Débito agrupa como cartão nos relatórios de forma de pagamento.
  if (v === "DEBIT_CARD") return "CREDIT_CARD";
  log.warn({ billingType: v }, "billingType desconhecido do Asaas — gravando como OUTRO");
  return "OUTRO";
}

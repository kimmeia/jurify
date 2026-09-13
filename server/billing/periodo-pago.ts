/**
 * Período pago de uma assinatura do JuridFlow — o que sustenta a carência de
 * cancelamento (cláusula 5 dos Termos).
 */

import { eq } from "drizzle-orm";
import { escritorios } from "../../drizzle/schema";
import { FUSO_HORARIO_PADRAO, fimDoDiaNoFuso } from "../../shared/escritorio-types";
import { fimDoAcessoAoCancelar } from "../../shared/assinatura-carencia";
import { diaCivilEmTz } from "../_core/dates";

export type CicloAssinatura = "monthly" | "yearly";

const DIA_MS = 24 * 60 * 60 * 1000;

/** `cycle` do payload do Asaas → ciclo local. Ciclos que não vendemos viram `null`. */
export function cicloDoAsaas(cycle: string | null | undefined): CicloAssinatura | null {
  if (cycle === "MONTHLY") return "monthly";
  if (cycle === "YEARLY") return "yearly";
  return null;
}

export function cicloParaAsaas(ciclo: CicloAssinatura): "MONTHLY" | "YEARLY" {
  return ciclo === "yearly" ? "YEARLY" : "MONTHLY";
}

/**
 * Soma um período a uma data-calendário ("YYYY-MM-DD"). Dia que não existe
 * no mês de destino cai no último dia dele (31/01 + 1 mês = 28/02), em vez
 * de virar o dia 3 do mês seguinte.
 */
function somarPeriodo(yyyymmdd: string, ciclo: CicloAssinatura): string {
  const [ano, mes, dia] = yyyymmdd.split("-").map(Number);
  const anoAlvo = ciclo === "yearly" ? ano + 1 : ano;
  const mesAlvo = ciclo === "yearly" ? mes : mes + 1;
  const ultimoDiaDoMesAlvo = new Date(Date.UTC(anoAlvo, mesAlvo, 0)).getUTCDate();
  const alvo = new Date(Date.UTC(anoAlvo, mesAlvo - 1, Math.min(dia, ultimoDiaDoMesAlvo)));
  return alvo.toISOString().slice(0, 10);
}

/**
 * Fim do período que um pagamento cobre: o fim do dia civil (no fuso do
 * escritório) de vencimento + 1 mês ou + 1 ano. Sem ciclo conhecido cai nos
 * 30 dias fixos que `currentPeriodEnd` sempre usou.
 */
export function fimDoPeriodoPago(
  dueDate: string,
  ciclo: CicloAssinatura | null | undefined,
  fusoHorario: string = FUSO_HORARIO_PADRAO,
): number | null {
  const diaVencimento = dueDate.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(diaVencimento)) return null;
  if (!ciclo) {
    const base = new Date(`${diaVencimento}T00:00:00Z`).getTime();
    return isNaN(base) ? null : base + 30 * DIA_MS;
  }
  return fimDoDiaNoFuso(somarPeriodo(diaVencimento, ciclo), fusoHorario).getTime();
}

/**
 * Dia seguinte ao fim do acesso, como data-calendário do fuso — é o
 * `nextDueDate` da assinatura recriada ao reativar: a primeira cobrança nova
 * cai no dia em que o período já pago termina.
 */
export function vencimentoAposFimDoAcesso(fimAcessoMs: number, fusoHorario: string = FUSO_HORARIO_PADRAO): string {
  const diaDoFim = diaCivilEmTz(new Date(fimAcessoMs), fusoHorario);
  const [ano, mes, dia] = diaDoFim.split("-").map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia + 1)).toISOString().slice(0, 10);
}

/**
 * Fuso do escritório cujo dono é o assinante. A assinatura é do dono, e o
 * "fim do dia" da carência é o dia dele — não o do servidor (UTC).
 */
export async function fusoDoDonoDaAssinatura(
  db: { select: (...args: any[]) => any },
  userId: number,
): Promise<string> {
  try {
    const [esc] = await db
      .select({ fusoHorario: escritorios.fusoHorario })
      .from(escritorios)
      .where(eq(escritorios.ownerId, userId))
      .limit(1);
    return esc?.fusoHorario || FUSO_HORARIO_PADRAO;
  } catch {
    return FUSO_HORARIO_PADRAO;
  }
}

/**
 * Campos que todo cancelamento grava. `cancelAtPeriodEnd` é a marca da
 * carência: sem ela, `canceled` bloqueia na hora (trial expirado, troca de
 * plano paga, assinatura substituída). Sem `fimPeriodoPagoEm` no futuro a
 * assinatura antiga cai em `currentPeriodEnd`; sem nenhum dos dois o acesso
 * encerra na hora, e o campo fica como está.
 */
export function camposDeCancelamento(
  sub: { fimPeriodoPagoEm?: number | null; currentPeriodEnd?: number | null } | null | undefined,
  agora: number = Date.now(),
): { status: "canceled"; cancelAtPeriodEnd: true; fimPeriodoPagoEm?: number } {
  const base = { status: "canceled" as const, cancelAtPeriodEnd: true as const };
  if (!sub) return base;
  const fim = fimDoAcessoAoCancelar(sub, agora);
  return fim == null ? base : { ...base, fimPeriodoPagoEm: fim };
}

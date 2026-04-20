/**
 * SmartFlow Cobranças Scheduler — cron diário que varre cobranças do Asaas
 * e dispara cenários:
 *   - `pagamento_vencido`             para cobranças em atraso
 *   - `pagamento_proximo_vencimento`  para cobranças que vencem em breve
 *
 * Complementa o webhook do Asaas (que já dispara PAYMENT_OVERDUE em tempo
 * real): este job garante a cobertura diária e permite configs de janela
 * ("disparar quando passar de 7 dias de atraso") que o webhook sozinho não
 * consegue atender.
 *
 * Dedupe: ambos dispatchers (`dispararPagamentoVencido` e
 * `dispararProximoVencimento`) têm proteção por (cenarioId, pagamentoId)
 * nas últimas 24h, então o job é idempotente.
 */

import { getDb } from "../db";
import { asaasCobrancas, smartflowCenarios, asaasClientes } from "../../drizzle/schema";
import { eq, and, ne, inArray } from "drizzle-orm";
import { dispararPagamentoVencido, dispararProximoVencimento } from "./dispatcher";
import { createLogger } from "../_core/logger";

const log = createLogger("smartflow-cobrancas-scheduler");

// Uma varredura a cada 12h — quase "1 vez por dia" mas pega tanto o início
// quanto o fim do dia útil (escritórios começam a operar em horários
// diferentes).
const INTERVALO_MS = 12 * 60 * 60 * 1000;

let intervalo: ReturnType<typeof setInterval> | null = null;

/** Lista os escritórios que têm pelo menos 1 cenário ativo de pagamento. */
async function escritoriosComCenariosAtivos(): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const linhas = await db
    .select({ escritorioId: smartflowCenarios.escritorioId })
    .from(smartflowCenarios)
    .where(
      and(
        eq(smartflowCenarios.ativo, true),
        inArray(smartflowCenarios.gatilho, ["pagamento_vencido", "pagamento_proximo_vencimento"]),
      ),
    );
  const unique = new Set<number>();
  for (const l of linhas) unique.add(l.escritorioId);
  return Array.from(unique);
}

/**
 * Roda 1 ciclo do scheduler. Público pra poder ser chamado em testes ou
 * em ações administrativas ("rodar agora").
 */
export async function rodarCicloCobrancas(): Promise<{ vencidas: number; proximas: number }> {
  const db = await getDb();
  if (!db) return { vencidas: 0, proximas: 0 };

  try {
    const escritorios = await escritoriosComCenariosAtivos();
    if (escritorios.length === 0) return { vencidas: 0, proximas: 0 };

    let vencidas = 0;
    let proximas = 0;

    for (const escritorioId of escritorios) {
      // Todas as cobranças do escritório (não deletadas). O filtro por
      // status/vencimento acontece depois em JS — simples e permite ver
      // cobranças que a Asaas ainda não marcou como OVERDUE mas cuja
      // dueDate já passou.
      const cobrancas = await db
        .select()
        .from(asaasCobrancas)
        .where(
          and(
            eq(asaasCobrancas.escritorioId, escritorioId),
            ne(asaasCobrancas.status, "RECEIVED"),
          ),
        );

      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      const dist = 14 * 24 * 60 * 60 * 1000; // janela de até 14 dias antes

      for (const cb of cobrancas) {
        const vencStr = cb.vencimento;
        if (!vencStr) continue;
        const venc = new Date(`${vencStr}T00:00:00`);
        if (isNaN(venc.getTime())) continue;
        const diffMs = venc.getTime() - hoje.getTime();

        // Dados comuns
        const clienteId = cb.asaasCustomerId;
        const [vinc] = clienteId
          ? await db
              .select({ nome: asaasClientes.nome, contatoId: asaasClientes.contatoId })
              .from(asaasClientes)
              .where(and(
                eq(asaasClientes.asaasCustomerId, clienteId),
                eq(asaasClientes.escritorioId, escritorioId),
              )).limit(1)
          : [undefined];

        const comuns = {
          pagamentoId: cb.asaasPaymentId,
          valor: Math.round(Number(cb.valor || 0) * 100),
          descricao: cb.descricao || `Cobrança ${cb.asaasPaymentId}`,
          vencimento: vencStr,
          clienteNome: vinc?.nome || undefined,
          contatoId: vinc?.contatoId || undefined,
        };

        if (diffMs < 0) {
          // Vencida
          const r = await dispararPagamentoVencido(escritorioId, comuns);
          if (r.cenariosDisparados > 0) vencidas += r.cenariosDisparados;
        } else if (diffMs <= dist) {
          // Próxima do vencimento (<= 14 dias). Cada cenário filtra pelo seu
          // próprio `diasAntes`.
          const r = await dispararProximoVencimento(escritorioId, comuns);
          if (r.cenariosDisparados > 0) proximas += r.cenariosDisparados;
        }
      }
    }

    if (vencidas > 0 || proximas > 0) {
      log.info({ vencidas, proximas }, "[Cobranças] Ciclo concluído");
    }
    return { vencidas, proximas };
  } catch (err: any) {
    log.error({ err: err.message }, "[Cobranças] Erro no ciclo");
    return { vencidas: 0, proximas: 0 };
  }
}

export function iniciarCobrancasSchedulerSmartFlow() {
  if (intervalo) return;
  log.info({ intervaloMs: INTERVALO_MS }, "[Cobranças] Scheduler SmartFlow iniciado");
  // Primeira execução após 2 min (dá tempo do app subir e o scheduler de
  // retomada rodar primeiro).
  setTimeout(() => rodarCicloCobrancas().catch(() => {}), 2 * 60_000);
  intervalo = setInterval(() => rodarCicloCobrancas().catch(() => {}), INTERVALO_MS);
}

export function pararCobrancasSchedulerSmartFlow() {
  if (!intervalo) return;
  clearInterval(intervalo);
  intervalo = null;
}

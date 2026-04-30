/**
 * SmartFlow Cobranças Scheduler — cron de 15min que varre cobranças do
 * Asaas e dispara os gatilhos `pagamento_vencido` e
 * `pagamento_proximo_vencimento`.
 *
 * Dois modos de operação por cenário:
 *
 *   1. **Modo slot** (`configGatilho.horarioInicial` preenchido) — o
 *      scheduler calcula slots do dia (ex: 09:00, 11:00, 13:00) e só
 *      dispara o cenário quando o ciclo atual cai na janela de um slot.
 *      Antes de disparar, relê `asaas_cobrancas.status` — se o cliente
 *      pagou entre o último lembrete e agora, skip. Dedupe por
 *      `(cenário, cobrança, slot)`.
 *
 *   2. **Modo legado** (sem `horarioInicial`) — varre cobranças e chama o
 *      dispatcher sem slot. Dedupe mantém 24h por `(cenário, cobrança)`.
 *      Mesmo comportamento que antes.
 *
 * Registrado em `_core/cron-jobs.ts` via dynamic import.
 */

import { getDb } from "../db";
import { asaasCobrancas, smartflowCenarios, asaasClientes, escritorios } from "../../drizzle/schema";
import { eq, and, ne, inArray } from "drizzle-orm";
import { FUSO_HORARIO_PADRAO } from "../../shared/escritorio-types";
import { dispararPagamentoVencido, dispararProximoVencimento } from "./dispatcher";
import {
  acharSlotAtivo,
  calcularSlotsDoDia,
  parseVencimento,
  diasEntre,
  temHorarioConfigurado,
} from "./dispatcher-helpers";
import { createLogger } from "../_core/logger";
import type {
  ConfigGatilhoPagamentoVencido,
  ConfigGatilhoPagamentoProximoVencimento,
} from "../../shared/smartflow-types";

const log = createLogger("smartflow-cobrancas-scheduler");

/** Cron de 15min — precisão suficiente pros slots configuráveis. */
const INTERVALO_MS = 15 * 60 * 1000;
const TOLERANCIA_MIN = 15;

/** Status que indicam "cobrança já paga" — skip silencioso antes do disparo. */
const STATUS_PAGO = new Set(["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH", "REFUNDED"]);

let intervalo: ReturnType<typeof setInterval> | null = null;

interface CenarioLite {
  id: number;
  escritorioId: number;
  gatilho: "pagamento_vencido" | "pagamento_proximo_vencimento";
  configGatilho: Record<string, unknown>;
}

async function carregarCenariosAtivos(): Promise<CenarioLite[]> {
  const db = await getDb();
  if (!db) return [];
  const linhas = await db
    .select()
    .from(smartflowCenarios)
    .where(
      and(
        eq(smartflowCenarios.ativo, true),
        inArray(smartflowCenarios.gatilho, ["pagamento_vencido", "pagamento_proximo_vencimento"]),
      ),
    );
  return linhas.map((l) => {
    let cfg: Record<string, unknown> = {};
    if (l.configGatilho) {
      try {
        const parsed = JSON.parse(l.configGatilho);
        if (parsed && typeof parsed === "object") cfg = parsed;
      } catch {
        /* ignore */
      }
    }
    return {
      id: l.id,
      escritorioId: l.escritorioId,
      gatilho: l.gatilho as "pagamento_vencido" | "pagamento_proximo_vencimento",
      configGatilho: cfg,
    };
  });
}

async function carregarCobrancasDoEscritorio(escritorioId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(asaasCobrancas)
    .where(
      and(
        eq(asaasCobrancas.escritorioId, escritorioId),
        ne(asaasCobrancas.status, "RECEIVED"),
      ),
    );
}

async function resolverVinculo(
  escritorioId: number,
  asaasCustomerId: string | null | undefined,
) {
  if (!asaasCustomerId) return null;
  const db = await getDb();
  if (!db) return null;
  const [vinc] = await db
    .select({ nome: asaasClientes.nome, contatoId: asaasClientes.contatoId })
    .from(asaasClientes)
    .where(
      and(
        eq(asaasClientes.asaasCustomerId, asaasCustomerId),
        eq(asaasClientes.escritorioId, escritorioId),
      ),
    )
    .limit(1);
  return vinc ?? null;
}

/** Roda 1 ciclo — público pra testes/ações admin. */
export async function rodarCicloCobrancas(): Promise<{ vencidas: number; proximas: number }> {
  const db = await getDb();
  if (!db) return { vencidas: 0, proximas: 0 };

  try {
    const cenarios = await carregarCenariosAtivos();
    if (cenarios.length === 0) return { vencidas: 0, proximas: 0 };

    const escritoriosIds = Array.from(new Set(cenarios.map((c) => c.escritorioId)));
    const agora = new Date();
    const hoje = new Date(agora);
    hoje.setHours(0, 0, 0, 0);
    const janelaMs = 14 * 24 * 60 * 60 * 1000;

    // Lê o fuso horário configurado por cada escritório — usado pra
    // materializar slots de disparo no TZ correto (ex: 09:00 SP vs 09:00
    // Manaus são instantes UTC diferentes).
    const fusoPorEscritorio = new Map<number, string>();
    const rowsFuso = await db
      .select({ id: escritorios.id, fusoHorario: escritorios.fusoHorario })
      .from(escritorios)
      .where(inArray(escritorios.id, escritoriosIds));
    for (const r of rowsFuso) fusoPorEscritorio.set(r.id, r.fusoHorario || FUSO_HORARIO_PADRAO);

    let vencidas = 0;
    let proximas = 0;

    for (const escritorioId of escritoriosIds) {
      const cobrancas = await carregarCobrancasDoEscritorio(escritorioId);
      const cenariosDoEscritorio = cenarios.filter((c) => c.escritorioId === escritorioId);
      const tz = fusoPorEscritorio.get(escritorioId) || FUSO_HORARIO_PADRAO;

      for (const cb of cobrancas) {
        const vencStr = cb.vencimento;
        if (!vencStr) continue;
        const venc = parseVencimento(vencStr);
        if (!venc) continue;
        const diffDias = diasEntre(venc, hoje);

        // Pagou entre um lembrete e outro? skip qualquer disparo.
        if (STATUS_PAGO.has(cb.status)) continue;

        // Cobranças manuais não passam pelo scheduler de SmartFlow
        // (não tem pagamentoId Asaas pra correlacionar com webhooks).
        if (!cb.asaasPaymentId || !cb.asaasCustomerId) continue;

        const vinc = await resolverVinculo(escritorioId, cb.asaasCustomerId);
        const comuns = {
          pagamentoId: cb.asaasPaymentId,
          valor: Math.round(Number(cb.valor || 0) * 100),
          descricao: cb.descricao || `Cobrança ${cb.asaasPaymentId}`,
          vencimento: vencStr,
          clienteNome: vinc?.nome || undefined,
          contatoId: vinc?.contatoId || undefined,
          clienteAsaasId: cb.asaasCustomerId,
        };

        for (const cen of cenariosDoEscritorio) {
          const cfg = cen.configGatilho as
            | ConfigGatilhoPagamentoVencido
            | ConfigGatilhoPagamentoProximoVencimento;

          // Filtra janela de cobrança pelo tipo de cenário.
          const venceuDif = venc.getTime() - hoje.getTime();
          if (cen.gatilho === "pagamento_vencido") {
            if (diffDias >= 0) continue; // ainda não venceu
          } else {
            if (venceuDif < 0) continue; // já venceu
            if (venceuDif > janelaMs) continue; // fora da janela max
          }

          // Modo slot: só dispara se o ciclo atual cai dentro de um slot.
          // Modo legado: dispara sem slot (dedupe 24h).
          // Os slots são materializados no fuso do escritório.
          const params: Parameters<typeof dispararPagamentoVencido>[1] = { ...comuns };
          if (temHorarioConfigurado(cfg)) {
            const slots = calcularSlotsDoDia(cfg, hoje, tz);
            const slot = acharSlotAtivo(slots, agora, TOLERANCIA_MIN);
            if (!slot) continue;
            params.slotTimestamp = slot;
          }

          if (cen.gatilho === "pagamento_vencido") {
            const r = await dispararPagamentoVencido(escritorioId, params);
            if (r.cenariosDisparados > 0) vencidas += r.cenariosDisparados;
          } else {
            const r = await dispararProximoVencimento(escritorioId, params);
            if (r.cenariosDisparados > 0) proximas += r.cenariosDisparados;
          }
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
  setTimeout(() => rodarCicloCobrancas().catch(() => {}), 2 * 60_000);
  intervalo = setInterval(() => rodarCicloCobrancas().catch(() => {}), INTERVALO_MS);
}

export function pararCobrancasSchedulerSmartFlow() {
  if (!intervalo) return;
  clearInterval(intervalo);
  intervalo = null;
}

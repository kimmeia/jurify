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
import { eq, and, inArray } from "drizzle-orm";
import { FUSO_HORARIO_PADRAO } from "../../shared/escritorio-types";
import { captureError } from "../_core/sentry";
import { dispararPagamentoVencido, dispararProximoVencimento } from "./dispatcher";
import {
  acharSlotAtivo,
  calcularSlotsDoDia,
  parseVencimento,
  diasEntre,
  temHorarioConfigurado,
  deveDispararProximo,
  deveDispararVencido,
} from "./dispatcher-helpers";
import { createLogger } from "../_core/logger";
import type {
  ConfigGatilhoPagamentoVencido,
  ConfigGatilhoPagamentoProximoVencimento,
} from "../../shared/smartflow-types";

const log = createLogger("smartflow-cobrancas-scheduler");

/**
 * Reporta erros INESPERADOS escapados de `rodarCicloCobrancas`. O try/catch
 * interno da função já trata erros previsíveis e retorna `{vencidas:0,
 * proximas:0}` — esse handler cobre rejeições que furam o try (ex: erro
 * async fora do try-block). Sem isso, lembretes de cobrança não disparam
 * e o operador só descobre quando inadimplentes deixam de receber aviso.
 *
 * Exportada para teste em
 * `server/__tests__/smartflow-schedulers-error-handler.test.ts`.
 */
export function reportarErroInesperado(err: unknown): void {
  log.error(
    { err: err instanceof Error ? err.stack : String(err) },
    "[Cobranças] Erro inesperado escapou do ciclo — verifique rejeição async fora do try interno",
  );
  captureError(err, { kind: "smartflow-cobrancas-scheduler" });
}

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
  // Filtra direto no SQL pra status que disparam reminders: PENDING e
  // OVERDUE. Antes carregava `ne(status, "RECEIVED")` e descartava em
  // JS via STATUS_PAGO (CONFIRMED, RECEIVED_IN_CASH, REFUNDED). Trazia
  // ~30% de tráfego desnecessário em escritórios com muitos pagamentos
  // confirmados/estornados.
  return db
    .select()
    .from(asaasCobrancas)
    .where(
      and(
        eq(asaasCobrancas.escritorioId, escritorioId),
        inArray(asaasCobrancas.status, ["PENDING", "OVERDUE"]),
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

export interface DiagnosticoCobrancaItem {
  pagamentoId: string | null;
  descricao: string;
  vencimento: string | null;
  status: string;
  diasAteVencer: number | null;
  temVinculo: boolean;
  elegivel: boolean;
  motivo: string;
}
export interface DiagnosticoCobrancasResultado {
  cenariosAtivos: number;
  cobrancasNoBanco: number;
  agora: string;
  fuso: string;
  itens: DiagnosticoCobrancaItem[];
  resumo: string;
}

/**
 * Dry-run do ciclo de cobranças pra UM escritório: NÃO envia nada, só explica —
 * cobrança por cobrança — se dispararia agora e, se não, POR QUÊ. Espelha os
 * gates de `rodarCicloCobrancas`. Serve pra diagnosticar "o SmartFlow de
 * cobrança não disparou" sem ficar no escuro esperando o cron de 15min.
 *
 * NÃO checa o dedup por slot (jaDisparouPagamento) — é interno ao dispatcher e
 * raramente é a causa num primeiro teste; sinalizado no texto do item elegível.
 */
export async function diagnosticarCobrancas(
  escritorioId: number,
): Promise<DiagnosticoCobrancasResultado> {
  const db = await getDb();
  const agora = new Date();
  const hoje = new Date(agora);
  hoje.setHours(0, 0, 0, 0);
  const res: DiagnosticoCobrancasResultado = {
    cenariosAtivos: 0,
    cobrancasNoBanco: 0,
    agora: agora.toISOString(),
    fuso: FUSO_HORARIO_PADRAO,
    itens: [],
    resumo: "",
  };
  if (!db) {
    res.resumo = "Banco indisponível.";
    return res;
  }

  const cenarios = (await carregarCenariosAtivos()).filter((c) => c.escritorioId === escritorioId);
  res.cenariosAtivos = cenarios.length;
  if (cenarios.length === 0) {
    res.resumo =
      "Nenhum cenário ATIVO de cobrança (a vencer / vencido). Ative o cenário no SmartFlow — o cron só olha cenários ativos.";
    return res;
  }

  const [escRow] = await db
    .select({ fusoHorario: escritorios.fusoHorario })
    .from(escritorios)
    .where(eq(escritorios.id, escritorioId))
    .limit(1);
  const tz = escRow?.fusoHorario || FUSO_HORARIO_PADRAO;
  res.fuso = tz;

  const cobrancas = await carregarCobrancasDoEscritorio(escritorioId);
  res.cobrancasNoBanco = cobrancas.length;
  if (cobrancas.length === 0) {
    res.resumo =
      "Nenhuma cobrança PENDING/OVERDUE no banco local. Se você criou no Asaas e não aparece aqui, o webhook não sincronizou (Configurações → Asaas). Cobrança lançada MANUAL não entra no cron.";
    return res;
  }

  const janelaMs = 14 * 24 * 60 * 60 * 1000;
  const hhmm = (d: Date) =>
    d.toLocaleTimeString("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit" });

  for (const cb of cobrancas) {
    const venc = parseVencimento(cb.vencimento);
    const item: DiagnosticoCobrancaItem = {
      pagamentoId: cb.asaasPaymentId ?? null,
      descricao: cb.descricao || `Cobrança ${cb.asaasPaymentId ?? cb.id}`,
      vencimento: cb.vencimento ?? null,
      status: cb.status,
      diasAteVencer: null,
      temVinculo: false,
      elegivel: false,
      motivo: "",
    };

    if (!venc) {
      item.motivo = "Vencimento inválido/ausente.";
      res.itens.push(item);
      continue;
    }
    const diasAteVencer = diasEntre(venc, hoje);
    item.diasAteVencer = diasAteVencer;
    if (STATUS_PAGO.has(cb.status)) {
      item.motivo = `Já paga (status ${cb.status}) — não dispara.`;
      res.itens.push(item);
      continue;
    }
    if (!cb.asaasPaymentId || !cb.asaasCustomerId) {
      item.motivo =
        "Sem vínculo Asaas (asaasPaymentId) — cobrança MANUAL não passa pelo cron; só cobrança criada no Asaas.";
      res.itens.push(item);
      continue;
    }

    const vinc = await resolverVinculo(escritorioId, cb.asaasCustomerId);
    item.temVinculo = !!vinc?.contatoId;

    const venceuDif = venc.getTime() - hoje.getTime();
    const motivos: string[] = [];
    let casou = false;
    for (const cen of cenarios) {
      const cfg = cen.configGatilho as
        | ConfigGatilhoPagamentoVencido
        | ConfigGatilhoPagamentoProximoVencimento;
      if (cen.gatilho === "pagamento_vencido") {
        if (diasAteVencer >= 0) {
          motivos.push("'vencido': ainda não venceu");
          continue;
        }
        if (!deveDispararVencido(cfg, Math.abs(diasAteVencer))) {
          motivos.push(`'vencido': atraso ${Math.abs(diasAteVencer)}d abaixo do configurado`);
          continue;
        }
      } else {
        if (venceuDif < 0) {
          motivos.push("'a vencer': já venceu");
          continue;
        }
        if (venceuDif > janelaMs) {
          motivos.push("'a vencer': vence em mais de 14 dias");
          continue;
        }
        if (!deveDispararProximo(cfg, diasAteVencer)) {
          motivos.push(`'a vencer': faltam ${diasAteVencer}d, mais que os diasAntes configurados`);
          continue;
        }
      }
      if (temHorarioConfigurado(cfg)) {
        const slots = calcularSlotsDoDia(cfg, hoje, tz);
        const slot = acharSlotAtivo(slots, agora, TOLERANCIA_MIN);
        if (!slot) {
          motivos.push(
            `fora do horário: slots de hoje [${slots.map(hhmm).join(", ") || "nenhum"}]; agora ${hhmm(agora)}; só dispara até ${TOLERANCIA_MIN}min após um slot`,
          );
          continue;
        }
      }
      casou = true;
      break;
    }

    if (casou) {
      item.elegivel = item.temVinculo;
      item.motivo = item.temVinculo
        ? "ELEGÍVEL — deve disparar no próximo ciclo do cron (até 15min). Se já disparou hoje, respeita repetirPorDias."
        : "Casaria o gatilho, MAS sem cliente vinculado (contatoId) — não há telefone pra enviar. Vincule o cliente à cobrança.";
    } else {
      item.motivo = motivos.length ? motivos.join(" | ") : "Nenhum cenário casou.";
    }
    res.itens.push(item);
  }

  const elegiveis = res.itens.filter((i) => i.elegivel).length;
  res.resumo =
    elegiveis > 0
      ? `${elegiveis} cobrança(s) elegível(is) — devem disparar no próximo ciclo (até 15min).`
      : "Nenhuma cobrança elegível agora — veja o motivo de cada uma abaixo.";
  return res;
}

export function iniciarCobrancasSchedulerSmartFlow() {
  if (intervalo) return;
  log.info({ intervaloMs: INTERVALO_MS }, "[Cobranças] Scheduler SmartFlow iniciado");
  setTimeout(() => rodarCicloCobrancas().catch(reportarErroInesperado), 2 * 60_000);
  intervalo = setInterval(
    () => rodarCicloCobrancas().catch(reportarErroInesperado),
    INTERVALO_MS,
  );
}

export function pararCobrancasSchedulerSmartFlow() {
  if (!intervalo) return;
  clearInterval(intervalo);
  intervalo = null;
}

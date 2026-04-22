/**
 * Helpers puros usados pelo dispatcher do SmartFlow. Separados em arquivo
 * próprio pra poderem ser testados sem precisar mockar `getDb` nem puxar
 * o schema do drizzle.
 */

import type {
  ConfigGatilhoMensagemCanal,
  ConfigGatilhoPagamentoVencido,
  ConfigGatilhoPagamentoProximoVencimento,
  ConfigGatilhoAgendamentoLembrete,
  JanelaDisparo,
  TipoCanalMensagem,
} from "../../shared/smartflow-types";
import {
  partsInTz,
  zonedWallTimeToUtc,
  diaCivilNoTz,
  inicioDoDiaNoTz,
  diasCivisEntre,
} from "../../shared/timezone";

/** Fuso default quando o escritório não tem `fusoHorario` (schema já garante
 *  NOT NULL DEFAULT, mas helpers devem se proteger caso sejam chamados solto). */
export const FUSO_DEFAULT = "America/Sao_Paulo";

/**
 * Retorna `true` se o cenário (com gatilho `mensagem_canal`) aceita o canal
 * informado. Config vazia = aceita qualquer canal.
 */
export function aceitaCanal(cfg: ConfigGatilhoMensagemCanal | undefined, canalTipo: TipoCanalMensagem): boolean {
  const canais = Array.isArray(cfg?.canais) ? cfg!.canais : [];
  if (canais.length === 0) return true;
  return canais.includes(canalTipo);
}

/**
 * Dispara `pagamento_vencido`?
 * Só se o atraso atual for >= `diasAtraso` configurado (default 0).
 */
export function deveDispararVencido(
  cfg: ConfigGatilhoPagamentoVencido | undefined,
  diasAtrasoAtual: number,
): boolean {
  const min = Math.max(0, Number(cfg?.diasAtraso ?? 0));
  return diasAtrasoAtual >= min;
}

/**
 * Dispara `pagamento_proximo_vencimento`?
 * Só se faltar no máximo `diasAntes` (default 3) dias para o vencimento,
 * e o pagamento ainda não tiver vencido.
 */
export function deveDispararProximo(
  cfg: ConfigGatilhoPagamentoProximoVencimento | undefined,
  diasAteVencer: number,
): boolean {
  if (diasAteVencer < 0) return false;
  const max = Math.max(0, Number(cfg?.diasAntes ?? 3));
  return diasAteVencer <= max;
}

/**
 * Dedupe: retorna `true` se o JSON `contextoSerializado` referencia o
 * `pagamentoId` informado. O dispatcher usa isso pra pular execuções
 * duplicadas na janela de 24h.
 */
export function contextoContemPagamento(contextoSerializado: string | null | undefined, pagamentoId: string): boolean {
  if (!contextoSerializado || !pagamentoId) return false;
  return contextoSerializado.includes(`"pagamentoId":"${pagamentoId}"`);
}

/**
 * Diferença em dias civis (a - b), medida no fuso `tz` do escritório.
 *
 * Ex: `a = 2026-04-22T01:00:00Z` (= 22:00 BRT de 21-abr), `b = venc 21-abr`
 *      → 0 dias. Só à meia-noite local vira 1.
 */
export function diasEntre(a: Date, b: Date, tz: string = FUSO_DEFAULT): number {
  return diasCivisEntre(a, b, tz);
}

/**
 * Parseia a string de vencimento do Asaas ("YYYY-MM-DD") como meia-noite
 * CIVIL no fuso `tz`. Sem `tz`, assumia UTC — fazia o vencimento "2026-04-21"
 * ser meia-noite UTC (= 21h de 20-abr BRT), dando 1 dia de atraso ao tick
 * 00:15 UTC de 22-abr (= 21:15 de 21-abr BRT).
 */
export function parseVencimento(
  iso: string | null | undefined,
  tz: string = FUSO_DEFAULT,
): Date | null {
  if (!iso || typeof iso !== "string") return null;
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const y = Number(match[1]);
  const mo = Number(match[2]);
  const d = Number(match[3]);
  if (!Number.isInteger(y) || !Number.isInteger(mo) || !Number.isInteger(d)) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return zonedWallTimeToUtc(y, mo, d, 0, 0, 0, tz);
}

// ─── Janela de disparo (slots de horário) ───────────────────────────────────

/**
 * Valida formato "HH:MM". Retorna `{h, m}` se válido; null caso contrário.
 * Minutos/horas fora do intervalo são rejeitados.
 */
export function parseHoraHHMM(horario: string | null | undefined): { h: number; m: number } | null {
  if (!horario || typeof horario !== "string") return null;
  const match = horario.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m };
}

/**
 * `true` se a janela de disparo tem `horarioInicial` válido — nesse caso o
 * scheduler usa o modo "slot" (N disparos/dia); caso contrário, cai no
 * comportamento legado (1×/dia, dedupe de 24h).
 */
export function temHorarioConfigurado(cfg: JanelaDisparo | undefined | null): boolean {
  if (!cfg) return false;
  return parseHoraHHMM(cfg.horarioInicial) !== null;
}

/**
 * Dada uma janela de disparo, uma data-base e o fuso do escritório,
 * retorna os `disparosPorDia` slots como instâncias Date — cada um é o
 * instante UTC do horário civil de disparo naquele dia no `tz`.
 *
 * Ex: `horarioInicial="00:01"`, `tz="America/Sao_Paulo"`, baseDia em
 * 2026-04-22 → [2026-04-22T03:01:00Z] (00:01 BRT = 03:01 UTC).
 *
 * Se `cfg.horarioInicial` for inválido/ausente, retorna `[]` — caller cai
 * no modo legado.
 */
export function calcularSlotsDoDia(
  cfg: JanelaDisparo | undefined | null,
  baseDia: Date,
  tz: string = FUSO_DEFAULT,
): Date[] {
  const hora = cfg ? parseHoraHHMM(cfg.horarioInicial) : null;
  if (!hora) return [];

  const disparos = Math.max(1, Math.floor(Number(cfg?.disparosPorDia ?? 1)));
  const intervaloMin = Math.max(1, Math.floor(Number(cfg?.intervaloMinutos ?? 120)));

  const base = partsInTz(baseDia, tz);
  const slots: Date[] = [];
  for (let i = 0; i < disparos; i++) {
    const minutosTotais = hora.m + i * intervaloMin;
    const h = hora.h + Math.floor(minutosTotais / 60);
    const m = minutosTotais % 60;
    // Usa o ano/mês/dia civil da base no `tz`; `zonedWallTimeToUtc` normaliza
    // horas ≥ 24 implicitamente (Date.UTC rola o dia).
    slots.push(zonedWallTimeToUtc(base.y, base.mo, base.d, h, m, 0, tz));
  }
  return slots;
}

/**
 * Procura o slot (dentre os calculados) cujo horário cai na janela de
 * tolerância (`[agora - toleranciaMin, agora]`). A tolerância equivale ao
 * intervalo do cron (ex: 15min) — garante que nenhum slot é perdido se o
 * cron atrasar.
 */
export function acharSlotAtivo(
  slots: Date[],
  agora: Date,
  toleranciaMin: number,
): Date | null {
  const inicioJanela = new Date(agora.getTime() - toleranciaMin * 60 * 1000);
  // Varre do último pro primeiro — se houver dois slots muito próximos
  // (config inconsistente), escolhe o mais recente.
  for (let i = slots.length - 1; i >= 0; i--) {
    const s = slots[i];
    if (s >= inicioJanela && s <= agora) return s;
  }
  return null;
}

/**
 * Serializa um slot como string estável — usada no contexto da execução pra
 * permitir dedupe por match exato de substring. Formato:
 * "YYYY-MM-DDTHH:MM" em horário civil do fuso `tz` (truncando segundos).
 *
 * Antes esta função usava `getFullYear/getMonth/.../getHours` que lê no
 * fuso do processo Node (UTC em produção). A chave ficava inconsistente
 * com o horário configurado pelo usuário.
 */
export function slotTimestampChave(slot: Date, tz: string = FUSO_DEFAULT): string {
  const p = partsInTz(slot, tz);
  const mo = String(p.mo).padStart(2, "0");
  const d = String(p.d).padStart(2, "0");
  const h = String(p.h).padStart(2, "0");
  const mi = String(p.mi).padStart(2, "0");
  return `${p.y}-${mo}-${d}T${h}:${mi}`;
}

/**
 * Dedupe por slot: `true` se o `contextoSerializado` tem o `slotTimestamp`
 * exato informado. Se o contexto não tem `slotTimestamp`, nunca bate — o
 * caller deve cair no dedupe de 24h.
 */
export function contextoContemSlot(contextoSerializado: string | null | undefined, slotChave: string): boolean {
  if (!contextoSerializado || !slotChave) return false;
  return contextoSerializado.includes(`"slotTimestamp":"${slotChave}"`);
}

/**
 * Retorna o "dia civil" (YYYY-MM-DD) de uma Date no fuso `tz` do escritório.
 * Usado pra contar quantos dias distintos um cenário já disparou (limite
 * `repetirPorDias`).
 */
export function chaveDiaLocal(dt: Date, tz: string = FUSO_DEFAULT): string {
  return diaCivilNoTz(dt, tz);
}

// ─── Lembrete de agendamento Cal.com ────────────────────────────────────────

/**
 * Calcula o momento exato em que o lembrete deve disparar. A partir do
 * `startTime` do booking, subtrai `diasAntes` dias civis e posiciona no
 * `horario` configurado (HH:MM) **no fuso `tz` do escritório**.
 *
 * Ex: booking em 2026-04-22T14:00Z, tz="America/Sao_Paulo" (= 11:00 BRT de
 * 22-abr), `diasAntes=1`, `horario="18:00"` → lembrete às `2026-04-21 18:00`
 * BRT = `2026-04-21T21:00:00Z`.
 */
export function calcularMomentoLembrete(
  startTime: Date,
  cfg: ConfigGatilhoAgendamentoLembrete | undefined | null,
  tz: string = FUSO_DEFAULT,
): Date | null {
  const diasAntes = Math.max(0, Math.floor(Number(cfg?.diasAntes ?? 1)));
  const hora = parseHoraHHMM(cfg?.horario || "18:00") ?? { h: 18, m: 0 };

  // Dia civil do booking no `tz`, menos `diasAntes`.
  const inicioDia = inicioDoDiaNoTz(startTime, tz);
  const diaAlvo = new Date(inicioDia.getTime() - diasAntes * 24 * 60 * 60 * 1000);
  const partsAlvo = partsInTz(diaAlvo, tz);
  return zonedWallTimeToUtc(partsAlvo.y, partsAlvo.mo, partsAlvo.d, hora.h, hora.m, 0, tz);
}

/**
 * Retorna `true` se o lembrete do booking deve disparar no ciclo atual do
 * scheduler. Usa a mesma janela de tolerância do `acharSlotAtivo`.
 */
export function deveDispararLembrete(
  startTime: Date,
  cfg: ConfigGatilhoAgendamentoLembrete | undefined | null,
  agora: Date,
  toleranciaMin: number,
  tz: string = FUSO_DEFAULT,
): boolean {
  const momento = calcularMomentoLembrete(startTime, cfg, tz);
  if (!momento) return false;
  // Janela: entre (agora - tolerância) e agora — igual ao slot Asaas.
  const inicioJanela = new Date(agora.getTime() - toleranciaMin * 60 * 1000);
  return momento >= inicioJanela && momento <= agora;
}

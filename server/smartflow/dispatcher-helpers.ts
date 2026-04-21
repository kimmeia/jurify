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

export function diasEntre(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000));
}

export function parseVencimento(iso: string | null | undefined): Date | null {
  if (!iso || typeof iso !== "string") return null;
  const d = new Date(`${iso}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
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
 * Dada uma janela de disparo e uma data-base (início do dia), retorna os
 * `disparosPorDia` slots como instâncias Date — cada um é o inicio do
 * horário de disparo naquele dia. Ex: `horarioInicial="09:00"`,
 * `disparosPorDia=3`, `intervaloMinutos=120` → [09:00, 11:00, 13:00].
 *
 * Se `cfg.horarioInicial` for inválido/ausente, retorna `[]` — caller cai
 * no modo legado.
 */
export function calcularSlotsDoDia(
  cfg: JanelaDisparo | undefined | null,
  baseDia: Date,
): Date[] {
  const hora = cfg ? parseHoraHHMM(cfg.horarioInicial) : null;
  if (!hora) return [];

  const disparos = Math.max(1, Math.floor(Number(cfg?.disparosPorDia ?? 1)));
  const intervaloMin = Math.max(1, Math.floor(Number(cfg?.intervaloMinutos ?? 120)));

  const slots: Date[] = [];
  for (let i = 0; i < disparos; i++) {
    const slot = new Date(baseDia);
    slot.setHours(hora.h, hora.m + i * intervaloMin, 0, 0);
    slots.push(slot);
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
 * Serializa um slot como string estável (sem timezone) — usada dentro do
 * contexto da execução pra permitir dedupe por match exato de substring.
 * Formato: "YYYY-MM-DDTHH:MM" (truncando segundos).
 */
export function slotTimestampChave(slot: Date): string {
  const y = slot.getFullYear();
  const mo = String(slot.getMonth() + 1).padStart(2, "0");
  const d = String(slot.getDate()).padStart(2, "0");
  const h = String(slot.getHours()).padStart(2, "0");
  const mi = String(slot.getMinutes()).padStart(2, "0");
  return `${y}-${mo}-${d}T${h}:${mi}`;
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
 * Retorna o "dia" (YYYY-MM-DD) no timezone local a partir de uma Date.
 * Usado pra contar quantos dias distintos um cenário já disparou (limite
 * `repetirPorDias`).
 */
export function chaveDiaLocal(dt: Date): string {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ─── Lembrete de agendamento Cal.com ────────────────────────────────────────

/**
 * Calcula o momento exato em que o lembrete deve disparar. A partir do
 * `startTime` do booking, subtrai `diasAntes` dias e posiciona no `horario`
 * configurado (HH:MM, timezone local).
 *
 * Ex: booking começa em `2026-04-22 14:00`, `diasAntes=1`, `horario="18:00"`
 *     → lembrete às `2026-04-21 18:00`.
 */
export function calcularMomentoLembrete(
  startTime: Date,
  cfg: ConfigGatilhoAgendamentoLembrete | undefined | null,
): Date | null {
  const diasAntes = Math.max(0, Math.floor(Number(cfg?.diasAntes ?? 1)));
  const hora = parseHoraHHMM(cfg?.horario || "18:00") ?? { h: 18, m: 0 };
  const momento = new Date(startTime);
  momento.setDate(momento.getDate() - diasAntes);
  momento.setHours(hora.h, hora.m, 0, 0);
  return momento;
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
): boolean {
  const momento = calcularMomentoLembrete(startTime, cfg);
  if (!momento) return false;
  // Janela: entre (agora - tolerância) e agora — igual ao slot Asaas.
  const inicioJanela = new Date(agora.getTime() - toleranciaMin * 60 * 1000);
  return momento >= inicioJanela && momento <= agora;
}

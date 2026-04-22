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

// ─── Helpers de timezone (IANA) ─────────────────────────────────────────────

/**
 * Offset em minutos entre um timezone IANA e UTC para um instante específico.
 * Positivo para leste de Greenwich. Ex: `America/Sao_Paulo` retorna `-180`.
 *
 * Funciona com DST transparente: usamos a data de referência para decidir
 * qual offset aplicar.
 */
function offsetMinutos(tz: string, d: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(d);

  const m: Record<string, string> = {};
  for (const p of parts) m[p.type] = p.value;

  const asUTC = Date.UTC(
    Number(m.year),
    Number(m.month) - 1,
    Number(m.day),
    m.hour === "24" ? 0 : Number(m.hour),
    Number(m.minute),
    Number(m.second),
  );
  return Math.round((asUTC - d.getTime()) / 60000);
}

/**
 * Constrói um `Date` (em UTC) que representa "Y-M-D H:MI" no timezone `tz`.
 * Usado para materializar slots como "09:00 de hoje em Brasília" —
 * independente do TZ do servidor (que em deploys Railway/AWS é UTC).
 */
export function dateNoFuso(
  y: number, mo: number, d: number, h: number, mi: number,
  tz: string,
): Date {
  const naive = new Date(Date.UTC(y, mo - 1, d, h, mi, 0));
  const offset = offsetMinutos(tz, naive);
  return new Date(naive.getTime() - offset * 60000);
}

/**
 * Retorna Y/M/D do `date` observado no timezone `tz`. Usado para chaves
 * diárias e contagem de dias distintos (`repetirPorDias`) respeitando o
 * calendário local do escritório.
 */
export function ymdNoFuso(date: Date, tz: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const r: Record<string, string> = {};
  for (const p of parts) r[p.type] = p.value;
  return { y: Number(r.year), m: Number(r.month), d: Number(r.day) };
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
 *
 * Quando `tz` é passado, os slots são interpretados no timezone IANA do
 * escritório (ex: "America/Sao_Paulo") — imprescindível em deploys onde o
 * TZ do servidor é UTC. Sem `tz`, preserva o comportamento legado (usa o
 * TZ do processo Node via `setHours`).
 */
export function calcularSlotsDoDia(
  cfg: JanelaDisparo | undefined | null,
  baseDia: Date,
  tz?: string,
): Date[] {
  const hora = cfg ? parseHoraHHMM(cfg.horarioInicial) : null;
  if (!hora) return [];

  const disparos = Math.max(1, Math.floor(Number(cfg?.disparosPorDia ?? 1)));
  const intervaloMin = Math.max(1, Math.floor(Number(cfg?.intervaloMinutos ?? 120)));

  const slots: Date[] = [];
  if (tz) {
    const { y, m, d } = ymdNoFuso(baseDia, tz);
    for (let i = 0; i < disparos; i++) {
      const totalMin = hora.h * 60 + hora.m + i * intervaloMin;
      const slotH = Math.floor(totalMin / 60);
      const slotM = totalMin % 60;
      slots.push(dateNoFuso(y, m, d, slotH, slotM, tz));
    }
  } else {
    for (let i = 0; i < disparos; i++) {
      const slot = new Date(baseDia);
      slot.setHours(hora.h, hora.m + i * intervaloMin, 0, 0);
      slots.push(slot);
    }
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
 * configurado (HH:MM).
 *
 * Ex: booking começa em `2026-04-22 14:00`, `diasAntes=1`, `horario="18:00"`
 *     → lembrete às `2026-04-21 18:00`.
 *
 * Quando `tz` é passado, o `horario` é interpretado no timezone IANA do
 * escritório (ex: "America/Sao_Paulo"). Sem `tz`, preserva o comportamento
 * legado (TZ do processo Node).
 */
export function calcularMomentoLembrete(
  startTime: Date,
  cfg: ConfigGatilhoAgendamentoLembrete | undefined | null,
  tz?: string,
): Date | null {
  const diasAntes = Math.max(0, Math.floor(Number(cfg?.diasAntes ?? 1)));
  const hora = parseHoraHHMM(cfg?.horario || "18:00") ?? { h: 18, m: 0 };
  if (tz) {
    const base = new Date(startTime.getTime() - diasAntes * 24 * 60 * 60 * 1000);
    const { y, m, d } = ymdNoFuso(base, tz);
    return dateNoFuso(y, m, d, hora.h, hora.m, tz);
  }
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
  tz?: string,
): boolean {
  const momento = calcularMomentoLembrete(startTime, cfg, tz);
  if (!momento) return false;
  // Janela: entre (agora - tolerância) e agora — igual ao slot Asaas.
  const inicioJanela = new Date(agora.getTime() - toleranciaMin * 60 * 1000);
  return momento >= inicioJanela && momento <= agora;
}

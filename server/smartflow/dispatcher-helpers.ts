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
 * Só quando faltarem EXATAMENTE `diasAntes` (default 3) dias pro vencimento —
 * "1 dia antes" dispara SÓ na véspera, não no dia do vencimento (0 dias) nem 2
 * dias antes. Antes era "até N dias" (`<= diasAntes`), que disparava em 0..N e
 * confundia (ex.: "1 dia antes" disparava também no dia do vencimento).
 */
export function deveDispararProximo(
  cfg: ConfigGatilhoPagamentoProximoVencimento | undefined,
  diasAteVencer: number,
): boolean {
  if (diasAteVencer < 0) return false;
  const alvo = Math.max(0, Number(cfg?.diasAntes ?? 3));
  return diasAteVencer === alvo;
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

/**
 * Diferença em DIAS DE CALENDÁRIO entre hoje (no fuso `tz` do escritório) e a
 * data de vencimento ("YYYY-MM-DD"). Positivo = vence no futuro; 0 = vence hoje;
 * negativo = já venceu. Diferente de `diasEntre(venc, new Date())`, que faz floor
 * da diferença em HORAS e subconta quando o dia já avançou (ex.: 07/07 20h →
 * 09/07 dava 1, não 2 — e a cobrança "1 dia antes" disparava 2 dias antes).
 * Aqui compara só o calendário local, então 07/07 → 09/07 = 2 em qualquer hora.
 */
export function diasCalendarioAteVencimento(
  vencimentoIso: string,
  agora: Date,
  tz: string,
): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(vencimentoIso || "");
  if (!m) return 0;
  const hoje = ymdNoFuso(agora, tz);
  const msVenc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const msHoje = Date.UTC(hoje.y, hoje.m - 1, hoje.d);
  return Math.round((msVenc - msHoje) / (24 * 60 * 60 * 1000));
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

// ─── Condições por horário / dia da semana (fuso IANA) ──────────────────────

/** Minutos desde a meia-noite (0..1439) de `date` observado no fuso `tz`. */
export function minutosDoDiaNoFuso(date: Date, tz: string): number {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
  const [hh, mm] = f.format(date).split(":").map(Number);
  return (hh % 24) * 60 + mm;
}

const DIA_SEMANA_INDICE: Record<string, number> = {
  dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6, "sáb": 6,
};

/** 0=domingo .. 6=sábado de `date` observado no fuso `tz`. */
export function diaSemanaNoFuso(date: Date, tz: string): number {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(date);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[wd] ?? date.getUTCDay();
}

/**
 * `true` se o horário de `agora` (no fuso `tz`) cai na janela [início, fim).
 * Início inclusivo, fim exclusivo (ex: "09:00"–"18:00" → 18:00 já está FORA).
 * Suporta janela que cruza a meia-noite (início > fim, ex: "22:00"–"06:00").
 * `inicio`/`fim` em "HH:MM"; formato inválido → false.
 */
export function avaliarHorarioEntre(agora: Date, inicio: string, fim: string, tz: string): boolean {
  const ini = parseHoraHHMM(inicio);
  const f = parseHoraHHMM(fim);
  if (!ini || !f) return false;
  const minNow = minutosDoDiaNoFuso(agora, tz);
  const minIni = ini.h * 60 + ini.m;
  const minFim = f.h * 60 + f.m;
  if (minIni === minFim) return false; // janela vazia
  return minIni < minFim
    ? minNow >= minIni && minNow < minFim
    : minNow >= minIni || minNow < minFim; // cruza a meia-noite
}

/**
 * `true` se o dia da semana de `agora` (no fuso `tz`) está na lista CSV.
 * Aceita abreviações pt-BR (dom,seg,ter,qua,qui,sex,sab) e/ou números 0..6
 * (0=domingo). Ex: "seg,ter,qua,qui,sex" = dias úteis.
 */
export function avaliarDiaSemana(agora: Date, diasCsv: string, tz: string): boolean {
  const hoje = diaSemanaNoFuso(agora, tz);
  for (const raw of String(diasCsv ?? "").split(",")) {
    const t = raw.trim().toLowerCase();
    if (!t) continue;
    const idx = t in DIA_SEMANA_INDICE ? DIA_SEMANA_INDICE[t] : Number(t);
    if (Number.isInteger(idx) && idx === hoje) return true;
  }
  return false;
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
 * Teto de disparos por dia (por pagamento) — trava anti-spam. Um cenário salvo
 * com valor alto (ex.: 20/dia) causou ban da Meta por "Sending spam"; aqui
 * limitamos no motor pra proteger inclusive fluxos já criados. 1/dia é o ideal
 * pra cobrança. A UI usa o mesmo teto no input.
 */
export const MAX_DISPAROS_DIA = 3;

/**
 * Clampa um valor numérico de config de disparo em [1, max]. NaN/inválido
 * (config corrompida, string não-numérica) cai no fallback — NUNCA em NaN:
 * `x >= NaN` é sempre false e um limite NaN desligaria o teto (foi a fresta
 * que reabria o dunning infinito).
 */
export function clampConfigDisparo(valor: unknown, fallback: number, max: number): number {
  const n = Number(valor ?? fallback);
  return Math.min(max, Math.max(1, Number.isFinite(n) ? Math.floor(n) : fallback));
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

  // Teto anti-spam: por mais que o cenário esteja salvo com um número alto
  // (ex.: 20/dia — causou ban da Meta por "Sending spam"), NUNCA dispara mais
  // que MAX_DISPAROS_DIA por dia pro mesmo pagamento. Protege inclusive fluxos
  // já criados. 1/dia é o recomendado pra cobrança.
  const disparos = clampConfigDisparo(cfg?.disparosPorDia, 1, MAX_DISPAROS_DIA);
  const intervaloMin = clampConfigDisparo(cfg?.intervaloMinutos, 120, 24 * 60);

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
 * Retorna o slot que deve disparar AGORA: o mais recente que já passou hoje
 * (`slot <= agora`). Se nenhum passou ainda, retorna null.
 *
 * Antes exigia o slot dentro de `[agora - toleranciaMin, agora]` — uma janela
 * de 15min IGUAL ao intervalo do cron, com margem ZERO. Qualquer atraso (deploy/
 * restart do cron, drift do setInterval, container pausado) fazia o horário cair
 * no vão entre dois ticks e ser PERDIDO no dia inteiro ("roda quando quer").
 * Agora dispara no PRIMEIRO tick a partir do horário; como os slots vêm do dia
 * corrente (calcularSlotsDoDia usa o fuso do escritório), "já passou" nunca vaza
 * pro dia anterior, e o dedupe por (cenário, pagamento, slot) garante 1× por
 * slot/dia mesmo que o disparo aconteça em qualquer tick posterior ao horário.
 *
 * `toleranciaMin` mantida na assinatura por compat (ignorada).
 */
export function acharSlotAtivo(
  slots: Date[],
  agora: Date,
  _toleranciaMin?: number,
): Date | null {
  let melhor: Date | null = null;
  for (const s of slots) {
    if (s.getTime() <= agora.getTime() && (!melhor || s.getTime() > melhor.getTime())) {
      melhor = s;
    }
  }
  return melhor;
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

/**
 * Decide se a retomada de uma execução pausada deve REENTRAR no nó onde
 * pausou (re-executando-o) em vez de continuar linearmente por `ordem`.
 *
 * Vale sempre que o nó de espera é conhecido (`waitNodeId`) e existe no
 * cenário. Antes o gate era "o cenário tem alguma seta `proximoSe`?" (modo
 * grafo) — mas um Atendente IA puramente conversacional (sem ações ligadas)
 * não tem NENHUMA seta, então caía no resume LINEAR, que pulava o nó e parava
 * a conversa após a 1ª resposta. Reentrar re-executa o agente a cada mensagem.
 */
export function deveReentrarNoWaitNode(
  passos: Array<{ clienteId?: string | null }>,
  waitNodeId: string | null | undefined,
): boolean {
  return !!waitNodeId && passos.some((p) => p.clienteId === waitNodeId);
}

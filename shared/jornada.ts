/**
 * A jornada contratada de cada colaborador.
 *
 * Sem ela o espelho de ponto mostra horas e não diz nada: 7h20 num dia é
 * sobra pra quem faz 6h e falta pra quem faz 8h. É a jornada que transforma
 * "quanto trabalhou" em "cumpriu", e é por colaborador porque estagiário,
 * atendente e sócio não têm a mesma carga.
 *
 * O formato guarda HORÁRIO, não só duração. Duração responderia "cumpriu as
 * 8h"; horário responde também "chegou na hora" — e pontualidade é um dos
 * critérios que a avaliação de desempenho vai medir. Um formato só serve aos
 * dois usos; dois formatos divergem.
 *
 * Dia ausente do mapa é dia de folga. Jornada inteira ausente (null) é
 * colaborador sem jornada definida, e aí o espelho mostra as horas sem cobrar
 * nada — que é o certo enquanto ninguém configurou.
 */

/** 0 = domingo, 6 = sábado. Mesma convenção de `Date.getDay()`. */
export type DiaSemana = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface ExpedienteDoDia {
  /** "08:00" */
  inicio: string;
  /** "18:00" */
  fim: string;
  /** Minutos de intervalo previstos (almoço). 0 quando não há. */
  intervaloMin: number;
}

/** Mapa de dia da semana → expediente. Dia ausente = folga. */
export type JornadaSemanal = Partial<Record<DiaSemana, ExpedienteDoDia>>;

export const NOMES_DIA: Record<DiaSemana, string> = {
  0: "Domingo",
  1: "Segunda",
  2: "Terça",
  3: "Quarta",
  4: "Quinta",
  5: "Sexta",
  6: "Sábado",
};

/**
 * Tolerância de atraso, em minutos.
 *
 * Chegar 08:03 não é atraso — é o relógio do prédio, o elevador, o café. Sem
 * tolerância o espelho acusaria quase todo mundo quase todo dia, e um alarme
 * que dispara sempre é um alarme que ninguém lê.
 */
export const TOLERANCIA_ATRASO_MIN = 10;

const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "08:30" → 510. null quando o texto não é hora. */
export function minutosDaHora(hhmm: string): number | null {
  const m = HORA.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 510 → "08:30". */
export function horaDosMinutos(minutos: number): string {
  const m = ((minutos % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * Valida e normaliza o que veio da tela ou do banco.
 *
 * Devolve null pra jornada inexistente OU inválida — e é de propósito que os
 * dois casos se juntem: jornada quebrada tratada como "8h de seg a sex" faria
 * o espelho cobrar de alguém uma carga que ninguém contratou.
 */
export function normalizarJornada(bruto: unknown): JornadaSemanal | null {
  const obj = typeof bruto === "string" ? seguroJson(bruto) : bruto;
  if (!obj || typeof obj !== "object") return null;

  const saida: JornadaSemanal = {};
  for (const [chave, valor] of Object.entries(obj as Record<string, unknown>)) {
    const dia = Number(chave);
    if (!Number.isInteger(dia) || dia < 0 || dia > 6) continue;
    if (!valor || typeof valor !== "object") continue;

    const v = valor as { inicio?: unknown; fim?: unknown; intervaloMin?: unknown };
    const inicio = typeof v.inicio === "string" ? v.inicio : "";
    const fim = typeof v.fim === "string" ? v.fim : "";
    const mi = minutosDaHora(inicio);
    const mf = minutosDaHora(fim);
    if (mi == null || mf == null || mf <= mi) continue;

    const intervalo = Number(v.intervaloMin);
    const intervaloMin = Number.isFinite(intervalo) && intervalo >= 0 && intervalo < mf - mi
      ? Math.round(intervalo)
      : 0;

    saida[dia as DiaSemana] = { inicio, fim, intervaloMin };
  }

  return Object.keys(saida).length > 0 ? saida : null;
}

function seguroJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Minutos previstos num expediente, já descontado o intervalo. */
export function minutosDoExpediente(e: ExpedienteDoDia): number {
  const mi = minutosDaHora(e.inicio);
  const mf = minutosDaHora(e.fim);
  if (mi == null || mf == null || mf <= mi) return 0;
  return mf - mi - e.intervaloMin;
}

/** O expediente previsto pra uma data ("YYYY-MM-DD"). null = folga. */
export function expedienteDoDia(
  jornada: JornadaSemanal | null,
  dia: string,
): ExpedienteDoDia | null {
  if (!jornada) return null;
  // Meio-dia UTC evita que o fuso empurre a data pro dia anterior ao extrair
  // o dia da semana.
  const d = new Date(`${dia}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  return jornada[d.getUTCDay() as DiaSemana] ?? null;
}

/** Minutos previstos pra uma data. 0 em folga e em quem não tem jornada. */
export function minutosPrevistos(jornada: JornadaSemanal | null, dia: string): number {
  const e = expedienteDoDia(jornada, dia);
  return e ? minutosDoExpediente(e) : 0;
}

export interface Pontualidade {
  /** Minutos de atraso além da tolerância. 0 quando chegou na hora. */
  atrasoMin: number;
  /** true quando havia expediente previsto e a entrada passou da tolerância. */
  atrasado: boolean;
}

/**
 * Compara a entrada real com o início previsto.
 *
 * `minutosLocaisDaEntrada` chega já convertido pro fuso do escritório — quem
 * sabe o fuso é o servidor, e fazer essa conta aqui dentro com `getHours()`
 * usaria o fuso de quem está OLHANDO a tela, que pode ser outro.
 */
export function pontualidade(
  jornada: JornadaSemanal | null,
  dia: string,
  minutosLocaisDaEntrada: number | null,
): Pontualidade {
  const e = expedienteDoDia(jornada, dia);
  if (!e || minutosLocaisDaEntrada == null) return { atrasoMin: 0, atrasado: false };
  const previsto = minutosDaHora(e.inicio);
  if (previsto == null) return { atrasoMin: 0, atrasado: false };

  const diff = minutosLocaisDaEntrada - previsto;
  if (diff <= TOLERANCIA_ATRASO_MIN) return { atrasoMin: 0, atrasado: false };
  return { atrasoMin: diff, atrasado: true };
}

/** Uma linha legível da jornada, pra tela de configuração. */
export function resumirJornada(jornada: JornadaSemanal | null): string {
  if (!jornada) return "Sem jornada definida";
  const dias = ([0, 1, 2, 3, 4, 5, 6] as DiaSemana[]).filter((d) => jornada[d]);
  if (dias.length === 0) return "Sem jornada definida";

  const total = dias.reduce<number>((s, d) => s + minutosDoExpediente(jornada[d]!), 0);
  const horas = Math.round((total / 60) * 10) / 10;

  // Dias com o mesmo horário viram faixa ("Seg a Sex"); o resto é listado.
  const mesmoHorario = dias.every(
    (d) => jornada[d]!.inicio === jornada[dias[0]!]!.inicio && jornada[d]!.fim === jornada[dias[0]!]!.fim,
  );
  const consecutivos = dias.every((d, i) => i === 0 || d === dias[i - 1]! + 1);

  const faixa = mesmoHorario && consecutivos && dias.length > 1
    ? `${NOMES_DIA[dias[0]!].slice(0, 3)} a ${NOMES_DIA[dias[dias.length - 1]!].slice(0, 3)}`
    : dias.map((d) => NOMES_DIA[d].slice(0, 3)).join(", ");

  const horario = mesmoHorario ? ` · ${jornada[dias[0]!]!.inicio}–${jornada[dias[0]!]!.fim}` : "";
  return `${faixa}${horario} · ${horas}h/semana`;
}

/** Jornada mais comum em escritório, como ponto de partida da tela. */
export function jornadaPadrao(): JornadaSemanal {
  const e: ExpedienteDoDia = { inicio: "08:00", fim: "18:00", intervaloMin: 60 };
  return { 1: { ...e }, 2: { ...e }, 3: { ...e }, 4: { ...e }, 5: { ...e } };
}

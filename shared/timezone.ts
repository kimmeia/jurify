/**
 * Helpers de timezone usados pelos schedulers e dispatcher do SmartFlow.
 *
 * O Node roda em UTC nos deploys (Railway/Docker/Fly). Usar `Date#setHours`
 * ou `new Date("YYYY-MM-DDTHH:MM:SS")` dentro dos helpers do dispatcher
 * fazia com que "00:01" fosse interpretado como 00:01 UTC = 21:01 Fortaleza
 * véspera, disparando cenários fora do horário local.
 *
 * Essas funções recebem sempre o fuso (`tz`, ex: "America/Sao_Paulo") como
 * parâmetro — o campo `escritorios.fusoHorario` passa a ser a fonte da
 * verdade. Sem dependência nova: usa `Intl.DateTimeFormat`, nativo do Node.
 */

export interface FusoOption {
  value: string;
  label: string;
}

/** Fusos disponíveis no seletor da UI. Lista curta pra não poluir — o campo
 *  aceita qualquer string IANA, então fusos fora daqui podem ser setados via
 *  API se necessário. */
export const FUSOS_BR: ReadonlyArray<FusoOption> = [
  { value: "America/Sao_Paulo", label: "Brasília (GMT-3) — maior parte do país" },
  { value: "America/Fortaleza", label: "Fortaleza / Recife (GMT-3)" },
  { value: "America/Belem", label: "Belém (GMT-3)" },
  { value: "America/Manaus", label: "Manaus (GMT-4)" },
  { value: "America/Cuiaba", label: "Cuiabá (GMT-4)" },
  { value: "America/Rio_Branco", label: "Rio Branco (GMT-5)" },
  { value: "America/Noronha", label: "Fernando de Noronha (GMT-2)" },
];

export interface WallTimeParts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

/**
 * Extrai os componentes "civis" de uma Date no fuso `tz`.
 * Ex: para `dt = 2026-04-22T02:30:00Z`, `tz = "America/Sao_Paulo"` →
 *   `{ y: 2026, mo: 4, d: 21, h: 23, mi: 30, s: 0 }`.
 */
export function partsInTz(dt: Date, tz: string): WallTimeParts {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(dt)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  // Intl em hour12:false pode devolver "24" pra meia-noite em alguns runtimes —
  // normaliza pra "0".
  const hourStr = parts.hour === "24" ? "00" : parts.hour;
  return {
    y: Number(parts.year),
    mo: Number(parts.month),
    d: Number(parts.day),
    h: Number(hourStr),
    mi: Number(parts.minute),
    s: Number(parts.second ?? "0"),
  };
}

/**
 * Instante UTC (Date) correspondente a um horário civil `y-mo-d h:mi:s` no
 * fuso `tz`.
 *
 * Algoritmo: chute inicial com `Date.UTC` (assume o horário como se fosse
 * UTC), lê os componentes desse instante no `tz` pra medir o offset
 * percebido, compensa. Dois passes são suficientes pra DST — o ajuste fica
 * dentro de 1h em qualquer fuso IANA.
 *
 * Em ambiguidades de DST (hora que acontece duas vezes no outono) escolhe
 * a primeira ocorrência; em hora inexistente (salto primaveril) retorna o
 * instante imediatamente posterior. Brasil não tem DST desde 2019, então
 * casos ambíguos não afetam o fluxo real.
 */
export function zonedWallTimeToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  tz: string,
): Date {
  const chute = Date.UTC(y, mo - 1, d, h, mi, s);
  const partsChute = partsInTz(new Date(chute), tz);
  const chuteVisto = Date.UTC(
    partsChute.y,
    partsChute.mo - 1,
    partsChute.d,
    partsChute.h,
    partsChute.mi,
    partsChute.s,
  );
  // offset = quanto o chute (tratado como UTC) "avança" quando visto no tz.
  // Se tz = America/Sao_Paulo (UTC-3), o chute 00:01 UTC aparece como 21:01
  // do dia anterior no tz → chuteVisto = chute - 3h → offset = 3h. Pra que
  // 00:01 no fuso seja o horário civil, o UTC real é chute + 3h.
  const offset = chute - chuteVisto;
  return new Date(chute + offset);
}

/** "YYYY-MM-DD" do instante `dt` lido no fuso `tz`. */
export function diaCivilNoTz(dt: Date, tz: string): string {
  const p = partsInTz(dt, tz);
  return `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** Instante UTC da meia-noite (civil) do dia de `dt` no fuso `tz`. */
export function inicioDoDiaNoTz(dt: Date, tz: string): Date {
  const p = partsInTz(dt, tz);
  return zonedWallTimeToUtc(p.y, p.mo, p.d, 0, 0, 0, tz);
}

/**
 * Diferença em dias civis (a - b) medida no fuso `tz`.
 * Ex: a = 2026-04-22T01:00Z (22:00 BRT de 21-abr), b = 2026-04-21T00:00Z
 * → em BRT ambos são dia 21 → 0 dias.
 */
export function diasCivisEntre(a: Date, b: Date, tz: string): number {
  const ia = inicioDoDiaNoTz(a, tz);
  const ib = inicioDoDiaNoTz(b, tz);
  return Math.round((ia.getTime() - ib.getTime()) / (24 * 60 * 60 * 1000));
}

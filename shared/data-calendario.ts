/**
 * Datas de CALENDÁRIO — um prazo "10/09", um vencimento — sem hora que
 * importe.
 *
 * O servidor grava esse dia como instante UTC (meia-noite nos registros
 * antigos, meio-dia nos novos) e o client recebe um Date. Formatar esse
 * Date no fuso do navegador mostra o dia ANTERIOR: 2026-09-10T00:00Z é
 * 21:00 de 09/09 no Brasil. Aqui a parte de data é lida sempre em UTC,
 * que é onde o dia foi gravado — vale pros dois formatos.
 *
 * O caminho inverso tem a mesma armadilha: "hoje" pra comparar com o que o
 * usuário digitou num <input type="date"> tem que vir das partes LOCAIS do
 * relógio. `toISOString()` é UTC, e depois das 21h já é amanhã.
 */

const SO_DATA = /^\d{4}-\d{2}-\d{2}$/;

export type EntradaDataCalendario = string | Date | null | undefined;

function paraInstante(valor: EntradaDataCalendario): Date | null {
  if (valor == null || valor === "") return null;
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor;
  // String só-data ("2026-09-10", como o Asaas manda): ancorada no meio-dia
  // UTC pra ficar longe da virada em qualquer sentido.
  const d = SO_DATA.test(valor) ? new Date(`${valor}T12:00:00Z`) : new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A parte de data em UTC como `YYYY-MM-DD` — o valor de um `<input type="date">`. */
export function dataCalendarioISO(valor: EntradaDataCalendario): string {
  if (typeof valor === "string" && SO_DATA.test(valor)) return valor;
  const d = paraInstante(valor);
  return d ? d.toISOString().slice(0, 10) : "";
}

export interface OpcoesDataCalendario {
  /** `false` omite o ano ("10/09"). */
  ano?: boolean;
  /** `"curto"` abrevia o mês ("10 de set."). */
  mes?: "numerico" | "curto";
  /** Prefixa o dia da semana ("quinta-feira, 10/09/2026"). */
  diaSemana?: boolean;
}

/** "10/09/2026" pra qualquer instante do dia 10/09 em UTC. Vazio quando inválido. */
export function formatarDataCalendario(
  valor: EntradaDataCalendario,
  opts: OpcoesDataCalendario = {},
): string {
  const d = paraInstante(valor);
  if (!d) return "";
  const { ano = true, mes = "numerico", diaSemana = false } = opts;
  const data = d.toLocaleDateString("pt-BR", {
    timeZone: "UTC",
    day: "2-digit",
    month: mes === "curto" ? "short" : "2-digit",
    ...(ano ? { year: "numeric" } : {}),
  });
  return diaSemana ? `${diaSemanaCalendario(d)}, ${data}` : data;
}

/** "quinta-feira" — o dia da semana do MESMO dia que `formatarDataCalendario` imprime. */
export function diaSemanaCalendario(valor: EntradaDataCalendario): string {
  const d = paraInstante(valor);
  if (!d) return "";
  return d.toLocaleDateString("pt-BR", { weekday: "long", timeZone: "UTC" });
}

/** "Hoje" pelo relógio LOCAL, como `YYYY-MM-DD`. `agora` é injetável pra teste. */
export function dataLocalHoje(agora: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${agora.getFullYear()}-${pad(agora.getMonth() + 1)}-${pad(agora.getDate())}`;
}

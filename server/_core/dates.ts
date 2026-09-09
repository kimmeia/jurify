import { inicioDoDiaNoFuso } from "../../shared/escritorio-types";

/**
 * Drizzle aplica adapter de coluna declarada (timestamp() vira Date no JS),
 * mas em `sql<Date>\`MAX(col)\`` o tipo é só hint — o mysql2 entrega o valor
 * cru, que pode vir como string 'YYYY-MM-DD HH:MM:SS'. `(x as Date).toISOString()`
 * quebra em runtime nesse caminho.
 */
export function toIsoString(
  v: Date | string | number | null | undefined,
): string | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Início e fim de "hoje" no fuso informado, como instantes UTC — pra comparar
 * com colunas TIMESTAMP (que o driver entrega/recebe em UTC).
 *
 * Existe porque `CURDATE()` do MySQL responde conforme o TZ da sessão: em
 * produção (Railway, UTC) o dia virava às 21h de Brasília, então tudo que
 * acontecia depois disso era contado como "amanhã" nos painéis.
 *
 * Considera DST ancorando a leitura do offset ao meio-dia do dia em questão
 * (horário sem ambiguidade em qualquer transição).
 */
export function diaAtualEmTz(fusoHorario: string): { inicio: Date; fim: Date } {
  const agora = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: fusoHorario,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [ano, mes, dia] = fmt.format(agora).split("-").map(Number);

  const refAoMeioDia = new Date(Date.UTC(ano, mes - 1, dia, 12, 0, 0));
  const tzName =
    new Intl.DateTimeFormat("en-US", {
      timeZone: fusoHorario,
      timeZoneName: "longOffset",
    })
      .formatToParts(refAoMeioDia)
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT+00:00";
  const match = tzName.match(/GMT([+-])(\d{1,2}):?(\d{2})?/);
  const offsetMs = match
    ? (match[1] === "+" ? 1 : -1) *
      (Number(match[2]) * 60 + Number(match[3] ?? 0)) *
      60 *
      1000
    : 0;

  const inicio = new Date(Date.UTC(ano, mes - 1, dia) - offsetMs);
  const fim = new Date(inicio.getTime() + 24 * 60 * 60 * 1000);
  return { inicio, fim };
}

/** Início do dia N dias atrás no mesmo fuso (janelas "últimos N dias"). */
export function inicioDiasAtrasEmTz(fusoHorario: string, dias: number): Date {
  const { inicio } = diaAtualEmTz(fusoHorario);
  return new Date(inicio.getTime() - dias * 24 * 60 * 60 * 1000);
}

/**
 * O dia civil de um instante no fuso do escritório ("YYYY-MM-DD").
 *
 * O "dia" do ponto é o dia de quem trabalha, não o dia UTC: às 21h em
 * Fortaleza já é o dia seguinte em UTC, e o expediente de terça apareceria na
 * quarta no espelho.
 */
export function diaCivilEmTz(instante: Date, fusoHorario: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: fusoHorario,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instante);
}

/** "HH:MM" de um instante no fuso do escritório (00..23, nunca "24:00"). */
export function horaEmTz(instante: Date, fusoHorario: string): string {
  const partes = new Intl.DateTimeFormat("en-GB", {
    timeZone: fusoHorario,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instante);
  const get = (t: string) => partes.find((p) => p.type === t)?.value ?? "00";
  return `${get("hour")}:${get("minute")}`;
}

/**
 * Dia civil de uma coluna gravada como DATA-CALENDÁRIO — "YYYY-MM-DD" lido
 * da parte UTC do instante.
 *
 * Prazo de card e vencimento sugerido não são instantes: são o dia que o
 * usuário digitou, gravado em TIMESTAMP como 00:00Z (registros antigos) ou
 * 12:00Z (convenção nova). Nos dois casos a parte de data em UTC é o dia
 * certo; ler no fuso do escritório devolveria a véspera para os antigos.
 */
export function diaCalendarioUtc(data: Date): string {
  return data.toISOString().slice(0, 10);
}

/**
 * Instante a partir do qual uma data-calendário conta como vencida: a
 * meia-noite UTC do dia civil de HOJE no fuso do escritório. Compare com
 * `<` — vencido = `prazo < corte`. Equivale a "agora passou do fim do dia
 * civil do prazo no fuso", e vale tanto para 00:00Z quanto para 12:00Z.
 */
export function corteVencimentoCalendario(agora: Date, fusoHorario: string): Date {
  return new Date(`${diaCivilEmTz(agora, fusoHorario)}T00:00:00Z`);
}

/** `true` quando o dia civil do prazo (data-calendário) já passou no fuso. */
export function prazoCalendarioVencido(prazo: Date, agora: Date, fusoHorario: string): boolean {
  return diaCalendarioUtc(prazo) < diaCivilEmTz(agora, fusoHorario);
}

/**
 * Reinterpreta o relógio-de-parede UTC de um instante como relógio do
 * escritório: 2026-09-10T00:00Z vira 00:00 de 10/09 no fuso (03:00Z em
 * Fortaleza); 14:00Z vira 14:00 no fuso.
 *
 * É a ponte entre o que o detector grava (dia/hora "nus", sem fuso) e a
 * Agenda, que guarda instantes reais: sem isso o prazo de 10/09 nascia às
 * 21:00 de 09/09 na tela.
 */
export function dataCalendarioNoFuso(dataUtc: Date, fusoHorario: string): Date {
  const inicioDoDia = inicioDoDiaNoFuso(diaCalendarioUtc(dataUtc), fusoHorario);
  const dentroDoDiaMs =
    dataUtc.getUTCHours() * 3_600_000 +
    dataUtc.getUTCMinutes() * 60_000 +
    dataUtc.getUTCSeconds() * 1000 +
    dataUtc.getUTCMilliseconds();
  return new Date(inicioDoDia.getTime() + dentroDoDiaMs);
}


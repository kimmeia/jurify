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


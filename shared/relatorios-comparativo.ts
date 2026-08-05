/**
 * Comparação entre o período do relatório e o imediatamente anterior.
 *
 * Mora em `shared/` porque a tela e o PDF mostram o mesmo delta — duplicar a
 * regra faria o papel divergir do painel na primeira mudança de arredondamento.
 */

export interface DeltaKpi {
  /** Variação já arredondada, na unidade de `unidade`. */
  valor: number;
  /** Verde quando a variação é boa. Métricas "quanto menor melhor"
   *  (tempo de resposta, ligações perdidas, despesa) invertem isso. */
  bom: boolean;
  unidade: "%" | "p.p.";
}

type Numerico = number | null | undefined;

const finito = (v: Numerico): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Variação relativa entre dois valores. `null` quando não há base de
 * comparação — mostrar "0%" contra um anterior zerado enganaria — e também
 * quando não houve variação, pra não poluir o card com "0%".
 */
export function calcularDelta(
  atual: Numerico,
  anterior: Numerico,
  menorEhMelhor = false,
): DeltaKpi | null {
  if (!finito(atual) || !finito(anterior) || anterior === 0) return null;
  const valor = Math.round(((atual - anterior) / anterior) * 100);
  if (valor === 0) return null;
  return { valor, bom: menorEhMelhor ? valor < 0 : valor > 0, unidade: "%" };
}

/**
 * Variação de uma métrica que já é percentual (taxa de conversão, margem).
 * A diferença vai em pontos percentuais porque a variação relativa mente:
 * de 23% pra 27% são 4 pontos, mas "+17%" faz parecer salto de um sexto.
 */
export function calcularDeltaPontos(
  atual: Numerico,
  anterior: Numerico,
  menorEhMelhor = false,
): DeltaKpi | null {
  if (!finito(atual) || !finito(anterior)) return null;
  const valor = Math.round((atual - anterior) * 10) / 10;
  if (valor === 0) return null;
  return { valor, bom: menorEhMelhor ? valor < 0 : valor > 0, unidade: "p.p." };
}

/** Texto do delta pronto pra exibição: "+12%", "-4 p.p.". */
export function formatarDelta(d: DeltaKpi): string {
  const n = Math.abs(d.valor).toLocaleString("pt-BR");
  const sinal = d.valor > 0 ? "+" : "-";
  return d.unidade === "%" ? `${sinal}${n}%` : `${sinal}${n} p.p.`;
}

/**
 * Mesmo número de dias imediatamente antes do range (datas YYYY-MM-DD, com
 * as duas pontas inclusivas). É o intervalo que o comparativo usa como base.
 */
export function periodoAnterior(inicio: string, fim: string): { inicio: string; fim: string } {
  const DIA = 24 * 60 * 60 * 1000;
  const di = Date.parse(`${inicio}T12:00:00Z`);
  const df = Date.parse(`${fim}T12:00:00Z`);
  if (Number.isNaN(di) || Number.isNaN(df)) return { inicio, fim };
  const duracao = df - di + DIA;
  const fimAnt = di - DIA;
  const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { inicio: ymd(fimAnt - duracao + DIA), fim: ymd(fimAnt) };
}

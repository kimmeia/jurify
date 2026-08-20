/**
 * Leitura dos tribunais de um monitoramento por CPF/CNPJ — puro, testável.
 *
 * Duas colunas novas (0198) com legado NULL por trás:
 *  - `tribunais` NULL → vigia só o `tribunal` original (comportamento antigo)
 *  - `tribunaisBaseline` NULL → se o monitor JÁ varreu alguma vez
 *    (`cnjsConhecidos` não-nulo, mesmo "[]"), o tribunal original conta como
 *    baselineado. Sem isso, a primeira varredura pós-migração trataria CNJ
 *    novo de verdade como baseline silencioso — alerta perdido, que é o pior
 *    defeito possível neste módulo.
 */

import { normalizarTribunais } from "../../shared/tribunais-pje";

type MonitorRow = {
  tribunal: string;
  tribunais: string | null;
  tribunaisBaseline: string | null;
  cnjsConhecidos: string | null;
};

export function lerTribunaisDoMonitor(mon: Pick<MonitorRow, "tribunal" | "tribunais">): string[] {
  if (mon.tribunais) {
    try {
      const lista = normalizarTribunais(JSON.parse(mon.tribunais));
      if (lista.length > 0) return lista;
    } catch {
      /* JSON inválido → legado */
    }
  }
  return [mon.tribunal];
}

export function lerTribunaisBaseline(
  mon: Pick<MonitorRow, "tribunal" | "tribunaisBaseline" | "cnjsConhecidos">,
): string[] {
  if (mon.tribunaisBaseline) {
    try {
      const lista = JSON.parse(mon.tribunaisBaseline);
      if (Array.isArray(lista)) return lista.filter((t): t is string => typeof t === "string");
    } catch {
      /* JSON inválido → legado */
    }
  }
  // Legado: monitor NOVO nasce com cnjsConhecidos = "[]" — isso é "nunca
  // varreu", não "varreu e achou zero". Só lista NÃO-VAZIA prova baseline
  // feito; tratar "[]" como baseline faria a 1ª varredura alarmar a carteira
  // inteira do cliente (a regressão de falso-positivo que o teste do cron
  // guarda). Daqui em diante a prova é explícita via `tribunaisBaseline`.
  try {
    const lista = JSON.parse(mon.cnjsConhecidos ?? "null");
    if (Array.isArray(lista) && lista.length > 0) return [mon.tribunal];
  } catch {
    /* legado ilegível → sem baseline */
  }
  return [];
}

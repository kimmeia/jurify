/**
 * Como o PRÓPRIO escritório se saiu em casos do mesmo tipo.
 *
 * A unidade tem que ser a mesma do acervo, senão a comparação é falsa. Por
 * isso aqui NÃO se usa `eventos_processo.desfecho` (que é relativo ao polo —
 * "favorável" pro cliente daquele escritório): as movimentações passam pelo
 * `deduzirDesfecho`, o mesmo classificador do acervo público, e saem em
 * vocabulário neutro.
 *
 * O acervo público é global; isto é do escritório e nunca sai dele.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { eventosProcesso, motorMonitoramentos } from "../../drizzle/schema";
import { deduzirDesfecho, type ResultadoProcesso } from "../../shared/datajud-desfecho";
import { montarEstatistica, type EstatisticaRecorte, type FiltroRecorte } from "../../shared/jurisia-recorte";
import { casoBateComFiltro, type CapaCaso } from "../../shared/jurisia-estrategia";
import { createLogger } from "../_core/logger";

const log = createLogger("jurisia-historico");

/** Teto de casos do escritório examinados. Cada um custa ler movimentação. */
export const LIMITE_CASOS = 300;

const ZERO: Record<ResultadoProcesso, number> = {
  procedente: 0,
  parcial: 0,
  improcedente: 0,
  acordo: 0,
  extinto_sem_merito: 0,
};

export interface HistoricoEscritorio {
  estatistica: EstatisticaRecorte;
  /** Casos do escritório que bateram com o recorte. */
  casos: Array<{
    monitoramentoId: number;
    apelido: string | null;
    cnj: string;
    resultado: ResultadoProcesso | null;
    movimento: string | null;
  }>;
}

const VAZIO: HistoricoEscritorio = {
  estatistica: montarEstatistica(0, { ...ZERO }),
  casos: [],
};

function parseCapa(raw: string | null): CapaCaso | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    return o && typeof o === "object" ? (o as CapaCaso) : null;
  } catch {
    return null;
  }
}

export async function historicoDoEscritorio(
  escritorioId: number,
  filtro: FiltroRecorte,
): Promise<HistoricoEscritorio> {
  const db = await getDb();
  if (!db) return VAZIO;

  const monitoramentos = await db
    .select({
      id: motorMonitoramentos.id,
      apelido: motorMonitoramentos.apelido,
      searchKey: motorMonitoramentos.searchKey,
      tribunal: motorMonitoramentos.tribunal,
      capaJson: motorMonitoramentos.capaJson,
    })
    .from(motorMonitoramentos)
    .where(eq(motorMonitoramentos.escritorioId, escritorioId))
    .orderBy(desc(motorMonitoramentos.id))
    .limit(LIMITE_CASOS);

  const doTipo = monitoramentos.filter((m) =>
    casoBateComFiltro(parseCapa(m.capaJson), m.tribunal, {
      tribunal: filtro.tribunal,
      classeTermo: filtro.classeTermo,
      assuntoTermo: filtro.assuntoTermo,
    }),
  );

  if (doTipo.length === 0) return VAZIO;

  const ids = doTipo.map((m) => m.id);
  const eventos = await db
    .select({
      monitoramentoId: eventosProcesso.monitoramentoId,
      conteudo: eventosProcesso.conteudo,
      dataEvento: eventosProcesso.dataEvento,
    })
    .from(eventosProcesso)
    .where(and(
      eq(eventosProcesso.escritorioId, escritorioId),
      inArray(eventosProcesso.monitoramentoId, ids),
    ));

  const porCaso = new Map<number, Array<{ nome: string; dataHora: string }>>();
  for (const e of eventos) {
    if (e.monitoramentoId == null) continue;
    const lista = porCaso.get(e.monitoramentoId) ?? [];
    lista.push({ nome: e.conteudo, dataHora: e.dataEvento.toISOString() });
    porCaso.set(e.monitoramentoId, lista);
  }

  const porResultado = { ...ZERO };
  const casos: HistoricoEscritorio["casos"] = [];

  for (const m of doTipo) {
    const desfecho = deduzirDesfecho(porCaso.get(m.id) ?? []);
    if (desfecho) porResultado[desfecho.resultado]++;
    casos.push({
      monitoramentoId: m.id,
      apelido: m.apelido,
      cnj: m.searchKey,
      resultado: desfecho?.resultado ?? null,
      movimento: desfecho?.movimento ?? null,
    });
  }

  log.info(
    { escritorioId, examinados: monitoramentos.length, doTipo: doTipo.length },
    "histórico do escritório para o recorte",
  );

  return { estatistica: montarEstatistica(doTipo.length, porResultado), casos };
}

/**
 * Consulta o acervo público (DataJud) para uma pesquisa jurisprudencial.
 *
 * Duas saídas com propósitos diferentes:
 *
 * - `estatistica` conta o recorte INTEIRO, em SQL. É o entregável do produto e
 *   nunca passa perto do modelo.
 * - `processos` é uma amostra citável, limitada, que vai pro contexto pra o
 *   modelo poder apontar caso concreto em vez de falar em abstrato.
 */

import { and, desc, eq, gte, like, sql, type SQL } from "drizzle-orm";
import { getDb } from "../db";
import { jurisiaProcessos } from "../../drizzle/schema";
import type { ResultadoProcesso } from "../../shared/datajud-desfecho";
import {
  MAX_FONTES_RECORTE,
  montarEstatistica,
  type EstatisticaRecorte,
  type FiltroRecorte,
  type ProcessoAcervo,
} from "../../shared/jurisia-recorte";

const ZERO: Record<ResultadoProcesso, number> = {
  procedente: 0,
  parcial: 0,
  improcedente: 0,
  acordo: 0,
  extinto_sem_merito: 0,
};

/** `%` e `_` são curinga no LIKE; vindos da pergunta do usuário viram busca
 *  larga demais sem ninguém pedir. */
function escaparLike(t: string): string {
  return t.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function condicoesRecorte(f: FiltroRecorte): SQL[] {
  const cond: SQL[] = [];
  if (f.tribunal) cond.push(eq(jurisiaProcessos.tribunal, f.tribunal));
  if (f.classeTermo) cond.push(like(jurisiaProcessos.classeNome, `%${escaparLike(f.classeTermo)}%`));
  if (f.assuntoTermo) cond.push(like(jurisiaProcessos.assuntoNome, `%${escaparLike(f.assuntoTermo)}%`));
  if (f.orgaoTermo) cond.push(like(jurisiaProcessos.orgaoNome, `%${escaparLike(f.orgaoTermo)}%`));
  if (f.desdeAno) cond.push(gte(jurisiaProcessos.ajuizamentoEm, new Date(Date.UTC(f.desdeAno, 0, 1))));
  return cond;
}

export interface Recorte {
  estatistica: EstatisticaRecorte;
  processos: ProcessoAcervo[];
}

export async function buscarRecorte(
  f: FiltroRecorte,
  opts?: { maxFontes?: number },
): Promise<Recorte> {
  const db = await getDb();
  if (!db) throw new Error("Base de dados indisponível.");

  const cond = condicoesRecorte(f);
  const onde = cond.length > 0 ? and(...cond) : undefined;

  const agrupado = await db
    .select({
      resultado: jurisiaProcessos.resultado,
      quantidade: sql<number>`COUNT(*)`,
    })
    .from(jurisiaProcessos)
    .where(onde)
    .groupBy(jurisiaProcessos.resultado);

  const porResultado = { ...ZERO };
  let total = 0;
  for (const linha of agrupado) {
    const n = Number(linha.quantidade ?? 0);
    total += n;
    if (linha.resultado) porResultado[linha.resultado as ResultadoProcesso] += n;
  }

  const linhas = await db
    .select({
      id: jurisiaProcessos.id,
      cnj: jurisiaProcessos.cnj,
      tribunal: jurisiaProcessos.tribunal,
      classeNome: jurisiaProcessos.classeNome,
      assuntoNome: jurisiaProcessos.assuntoNome,
      orgaoNome: jurisiaProcessos.orgaoNome,
      resultado: jurisiaProcessos.resultado,
      resultadoEm: jurisiaProcessos.resultadoEm,
      resultadoMovimento: jurisiaProcessos.resultadoMovimento,
      ajuizamentoEm: jurisiaProcessos.ajuizamentoEm,
    })
    .from(jurisiaProcessos)
    .where(onde)
    // Processo decidido primeiro: é o que sustenta afirmação sobre como
    // "costuma terminar". Em andamento só entra pra completar a amostra.
    .orderBy(
      sql`${jurisiaProcessos.resultado} IS NULL`,
      desc(jurisiaProcessos.resultadoEm),
      desc(jurisiaProcessos.id),
    )
    .limit(opts?.maxFontes ?? MAX_FONTES_RECORTE);

  return {
    estatistica: montarEstatistica(total, porResultado),
    processos: linhas.map((r) => ({
      id: r.id,
      cnj: r.cnj,
      tribunal: r.tribunal,
      classeNome: r.classeNome,
      assuntoNome: r.assuntoNome,
      orgaoNome: r.orgaoNome,
      resultado: (r.resultado as ResultadoProcesso | null) ?? null,
      resultadoEm: r.resultadoEm ? r.resultadoEm.toISOString() : null,
      resultadoMovimento: r.resultadoMovimento,
      ajuizamentoEm: r.ajuizamentoEm ? r.ajuizamentoEm.toISOString() : null,
    })),
  };
}

/** Tribunais que já têm processo no acervo — a tela precisa mostrar o que
 *  existe antes de o advogado perguntar sobre o que não foi coletado. */
export async function tribunaisDoAcervo(): Promise<Array<{ tribunal: string; processos: number }>> {
  const db = await getDb();
  if (!db) return [];
  const linhas = await db
    .select({ tribunal: jurisiaProcessos.tribunal, processos: sql<number>`COUNT(*)` })
    .from(jurisiaProcessos)
    .groupBy(jurisiaProcessos.tribunal)
    .orderBy(desc(sql`COUNT(*)`));
  return linhas.map((l) => ({ tribunal: l.tribunal, processos: Number(l.processos ?? 0) }));
}

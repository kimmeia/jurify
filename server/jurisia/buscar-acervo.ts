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

import { and, desc, eq, gte, inArray, isNotNull, like, sql, type SQL } from "drizzle-orm";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";
import { getDb } from "../db";
import { jurisiaMovimentos, jurisiaProcessos } from "../../drizzle/schema";
import { montarPerfil, type EntradaPerfil, type PerfilRecorte } from "../../shared/jurisia-perfil";
import type { ResultadoProcesso } from "../../shared/datajud-desfecho";
import { ACERVO_VAZIO, type ComposicaoAcervo } from "../../shared/jurisia-acervo";
import { contarNatureza, type ComposicaoNatureza } from "../../shared/jurisia-grau";
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
  /** Quanto deste recorte é acórdão e quanto é sentença de 1º grau. */
  natureza: ComposicaoNatureza;
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
      grau: jurisiaProcessos.grau,
      quantidade: sql<number>`COUNT(*)`,
    })
    .from(jurisiaProcessos)
    .where(onde)
    .groupBy(jurisiaProcessos.resultado, jurisiaProcessos.grau);

  const porResultado = { ...ZERO };
  const porGrau: Array<{ grau: string | null; quantidade: number }> = [];
  let total = 0;
  for (const linha of agrupado) {
    const n = Number(linha.quantidade ?? 0);
    total += n;
    if (linha.resultado) porResultado[linha.resultado as ResultadoProcesso] += n;
    porGrau.push({ grau: linha.grau, quantidade: n });
  }

  const linhas = await db
    .select({
      id: jurisiaProcessos.id,
      cnj: jurisiaProcessos.cnj,
      tribunal: jurisiaProcessos.tribunal,
      grau: jurisiaProcessos.grau,
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
    natureza: contarNatureza(porGrau),
    processos: linhas.map((r) => ({
      id: r.id,
      cnj: r.cnj,
      tribunal: r.tribunal,
      grau: r.grau,
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

/**
 * Teto da amostra do perfil.
 *
 * Duração sai de duas colunas, mas os marcadores exigem varrer os movimentos
 * de cada processo — num recorte de dezenas de milhares isso é uma query que
 * ninguém quer no caminho de uma pergunta. 500 decididos recentes descrevem a
 * prática atual da vara melhor do que a base inteira, que mistura o que o
 * tribunal fazia há dez anos.
 *
 * O número aparece na tela junto do resultado: corte silencioso vira "medimos
 * tudo" na cabeça de quem lê.
 */
export const LIMITE_PERFIL = 500;

export async function perfilDoRecorte(f: FiltroRecorte): Promise<PerfilRecorte> {
  const db = await getDb();
  if (!db) throw new Error("Base de dados indisponível.");

  const cond = condicoesRecorte(f);
  cond.push(isNotNull(jurisiaProcessos.resultado));

  const decididos = await db
    .select({
      id: jurisiaProcessos.id,
      ajuizamentoEm: jurisiaProcessos.ajuizamentoEm,
      resultadoEm: jurisiaProcessos.resultadoEm,
    })
    .from(jurisiaProcessos)
    .where(and(...cond))
    .orderBy(desc(jurisiaProcessos.resultadoEm), desc(jurisiaProcessos.id))
    .limit(LIMITE_PERFIL);

  if (decididos.length === 0) return montarPerfil([], LIMITE_PERFIL);

  const ids = decididos.map((d) => d.id);
  const movimentos = await db
    .select({ processoId: jurisiaMovimentos.processoId, nome: jurisiaMovimentos.nome })
    .from(jurisiaMovimentos)
    .where(inArray(jurisiaMovimentos.processoId, ids));

  const porProcesso = new Map<number, string[]>();
  for (const m of movimentos) {
    const lista = porProcesso.get(m.processoId);
    if (lista) lista.push(m.nome);
    else porProcesso.set(m.processoId, [m.nome]);
  }

  const entradas: EntradaPerfil[] = decididos.map((d) => ({
    ajuizamentoEm: d.ajuizamentoEm ? d.ajuizamentoEm.toISOString() : null,
    resultadoEm: d.resultadoEm ? d.resultadoEm.toISOString() : null,
    movimentos: porProcesso.get(d.id) ?? [],
  }));

  return montarPerfil(entradas, LIMITE_PERFIL);
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

/**
 * O que existe no acervo, em vocabulário do advogado.
 *
 * Sem isto o módulo é adivinhação: o advogado digita, erra, e recebe "não
 * encontrei" sem nunca descobrir que o acervo só tem execução fiscal. Mostrar
 * as classes e assuntos que existem de fato transforma a busca em escolha.
 */
export async function composicaoDoAcervo(topo = 8): Promise<ComposicaoAcervo> {
  const db = await getDb();
  if (!db) return ACERVO_VAZIO;

  const porNome = async (coluna: AnyMySqlColumn) => {
    const linhas = await db
      .select({ nome: coluna, quantidade: sql<number>`COUNT(*)` })
      .from(jurisiaProcessos)
      .where(isNotNull(coluna))
      .groupBy(coluna)
      .orderBy(desc(sql`COUNT(*)`));
    return linhas
      .map((l) => ({ nome: String(l.nome), quantidade: Number(l.quantidade ?? 0) }))
      .filter((l) => l.nome.length > 0);
  };

  const [tribunais, classes, assuntos, graus] = await Promise.all([
    tribunaisDoAcervo(),
    porNome(jurisiaProcessos.classeNome),
    porNome(jurisiaProcessos.assuntoNome),
    grausDoAcervo(),
  ]);

  return {
    total: tribunais.reduce((s, t) => s + t.processos, 0),
    tribunais,
    classes: classes.slice(0, topo),
    assuntos: assuntos.slice(0, topo),
    classesRestantes: Math.max(0, classes.length - topo),
    assuntosRestantes: Math.max(0, assuntos.length - topo),
    natureza: contarNatureza(graus),
  };
}

/**
 * Quantos processos do acervo têm desfecho, e por qual eixo.
 *
 * É a conferência que faltava: a varredura pode gravar 500 linhas com
 * `resultadoRecurso` nulo em todas e o painel de progresso continuaria dizendo
 * "500 no acervo", satisfeito. Sem este número, calibragem quebrada só
 * apareceria quando um cliente pesquisasse e recebesse um gráfico vazio.
 */
export async function classificacaoDoAcervo(): Promise<{
  total: number;
  comDesfecho: number;
  comRecurso: number;
  semNada: number;
  porRecurso: Array<{ resultado: string; quantidade: number }>;
}> {
  const db = await getDb();
  if (!db) return { total: 0, comDesfecho: 0, comRecurso: 0, semNada: 0, porRecurso: [] };

  const [linha] = await db
    .select({
      total: sql<number>`COUNT(*)`,
      comDesfecho: sql<number>`SUM(CASE WHEN ${jurisiaProcessos.resultado} IS NOT NULL THEN 1 ELSE 0 END)`,
      comRecurso: sql<number>`SUM(CASE WHEN ${jurisiaProcessos.resultadoRecurso} IS NOT NULL THEN 1 ELSE 0 END)`,
      semNada: sql<number>`SUM(CASE WHEN ${jurisiaProcessos.resultado} IS NULL AND ${jurisiaProcessos.resultadoRecurso} IS NULL THEN 1 ELSE 0 END)`,
    })
    .from(jurisiaProcessos);

  const fatias = await db
    .select({
      resultado: jurisiaProcessos.resultadoRecurso,
      quantidade: sql<number>`COUNT(*)`,
    })
    .from(jurisiaProcessos)
    .where(isNotNull(jurisiaProcessos.resultadoRecurso))
    .groupBy(jurisiaProcessos.resultadoRecurso)
    .orderBy(desc(sql`COUNT(*)`));

  return {
    total: Number(linha?.total ?? 0),
    comDesfecho: Number(linha?.comDesfecho ?? 0),
    comRecurso: Number(linha?.comRecurso ?? 0),
    semNada: Number(linha?.semNada ?? 0),
    porRecurso: fatias.map((f) => ({
      resultado: String(f.resultado),
      quantidade: Number(f.quantidade ?? 0),
    })),
  };
}

/** Contagem por grau, crua. Alimenta a classificação de natureza e a tabela do
 *  admin, que é onde se descobre que a coleta trouxe só 1º grau. */
export async function grausDoAcervo(): Promise<Array<{ grau: string | null; quantidade: number }>> {
  const db = await getDb();
  if (!db) return [];
  const linhas = await db
    .select({ grau: jurisiaProcessos.grau, quantidade: sql<number>`COUNT(*)` })
    .from(jurisiaProcessos)
    .groupBy(jurisiaProcessos.grau)
    .orderBy(desc(sql`COUNT(*)`));
  return linhas.map((l) => ({ grau: l.grau, quantidade: Number(l.quantidade ?? 0) }));
}

/** Quantos processos DISTINTOS cada tribunal tem no acervo.
 *
 *  O contador de `jurisia_varredura` conta GRAVAÇÕES, e `gravarProcesso` faz
 *  upsert — reler um tribunal soma de novo. Era daí que vinha o admin dizer
 *  1.000 com 500 no banco. */
export async function contagemPorTribunal(): Promise<Map<string, number>> {
  const linhas = await tribunaisDoAcervo();
  return new Map(linhas.map((l) => [l.tribunal.toUpperCase(), l.processos]));
}

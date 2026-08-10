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

import { and, desc, eq, gte, inArray, isNotNull, like, or, sql, type SQL } from "drizzle-orm";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";
import { getDb } from "../db";
import { jurisiaMovimentos, jurisiaProcessos } from "../../drizzle/schema";
import { montarPerfil, type EntradaPerfil, type PerfilRecorte } from "../../shared/jurisia-perfil";
import type { ResultadoProcesso } from "../../shared/datajud-desfecho";
import { ORDEM_RECURSO, rotuloRecurso, type ResultadoRecurso } from "../../shared/datajud-recurso";
import {
  corteDaJanela,
  montarTendencia,
  type EntradaTendencia,
  type Tendencia,
} from "../../shared/jurisia-tendencia";
import { ACERVO_VAZIO, type ComposicaoAcervo } from "../../shared/jurisia-acervo";
import { contarNatureza, type ComposicaoNatureza } from "../../shared/jurisia-grau";
import {
  MAX_FONTES_RECORTE,
  montarEstatistica,
  montarEstatisticaRecursal,
  rotuloResultado,
  type EstatisticaRecorte,
  type FiltroRecorte,
  type ProcessoAcervo,
} from "../../shared/jurisia-recorte";

/** Ordem canônica do eixo de mérito — local pra não reimportar o array e
 *  arriscar divergência de ordem com a paleta. */
const ORDEM_RESULTADO_LOCAL: ResultadoProcesso[] = [
  "procedente",
  "parcial",
  "improcedente",
  "acordo",
  "extinto_sem_merito",
];

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
  if (f.assuntoTermo) {
    // Casa contra a lista COMPLETA de assuntos, não só o principal: num agravo
    // o assunto principal costuma ser a matéria processual genérica e o que o
    // advogado procura ("busca e apreensão", "alimentos") vem depois dela.
    const alvo = `%${escaparLike(f.assuntoTermo)}%`;
    cond.push(
      or(
        like(jurisiaProcessos.assuntoNome, alvo),
        like(jurisiaProcessos.assuntosTodos, alvo),
      )!,
    );
  }
  if (f.orgaoTermo) cond.push(like(jurisiaProcessos.orgaoNome, `%${escaparLike(f.orgaoTermo)}%`));
  if (f.desdeAno) cond.push(gte(jurisiaProcessos.ajuizamentoEm, new Date(Date.UTC(f.desdeAno, 0, 1))));
  return cond;
}

export interface Recorte {
  estatistica: EstatisticaRecorte;
  processos: ProcessoAcervo[];
  /** Quanto deste recorte é acórdão e quanto é sentença de 1º grau. */
  natureza: ComposicaoNatureza;
  /** O que o recorte decide HOJE, e se mudou. Null quando nada foi decidido. */
  tendencia: Tendencia | null;
}

/**
 * A data que conta pra "quando isto foi decidido".
 *
 * Instância superior carimba `resultadoRecursoEm` e deixa o mérito vazio; a
 * origem faz o contrário. Ler só uma das duas jogaria metade do acervo pro
 * período errado da janela.
 */
const DECIDIDO_EM = sql`COALESCE(${jurisiaProcessos.resultadoRecursoEm}, ${jurisiaProcessos.resultadoEm})`;

export async function buscarRecorte(
  f: FiltroRecorte,
  opts?: { maxFontes?: number },
): Promise<Recorte> {
  const db = await getDb();
  if (!db) throw new Error("Base de dados indisponível.");

  const cond = condicoesRecorte(f);
  const onde = cond.length > 0 ? and(...cond) : undefined;

  const desde = corteDaJanela(new Date());

  const agrupado = await db
    .select({
      resultado: jurisiaProcessos.resultado,
      resultadoRecurso: jurisiaProcessos.resultadoRecurso,
      grau: jurisiaProcessos.grau,
      recente: sql<number>`CASE WHEN ${DECIDIDO_EM} >= ${desde} THEN 1 ELSE 0 END`,
      quantidade: sql<number>`COUNT(*)`,
      // Só entre os decididos: transitado sem desfecho classificado não diz
      // nada sobre "quanto costuma dar", e somá-lo inflaria a fração.
      transitados: sql<number>`SUM(CASE WHEN ${jurisiaProcessos.transitadoEm} IS NOT NULL AND ${jurisiaProcessos.resultado} IS NOT NULL THEN 1 ELSE 0 END)`,
    })
    .from(jurisiaProcessos)
    .where(onde)
    .groupBy(
      jurisiaProcessos.resultado,
      jurisiaProcessos.resultadoRecurso,
      jurisiaProcessos.grau,
      sql`CASE WHEN ${DECIDIDO_EM} >= ${desde} THEN 1 ELSE 0 END`,
    );

  const porResultado = { ...ZERO };
  const porRecurso: Partial<Record<ResultadoRecurso, number>> = {};
  const porGrau: Array<{ grau: string | null; quantidade: number }> = [];
  // Os dois eixos coexistem no mesmo recorte, então a tendência é medida sobre
  // aquele que tem mais decisões — num recorte de agravo é o recursal, numa
  // vara de 1º grau é o de mérito.
  const janela = {
    merito: { recente: { ...ZERO }, anterior: { ...ZERO } },
    recurso: {
      recente: {} as Partial<Record<ResultadoRecurso, number>>,
      anterior: {} as Partial<Record<ResultadoRecurso, number>>,
    },
  };
  let total = 0;
  let transitados = 0;
  let decididos = 0;
  for (const linha of agrupado) {
    const n = Number(linha.quantidade ?? 0);
    total += n;
    transitados += Number(linha.transitados ?? 0);
    if (linha.resultado || linha.resultadoRecurso) decididos += n;
    const quando = Number(linha.recente ?? 0) === 1 ? "recente" : "anterior";
    if (linha.resultado) {
      const r = linha.resultado as ResultadoProcesso;
      porResultado[r] += n;
      janela.merito[quando][r] += n;
    }
    if (linha.resultadoRecurso) {
      const r = linha.resultadoRecurso as ResultadoRecurso;
      porRecurso[r] = (porRecurso[r] ?? 0) + n;
      janela.recurso[quando][r] = (janela.recurso[quando][r] ?? 0) + n;
    }
    porGrau.push({ grau: linha.grau, quantidade: n });
  }

  const recursal = montarEstatisticaRecursal(porRecurso);
  const merito = montarEstatistica(total, porResultado);

  const eixoRecursal = recursal.comResultado > merito.comResultado;
  const entradas = (
    fonte: Record<ResultadoProcesso, number> | Partial<Record<ResultadoRecurso, number>>,
  ): EntradaTendencia[] =>
    eixoRecursal
      ? ORDEM_RECURSO.map((r) => ({
        rotulo: rotuloRecurso(r),
        quantidade: (fonte as Partial<Record<ResultadoRecurso, number>>)[r] ?? 0,
      }))
      : ORDEM_RESULTADO_LOCAL.map((r) => ({
        rotulo: rotuloResultado(r),
        quantidade: (fonte as Record<ResultadoProcesso, number>)[r] ?? 0,
      }));

  const lado = eixoRecursal ? janela.recurso : janela.merito;
  const tendencia =
    recursal.comResultado + merito.comResultado > 0
      ? montarTendencia({
        desde,
        recente: entradas(lado.recente as any),
        anterior: entradas(lado.anterior as any),
      })
      : null;

  const linhas = await db
    .select({
      id: jurisiaProcessos.id,
      cnj: jurisiaProcessos.cnj,
      tribunal: jurisiaProcessos.tribunal,
      grau: jurisiaProcessos.grau,
      classeNome: jurisiaProcessos.classeNome,
      assuntoNome: jurisiaProcessos.assuntoNome,
      assuntosTodos: jurisiaProcessos.assuntosTodos,
      orgaoNome: jurisiaProcessos.orgaoNome,
      resultado: jurisiaProcessos.resultado,
      resultadoEm: jurisiaProcessos.resultadoEm,
      resultadoMovimento: jurisiaProcessos.resultadoMovimento,
      resultadoRecurso: jurisiaProcessos.resultadoRecurso,
      resultadoRecursoEm: jurisiaProcessos.resultadoRecursoEm,
      resultadoRecursoMovimento: jurisiaProcessos.resultadoRecursoMovimento,
      ajuizamentoEm: jurisiaProcessos.ajuizamentoEm,
    })
    .from(jurisiaProcessos)
    .where(onde)
    // Processo decidido primeiro — em QUALQUER um dos dois eixos: é o que
    // sustenta afirmação sobre como "costuma terminar". Em andamento só entra
    // pra completar a amostra. Entre os decididos, o mais recente primeiro,
    // porque é o entendimento de hoje que o advogado vai usar.
    .orderBy(
      sql`${DECIDIDO_EM} IS NULL`,
      desc(DECIDIDO_EM),
      desc(jurisiaProcessos.id),
    )
    .limit(opts?.maxFontes ?? MAX_FONTES_RECORTE);

  return {
    estatistica: {
      ...merito,
      // Sobrescreve o `emAndamento` de `montarEstatistica`, que só conhece o
      // eixo de mérito: num recorte de recurso ele chamaria de "em andamento"
      // tudo que a instância superior já julgou.
      emAndamento: Math.max(0, total - decididos),
      transitados,
      recursal,
      decididos,
    },
    natureza: contarNatureza(porGrau),
    tendencia,
    processos: linhas.map((r) => ({
      id: r.id,
      cnj: r.cnj,
      tribunal: r.tribunal,
      grau: r.grau,
      classeNome: r.classeNome,
      assuntoNome: r.assuntoNome,
      assuntosTodos: r.assuntosTodos,
      orgaoNome: r.orgaoNome,
      resultado: (r.resultado as ResultadoProcesso | null) ?? null,
      resultadoEm: r.resultadoEm ? r.resultadoEm.toISOString() : null,
      resultadoMovimento: r.resultadoMovimento,
      resultadoRecurso: (r.resultadoRecurso as ResultadoRecurso | null) ?? null,
      resultadoRecursoEm: r.resultadoRecursoEm ? r.resultadoRecursoEm.toISOString() : null,
      resultadoRecursoMovimento: r.resultadoRecursoMovimento,
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

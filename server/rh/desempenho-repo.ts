/**
 * O desempenho de cada pessoa no período, pra ficha do RH.
 *
 * As janelas de tempo são as MESMAS do relatório de Atendimento, e cada uma é
 * diferente de propósito:
 *
 *  - oportunidade entra se foi CRIADA ou FECHADA no período. Só criação
 *    esconderia o contrato que a pessoa fechou este mês de um lead de março;
 *    só fechamento esconderia o trabalho em cima do que ainda está em aberto;
 *  - conversa entra pela data de abertura;
 *  - compromisso entra pela data de início.
 *
 * A primeira resposta usa MEDIANA, e não média como o KPI do relatório: numa
 * pessoa só, uma conversa esquecida por dois dias puxa a média para um número
 * que não descreve nenhum dia dela. Com o escritório inteiro isso se dilui; com
 * uma pessoa, não. A tela diz "mediana" para os dois números não parecerem o
 * mesmo com valores diferentes.
 */

import { and, eq, gte, lte, or, sql } from "drizzle-orm";
import { getDb } from "../db";
import { agendamentos, conversas, leads } from "../../drizzle/schema";
import {
  agregarDesempenho,
  DESEMPENHO_VAZIO,
  type Desempenho,
  type LinhaPorEtapa,
} from "../../shared/desempenho";

/** Mediana de uma lista já ordenada de números. */
function mediana(ordenados: number[]): number | null {
  if (ordenados.length === 0) return null;
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 === 1
    ? ordenados[meio]!
    : Math.round((ordenados[meio - 1]! + ordenados[meio]!) / 2);
}

/**
 * O desempenho de todos os colaboradores do escritório no intervalo.
 *
 * Devolve um mapa por colaboradorId. Quem não aparece em nenhuma das fontes
 * fica de fora — o chamador usa `DESEMPENHO_VAZIO` no lugar, que é diferente
 * de não ter o dado.
 */
export async function desempenhoDoPeriodo(
  escritorioId: number,
  de: Date,
  ate: Date,
): Promise<Map<number, Desempenho>> {
  const db = await getDb();
  if (!db) return new Map();

  const [porEtapa, porAtendente, porResponsavel, respostas] = await Promise.all([
    db
      .select({
        colabId: leads.responsavelId,
        etapa: leads.etapaFunil,
        total: sql<number>`COUNT(*)`,
        valor: sql<number>`COALESCE(SUM(CAST(${leads.valorEstimado} AS DECIMAL(15,2))), 0)`,
      })
      .from(leads)
      .where(and(
        eq(leads.escritorioId, escritorioId),
        or(
          and(gte(leads.createdAt, de), lte(leads.createdAt, ate)),
          and(sql`${leads.fechadoEm} IS NOT NULL`, gte(leads.fechadoEm, de), lte(leads.fechadoEm, ate)),
        ),
      ))
      .groupBy(leads.responsavelId, leads.etapaFunil),

    db
      .select({ colabId: conversas.atendenteId, total: sql<number>`COUNT(*)` })
      .from(conversas)
      .where(and(
        eq(conversas.escritorioId, escritorioId),
        gte(conversas.createdAt, de),
        lte(conversas.createdAt, ate),
      ))
      .groupBy(conversas.atendenteId),

    db
      .select({
        colabId: agendamentos.responsavelId,
        total: sql<number>`COUNT(*)`,
        concluidos: sql<number>`SUM(CASE WHEN ${agendamentos.status} = 'concluido' THEN 1 ELSE 0 END)`,
      })
      .from(agendamentos)
      .where(and(
        eq(agendamentos.escritorioId, escritorioId),
        gte(agendamentos.dataInicio, de),
        lte(agendamentos.dataInicio, ate),
      ))
      .groupBy(agendamentos.responsavelId),

    // Uma linha por conversa respondida, pra calcular a mediana em memória —
    // MySQL 5.7 não tem função de percentil, e emular com variável de sessão
    // dentro do Drizzle sairia ilegível por um número que roda sobre dezenas
    // de linhas.
    db.execute(sql`
      SELECT c.atendenteIdConv AS colabId,
             TIMESTAMPDIFF(SECOND, c.createdAtConv, m.primeiraSaida) AS seg
      FROM conversas c
      INNER JOIN (
        SELECT conversaIdMsg, MIN(createdAtMsg) AS primeiraSaida
        FROM mensagens
        WHERE direcaoMsg = 'saida'
        GROUP BY conversaIdMsg
      ) m ON m.conversaIdMsg = c.id
      WHERE c.escritorioIdConv = ${escritorioId}
        AND c.createdAtConv >= ${de}
        AND c.createdAtConv <= ${ate}
        AND c.atendenteIdConv IS NOT NULL
    `),
  ]);

  const etapasPorColab = new Map<number, LinhaPorEtapa[]>();
  for (const r of porEtapa) {
    if (r.colabId == null) continue;
    const lista = etapasPorColab.get(r.colabId) ?? [];
    lista.push({ etapa: String(r.etapa), total: Number(r.total), valor: Number(r.valor || 0) });
    etapasPorColab.set(r.colabId, lista);
  }

  const atendPorColab = new Map<number, number>();
  for (const r of porAtendente) {
    if (r.colabId == null) continue;
    atendPorColab.set(r.colabId, Number(r.total));
  }

  const agendaPorColab = new Map<number, { total: number; concluidos: number }>();
  for (const r of porResponsavel) {
    if (r.colabId == null) continue;
    agendaPorColab.set(r.colabId, {
      total: Number(r.total),
      concluidos: Number(r.concluidos || 0),
    });
  }

  const esperasPorColab = new Map<number, number[]>();
  const linhas = (respostas as unknown as { colabId: number; seg: number }[][])[0]
    ?? (respostas as unknown as { rows?: { colabId: number; seg: number }[] }).rows
    ?? [];
  for (const r of linhas as { colabId: number; seg: number }[]) {
    const id = Number(r.colabId);
    const seg = Number(r.seg);
    if (!Number.isFinite(id) || !Number.isFinite(seg) || seg < 0) continue;
    const lista = esperasPorColab.get(id) ?? [];
    lista.push(seg);
    esperasPorColab.set(id, lista);
  }

  const ids = new Set<number>([
    ...etapasPorColab.keys(),
    ...atendPorColab.keys(),
    ...agendaPorColab.keys(),
    ...esperasPorColab.keys(),
  ]);

  const saida = new Map<number, Desempenho>();
  for (const id of ids) {
    const agenda = agendaPorColab.get(id) ?? { total: 0, concluidos: 0 };
    const esperas = (esperasPorColab.get(id) ?? []).sort((a, b) => a - b);
    saida.set(
      id,
      agregarDesempenho(etapasPorColab.get(id) ?? [], {
        atendimentos: atendPorColab.get(id) ?? 0,
        agendamentos: agenda.total,
        agendamentosConcluidos: agenda.concluidos,
        segPrimeiraResposta: mediana(esperas),
      }),
    );
  }
  return saida;
}

export { DESEMPENHO_VAZIO };
export type { Desempenho };

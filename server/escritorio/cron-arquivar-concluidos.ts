/**
 * Cron diário: arquiva cards em coluna `tipo='conclusao'` cuja última
 * atualização foi ANTES do primeiro dia do mês corrente. Resultado:
 * dia 1 de cada mês limpa automaticamente tudo que ficou em coluna de
 * conclusão no mês passado.
 *
 * Por que diário e não 1×/mês: se a aplicação ficar fora do ar no dia
 * 1, perderíamos a janela. Diário é idempotente — cards que já foram
 * arquivados (arquivado=true) ficam de fora.
 *
 * Idempotência:
 * - WHERE arquivado=false exclui cards já arquivados
 * - Critério de tempo usa `updatedAt < primeiroDiaDoMes` que NÃO muda
 *   ao re-rodar (mesmo dia, mesmo corte)
 * - UPDATE seta updatedAt=NOW() implicitamente (onUpdateNow) — após
 *   arquivar, próxima execução já não bate no critério porque o card
 *   está com arquivado=true
 *
 * Segurança:
 * - Iteração por escritório, falha de um não bloqueia os outros
 * - Hard cap de 5000 cards por escritório (paranoia — caso real é < 100)
 */

import { and, eq, inArray, lt } from "drizzle-orm";
import { getDb } from "../db";
import { kanbanCards, kanbanColunas, kanbanFunis } from "../../drizzle/schema";
import { createLogger } from "../_core/logger";

const log = createLogger("cron-arquivar-concluidos-kanban");

const MAX_POR_ESCRITORIO = 5000;

function primeiroDiaDoMesCorrente(): Date {
  const hoje = new Date();
  return new Date(hoje.getFullYear(), hoje.getMonth(), 1, 0, 0, 0, 0);
}

export async function arquivarConcluidosDoMesPassado(): Promise<{
  escritoriosProcessados: number;
  cardsArquivados: number;
}> {
  const db = await getDb();
  if (!db) {
    log.warn("DB indisponível");
    return { escritoriosProcessados: 0, cardsArquivados: 0 };
  }

  const corte = primeiroDiaDoMesCorrente();

  // Pega colunas tipo='conclusao' agrupadas por escritório (via JOIN com funis
  // que tem escritorioId).
  const colunasConclusao = await db
    .select({
      colunaId: kanbanColunas.id,
      escritorioId: kanbanFunis.escritorioId,
    })
    .from(kanbanColunas)
    .innerJoin(kanbanFunis, eq(kanbanFunis.id, kanbanColunas.funilId))
    .where(eq(kanbanColunas.tipo, "conclusao"));

  if (colunasConclusao.length === 0) {
    log.info("Nenhuma coluna marcada como conclusão — nada a fazer");
    return { escritoriosProcessados: 0, cardsArquivados: 0 };
  }

  // Agrupa colunas por escritório pra processar 1 escritório por vez.
  const colunasPorEscritorio = new Map<number, number[]>();
  for (const c of colunasConclusao) {
    const arr = colunasPorEscritorio.get(c.escritorioId) ?? [];
    arr.push(c.colunaId);
    colunasPorEscritorio.set(c.escritorioId, arr);
  }

  let totalArquivados = 0;
  let escritoriosProcessados = 0;

  for (const [escritorioId, colunaIds] of colunasPorEscritorio) {
    try {
      const alvos = await db
        .select({ id: kanbanCards.id })
        .from(kanbanCards)
        .where(and(
          eq(kanbanCards.escritorioId, escritorioId),
          inArray(kanbanCards.colunaId, colunaIds),
          eq(kanbanCards.arquivado, false),
          lt(kanbanCards.updatedAt, corte),
        ))
        .limit(MAX_POR_ESCRITORIO);

      if (alvos.length === 0) {
        escritoriosProcessados++;
        continue;
      }

      const ids = alvos.map((a) => a.id);
      await db
        .update(kanbanCards)
        .set({ arquivado: true, arquivadoEm: new Date() })
        .where(and(
          eq(kanbanCards.escritorioId, escritorioId),
          inArray(kanbanCards.id, ids),
        ));

      totalArquivados += ids.length;
      escritoriosProcessados++;
      log.info(
        { escritorioId, arquivados: ids.length, corte: corte.toISOString() },
        "Auto-arquivamento mensal",
      );
    } catch (err: any) {
      log.warn(
        { escritorioId, err: err?.message ?? String(err) },
        "Falha no auto-arquivamento (não bloqueia próximo escritório)",
      );
    }
  }

  log.info(
    { escritoriosProcessados, totalArquivados, corte: corte.toISOString() },
    "Cron auto-arquivar concluídos finalizado",
  );

  return {
    escritoriosProcessados,
    cardsArquivados: totalArquivados,
  };
}

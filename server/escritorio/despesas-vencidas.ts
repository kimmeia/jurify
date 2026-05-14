/**
 * Cron de atualização do status `vencido` em despesas.
 *
 * Contexto: o enum de status (`pendente|parcial|pago|vencido`) sempre
 * existiu no schema, mas nenhuma parte do código setava `vencido`. O KPI
 * "Vencido" em router-despesas.kpis somava só linhas com status='vencido',
 * que nunca aparecia → card sempre mostrava R$ 0,00 mesmo com despesas
 * em atraso.
 *
 * Este worker faz a transição bidirecional:
 *  - Forward: pendente/parcial com vencimento < hoje → vencido
 *  - Reverse: vencido com vencimento >= hoje (foi prorrogado) → volta a
 *    pendente (se valorPago=0) ou parcial (se valorPago>0)
 *
 * Roda a cada 1h pelo cron global. Janela de defasagem (max 1h) é
 * aceitável pra KPI gerencial — operadores que precisam de atualização
 * imediata podem chamar manualmente (futuro endpoint, fora do escopo).
 *
 * Idempotente: rodar 2x seguido tem o mesmo efeito. Não toca em status
 * 'pago' (intocado uma vez quitado).
 */

import { and, eq, gte, lt, or, sql } from "drizzle-orm";
import { getDb } from "../db";
import { despesas } from "../../drizzle/schema";
import { createLogger } from "../_core/logger";
import { dataHojeBR } from "../../shared/escritorio-types";

const log = createLogger("escritorio-despesas-vencidas");

export interface ResultadoAtualizacaoVencidas {
  marcadasVencidas: number;
  desmarcadasParaPendente: number;
  desmarcadasParaParcial: number;
}

/**
 * Atualiza o status `vencido` de despesas em massa. Não retorna lista
 * pra economizar memória — só agregados. Caller (cron) loga se >0.
 */
export async function atualizarStatusDespesasVencidas(): Promise<ResultadoAtualizacaoVencidas> {
  const db = await getDb();
  if (!db) {
    return { marcadasVencidas: 0, desmarcadasParaPendente: 0, desmarcadasParaParcial: 0 };
  }

  // Usa fuso BRT pra não marcar "vencido" 3h antes do dia terminar de fato
  // pra o operador (server em UTC vê "amanhã" às 21h BRT). Crons globais
  // assumem padrão BRT — escritórios em outros fusos seriam corner cases
  // raros (Manaus/Acre/Noronha) e desviam no máximo 1h.
  const hojeIso = dataHojeBR();

  // 1. Forward: pendente/parcial com vencimento < hoje → vencido.
  //    Comparação lexicográfica em string YYYY-MM-DD é equivalente a
  //    comparação de data (preserva ordem cronológica).
  const forward = await db
    .update(despesas)
    .set({ status: "vencido" })
    .where(
      and(
        or(eq(despesas.status, "pendente"), eq(despesas.status, "parcial")),
        lt(despesas.vencimento, hojeIso),
      ),
    );
  const marcadasVencidas = Number((forward as any)?.[0]?.affectedRows ?? 0);

  // 2. Reverse pra "pendente": vencido com vencimento prorrogado e sem
  //    pagamento parcial. Ex: user negocia prazo com fornecedor depois
  //    do vencimento e edita a data — status volta sozinho.
  const reversePendente = await db
    .update(despesas)
    .set({ status: "pendente" })
    .where(
      and(
        eq(despesas.status, "vencido"),
        gte(despesas.vencimento, hojeIso),
        eq(despesas.valorPago, "0.00"),
      ),
    );
  const desmarcadasParaPendente = Number(
    (reversePendente as any)?.[0]?.affectedRows ?? 0,
  );

  // 3. Reverse pra "parcial": vencido com vencimento prorrogado mas
  //    com pagamento parcial registrado. CAST necessário porque
  //    valorPago é decimal e a comparação direta com 0 via Drizzle
  //    não joga bem com o driver mysql2.
  const reverseParcial = await db
    .update(despesas)
    .set({ status: "parcial" })
    .where(
      and(
        eq(despesas.status, "vencido"),
        gte(despesas.vencimento, hojeIso),
        sql`CAST(${despesas.valorPago} AS DECIMAL(12,2)) > 0`,
      ),
    );
  const desmarcadasParaParcial = Number(
    (reverseParcial as any)?.[0]?.affectedRows ?? 0,
  );

  const total = marcadasVencidas + desmarcadasParaPendente + desmarcadasParaParcial;
  if (total > 0) {
    log.info(
      {
        marcadasVencidas,
        desmarcadasParaPendente,
        desmarcadasParaParcial,
      },
      "[despesas-vencidas] status atualizado",
    );
  }

  return { marcadasVencidas, desmarcadasParaPendente, desmarcadasParaParcial };
}

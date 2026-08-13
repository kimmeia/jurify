/**
 * Quantas movimentações novas o escritório tem para ver.
 *
 * Módulo próprio porque a pergunta aparece em dois lugares — o badge do
 * menu e o card do Painel Geral — e cada um tinha a sua resposta:
 *
 *   - badge: `eventos_processo` do ESCRITÓRIO, não lidas, últimos 30 dias
 *   - card:  `notificacoes` do USUÁRIO logado, tipo movimentacao, não lidas
 *
 * As duas contagens não podiam bater. A notificação só é criada para quem
 * cadastrou o monitoramento, então um colaborador que não cadastrou nada
 * via badge 10 e card 0 na mesma tela. Pior: "marcar como lida" atualiza
 * `eventos_processo` e não toca em `notificacoes`, então o badge zerava e o
 * card continuava com o número velho para sempre.
 *
 * A fonte da verdade é `eventos_processo`: é lá que a movimentação existe,
 * é o que a Central lista e o que o "marcar como lida" atualiza. Notificação
 * é entrega, não é o fato.
 */

import { and, eq, gte, sql } from "drizzle-orm";
import { getDb } from "../db";
import { eventosProcesso } from "../../drizzle/schema";

/**
 * Janela do contador. Movimentação de dois meses atrás não lida deixou de
 * ser novidade e vira ruído permanente no badge.
 */
export const DIAS_JANELA_MOVIMENTACOES = 30;

export async function contarMovimentacoesNaoLidas(escritorioId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const desde = new Date(Date.now() - DIAS_JANELA_MOVIMENTACOES * 86_400_000);
  const [row] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(eventosProcesso)
    .where(
      and(
        eq(eventosProcesso.escritorioId, escritorioId),
        eq(eventosProcesso.tipo, "movimentacao"),
        eq(eventosProcesso.lido, false),
        gte(eventosProcesso.dataEvento, desde),
      ),
    );

  return Number(row?.n ?? 0);
}

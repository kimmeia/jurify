/**
 * O corte único de "atrasado".
 *
 * Existiam quatro definições no sistema, e as quatro apareciam ao mesmo
 * tempo pro usuário:
 *
 *   badge da Agenda        `vencimento <= meia-noite de hoje`
 *   card do Painel Geral   `vencimento <  meia-noite de hoje`
 *   Painel Operacional     `vencimento <  agora`
 *   contador de Tarefas    `vencimento <  NOW()` (relógio do banco, em UTC)
 *
 * Três consequências: compromisso marcado para a meia-noite de hoje era
 * atrasado num lugar e não em outro; tarefa marcada para hoje às 9h virava
 * atrasada às 9h01 em duas telas e só amanhã nas outras duas; e o `NOW()`
 * do banco usa UTC, então perto da virada o dia do contador não era o dia
 * do escritório.
 *
 * A definição escolhida: **o dia inteiro é seu**. Só atrasa quando o dia
 * vira, no fuso do escritório. É a leitura que combina com prazo jurídico,
 * onde protocolar às 23h de hoje é dentro do prazo.
 */

import { eq } from "drizzle-orm";
import { dataHojeBR, inicioDoDiaNoFuso, FUSO_HORARIO_PADRAO } from "../../shared/escritorio-types";
import { getDb } from "../db";
import { escritorios } from "../../drizzle/schema";

/**
 * Instante a partir do qual algo NÃO está mais atrasado — a meia-noite de
 * hoje no fuso do escritório. Compare sempre com `<`:
 *
 *   atrasado  = vencimento < corteAtraso(tz)
 *   no prazo  = vencimento >= corteAtraso(tz)
 *
 * Usar `<=` reinsere o compromisso da meia-noite de hoje entre os
 * atrasados, que é justamente a divergência que este módulo encerra.
 */
export function corteAtraso(fusoHorario?: string | null): Date {
  const tz = fusoHorario || FUSO_HORARIO_PADRAO;
  return inicioDoDiaNoFuso(dataHojeBR(tz), tz);
}

/** Mesmo corte, resolvendo o fuso do escritório. */
export async function corteAtrasoDoEscritorio(escritorioId: number): Promise<Date> {
  const db = await getDb();
  if (!db) return corteAtraso(null);

  const [esc] = await db
    .select({ fusoHorario: escritorios.fusoHorario })
    .from(escritorios)
    .where(eq(escritorios.id, escritorioId))
    .limit(1);

  return corteAtraso(esc?.fusoHorario);
}

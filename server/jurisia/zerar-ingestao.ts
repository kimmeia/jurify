/**
 * Apaga o que o robô ingeriu, pra recomeçar do zero.
 *
 * O alcance é deliberadamente estreito: acervo, movimentos e cursores. As
 * conversas dos clientes e o consumo de cota ficam de fora, e não é
 * conservadorismo — apagar aquilo não faz a ingestão recomeçar, só destrói
 * histórico de pesquisa e o número que sustenta a cobrança do mês.
 *
 * Vale registrar que apagar quase nunca é necessário: `jurisia_processos` tem
 * índice único no CNJ e a gravação é upsert, então re-varrer já reescreve cada
 * linha com os classificadores atuais. Zerar serve pra quando se quer garantia
 * de base limpa — processo que saiu do índice do CNJ nunca seria reescrito e
 * ficaria pra sempre.
 */

import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { jurisiaMovimentos, jurisiaProcessos, jurisiaVarredura } from "../../drizzle/schema";
import { createLogger } from "../_core/logger";

const log = createLogger("jurisia-zerar");

export interface ContagemIngestao {
  processos: number;
  movimentos: number;
  tribunaisComEstado: number;
}

/** O que será apagado. A tela mostra isto ANTES de confirmar. */
export async function contarIngestao(): Promise<ContagemIngestao> {
  const db = await getDb();
  if (!db) return { processos: 0, movimentos: 0, tribunaisComEstado: 0 };

  const [[p], [m], [v]] = await Promise.all([
    db.select({ n: sql<number>`COUNT(*)` }).from(jurisiaProcessos),
    db.select({ n: sql<number>`COUNT(*)` }).from(jurisiaMovimentos),
    db.select({ n: sql<number>`COUNT(*)` }).from(jurisiaVarredura),
  ]);

  return {
    processos: Number(p?.n ?? 0),
    movimentos: Number(m?.n ?? 0),
    tribunaisComEstado: Number(v?.n ?? 0),
  };
}

/**
 * Apaga na ordem filho → pai. `jurisia_movimentos.processoId` aponta pra
 * `jurisia_processos`; inverter a ordem deixaria movimento órfão apontando pra
 * id que não existe mais, e o próximo processo a reusar aquele id herdaria
 * movimentação de outro.
 */
export async function zerarIngestao(): Promise<ContagemIngestao> {
  const db = await getDb();
  if (!db) return { processos: 0, movimentos: 0, tribunaisComEstado: 0 };

  const antes = await contarIngestao();

  await db.delete(jurisiaMovimentos);
  await db.delete(jurisiaProcessos);
  await db.delete(jurisiaVarredura);

  log.warn(
    { ...antes },
    "acervo JurisIA zerado — conversas e consumo de cota preservados",
  );

  return antes;
}

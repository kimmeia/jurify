/**
 * Quais clientes um colaborador enxerga no financeiro.
 *
 * Vive em módulo próprio porque mais de uma tela responde à pergunta
 * "quanto entrou no caixa?" — a página /financeiro e o Painel Financeiro —
 * e as duas precisam recortar pelo MESMO conjunto de clientes. Enquanto o
 * filtro morava dentro de `router-asaas.ts`, o painel simplesmente não o
 * tinha: somava o escritório inteiro para qualquer usuário que passasse no
 * gate de dashboard, inclusive quem só pode ver a própria carteira.
 *
 * Contrato:
 *   null  → sem filtro (verTodos)
 *   []    → não vê nada
 *   [ids] → só esses contatos
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { contatos } from "../../drizzle/schema";
import { checkPermission } from "./check-permission";

export async function contatosVisiveisFinanceiro(
  userId: number,
  escritorioId: number,
): Promise<number[] | null> {
  const perm = await checkPermission(userId, "financeiro", "ver");
  if (perm.verTodos) return null;
  if (!perm.verProprios) return [];

  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select({ id: contatos.id })
    .from(contatos)
    .where(
      and(
        eq(contatos.escritorioId, escritorioId),
        eq(contatos.responsavelId, perm.colaboradorId),
      ),
    );
  return rows.map((r) => r.id);
}

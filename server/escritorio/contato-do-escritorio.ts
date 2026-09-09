/**
 * O contato citado por id pertence a este escritório?
 *
 * `contatoId` chega cru do cliente em várias procedures — vincular um
 * compromisso, uma tarefa, um card, uma conversa. O schema não amarra nada:
 * é um int livre. Sem conferir, dá pra plantar no próprio escritório um
 * vínculo que aponta pro cadastro de outro, e a partir daí toda tela que
 * junta as duas tabelas para mostrar o nome passa a exibir dado alheio —
 * sem nenhum bug nessas telas, que só confiam no vínculo.
 *
 * A checagem já existia copiada dentro de `router-crm.ts` e
 * `router-kanban.ts`; a agenda não tinha. É assim que essas guardas
 * divergem: cada uma escrita num momento, e a diferença só aparece quando
 * alguém encontra a que faltou.
 */

import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { contatos } from "../../drizzle/schema";

export async function contatoEhDoEscritorio(
  db: any,
  escritorioId: number,
  contatoId: number,
): Promise<boolean> {
  const [c] = await db
    .select({ id: contatos.id })
    .from(contatos)
    .where(and(eq(contatos.id, contatoId), eq(contatos.escritorioId, escritorioId)))
    .limit(1);
  return !!c;
}

/**
 * Mesma checagem, recusando em vez de devolver booleano. `null`/`undefined`
 * passa: vínculo com contato é opcional em quase todo lugar.
 */
export async function exigirContatoDoEscritorio(
  db: any,
  escritorioId: number,
  contatoId: number | null | undefined,
): Promise<void> {
  if (contatoId == null) return;
  if (!(await contatoEhDoEscritorio(db, escritorioId, contatoId))) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado." });
  }
}

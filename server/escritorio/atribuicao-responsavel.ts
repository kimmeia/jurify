/**
 * Quem pode ficar com um evento, e quem pode decidir isso.
 *
 * `responsavelId` chega do cliente em quatro procedures diferentes
 * (agenda.criarCompromisso, agenda.criarTarefa, agenda.atualizar,
 * agendamento.criar, tarefas.criar) e nada no schema amarra a coluna a um
 * colaborador — é um int livre. Sem checagem dá pra apontar pra id de outro
 * escritório, ou pra alguém que já saiu, e aí o evento cai numa agenda que
 * ninguém abre.
 *
 * As duas regras moram aqui porque copiá-las é como elas divergem: quando
 * escrevi a primeira versão, `agenda.atualizar` exigia ser o responsável
 * enquanto `agenda.excluir` aceitava responsável OU criador — duas linhas
 * parecidas, escritas em momentos diferentes, e a diferença só aparecia
 * quando alguém perdia o direito de editar o que tinha acabado de escrever.
 */

import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { colaboradores } from "../../drizzle/schema";

/** É gente deste escritório e ainda está aqui? */
export async function exigirColaboradorAtivo(
  db: any,
  escritorioId: number,
  colaboradorId: number,
) {
  const [c] = await db
    .select({ id: colaboradores.id })
    .from(colaboradores)
    .where(and(
      eq(colaboradores.id, colaboradorId),
      eq(colaboradores.escritorioId, escritorioId),
      eq(colaboradores.ativo, true),
    ))
    .limit(1);
  if (!c) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Responsável não encontrado na equipe." });
  }
}

/**
 * Passar trabalho pra outra pessoa é ato de coordenação: exige enxergar a
 * agenda do escritório inteiro. Quem só vê a própria linha cria e mantém pra
 * si — o campo existe, mas não despacha tarefa pra quem não escolheu
 * recebê-la.
 */
export function exigirPoderDeAtribuir(
  perm: { verTodos: boolean; colaboradorId: number },
  responsavelId: number,
) {
  if (!perm.verTodos && responsavelId !== perm.colaboradorId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Só quem enxerga a agenda de todos pode atribuir a outra pessoa.",
    });
  }
}

/** As duas checagens juntas — é sempre assim que se usa. */
export async function validarResponsavel(
  db: any,
  perm: { verTodos: boolean; colaboradorId: number; escritorioId: number },
  responsavelId: number | null | undefined,
) {
  if (responsavelId == null) return;
  exigirPoderDeAtribuir(perm, responsavelId);
  await exigirColaboradorAtivo(db, perm.escritorioId, responsavelId);
}

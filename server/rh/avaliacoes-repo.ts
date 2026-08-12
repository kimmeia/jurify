/**
 * Avaliação de desempenho — leitura e escrita.
 *
 * Mesmo princípio do resto do RH: o `escritorioId` viaja até o WHERE de toda
 * escrita. Uma ação combinada é filha da avaliação, e checar só o `id` dela
 * deixaria alguém marcar como cumprida a meta de outro escritório.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { rhAvaliacaoAcoes, rhAvaliacoes, users, colaboradores } from "../../drizzle/schema";

const COLUNAS = {
  id: rhAvaliacoes.id,
  colaboradorId: rhAvaliacoes.colaboradorId,
  ciclo: rhAvaliacoes.ciclo,
  notas: rhAvaliacoes.notas,
  media: rhAvaliacoes.media,
  comentario: rhAvaliacoes.comentario,
  avaliadoEm: rhAvaliacoes.avaliadoEm,
  avaliadoPorNome: users.name,
};

/**
 * O histórico de um colaborador, do ciclo mais recente pro mais antigo.
 *
 * O join com `users` é por LEFT: gestor removido do escritório não pode apagar
 * a avaliação que ele fez — o nome some, o registro fica.
 */
export async function avaliacoesDoColaborador(escritorioId: number, colaboradorId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select(COLUNAS)
    .from(rhAvaliacoes)
    .leftJoin(colaboradores, eq(rhAvaliacoes.avaliadoPor, colaboradores.id))
    .leftJoin(users, eq(colaboradores.userId, users.id))
    .where(and(
      eq(rhAvaliacoes.escritorioId, escritorioId),
      eq(rhAvaliacoes.colaboradorId, colaboradorId),
    ))
    .orderBy(desc(rhAvaliacoes.avaliadoEm), desc(rhAvaliacoes.id));
}

/** Todas as avaliações do escritório — a lista da equipe lê a última de cada. */
export async function avaliacoesDoEscritorio(escritorioId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select(COLUNAS)
    .from(rhAvaliacoes)
    .leftJoin(colaboradores, eq(rhAvaliacoes.avaliadoPor, colaboradores.id))
    .leftJoin(users, eq(colaboradores.userId, users.id))
    .where(eq(rhAvaliacoes.escritorioId, escritorioId))
    .orderBy(desc(rhAvaliacoes.avaliadoEm), desc(rhAvaliacoes.id));
}

/** As ações combinadas de um conjunto de avaliações. */
export async function acoesDasAvaliacoes(escritorioId: number, avaliacaoIds: number[]) {
  const db = await getDb();
  if (!db || avaliacaoIds.length === 0) return [];
  return db
    .select({
      id: rhAvaliacaoAcoes.id,
      avaliacaoId: rhAvaliacaoAcoes.avaliacaoId,
      descricao: rhAvaliacaoAcoes.descricao,
      prazo: rhAvaliacaoAcoes.prazo,
      concluidoEm: rhAvaliacaoAcoes.concluidoEm,
    })
    .from(rhAvaliacaoAcoes)
    .where(and(
      eq(rhAvaliacaoAcoes.escritorioId, escritorioId),
      inArray(rhAvaliacaoAcoes.avaliacaoId, avaliacaoIds),
    ))
    .orderBy(rhAvaliacaoAcoes.id);
}

export async function registrarAvaliacao(args: {
  escritorioId: number;
  colaboradorId: number;
  ciclo: string;
  notasJson: string;
  media: number | null;
  comentario: string | null;
  gestorId: number;
  acoes: Array<{ descricao: string; prazo: string | null }>;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Base de dados indisponível.");

  const [r] = await db.insert(rhAvaliacoes).values({
    escritorioId: args.escritorioId,
    colaboradorId: args.colaboradorId,
    ciclo: args.ciclo,
    notas: args.notasJson,
    media: args.media == null ? null : String(args.media),
    comentario: args.comentario,
    avaliadoPor: args.gestorId,
  });
  const id = (r as { insertId: number }).insertId;

  if (args.acoes.length > 0) {
    await db.insert(rhAvaliacaoAcoes).values(
      args.acoes.map((a) => ({
        avaliacaoId: id,
        escritorioId: args.escritorioId,
        descricao: a.descricao,
        prazo: a.prazo,
      })),
    );
  }
  return id;
}

/** Marca (ou desmarca) uma ação combinada como cumprida. */
export async function decidirAcao(args: {
  escritorioId: number;
  acaoId: number;
  gestorId: number;
  concluir: boolean;
}): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Base de dados indisponível.");

  const [alvo] = await db
    .select({ id: rhAvaliacaoAcoes.id })
    .from(rhAvaliacaoAcoes)
    .where(and(
      eq(rhAvaliacaoAcoes.id, args.acaoId),
      eq(rhAvaliacaoAcoes.escritorioId, args.escritorioId),
    ))
    .limit(1);
  if (!alvo) return false;

  await db
    .update(rhAvaliacaoAcoes)
    .set(
      args.concluir
        ? { concluidoEm: new Date(), concluidoPor: args.gestorId }
        : { concluidoEm: null, concluidoPor: null },
    )
    .where(eq(rhAvaliacaoAcoes.id, args.acaoId));
  return true;
}

/** Apaga uma avaliação lançada por engano, junto com o plano dela. */
export async function excluirAvaliacao(escritorioId: number, avaliacaoId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Base de dados indisponível.");

  const [alvo] = await db
    .select({ id: rhAvaliacoes.id })
    .from(rhAvaliacoes)
    .where(and(
      eq(rhAvaliacoes.id, avaliacaoId),
      eq(rhAvaliacoes.escritorioId, escritorioId),
    ))
    .limit(1);
  if (!alvo) return false;

  // As ações primeiro: se a avaliação sumisse antes, um erro no meio deixaria
  // plano órfão apontando pra uma avaliação que não existe mais.
  await db
    .delete(rhAvaliacaoAcoes)
    .where(and(
      eq(rhAvaliacaoAcoes.avaliacaoId, avaliacaoId),
      eq(rhAvaliacaoAcoes.escritorioId, escritorioId),
    ));
  await db
    .delete(rhAvaliacoes)
    .where(and(
      eq(rhAvaliacoes.id, avaliacaoId),
      eq(rhAvaliacoes.escritorioId, escritorioId),
    ));
  return true;
}

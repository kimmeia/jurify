/**
 * Conduta e faltas — leitura e escrita.
 *
 * Todo caminho de escrita recebe o `escritorioId` e o carrega até o WHERE. Um
 * update que confia só no `id` da ocorrência é um update que aprova o atestado
 * de outro escritório quando alguém troca o número na requisição — e aqui o
 * que está em jogo é a folha de pagamento de alguém.
 */

import { and, asc, eq, gte, lte } from "drizzle-orm";
import { getDb } from "../db";
import { rhOcorrencias } from "../../drizzle/schema";
import type { MotivoFalta, TipoOcorrencia } from "../../shared/ocorrencias";

const COLUNAS = {
  id: rhOcorrencias.id,
  colaboradorId: rhOcorrencias.colaboradorId,
  dia: rhOcorrencias.dia,
  tipo: rhOcorrencias.tipo,
  motivo: rhOcorrencias.motivo,
  descricao: rhOcorrencias.descricao,
  atestadoUrl: rhOcorrencias.atestadoUrl,
  atestadoNome: rhOcorrencias.atestadoNome,
  aprovadoEm: rhOcorrencias.aprovadoEm,
};

/** As ocorrências de um colaborador no intervalo. */
export async function ocorrenciasDoPeriodo(
  escritorioId: number,
  colaboradorId: number,
  de: string,
  ate: string,
) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select(COLUNAS)
    .from(rhOcorrencias)
    .where(and(
      eq(rhOcorrencias.escritorioId, escritorioId),
      eq(rhOcorrencias.colaboradorId, colaboradorId),
      gte(rhOcorrencias.dia, de),
      lte(rhOcorrencias.dia, ate),
    ))
    .orderBy(asc(rhOcorrencias.dia), asc(rhOcorrencias.id));
}

/** As ocorrências de todo o escritório no intervalo. */
export async function ocorrenciasDoEscritorio(escritorioId: number, de: string, ate: string) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select(COLUNAS)
    .from(rhOcorrencias)
    .where(and(
      eq(rhOcorrencias.escritorioId, escritorioId),
      gte(rhOcorrencias.dia, de),
      lte(rhOcorrencias.dia, ate),
    ))
    .orderBy(asc(rhOcorrencias.dia), asc(rhOcorrencias.id));
}

export async function registrarOcorrencia(args: {
  escritorioId: number;
  colaboradorId: number;
  dia: string;
  tipo: TipoOcorrencia;
  motivo: MotivoFalta | null;
  descricao: string | null;
  gestorId: number;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Base de dados indisponível.");
  const [r] = await db.insert(rhOcorrencias).values({
    escritorioId: args.escritorioId,
    colaboradorId: args.colaboradorId,
    dia: args.dia,
    tipo: args.tipo,
    motivo: args.motivo,
    descricao: args.descricao,
    registradoPor: args.gestorId,
  });
  return (r as { insertId: number }).insertId;
}

/**
 * Anexa o atestado. Só o gestor chega aqui, por decisão do dono.
 *
 * Anexar NÃO aprova. São dois atos porque são duas decisões: uma é receber o
 * papel, a outra é aceitá-lo. Fundir as duas faria o simples ato de subir o
 * arquivo abonar a falta sem ninguém ter lido nada.
 */
export async function anexarAtestado(args: {
  escritorioId: number;
  ocorrenciaId: number;
  url: string;
  nome: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Base de dados indisponível.");
  await db
    .update(rhOcorrencias)
    .set({ atestadoUrl: args.url, atestadoNome: args.nome })
    .where(and(
      eq(rhOcorrencias.id, args.ocorrenciaId),
      eq(rhOcorrencias.escritorioId, args.escritorioId),
    ));
}

/** Aprova ou desfaz a aprovação do atestado. */
export async function decidirAtestado(args: {
  escritorioId: number;
  ocorrenciaId: number;
  gestorId: number;
  aprovar: boolean;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Base de dados indisponível.");
  await db
    .update(rhOcorrencias)
    .set(
      args.aprovar
        ? { aprovadoPor: args.gestorId, aprovadoEm: new Date() }
        : { aprovadoPor: null, aprovadoEm: null },
    )
    .where(and(
      eq(rhOcorrencias.id, args.ocorrenciaId),
      eq(rhOcorrencias.escritorioId, args.escritorioId),
    ));
}

/** A ocorrência, dentro do escritório de quem pede. null quando não é dele. */
export async function acharOcorrencia(escritorioId: number, ocorrenciaId: number) {
  const db = await getDb();
  if (!db) return null;
  const [linha] = await db
    .select({ ...COLUNAS, escritorioId: rhOcorrencias.escritorioId })
    .from(rhOcorrencias)
    .where(and(
      eq(rhOcorrencias.id, ocorrenciaId),
      eq(rhOcorrencias.escritorioId, escritorioId),
    ))
    .limit(1);
  return linha ?? null;
}

export async function excluirOcorrencia(escritorioId: number, ocorrenciaId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Base de dados indisponível.");
  await db
    .delete(rhOcorrencias)
    .where(and(
      eq(rhOcorrencias.id, ocorrenciaId),
      eq(rhOcorrencias.escritorioId, escritorioId),
    ));
}

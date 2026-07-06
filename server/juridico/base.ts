/**
 * Camada de acesso à base jurídica: seed idempotente, indexação de embeddings
 * e recuperação por similaridade (junta fontes globais da plataforma + as do
 * escritório). As partes puras de ranqueamento moram em `busca.ts`.
 */
import { getDb } from "../db";
import { fontesJuridicas } from "../../drizzle/schema";
import { and, eq, isNull, or } from "drizzle-orm";
import { createLogger } from "../_core/logger";
import { FONTES_REVISIONAL, AREA_REVISIONAL } from "./fontes-revisional";
import { gerarEmbeddingSeguro } from "./embeddings";
import { parseEmbedding, rankearPorSimilaridade } from "./busca";

const log = createLogger("juridico-base");

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/**
 * Insere as fontes semente da área revisional na base GLOBAL (escritorioId
 * NULL), pulando as que já existem (idempotente por identificador). Não gera
 * embedding aqui — isso é a etapa de indexação (`reindexarEmbeddings`).
 */
export async function seedFontesRevisional(db: Db): Promise<{ inseridas: number; jaExistiam: number }> {
  const existentes = await db
    .select({ identificador: fontesJuridicas.identificador })
    .from(fontesJuridicas)
    .where(and(isNull(fontesJuridicas.escritorioId), eq(fontesJuridicas.area, AREA_REVISIONAL)));
  const jaTem = new Set(existentes.map((r) => r.identificador));

  const novas = FONTES_REVISIONAL.filter((f) => !jaTem.has(f.identificador));
  if (novas.length > 0) {
    await db.insert(fontesJuridicas).values(
      novas.map((f) => ({
        escritorioId: null,
        tipo: f.tipo,
        identificador: f.identificador,
        orgao: f.orgao ?? null,
        area: AREA_REVISIONAL,
        titulo: f.titulo ?? null,
        texto: f.texto,
        tags: f.tags ?? null,
        embedding: null,
      })),
    );
  }
  return { inseridas: novas.length, jaExistiam: jaTem.size };
}

/** Texto usado pra indexar/consultar uma fonte (título ajuda o embedding). */
function textoIndexavel(f: { identificador: string; titulo: string | null; texto: string }): string {
  return [f.identificador, f.titulo, f.texto].filter(Boolean).join(" — ");
}

/**
 * Gera embedding pras fontes ainda sem vetor (embedding NULL). Retorna quantas
 * foram indexadas. Falha de uma não derruba as outras (best-effort).
 */
export async function reindexarEmbeddings(
  db: Db,
  apiKey: string,
  opts?: { escritorioId?: number | null; area?: string; limite?: number },
): Promise<{ indexadas: number; pendentes: number }> {
  const conds = [isNull(fontesJuridicas.embedding)];
  if (opts?.area) conds.push(eq(fontesJuridicas.area, opts.area));
  if (opts?.escritorioId === null || opts?.escritorioId === undefined) {
    conds.push(isNull(fontesJuridicas.escritorioId));
  } else {
    conds.push(eq(fontesJuridicas.escritorioId, opts.escritorioId));
  }
  const pendentesRows = await db.select().from(fontesJuridicas).where(and(...conds));
  const limite = opts?.limite ?? 500;
  let indexadas = 0;
  for (const f of pendentesRows.slice(0, limite)) {
    const emb = await gerarEmbeddingSeguro(textoIndexavel(f), apiKey);
    if (!emb) continue;
    await db.update(fontesJuridicas).set({ embedding: JSON.stringify(emb) }).where(eq(fontesJuridicas.id, f.id));
    indexadas++;
  }
  return { indexadas, pendentes: pendentesRows.length - indexadas };
}

export type FonteRecuperada = {
  id: number;
  tipo: string;
  identificador: string;
  orgao: string | null;
  area: string;
  titulo: string | null;
  texto: string;
  score: number;
};

/**
 * Recupera as `topK` fontes mais similares à consulta (já embedada), dentro da
 * área. Junta a base global (escritorioId NULL) com as do próprio escritório.
 */
export async function recuperarFontes(
  db: Db,
  queryEmb: number[],
  opts: { area?: string; escritorioId?: number; topK?: number },
): Promise<FonteRecuperada[]> {
  const escCond = opts.escritorioId != null
    ? or(isNull(fontesJuridicas.escritorioId), eq(fontesJuridicas.escritorioId, opts.escritorioId))!
    : isNull(fontesJuridicas.escritorioId);
  const conds = [escCond];
  if (opts.area) conds.push(eq(fontesJuridicas.area, opts.area));

  const rows = await db.select().from(fontesJuridicas).where(and(...conds));
  const itens = rows.map((r) => ({ ...r, embedding: parseEmbedding(r.embedding) }));
  const ranked = rankearPorSimilaridade(queryEmb, itens, opts.topK ?? 6);
  return ranked.map((r) => ({
    id: r.id,
    tipo: r.tipo,
    identificador: r.identificador,
    orgao: r.orgao,
    area: r.area,
    titulo: r.titulo,
    texto: r.texto,
    score: Number(r.score.toFixed(4)),
  }));
}

export { log as juridicoLog };

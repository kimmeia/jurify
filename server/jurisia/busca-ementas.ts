/**
 * Acha a ementa que sustenta a resposta.
 *
 * Busca por TEXTO (FULLTEXT do MySQL), não por semelhança de vetor, e o
 * motivo é a precisão que o produto promete: "capitalização" tem que achar
 * capitalização, não "juros parecidos". Semelhança é boa pra pergunta vaga e
 * péssima pra termo jurídico exato — e é justamente o termo exato que decide
 * qual acórdão entra na peça.
 *
 * O tribunal do caso pesa: entendimento regional é o que muda a petição, e
 * uma ementa da câmara onde o processo corre vale mais que uma de outro
 * estado. Por isso a ordem é: tribunal do caso primeiro, relevância depois.
 */

import { sql } from "drizzle-orm";
import { getDb } from "../db";
import type { EmentaCitada } from "@shared/jurisia-una";

/** Palavras que não ajudam a achar acórdão e só diluem a busca. */
const VAZIAS = new Set([
  "o", "a", "os", "as", "de", "da", "do", "das", "dos", "em", "no", "na", "nos", "nas",
  "para", "por", "com", "sem", "que", "qual", "quais", "como", "sobre", "um", "uma",
  "e", "ou", "ao", "aos", "à", "às", "meu", "minha", "seu", "sua", "esse", "essa",
  "este", "esta", "isso", "vem", "vêm", "tem", "têm", "ser", "está", "estão", "foi",
]);

/**
 * A pergunta do advogado vira consulta em linguagem booleana do MySQL.
 *
 * Cada palavra vira um termo opcional (sem `+`): exigir todas devolveria zero
 * na maioria das perguntas, que são frases inteiras. O que ordena é a
 * relevância, não a presença de tudo.
 */
export function consultaFullText(pergunta: string): string {
  const palavras = pergunta
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((p) => p.length >= 4 && !VAZIAS.has(p))
    .slice(0, 12);
  // Aspas em cada palavra: o modo booleano trata `-` e `*` como operador, e
  // termo jurídico com hífen entraria como exclusão.
  return palavras.map((p) => `"${p}"`).join(" ");
}

export interface EmentaEncontrada extends EmentaCitada {
  tribunal: string;
  score: number;
}

/**
 * As `limite` ementas mais relevantes pra pergunta.
 *
 * `tribunalPreferido` não FILTRA — ele ordena. Filtrar devolveria vazio no
 * tribunal que ainda não foi coletado, e resposta sem ementa nenhuma é pior
 * que resposta com ementa de outro estado marcada como tal.
 */
export async function buscarEmentas(args: {
  pergunta: string;
  tribunalPreferido?: string | null;
  limite?: number;
}): Promise<EmentaEncontrada[]> {
  const consulta = consultaFullText(args.pergunta);
  if (!consulta) return [];

  const db = await getDb();
  if (!db) return [];

  const limite = Math.min(Math.max(args.limite ?? 3, 1), 10);
  const trib = (args.tribunalPreferido || "").toUpperCase();

  try {
    const linhas = await db.execute(sql`
      SELECT identificadorJurisEm AS identificador,
             tribunalJurisEm      AS tribunal,
             orgaoJurisEm         AS orgao,
             julgadoEmJurisEm     AS julgadoEm,
             ementaJurisEm        AS ementa,
             urlJurisEm           AS url,
             MATCH(ementaJurisEm) AGAINST(${consulta} IN BOOLEAN MODE) AS score
      FROM jurisia_ementas
      WHERE MATCH(ementaJurisEm) AGAINST(${consulta} IN BOOLEAN MODE)
      ORDER BY (tribunalJurisEm = ${trib}) DESC, score DESC
      LIMIT ${limite}
    `);
    const rows = (Array.isArray(linhas) ? linhas[0] : (linhas as { rows?: unknown[] }).rows) ?? [];
    return (rows as Array<Record<string, unknown>>).map((r) => ({
      identificador: String(r.identificador ?? ""),
      tribunal: String(r.tribunal ?? ""),
      orgao: r.orgao ? String(r.orgao) : String(r.tribunal ?? ""),
      data: formatarData(r.julgadoEm),
      ementa: String(r.ementa ?? "").slice(0, 1_200),
      url: String(r.url ?? ""),
      score: Number(r.score ?? 0),
    }));
  } catch (err) {
    // Índice ausente (banco antigo) ou sintaxe recusada não pode derrubar a
    // conversa: sem ementa a resposta continua, com o número do acervo.
    return [];
  }
}

/** Quantas ementas existem — alimenta o cartão da tela e o painel. */
export async function contarEmentas(): Promise<{ total: number; tribunais: number }> {
  const db = await getDb();
  if (!db) return { total: 0, tribunais: 0 };
  try {
    const linhas = await db.execute(sql`
      SELECT COUNT(*) AS total, COUNT(DISTINCT tribunalJurisEm) AS tribunais FROM jurisia_ementas
    `);
    const rows = (Array.isArray(linhas) ? linhas[0] : (linhas as { rows?: unknown[] }).rows) ?? [];
    const r = (rows as Array<Record<string, unknown>>)[0] ?? {};
    return { total: Number(r.total ?? 0), tribunais: Number(r.tribunais ?? 0) };
  } catch {
    return { total: 0, tribunais: 0 };
  }
}

function formatarData(v: unknown): string {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 10);
  return d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

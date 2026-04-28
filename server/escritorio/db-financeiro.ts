/**
 * Helpers de banco — Financeiro Plus (categorias, regra de comissão).
 * Despesas e comissões fechadas têm helpers próprios em fases seguintes.
 */

import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  categoriasCobranca,
  categoriasDespesa,
  regraComissao,
} from "../../drizzle/schema";

// ─── Categorias de cobrança ──────────────────────────────────────────────────

export async function listarCategoriasCobranca(escritorioId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(categoriasCobranca)
    .where(eq(categoriasCobranca.escritorioId, escritorioId))
    .orderBy(asc(categoriasCobranca.nome));
}

export async function criarCategoriaCobranca(
  escritorioId: number,
  nome: string,
  comissionavel: boolean,
) {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");
  const [novo] = await db
    .insert(categoriasCobranca)
    .values({ escritorioId, nome, comissionavel })
    .$returningId();
  return novo.id;
}

export async function atualizarCategoriaCobranca(
  id: number,
  escritorioId: number,
  dados: { nome?: string; comissionavel?: boolean; ativo?: boolean },
) {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");
  await db
    .update(categoriasCobranca)
    .set(dados)
    .where(
      and(
        eq(categoriasCobranca.id, id),
        eq(categoriasCobranca.escritorioId, escritorioId),
      ),
    );
}

// ─── Categorias de despesa ───────────────────────────────────────────────────

export async function listarCategoriasDespesa(escritorioId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(categoriasDespesa)
    .where(eq(categoriasDespesa.escritorioId, escritorioId))
    .orderBy(asc(categoriasDespesa.nome));
}

export async function criarCategoriaDespesa(
  escritorioId: number,
  nome: string,
) {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");
  const [novo] = await db
    .insert(categoriasDespesa)
    .values({ escritorioId, nome })
    .$returningId();
  return novo.id;
}

export async function atualizarCategoriaDespesa(
  id: number,
  escritorioId: number,
  dados: { nome?: string; ativo?: boolean },
) {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");
  await db
    .update(categoriasDespesa)
    .set(dados)
    .where(
      and(
        eq(categoriasDespesa.id, id),
        eq(categoriasDespesa.escritorioId, escritorioId),
      ),
    );
}

// ─── Regra de comissão (singleton por escritório) ────────────────────────────

export async function obterRegraComissao(escritorioId: number) {
  const db = await getDb();
  if (!db) return null;
  const [regra] = await db
    .select()
    .from(regraComissao)
    .where(eq(regraComissao.escritorioId, escritorioId))
    .limit(1);
  return regra ?? null;
}

export async function salvarRegraComissao(
  escritorioId: number,
  aliquotaPercent: number,
  valorMinimoCobranca: number,
) {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");
  // INSERT ... ON DUPLICATE KEY UPDATE: garante 1 linha por escritório.
  await db.execute(
    sql`INSERT INTO regra_comissao
        (escritorioIdRegraCom, aliquotaPercentRegraCom, valorMinimoCobRegraCom)
        VALUES (${escritorioId}, ${aliquotaPercent}, ${valorMinimoCobranca})
        ON DUPLICATE KEY UPDATE
          aliquotaPercentRegraCom = VALUES(aliquotaPercentRegraCom),
          valorMinimoCobRegraCom = VALUES(valorMinimoCobRegraCom)`,
  );
}

// ─── Seed de categorias padrão ───────────────────────────────────────────────

const CATEGORIAS_COBRANCA_PADRAO: Array<{ nome: string; comissionavel: boolean }> = [
  { nome: "Honorário inicial", comissionavel: true },
  { nome: "Honorário mensal", comissionavel: false },
  { nome: "Êxito", comissionavel: true },
  { nome: "Sucumbência", comissionavel: true },
  { nome: "Reembolso de despesas", comissionavel: false },
];

const CATEGORIAS_DESPESA_PADRAO: string[] = [
  "Aluguel",
  "Salários",
  "Pró-labore",
  "Energia",
  "Água",
  "Internet",
  "Telefone",
  "Material de escritório",
  "Tributos",
  "Marketing",
  "Publicações em Diário Oficial",
  "Honorário pago a parceiros",
  "Software/SaaS",
  "Contador",
];

/**
 * Garante que o escritório tenha o conjunto de categorias padrão.
 * Idempotente: só cria se a categoria com o mesmo nome ainda não existir.
 * Chamado preguiçosamente nas listagens — não exige migração de dados.
 */
export async function garantirCategoriasPadrao(escritorioId: number) {
  const db = await getDb();
  if (!db) return;

  const [cobrancaExistentes, despesaExistentes] = await Promise.all([
    db
      .select({ nome: categoriasCobranca.nome })
      .from(categoriasCobranca)
      .where(eq(categoriasCobranca.escritorioId, escritorioId)),
    db
      .select({ nome: categoriasDespesa.nome })
      .from(categoriasDespesa)
      .where(eq(categoriasDespesa.escritorioId, escritorioId)),
  ]);

  const cobrancaSet = new Set(cobrancaExistentes.map((c) => c.nome));
  const despesaSet = new Set(despesaExistentes.map((c) => c.nome));

  const aCriarCobranca = CATEGORIAS_COBRANCA_PADRAO.filter(
    (cat) => !cobrancaSet.has(cat.nome),
  );
  const aCriarDespesa = CATEGORIAS_DESPESA_PADRAO.filter(
    (nome) => !despesaSet.has(nome),
  );

  if (aCriarCobranca.length > 0) {
    await db.insert(categoriasCobranca).values(
      aCriarCobranca.map((cat) => ({
        escritorioId,
        nome: cat.nome,
        comissionavel: cat.comissionavel,
      })),
    );
  }

  if (aCriarDespesa.length > 0) {
    await db.insert(categoriasDespesa).values(
      aCriarDespesa.map((nome) => ({ escritorioId, nome })),
    );
  }
}

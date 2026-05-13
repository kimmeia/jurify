/**
 * Helpers de banco — Financeiro Plus (categorias, regra de comissão).
 * Despesas e comissões fechadas têm helpers próprios em fases seguintes.
 */

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  asaasCobrancas,
  categoriasCobranca,
  categoriasDespesa,
  colaboradores,
  contatos,
  despesas,
  ofxImportacoesFitid,
  regraComissao,
  regraComissaoFaixas,
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

/** Lista as faixas de um escritório em ordem crescente (lê pela coluna `ordem`). */
export async function listarFaixasComissao(escritorioId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(regraComissaoFaixas)
    .where(eq(regraComissaoFaixas.escritorioId, escritorioId))
    .orderBy(asc(regraComissaoFaixas.ordem));
}

export interface FaixaInput {
  /** NULL = sem teto (só permitido na última faixa). */
  limiteAte: number | null;
  aliquotaPercent: number;
}

/**
 * Salva regra completa: cabeçalho (modo, base, alíquota flat, mínimo) + faixas.
 * Substitui completamente as faixas antigas (delete + insert) — operação simples
 * dado que cada escritório tem ≤ ~10 faixas.
 *
 * Envolve TODAS as escritas numa transação MySQL (BEGIN/COMMIT/ROLLBACK) pra
 * evitar estado intermediário: se o INSERT das novas faixas falhar depois do
 * DELETE, o rollback restaura as antigas. Sem isso, o escritório ficava com
 * `modo='faixas'` e zero faixas → `calcularComissao` cai no fallback flat com
 * alíquota 0% → toda comissão futura silenciosamente vai pra R$ 0,00 até
 * alguém perceber.
 */
export async function salvarRegraComissao(
  escritorioId: number,
  dados: {
    modo: "flat" | "faixas";
    aliquotaPercent: number;
    valorMinimoCobranca: number;
    baseFaixa: "bruto" | "comissionavel";
    faixas: FaixaInput[];
  },
) {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");

  await db.transaction(async (tx) => {
    await tx.execute(
      sql`INSERT INTO regra_comissao
          (escritorioIdRegraCom, aliquotaPercentRegraCom, modoRegraCom, baseFaixaRegraCom, valorMinimoCobRegraCom)
          VALUES (${escritorioId}, ${dados.aliquotaPercent}, ${dados.modo}, ${dados.baseFaixa}, ${dados.valorMinimoCobranca})
          ON DUPLICATE KEY UPDATE
            aliquotaPercentRegraCom = VALUES(aliquotaPercentRegraCom),
            modoRegraCom = VALUES(modoRegraCom),
            baseFaixaRegraCom = VALUES(baseFaixaRegraCom),
            valorMinimoCobRegraCom = VALUES(valorMinimoCobRegraCom)`,
    );

    // Substitui o conjunto de faixas. Se modo='flat' o usuário pode ainda enviar
    // faixas (preserva-as caso volte a 'faixas' depois) — mas se vier vazio, limpa.
    await tx
      .delete(regraComissaoFaixas)
      .where(eq(regraComissaoFaixas.escritorioId, escritorioId));

    if (dados.faixas.length > 0) {
      await tx.insert(regraComissaoFaixas).values(
        dados.faixas.map((f, i) => ({
          escritorioId,
          ordem: i,
          limiteAte: f.limiteAte === null ? null : f.limiteAte.toFixed(2),
          aliquotaPercent: f.aliquotaPercent.toFixed(2),
        })),
      );
    }
  });
}

// ─── Cascata de atribuição de atendente em cobranças sincronizadas ───────────

const REGEX_ATENDENTE_REF = /^atendente:(\d+)$/;

/**
 * Aplica a cascata de inferência para descobrir qual atendente recebe a
 * comissão de uma cobrança que veio do Asaas (webhook ou sync órfãs):
 *
 *   1. externalReference no padrão "atendente:N" — confere que N é colaborador
 *      ativo do escritório e usa.
 *   2. Senão, busca o `responsavelId` do contato vinculado (mesma pessoa que
 *      atende o cliente é quem recebe a comissão).
 *   3. Senão, retorna null (cobrança fica em "sem atribuição" até bulk-edit).
 *
 * Idempotente. Não tenta inferir categoria — categorização sempre exige ação
 * humana, pois o Asaas não tem o conceito de categoria de cobrança.
 */
export async function inferirAtendentePorCobranca(
  escritorioId: number,
  externalReference: string | null,
  contatoId: number | null,
): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;

  if (externalReference) {
    const match = REGEX_ATENDENTE_REF.exec(externalReference);
    if (match) {
      const candidato = parseInt(match[1], 10);
      if (Number.isFinite(candidato)) {
        const [linha] = await db
          .select({ id: colaboradores.id })
          .from(colaboradores)
          .where(
            and(
              eq(colaboradores.id, candidato),
              eq(colaboradores.escritorioId, escritorioId),
              eq(colaboradores.ativo, true),
            ),
          )
          .limit(1);
        if (linha) return linha.id;
      }
    }
  }

  if (contatoId !== null) {
    const [c] = await db
      .select({ responsavelId: contatos.responsavelId })
      .from(contatos)
      .where(eq(contatos.id, contatoId))
      .limit(1);
    if (c?.responsavelId) return c.responsavelId;
  }

  return null;
}

/**
 * Re-aplica a cascata em todas as cobranças do escritório que ainda estão
 * órfãs (atendenteId NULL). Filtro opcional por contatoId é usado como
 * trigger pontual quando o atendente responsável de um cliente muda.
 *
 * Cobranças que já têm atendenteId definido — manualmente ou via cascata
 * anterior — NÃO são alteradas. Atribuição manual sempre vence.
 */
export async function reconciliarCobrancasOrfas(
  escritorioId: number,
  filtroContatoId?: number,
): Promise<{ atribuidas: number }> {
  const db = await getDb();
  if (!db) return { atribuidas: 0 };

  const conds = [
    eq(asaasCobrancas.escritorioId, escritorioId),
    isNull(asaasCobrancas.atendenteId),
  ];
  if (filtroContatoId !== undefined) {
    conds.push(eq(asaasCobrancas.contatoId, filtroContatoId));
  }

  const orfas = await db
    .select({
      id: asaasCobrancas.id,
      contatoId: asaasCobrancas.contatoId,
      externalReference: asaasCobrancas.externalReference,
    })
    .from(asaasCobrancas)
    .where(and(...conds));

  let atribuidas = 0;
  for (const cob of orfas) {
    const atendenteId = await inferirAtendentePorCobranca(
      escritorioId,
      cob.externalReference,
      cob.contatoId,
    );
    if (atendenteId !== null) {
      await db
        .update(asaasCobrancas)
        .set({ atendenteId })
        .where(eq(asaasCobrancas.id, cob.id));
      atribuidas++;
    }
  }

  return { atribuidas };
}

/**
 * Atribui em massa atendente / categoria / override a um conjunto de cobranças.
 * Campos undefined preservam o valor atual; null limpa explicitamente.
 */
export async function atribuirCobrancasEmMassa(
  escritorioId: number,
  cobrancaIds: number[],
  dados: {
    atendenteId?: number | null;
    categoriaId?: number | null;
    comissionavelOverride?: boolean | null;
  },
): Promise<{ atualizadas: number }> {
  const db = await getDb();
  if (!db) return { atualizadas: 0 };
  if (cobrancaIds.length === 0) return { atualizadas: 0 };

  const set: Record<string, unknown> = {};
  if (dados.atendenteId !== undefined) set.atendenteId = dados.atendenteId;
  if (dados.categoriaId !== undefined) set.categoriaId = dados.categoriaId;
  if (dados.comissionavelOverride !== undefined) {
    set.comissionavelOverride = dados.comissionavelOverride;
  }
  if (Object.keys(set).length === 0) return { atualizadas: 0 };

  await db
    .update(asaasCobrancas)
    .set(set)
    .where(
      and(
        eq(asaasCobrancas.escritorioId, escritorioId),
        inArray(asaasCobrancas.id, cobrancaIds),
      ),
    );

  return { atualizadas: cobrancaIds.length };
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

// ─── Conciliação OFX: aplica um match individual ─────────────────────────────

export type ResultadoConciliacaoOFXMatch =
  | { status: "aplicado_despesa" }
  | { status: "aplicado_cobranca" }
  | { status: "ja_importada" }
  | { status: "entidade_nao_encontrada"; tipo: "despesa" | "cobranca" }
  | { status: "cobranca_asaas_pulada" };

/**
 * Aplica UM match confirmado da conciliação OFX. Valida a entidade-pai
 * (despesa ou cobrança) ANTES de qualquer escrita; só grava o FITID
 * dentro de uma transação que também atualiza a entidade.
 *
 * Garantias:
 *  - Se a entidade não existe ou é cobrança Asaas (pulada), o FITID NÃO
 *    é gravado — reimport pode tentar de novo sem cair como "já importado".
 *  - Se o INSERT do FITID conflita com UNIQUE (FITID já importado antes),
 *    retorna `ja_importada` SEM mutar a entidade.
 *  - Se o INSERT sucede mas o UPDATE falha, o driver faz ROLLBACK
 *    automático: nenhum estado intermediário sobrevive.
 *
 * Por que o helper foi extraído da procedure tRPC: a lógica de
 * "validar → gravar FITID → atualizar entidade" precisa rodar em
 * transação e ser testável isoladamente. Inline na procedure ficava
 * impossível cobrir os 5 estados com testes diretos.
 */
export async function aplicarConciliacaoOFXMatch(params: {
  escritorioId: number;
  importadoPorUserId: number;
  fitid: string;
  tipo: "despesa" | "cobranca";
  entidadeId: number;
  valor: number;
  dataPagamento: string;
}): Promise<ResultadoConciliacaoOFXMatch> {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");

  if (params.tipo === "despesa") {
    const [d] = await db
      .select({ valor: despesas.valor })
      .from(despesas)
      .where(
        and(
          eq(despesas.id, params.entidadeId),
          eq(despesas.escritorioId, params.escritorioId),
        ),
      )
      .limit(1);
    if (!d) return { status: "entidade_nao_encontrada", tipo: "despesa" };

    try {
      await db.transaction(async (tx) => {
        await tx.insert(ofxImportacoesFitid).values({
          escritorioId: params.escritorioId,
          fitid: params.fitid,
          tipoEntidade: "despesa",
          entidadeId: params.entidadeId,
          valor: params.valor.toFixed(2),
          dataPagamento: params.dataPagamento,
          importadoPorUserId: params.importadoPorUserId,
        });
        await tx
          .update(despesas)
          .set({
            status: "pago",
            dataPagamento: params.dataPagamento,
            valorPago: d.valor,
          })
          .where(
            and(
              eq(despesas.id, params.entidadeId),
              eq(despesas.escritorioId, params.escritorioId),
            ),
          );
      });
      return { status: "aplicado_despesa" };
    } catch (txErr: any) {
      if (
        txErr.code === "ER_DUP_ENTRY" ||
        /Duplicate entry/i.test(txErr.message ?? "")
      ) {
        return { status: "ja_importada" };
      }
      throw txErr;
    }
  }

  const [c] = await db
    .select({ origem: asaasCobrancas.origem })
    .from(asaasCobrancas)
    .where(
      and(
        eq(asaasCobrancas.id, params.entidadeId),
        eq(asaasCobrancas.escritorioId, params.escritorioId),
      ),
    )
    .limit(1);
  if (!c) return { status: "entidade_nao_encontrada", tipo: "cobranca" };
  if (c.origem !== "manual") return { status: "cobranca_asaas_pulada" };

  try {
    await db.transaction(async (tx) => {
      await tx.insert(ofxImportacoesFitid).values({
        escritorioId: params.escritorioId,
        fitid: params.fitid,
        tipoEntidade: "cobranca",
        entidadeId: params.entidadeId,
        valor: params.valor.toFixed(2),
        dataPagamento: params.dataPagamento,
        importadoPorUserId: params.importadoPorUserId,
      });
      await tx
        .update(asaasCobrancas)
        .set({ status: "RECEIVED", dataPagamento: params.dataPagamento })
        .where(eq(asaasCobrancas.id, params.entidadeId));
    });
    return { status: "aplicado_cobranca" };
  } catch (txErr: any) {
    if (
      txErr.code === "ER_DUP_ENTRY" ||
      /Duplicate entry/i.test(txErr.message ?? "")
    ) {
      return { status: "ja_importada" };
    }
    throw txErr;
  }
}

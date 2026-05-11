/**
 * Despesas automáticas geradas pela integração com o Asaas.
 *
 * Quando uma cobrança é paga, o Asaas desconta uma taxa antes de creditar
 * o líquido na conta. Essa taxa não aparece em "Despesas" naturalmente —
 * vira só uma diferença entre `value` e `netValue` que o operador precisa
 * reconciliar mentalmente. Aqui automatizamos: a taxa vira uma despesa
 * "Taxa Asaas - {descrição da cobrança}" categorizada como "Taxas Asaas",
 * status='pago' (já foi descontada do crédito), data=data do pagamento.
 *
 * Idempotência:
 *  - UNIQUE INDEX (cobrancaOriginalId, origem) no DB impede duplicatas
 *    quando o webhook do Asaas retenta (PAYMENT_RECEIVED chegando 2-3×)
 *  - O caller (webhook) já tem `marcarEventoProcessado` como camada
 *    adicional, mas a UNIQUE é a proteção definitiva
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import {
  categoriasCobranca,
  categoriasDespesa,
  despesas,
} from "../../drizzle/schema";
import { createLogger } from "../_core/logger";

const log = createLogger("integracoes-asaas-despesas-auto");

const CATEGORIA_TAXAS_ASAAS_NOME = "Taxas Asaas";
const CATEGORIA_RECEITAS_ASAAS_NOME = "Serviços jurídicos";

/**
 * Retorna o id da categoria "Taxas Asaas" do escritório, criando se
 * não existir. Idempotente: chamadas concorrentes podem tentar criar
 * a mesma categoria — a UNIQUE(escritorioId, nome) garante 1 só
 * (segunda chamada cai no SELECT abaixo da tentativa de INSERT).
 */
export async function garantirCategoriaDespesaTaxasAsaas(
  escritorioId: number,
): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;

  const [existente] = await db
    .select({ id: categoriasDespesa.id })
    .from(categoriasDespesa)
    .where(
      and(
        eq(categoriasDespesa.escritorioId, escritorioId),
        eq(categoriasDespesa.nome, CATEGORIA_TAXAS_ASAAS_NOME),
      ),
    )
    .limit(1);

  if (existente) return existente.id;

  try {
    const [novo] = await db
      .insert(categoriasDespesa)
      .values({
        escritorioId,
        nome: CATEGORIA_TAXAS_ASAAS_NOME,
        ativo: true,
      })
      .$returningId();
    return novo?.id ?? null;
  } catch (err: any) {
    // Race com outra request — busca de novo
    const [retry] = await db
      .select({ id: categoriasDespesa.id })
      .from(categoriasDespesa)
      .where(
        and(
          eq(categoriasDespesa.escritorioId, escritorioId),
          eq(categoriasDespesa.nome, CATEGORIA_TAXAS_ASAAS_NOME),
        ),
      )
      .limit(1);
    if (retry) return retry.id;
    log.warn(
      { err: err.message, escritorioId },
      "[asaas-despesas-auto] falha ao criar categoria Taxas Asaas",
    );
    return null;
  }
}

/**
 * Categoria de cobrança default sugerida ao conectar o Asaas. Útil pra
 * cobranças vindas do passado/webhook que não têm categoria atribuída.
 * Não é obrigatória — só facilita o relatório.
 */
export async function garantirCategoriaCobrancaServicosAsaas(
  escritorioId: number,
): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;

  const [existente] = await db
    .select({ id: categoriasCobranca.id })
    .from(categoriasCobranca)
    .where(
      and(
        eq(categoriasCobranca.escritorioId, escritorioId),
        eq(categoriasCobranca.nome, CATEGORIA_RECEITAS_ASAAS_NOME),
      ),
    )
    .limit(1);

  if (existente) return existente.id;

  try {
    const [novo] = await db
      .insert(categoriasCobranca)
      .values({
        escritorioId,
        nome: CATEGORIA_RECEITAS_ASAAS_NOME,
        comissionavel: true,
        ativo: true,
      })
      .$returningId();
    return novo?.id ?? null;
  } catch {
    const [retry] = await db
      .select({ id: categoriasCobranca.id })
      .from(categoriasCobranca)
      .where(
        and(
          eq(categoriasCobranca.escritorioId, escritorioId),
          eq(categoriasCobranca.nome, CATEGORIA_RECEITAS_ASAAS_NOME),
        ),
      )
      .limit(1);
    return retry?.id ?? null;
  }
}

/**
 * Gera (idempotentemente) uma despesa "Taxa Asaas" pra uma cobrança paga.
 * Retorna `created=true` quando criou de fato, `false` quando já existia.
 *
 * Pré-condições:
 *  - `valor` e `valorLiquido` válidos (numéricos)
 *  - `valor > valorLiquido` (se taxa for 0 ou negativa, não cria)
 *  - `cobrancaOriginalId` é o id local em asaas_cobrancas (não o asaasPaymentId)
 *
 * Quem chama: o webhook do Asaas em PAYMENT_RECEIVED/CONFIRMED, depois do
 * upsert da cobrança local (precisa do id local).
 */
export async function gerarDespesaTaxaAsaas(params: {
  escritorioId: number;
  cobrancaOriginalId: number;
  valor: number;
  valorLiquido: number;
  dataPagamento: string;
  descricaoCobranca: string | null;
  /** userId que será gravado como "criou" — pra cron/webhook, passe 0
   *  ou o id do dono do escritório (system). */
  criadoPorUserId: number;
}): Promise<{ created: boolean; despesaId: number | null }> {
  const taxa = +(params.valor - params.valorLiquido).toFixed(2);
  if (!Number.isFinite(taxa) || taxa <= 0.0) {
    return { created: false, despesaId: null };
  }

  const db = await getDb();
  if (!db) return { created: false, despesaId: null };

  // Idempotência via UNIQUE INDEX (cobrancaOriginalId, origem). Tentamos
  // inserir; se já existe, capturamos o erro de duplicata e retornamos
  // `created=false` (não é uma falha — é o caso esperado em retries).
  const categoriaId = await garantirCategoriaDespesaTaxasAsaas(params.escritorioId);

  const descricao = params.descricaoCobranca
    ? `Taxa Asaas — ${params.descricaoCobranca}`.slice(0, 200)
    : `Taxa Asaas — cobrança #${params.cobrancaOriginalId}`;

  try {
    const [novo] = await db
      .insert(despesas)
      .values({
        escritorioId: params.escritorioId,
        categoriaId,
        descricao,
        valor: taxa.toFixed(2),
        valorPago: taxa.toFixed(2),
        vencimento: params.dataPagamento,
        dataPagamento: params.dataPagamento,
        status: "pago",
        recorrencia: "nenhuma",
        origem: "taxa_asaas",
        cobrancaOriginalId: params.cobrancaOriginalId,
        criadoPorUserId: params.criadoPorUserId,
      })
      .$returningId();
    log.info(
      { escritorioId: params.escritorioId, cobrancaOriginalId: params.cobrancaOriginalId, taxa },
      "[asaas-despesas-auto] despesa de taxa criada",
    );
    return { created: true, despesaId: novo?.id ?? null };
  } catch (err: any) {
    // ER_DUP_ENTRY (1062 MySQL) — UNIQUE bateu, despesa já existe
    if (err?.code === "ER_DUP_ENTRY" || /Duplicate entry/i.test(err?.message ?? "")) {
      return { created: false, despesaId: null };
    }
    log.warn(
      { err: err.message, cobrancaOriginalId: params.cobrancaOriginalId },
      "[asaas-despesas-auto] falha não-fatal ao criar despesa de taxa",
    );
    return { created: false, despesaId: null };
  }
}

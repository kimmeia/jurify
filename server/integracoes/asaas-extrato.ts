/**
 * Importação do extrato financeiro Asaas como despesas locais.
 *
 * O endpoint `GET /v3/financialTransactions` retorna o extrato bancário
 * completo da conta Asaas: cobranças recebidas, taxas, transferências
 * PIX/TED, notificações (SMS/WhatsApp/voz/e-mail), mensalidade, antecipações,
 * e tudo mais que afetar o saldo. Aqui processamos cada DÉBITO (value < 0)
 * como uma despesa local, categorizada conforme o `type` da movimentação.
 *
 * Crédito (value > 0) é skipado — o caminho de receita continua sendo o
 * webhook + sync histórico de cobranças (`asaas_cobrancas`). Importar
 * crédito aqui criaria dupla contagem.
 *
 * Idempotência: UNIQUE INDEX `(escritorioId, asaasFinTransId)` em
 * `despesas` impede duplicação em retries ou re-execução manual. Erro
 * `ER_DUP_ENTRY` é capturado como "já existe" — não conta como criação.
 *
 * Defesa contra type desconhecido: qualquer `type` que o Asaas adicionar
 * cai no catch-all "Outras movimentações Asaas". Admin pode recategorizar
 * manualmente na UI. Sem necessidade de deploy quando Asaas introduz tipo
 * novo.
 *
 * Rate limit: 1 GET paginado por janela. Rate guard do AsaasClient (PR
 * #247) cobre o resto.
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { categoriasDespesa, despesas } from "../../drizzle/schema";
import { createLogger } from "../_core/logger";
import type {
  AsaasClient,
  AsaasFinancialTransaction,
} from "./asaas-client";

const log = createLogger("asaas-extrato");

/**
 * Map de type da movimentação → nome de categoria de despesa local.
 * Tipos não listados aqui caem em "Outras movimentações Asaas" pra
 * sobreviver a novos tipos sem deploy.
 */
const TYPE_TO_CATEGORIA: Record<string, string> = {
  PAYMENT_FEE: "Taxas Asaas",
  REFUND_REQUEST_FEE: "Taxas Asaas",
  TRANSFER: "Transferências PIX/TED",
  TRANSFER_FEE: "Taxas de transferência Asaas",
  TRANSFER_REVERSAL_FEE: "Taxas de transferência Asaas",
  NOTIFICATION_FEE: "Notificações Asaas",
  PHONE_CALL_NOTIFICATION_FEE: "Notificações Asaas",
  SMS_NOTIFICATION_FEE: "Notificações Asaas",
  WHATSAPP_NOTIFICATION_FEE: "Notificações Asaas",
  EMAIL_NOTIFICATION_FEE: "Notificações Asaas",
  ANTICIPATION_FEE: "Antecipações Asaas",
  ASAAS_CARD_TRANSACTION: "Cartão Asaas",
  ASAAS_CARD_TRANSACTION_FEE: "Cartão Asaas",
  ASAAS_CARD_RECHARGE: "Cartão Asaas",
  CONTRACTUAL_EFFECT_SETTLEMENT_DEBIT: "Outras movimentações Asaas",
  BACEN_JUDICIAL_LOCK: "Bloqueio judicial",
  CUSTOMER_INTERNAL_TRANSFER: "Transferências internas Asaas",
};

const CATEGORIA_FALLBACK = "Outras movimentações Asaas";

/**
 * Tipos que SÃO créditos esperados — pulamos silenciosamente pra não
 * tentar tratar como despesa. Defesa adicional caso o Asaas devolva
 * `value > 0` em algum desses.
 */
const TYPES_CREDITO = new Set([
  "PAYMENT_RECEIVED",
  "PAYMENT_OVERDUE_RECEIVED",
  "PAYMENT_REVERSAL",
  "TRANSFER_REVERSAL",
  "REFUND_REQUEST_CANCELLED",
  "ASAAS_CARD_BALANCE_REFUND",
  "PROMOTIONAL_CODE_CREDIT",
  "CONTRACTUAL_EFFECT_SETTLEMENT_CREDIT",
  "BACEN_JUDICIAL_UNLOCK",
]);

export interface SincronizarExtratoResultado {
  totalProcessadas: number;
  novasDespesas: number;
  duplicadas: number;
  ignoradas: number;
  /** Movimentações que falharam ao salvar (não-fatal — segue processando). */
  erros: number;
  /** Tipos vistos e contagem, pra observabilidade de novos types do Asaas. */
  tiposVistos: Record<string, number>;
  /** Se a sync parou no meio (429 etc), true. Caller pode reagendar. */
  parcial: boolean;
}

interface CategoriaCache {
  [nome: string]: number;
}

async function obterOuCriarCategoria(
  escritorioId: number,
  nome: string,
  cache: CategoriaCache,
): Promise<number | null> {
  if (cache[nome] != null) return cache[nome];
  const db = await getDb();
  if (!db) return null;

  const [existente] = await db
    .select({ id: categoriasDespesa.id })
    .from(categoriasDespesa)
    .where(
      and(
        eq(categoriasDespesa.escritorioId, escritorioId),
        eq(categoriasDespesa.nome, nome),
      ),
    )
    .limit(1);

  if (existente) {
    cache[nome] = existente.id;
    return existente.id;
  }

  try {
    const [novo] = await db
      .insert(categoriasDespesa)
      .values({ escritorioId, nome, ativo: true })
      .$returningId();
    if (novo?.id != null) {
      cache[nome] = novo.id;
      return novo.id;
    }
  } catch {
    const [retry] = await db
      .select({ id: categoriasDespesa.id })
      .from(categoriasDespesa)
      .where(
        and(
          eq(categoriasDespesa.escritorioId, escritorioId),
          eq(categoriasDespesa.nome, nome),
        ),
      )
      .limit(1);
    if (retry) {
      cache[nome] = retry.id;
      return retry.id;
    }
  }
  return null;
}

export async function sincronizarExtratoAsaas(
  escritorioId: number,
  client: AsaasClient,
  params: {
    startDate?: string;
    finishDate?: string;
    /** ID do user pra registrar como "criou" (system/dono do escritório). */
    criadoPorUserId: number;
  },
): Promise<SincronizarExtratoResultado> {
  const db = await getDb();
  const resultado: SincronizarExtratoResultado = {
    totalProcessadas: 0,
    novasDespesas: 0,
    duplicadas: 0,
    ignoradas: 0,
    erros: 0,
    tiposVistos: {},
    parcial: false,
  };
  if (!db) return resultado;

  const categoriaCache: CategoriaCache = {};
  let offset = 0;
  const limit = 100;
  let hasMore = true;

  while (hasMore) {
    let pagina;
    try {
      pagina = await client.listarMovimentacoes({
        startDate: params.startDate,
        finishDate: params.finishDate,
        offset,
        limit,
      });
    } catch (err: any) {
      const status = err?.response?.status ?? err?.cause?.response?.status;
      log.warn(
        { escritorioId, offset, status, err: err.message },
        "[asaas-extrato] falha ao listar movimentações — pausando",
      );
      resultado.parcial = true;
      return resultado;
    }

    for (const mov of pagina.data) {
      resultado.totalProcessadas++;
      const tipo = mov.type || "UNKNOWN";
      resultado.tiposVistos[tipo] = (resultado.tiposVistos[tipo] ?? 0) + 1;

      // Skip créditos: não viram despesa
      if (mov.value > 0 || TYPES_CREDITO.has(tipo)) {
        resultado.ignoradas++;
        continue;
      }
      if (mov.value === 0) {
        resultado.ignoradas++;
        continue;
      }

      const created = await criarDespesaDeMovimentacao({
        escritorioId,
        mov,
        criadoPorUserId: params.criadoPorUserId,
        categoriaCache,
      });
      if (created === "novo") resultado.novasDespesas++;
      else if (created === "duplicado") resultado.duplicadas++;
      else resultado.erros++;
    }

    hasMore = pagina.hasMore;
    offset += pagina.limit;
  }

  log.info(
    {
      escritorioId,
      ...resultado,
    },
    "[asaas-extrato] sincronização concluída",
  );

  return resultado;
}

async function criarDespesaDeMovimentacao(opts: {
  escritorioId: number;
  mov: AsaasFinancialTransaction;
  criadoPorUserId: number;
  categoriaCache: CategoriaCache;
}): Promise<"novo" | "duplicado" | "erro"> {
  const db = await getDb();
  if (!db) return "erro";

  const { escritorioId, mov, criadoPorUserId, categoriaCache } = opts;
  const tipo = mov.type || "UNKNOWN";
  const categoriaNome = TYPE_TO_CATEGORIA[tipo] ?? CATEGORIA_FALLBACK;
  const categoriaId = await obterOuCriarCategoria(
    escritorioId,
    categoriaNome,
    categoriaCache,
  );

  const valorAbs = Math.abs(mov.value);
  const descricao = (mov.description?.trim() || tipo).slice(0, 200);

  try {
    await db.insert(despesas).values({
      escritorioId,
      categoriaId,
      descricao,
      valor: valorAbs.toFixed(2),
      valorPago: valorAbs.toFixed(2),
      vencimento: mov.date,
      dataPagamento: mov.date,
      status: "pago",
      recorrencia: "nenhuma",
      origem: "extrato_asaas",
      asaasFinTransId: mov.id,
      asaasFinTransType: tipo,
      criadoPorUserId,
    });
    return "novo";
  } catch (err: any) {
    if (err?.code === "ER_DUP_ENTRY" || /Duplicate entry/i.test(err?.message ?? "")) {
      return "duplicado";
    }
    log.warn(
      { escritorioId, asaasFinTransId: mov.id, type: tipo, err: err.message },
      "[asaas-extrato] falha não-fatal ao salvar despesa",
    );
    return "erro";
  }
}

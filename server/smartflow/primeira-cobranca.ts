/**
 * Helper: determina se um pagamento é a "primeira cobrança comissionável"
 * de um cliente OU de uma ação específica.
 *
 * Critério "comissionável" (cascata simplificada — alinhada com
 * `shared/calculo-comissao.ts:classificarCobranca`):
 *   • `comissionavelOverride === true`  → comissionável
 *   • `comissionavelOverride === false` → NÃO comissionável
 *   • `comissionavelOverride IS NULL`   → herda categoria
 *       - `categoria.comissionavel === false` → NÃO comissionável
 *       - resto → comissionável
 *
 * NÃO aplicamos `valorMinimoCobranca` aqui porque a regra de comissão
 * pode mudar com o tempo — o que era abaixo do mínimo ontem pode passar
 * hoje. Pra "primeira cobrança" usamos só atributos imutáveis do dado.
 *
 * Usado pelo dispatcher do SmartFlow pra preencher:
 *   - `primeiraCobrancaDoCliente`: nenhuma cobrança comissionável
 *     anterior do cliente foi paga (qualquer ação).
 *   - `primeiraCobrancaDaAcao`: quando há ação no contexto, nenhuma
 *     cobrança comissionável anterior dessa ação foi paga.
 *
 * "Anterior" = `dataPagamento < esta` OR (`dataPagamento = esta` AND `id < esta`).
 * O segundo termo desempata cobranças pagas no mesmo dia.
 */

import { and, eq, inArray, isNotNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  asaasCobrancas,
  categoriasCobranca,
  cobrancaAcoes,
} from "../../drizzle/schema";

const STATUS_PAGOS = ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"];

interface VerificarParams {
  escritorioId: number;
  contatoId: number;
  /** Se omitido, calcula só `doCliente`. Senão calcula ambos. */
  acaoId?: number | null;
  /** Cobrança ATUAL — usada como ponto de corte (excluída da contagem). */
  asaasPaymentIdAtual: string;
}

interface VerificarResult {
  /** True se NENHUMA cobrança comissionável anterior do cliente foi paga. */
  doCliente: boolean;
  /**
   * True se NENHUMA cobrança comissionável anterior DESTA ação foi paga.
   * `null` quando `acaoId` não foi informado (sem ação no contexto).
   */
  daAcao: boolean | null;
}

export async function verificarPrimeiraCobranca(
  params: VerificarParams,
): Promise<VerificarResult> {
  const db = await getDb();
  if (!db) return { doCliente: true, daAcao: params.acaoId ? true : null };

  // Busca a cobrança atual pra extrair `dataPagamento` (ponto de corte)
  // e `id` (desempate quando há outras pagas no mesmo dia).
  const [atual] = await db
    .select({
      id: asaasCobrancas.id,
      dataPagamento: asaasCobrancas.dataPagamento,
    })
    .from(asaasCobrancas)
    .where(
      and(
        eq(asaasCobrancas.escritorioId, params.escritorioId),
        eq(asaasCobrancas.asaasPaymentId, params.asaasPaymentIdAtual),
      ),
    )
    .limit(1);

  // Sem cobrança no banco (caso raro de webhook chegar antes do INSERT
  // local): assume primeiríssima — mais permissivo do que mais restrito.
  if (!atual || !atual.dataPagamento) {
    return { doCliente: true, daAcao: params.acaoId ? true : null };
  }

  const corteData = atual.dataPagamento;
  const corteId = atual.id;

  // Filtro "comissionável" reusado nas duas queries.
  // Drizzle não tem helper bonito pra OR aninhado; usamos `or()` puro.
  const filtroComissionavel = or(
    eq(asaasCobrancas.comissionavelOverride, true),
    and(
      // override !== false (NULL ou unset) E categoria não-bloqueante
      or(
        isNotNull(asaasCobrancas.comissionavelOverride), // pega TRUE (já filtrado acima vence) — sem isso queremos só NULL
        sql`${asaasCobrancas.comissionavelOverride} IS NULL`,
      ),
      // Categoria: NULL OU comissionavel=true
      or(
        sql`${categoriasCobranca.id} IS NULL`,
        eq(categoriasCobranca.comissionavel, true),
      ),
    ),
  );

  // Filtro "anterior": (data < corte) OR (data = corte AND id < corteId)
  const filtroAnterior = or(
    lt(asaasCobrancas.dataPagamento, corteData),
    and(
      eq(asaasCobrancas.dataPagamento, corteData),
      lt(asaasCobrancas.id, corteId),
    ),
  );

  const baseConds = [
    eq(asaasCobrancas.escritorioId, params.escritorioId),
    eq(asaasCobrancas.contatoId, params.contatoId),
    isNotNull(asaasCobrancas.dataPagamento),
    inArray(asaasCobrancas.status, STATUS_PAGOS),
    filtroAnterior,
    // Override !== false explícito (forma direta, sem o OR confuso acima)
    or(
      eq(asaasCobrancas.comissionavelOverride, true),
      sql`${asaasCobrancas.comissionavelOverride} IS NULL`,
    ),
    // Categoria não bloqueia (NULL ou comissionavel=true)
    or(
      sql`${categoriasCobranca.id} IS NULL`,
      eq(categoriasCobranca.comissionavel, true),
    ),
  ];

  // 1. Conta cobranças comissionáveis anteriores do CLIENTE (qualquer ação).
  const [{ qtd: qtdCliente }] = await db
    .select({ qtd: sql<number>`COUNT(*)` })
    .from(asaasCobrancas)
    .leftJoin(
      categoriasCobranca,
      eq(categoriasCobranca.id, asaasCobrancas.categoriaId),
    )
    .where(and(...baseConds));

  const doCliente = Number(qtdCliente) === 0;

  // 2. Se há ação no contexto, conta também restritas a essa ação
  //    (JOIN com cobranca_acoes pra filtrar).
  let daAcao: boolean | null = null;
  if (params.acaoId) {
    const [{ qtd: qtdAcao }] = await db
      .select({ qtd: sql<number>`COUNT(*)` })
      .from(asaasCobrancas)
      .innerJoin(
        cobrancaAcoes,
        and(
          eq(cobrancaAcoes.cobrancaId, asaasCobrancas.id),
          eq(cobrancaAcoes.processoId, params.acaoId),
        ),
      )
      .leftJoin(
        categoriasCobranca,
        eq(categoriasCobranca.id, asaasCobrancas.categoriaId),
      )
      .where(and(...baseConds));
    daAcao = Number(qtdAcao) === 0;
  }

  return { doCliente, daAcao };
}

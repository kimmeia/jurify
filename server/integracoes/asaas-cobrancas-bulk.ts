/**
 * Operações em massa sobre cobranças Asaas. Extraído da procedure tRPC
 * pra ser testável isoladamente — a procedure só faz auth + invoca o
 * helper, e o helper concentra a lógica de filtro/serialização/erro.
 *
 * Por que serializar:
 *   - Asaas tem rate limit por API key (12h de bloqueio quando estoura)
 *   - Antes, o frontend fazia `for (const c of ids) mut.mutate({id})`,
 *     disparando N requests HTTP paralelos pro backend → N chamadas
 *     simultâneas ao Asaas. 50 cobranças = risco real de bloqueio.
 *   - Aqui processamos 1 de cada vez. Quando o rate guard local lança
 *     RateLimitError (camadas 1-4 do AsaasRateGuard), o lote é abortado
 *     e o resumo parcial é devolvido pro frontend.
 */

import { and, eq, inArray } from "drizzle-orm";
import { asaasCobrancas } from "../../drizzle/schema";
import { RateLimitError } from "./asaas-rate-guard";
import type { AsaasClient } from "./asaas-client";

export interface ResultadoExclusaoEmMassa {
  excluidasAsaas: number;
  excluidasManual: number;
  ignoradas: number;
  erros: Array<{ id: number; mensagem: string }>;
  abortadoPorRateLimit: boolean;
  totalProcessadas: number;
}

/**
 * Executa exclusão sequencial de cobranças no escritório. Caller é
 * responsável pelas validações de permissão e por fornecer o `db` +
 * função de obter o `AsaasClient` (lazy — só carregado quando há
 * cobrança Asaas no lote).
 *
 * Comportamento:
 *  - Ignora cobranças com status != "PENDING" (sem erro, só contador)
 *  - Cobranças manuais (origem='manual' ou sem asaasPaymentId): só DB
 *  - Cobranças Asaas: chama API + remove DB
 *  - RateLimitError ou HTTP 429 → aborta o loop, devolve parcial
 *  - Outros erros: registra em `erros[]` e segue pra próxima
 */
export async function executarExclusaoCobrancasEmMassa(params: {
  db: any;
  escritorioId: number;
  ids: number[];
  getAsaasClient: () => Promise<AsaasClient>;
}): Promise<ResultadoExclusaoEmMassa> {
  const { db, escritorioId, ids, getAsaasClient } = params;

  const cobs = await db
    .select({
      id: asaasCobrancas.id,
      asaasPaymentId: asaasCobrancas.asaasPaymentId,
      origem: asaasCobrancas.origem,
      status: asaasCobrancas.status,
    })
    .from(asaasCobrancas)
    .where(
      and(
        inArray(asaasCobrancas.id, ids),
        eq(asaasCobrancas.escritorioId, escritorioId),
      ),
    );

  let excluidasAsaas = 0;
  let excluidasManual = 0;
  let ignoradas = 0;
  let abortadoPorRateLimit = false;
  const erros: Array<{ id: number; mensagem: string }> = [];

  let client: AsaasClient | null = null;
  const getClient = async (): Promise<AsaasClient> => {
    if (!client) client = await getAsaasClient();
    return client;
  };

  for (const cob of cobs) {
    if (cob.status !== "PENDING") {
      ignoradas++;
      continue;
    }

    try {
      if (cob.origem === "manual" || !cob.asaasPaymentId) {
        await db.delete(asaasCobrancas).where(eq(asaasCobrancas.id, cob.id));
        excluidasManual++;
      } else {
        const c = await getClient();
        await c.excluirCobranca(cob.asaasPaymentId);
        await db.delete(asaasCobrancas).where(eq(asaasCobrancas.id, cob.id));
        excluidasAsaas++;
      }
    } catch (err: any) {
      if (
        err instanceof RateLimitError ||
        err?.response?.status === 429 ||
        /429|rate.?limit/i.test(err?.message ?? "")
      ) {
        abortadoPorRateLimit = true;
        erros.push({
          id: cob.id,
          mensagem: "Rate limit Asaas atingido — pausando lote.",
        });
        break;
      }
      erros.push({ id: cob.id, mensagem: err?.message ?? String(err) });
    }
  }

  return {
    excluidasAsaas,
    excluidasManual,
    ignoradas,
    erros,
    abortadoPorRateLimit,
    totalProcessadas: excluidasAsaas + excluidasManual + ignoradas + erros.length,
  };
}

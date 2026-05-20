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
import { asaasCobrancas, comissoesFechadasItens } from "../../drizzle/schema";
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
 *  - Cobrança Asaas: só PENDING pode excluir (pago lá fora não cancela)
 *    → status != PENDING vai pra `ignoradas` (sem erro)
 *  - Cobrança manual: qualquer status pode excluir (incluindo RECEIVED).
 *    Lançamento manual feito por engano precisa poder ser desfeito.
 *  - Cobrança que já entrou em fechamento de comissão (qualquer origem):
 *    BLOQUEIA com erro claro — apagar quebraria a integridade do snapshot.
 *  - Cobranças Asaas chamam API + remove DB; manual só DB
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

  // Pré-check de fechamentos: quais cobranças do lote já viraram item
  // imutável em algum fechamento de comissão. Apagar a cobrança quebraria
  // o snapshot (item órfão apontando pra row inexistente). Bloqueamos com
  // erro descritivo — o operador precisa excluir o fechamento primeiro,
  // ou re-fechar com `forcarDuplicado` depois de ajustar.
  let idsBloqueadosPorFechamento = new Set<number>();
  if (cobs.length > 0) {
    const cobIds = cobs.map((c: any) => c.id);
    const itensComissao = await db
      .select({ asaasCobrancaId: comissoesFechadasItens.asaasCobrancaId })
      .from(comissoesFechadasItens)
      .where(inArray(comissoesFechadasItens.asaasCobrancaId, cobIds));
    idsBloqueadosPorFechamento = new Set(
      itensComissao.map((i: any) => i.asaasCobrancaId),
    );
  }

  let client: AsaasClient | null = null;
  const getClient = async (): Promise<AsaasClient> => {
    if (!client) client = await getAsaasClient();
    return client;
  };

  const ehManual = (cob: { origem: string; asaasPaymentId: string | null }) =>
    cob.origem === "manual" || !cob.asaasPaymentId;

  for (const cob of cobs) {
    // Cobrança em fechamento de comissão: bloqueia (qualquer origem).
    // Mensagem aponta o caminho: "exclua o fechamento e tente de novo".
    if (idsBloqueadosPorFechamento.has(cob.id)) {
      erros.push({
        id: cob.id,
        mensagem:
          "Esta cobrança já entrou em um fechamento de comissão. Exclua o fechamento (aba Comissões → Histórico) antes de remover a cobrança.",
      });
      continue;
    }

    // Cobrança Asaas só pode ser excluída em PENDING (pago lá fora não
    // cancela). Manual pode ser excluída em qualquer status — lançamento
    // por engano precisa poder ser desfeito.
    if (!ehManual(cob) && cob.status !== "PENDING") {
      ignoradas++;
      continue;
    }

    try {
      if (ehManual(cob)) {
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

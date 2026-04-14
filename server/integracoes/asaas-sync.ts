/**
 * Asaas Sync Service — Sincronização automática de cobranças.
 *
 * Funções reutilizáveis para sync de cobranças por escritório.
 * Usadas tanto pelo endpoint manual (protectedProcedure) quanto pelo cron job.
 *
 * Fluxo:
 * 1. Para cada escritório com Asaas conectado
 * 2. Para cada cliente vinculado (asaas_clientes)
 * 3. Puxa cobranças do Asaas (GET /payments?customer=X)
 * 4. Upsert local: cria novas, atualiza status das existentes
 */

import { getDb } from "../db";
import { asaasConfig, asaasClientes, asaasCobrancas, contatos } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { decrypt } from "../escritorio/crypto-utils";
import { AsaasClient } from "./asaas-client";
import { createLogger } from "../_core/logger";
const log = createLogger("integracoes-asaas-sync");

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

async function getAsaasClientForEscritorio(escritorioId: number): Promise<AsaasClient | null> {
  const db = await getDb();
  if (!db) return null;

  const [cfg] = await db.select().from(asaasConfig)
    .where(and(eq(asaasConfig.escritorioId, escritorioId), eq(asaasConfig.status, "conectado")))
    .limit(1);

  if (!cfg?.apiKeyEncrypted || !cfg?.apiKeyIv || !cfg?.apiKeyTag) return null;

  try {
    const apiKey = decrypt(cfg.apiKeyEncrypted, cfg.apiKeyIv, cfg.apiKeyTag);
    return new AsaasClient(apiKey, cfg.modo as any);
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SYNC DE COBRANÇAS POR CLIENTE VINCULADO
// ═══════════════════════════════════════════════════════════════════════════════

export type SyncCobrancasStats = {
  novas: number;        // Cobranças criadas localmente (não existiam)
  atualizadas: number;  // Mudança real de status/data de pagamento
  removidas: number;    // Deletadas localmente (apagadas/órfãs no Asaas)
};

/**
 * Soma duas stats — útil para agregar resultados de múltiplos clientes.
 */
export function somarStats(a: SyncCobrancasStats, b: SyncCobrancasStats): SyncCobrancasStats {
  return {
    novas: a.novas + b.novas,
    atualizadas: a.atualizadas + b.atualizadas,
    removidas: a.removidas + b.removidas,
  };
}

/**
 * Sincroniza cobranças de UM cliente vinculado.
 * Retorna contadores discriminados — permite ao caller saber o que mudou de verdade.
 */
export async function syncCobrancasDeCliente(
  client: AsaasClient,
  escritorioId: number,
  contatoId: number,
  asaasCustomerId: string
): Promise<SyncCobrancasStats> {
  const db = await getDb();
  const zero: SyncCobrancasStats = { novas: 0, atualizadas: 0, removidas: 0 };
  if (!db) return zero;

  const stats: SyncCobrancasStats = { novas: 0, atualizadas: 0, removidas: 0 };
  let offset = 0;
  let hasMore = true;
  const idsAsaas = new Set<string>(); // Track all IDs from Asaas

  while (hasMore) {
    const res = await client.listarCobrancas({ customer: asaasCustomerId, limit: 100, offset });

    for (const cob of res.data) {
      // Se deletada no Asaas, remover localmente
      if (cob.deleted) {
        const [local] = await db.select({ id: asaasCobrancas.id }).from(asaasCobrancas)
          .where(eq(asaasCobrancas.asaasPaymentId, cob.id)).limit(1);
        if (local) {
          await db.delete(asaasCobrancas).where(eq(asaasCobrancas.id, local.id));
          stats.removidas++;
          log.info(`[Asaas Sync] Cobrança ${cob.id} deletada localmente (excluida no Asaas)`);
        }
        continue;
      }

      idsAsaas.add(cob.id);

      const [local] = await db.select().from(asaasCobrancas)
        .where(eq(asaasCobrancas.asaasPaymentId, cob.id)).limit(1);

      if (local) {
        // Normaliza datas de pagamento (API pode retornar "" / undefined; DB guarda null)
        const localDataPag = local.dataPagamento || null;
        const remotaDataPag = cob.paymentDate || null;
        const mudouStatus = local.status !== cob.status;
        const mudouDataPag = localDataPag !== remotaDataPag;

        if (mudouStatus || mudouDataPag) {
          await db.update(asaasCobrancas).set({
            status: cob.status,
            dataPagamento: remotaDataPag,
            valorLiquido: cob.netValue?.toString() || null,
          }).where(eq(asaasCobrancas.id, local.id));
          stats.atualizadas++;
        }
      } else {
        await db.insert(asaasCobrancas).values({
          escritorioId,
          contatoId,
          asaasPaymentId: cob.id,
          asaasCustomerId,
          valor: cob.value.toString(),
          valorLiquido: cob.netValue?.toString() || null,
          vencimento: cob.dueDate,
          formaPagamento: (cob.billingType as any) || "UNDEFINED",
          status: cob.status,
          descricao: cob.description || null,
          invoiceUrl: cob.invoiceUrl,
          bankSlipUrl: cob.bankSlipUrl || null,
          dataPagamento: cob.paymentDate || null,
        });
        stats.novas++;
      }
    }

    hasMore = res.hasMore;
    offset += res.limit;
  }

  // Remover cobranças locais que não existem mais no Asaas (orfãs)
  // SEMPRE executar, mesmo se idsAsaas estiver vazio (caso todas as cobranças foram deletadas)
  const locais = await db.select({ id: asaasCobrancas.id, asaasPaymentId: asaasCobrancas.asaasPaymentId })
    .from(asaasCobrancas)
    .where(and(eq(asaasCobrancas.escritorioId, escritorioId), eq(asaasCobrancas.asaasCustomerId, asaasCustomerId)));

  for (const local of locais) {
    if (!idsAsaas.has(local.asaasPaymentId)) {
      await db.delete(asaasCobrancas).where(eq(asaasCobrancas.id, local.id));
      stats.removidas++;
      log.info(`[Asaas Sync] Cobrança órfã ${local.asaasPaymentId} removida (não existe mais no Asaas)`);
    }
  }

  return stats;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SYNC COMPLETO POR ESCRITÓRIO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sincroniza TODAS as cobranças de TODOS os clientes vinculados de um escritório.
 * Retorna contadores discriminados para o caller exibir um toast preciso.
 */
export async function syncCobrancasEscritorio(
  escritorioId: number,
): Promise<{ clientes: number } & SyncCobrancasStats> {
  const zero = { clientes: 0, novas: 0, atualizadas: 0, removidas: 0 };
  const client = await getAsaasClientForEscritorio(escritorioId);
  if (!client) return zero;

  const db = await getDb();
  if (!db) return zero;

  const vinculos = await db.select().from(asaasClientes)
    .where(eq(asaasClientes.escritorioId, escritorioId));

  let totais: SyncCobrancasStats = { novas: 0, atualizadas: 0, removidas: 0 };

  for (const vinculo of vinculos) {
    try {
      const s = await syncCobrancasDeCliente(
        client,
        escritorioId,
        vinculo.contatoId,
        vinculo.asaasCustomerId,
      );
      totais = somarStats(totais, s);
    } catch (err: any) {
      log.warn(`[Asaas Sync] Erro ao sincronizar cobranças de ${vinculo.asaasCustomerId}: ${err.message}`);
    }
  }

  // Atualizar saldo
  try {
    const saldo = await client.obterSaldo();
    await db.update(asaasConfig)
      .set({ saldo: saldo.balance.toString(), ultimoTeste: new Date() })
      .where(eq(asaasConfig.escritorioId, escritorioId));
  } catch {}

  return { clientes: vinculos.length, ...totais };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SYNC DE TODOS OS ESCRITÓRIOS (chamado pelo cron)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sincroniza cobranças de TODOS os escritórios conectados ao Asaas.
 * Chamado pelo cron job a cada 10 minutos.
 */
export async function syncTodosEscritorios(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const escritorios = await db.select({ escritorioId: asaasConfig.escritorioId })
    .from(asaasConfig)
    .where(eq(asaasConfig.status, "conectado"));

  if (escritorios.length === 0) return;

  log.info(`[Asaas Sync] Iniciando sync de ${escritorios.length} escritório(s)...`);

  for (const { escritorioId } of escritorios) {
    try {
      const result = await syncCobrancasEscritorio(escritorioId);
      const total = result.novas + result.atualizadas + result.removidas;
      if (total > 0) {
        log.info(
          `[Asaas Sync] Escritório ${escritorioId}: ${result.novas} novas, ${result.atualizadas} atualizadas, ${result.removidas} removidas`,
        );
      }
    } catch (err: any) {
      log.warn(`[Asaas Sync] Erro no escritório ${escritorioId}: ${err.message}`);
    }
  }
}

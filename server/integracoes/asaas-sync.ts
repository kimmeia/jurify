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

/**
 * Sincroniza cobranças de UM cliente vinculado.
 * Retorna quantidade de cobranças criadas/atualizadas.
 */
export async function syncCobrancasDeCliente(
  client: AsaasClient,
  escritorioId: number,
  contatoId: number,
  asaasCustomerId: string
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  let atualizadas = 0;
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
          atualizadas++;
          log.info(`[Asaas Sync] Cobrança ${cob.id} deletada localmente (excluida no Asaas)`);
        }
        continue;
      }

      idsAsaas.add(cob.id);

      const [local] = await db.select().from(asaasCobrancas)
        .where(eq(asaasCobrancas.asaasPaymentId, cob.id)).limit(1);

      if (local) {
        if (local.status !== cob.status || local.dataPagamento !== (cob.paymentDate || null)) {
          await db.update(asaasCobrancas).set({
            status: cob.status,
            dataPagamento: cob.paymentDate || null,
            valorLiquido: cob.netValue?.toString() || null,
          }).where(eq(asaasCobrancas.id, local.id));
          atualizadas++;
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
        atualizadas++;
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
      atualizadas++;
      log.info(`[Asaas Sync] Cobrança órfã ${local.asaasPaymentId} removida (não existe mais no Asaas)`);
    }
  }

  return atualizadas;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SYNC COMPLETO POR ESCRITÓRIO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sincroniza TODAS as cobranças de TODOS os clientes vinculados de um escritório.
 */
export async function syncCobrancasEscritorio(escritorioId: number): Promise<{ clientes: number; cobrancas: number }> {
  const client = await getAsaasClientForEscritorio(escritorioId);
  if (!client) return { clientes: 0, cobrancas: 0 };

  const db = await getDb();
  if (!db) return { clientes: 0, cobrancas: 0 };

  const vinculos = await db.select().from(asaasClientes)
    .where(eq(asaasClientes.escritorioId, escritorioId));

  let totalCobrancas = 0;

  for (const vinculo of vinculos) {
    try {
      const qty = await syncCobrancasDeCliente(client, escritorioId, vinculo.contatoId, vinculo.asaasCustomerId);
      totalCobrancas += qty;
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

  return { clientes: vinculos.length, cobrancas: totalCobrancas };
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
      if (result.cobrancas > 0) {
        log.info(`[Asaas Sync] Escritório ${escritorioId}: ${result.cobrancas} cobranças sincronizadas`);
      }
    } catch (err: any) {
      log.warn(`[Asaas Sync] Erro no escritório ${escritorioId}: ${err.message}`);
    }
  }
}

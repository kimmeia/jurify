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
import { eq, and, inArray, isNull, ne, or } from "drizzle-orm";
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
        const remotaNetValue = cob.netValue?.toString() || null;
        const mudouStatus = local.status !== cob.status;
        const mudouDataPag = localDataPag !== remotaDataPag;
        const mudouNetValue = (local.valorLiquido || null) !== remotaNetValue;
        // Reconcilia vínculo: cobrança pode ter sido criada órfã (via webhook
        // antes do vínculo) ou associada ao contato antigo (quando o primário
        // do Asaas muda). Aqui reatribuímos contatoId/asaasCustomerId ao caller.
        const mudouContato = local.contatoId !== contatoId;
        const mudouCustomer = local.asaasCustomerId !== asaasCustomerId;

        if (mudouStatus || mudouDataPag || mudouNetValue || mudouContato || mudouCustomer) {
          const setObj: Record<string, unknown> = {
            status: cob.status,
            dataPagamento: remotaDataPag,
            valorLiquido: remotaNetValue,
          };
          if (mudouContato) setObj.contatoId = contatoId;
          if (mudouCustomer) setObj.asaasCustomerId = asaasCustomerId;
          await db.update(asaasCobrancas).set(setObj).where(eq(asaasCobrancas.id, local.id));
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

/**
 * Sincroniza cobranças de TODOS os customers Asaas vinculados a um
 * contato do CRM. Um contato pode ter múltiplos vínculos (duplicatas do
 * Asaas com mesmo CPF) — aqui iteramos sobre todos para consolidar o
 * histórico financeiro num lugar só.
 */
export async function syncTodasCobrancasDoContato(
  client: AsaasClient,
  escritorioId: number,
  contatoId: number,
): Promise<SyncCobrancasStats> {
  const db = await getDb();
  const zero: SyncCobrancasStats = { novas: 0, atualizadas: 0, removidas: 0 };
  if (!db) return zero;

  const vinculos = await db.select({
    asaasCustomerId: asaasClientes.asaasCustomerId,
  }).from(asaasClientes)
    .where(and(
      eq(asaasClientes.contatoId, contatoId),
      eq(asaasClientes.escritorioId, escritorioId),
    ));

  // Adoção bulk: cobranças que entraram no banco sem contatoId (via webhook
  // antes do vínculo) ou apontando para outro contato do mesmo asaasCustomerId
  // são reatribuídas ao contato atual. O sync por-cliente abaixo também
  // reconcilia linha a linha, mas este passo único garante a adoção mesmo
  // quando o pagamento no Asaas não mudou (status/data iguais → o loop
  // interno não disparia UPDATE).
  if (vinculos.length > 0) {
    const customerIds = vinculos.map((v) => v.asaasCustomerId);
    await db
      .update(asaasCobrancas)
      .set({ contatoId })
      .where(
        and(
          eq(asaasCobrancas.escritorioId, escritorioId),
          inArray(asaasCobrancas.asaasCustomerId, customerIds),
          or(isNull(asaasCobrancas.contatoId), ne(asaasCobrancas.contatoId, contatoId)),
        ),
      );
  }

  let totais: SyncCobrancasStats = { novas: 0, atualizadas: 0, removidas: 0 };
  for (const v of vinculos) {
    try {
      const s = await syncCobrancasDeCliente(client, escritorioId, contatoId, v.asaasCustomerId);
      totais = somarStats(totais, s);
    } catch (err: any) {
      log.warn(
        { err: err.message, contatoId, asaasCustomerId: v.asaasCustomerId },
        "[Asaas Sync] Erro ao sincronizar um dos customers vinculados — prossegue com os demais",
      );
    }
  }
  return totais;
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
// AGREGAÇÃO N:1 — vários asaas_clientes por contato do CRM
// ═══════════════════════════════════════════════════════════════════════════════

export type VinculoLinha = {
  id: number;
  contatoId: number;
  asaasCustomerId: string;
  cpfCnpj: string | null;
  nome: string | null;
  primario: boolean | null;
};

export type CobrancaAgg = {
  asaasCustomerId: string;
  valor: string;
  status: string;
};

export type ContatoMeta = {
  nome: string;
  telefone: string | null;
  email: string | null;
};

export type ClienteAgregado = {
  /** ID do vínculo primário (compatibilidade com o frontend que usa como key). */
  id: number;
  contatoId: number;
  /** Todos os asaasCustomerIds vinculados a este contato (N:1 do Asaas). */
  asaasCustomerIds: string[];
  /** ID do primário — usado pelo frontend e para criar novas cobranças. */
  asaasCustomerId: string;
  cpfCnpj: string;
  nome: string;
  contatoNome: string;
  contatoTelefone: string | null;
  contatoEmail: string | null;
  totalCobrancas: number;
  pendente: number;
  vencido: number;
  pago: number;
};

/**
 * Agrupa múltiplos vínculos do mesmo contato em UM item. O Asaas permite
 * cadastros duplicados com o mesmo CPF (ids diferentes) e o CRM referência
 * todos como secundários. A tela de Clientes agrega tudo sob o contato do
 * CRM; as cobranças de cada customer secundário entram no agregado.
 *
 * Escolha do "primário" na saída (para usar como id na UI e como alvo
 * padrão ao criar cobranças): o marcado com `primario=true` se houver;
 * caso contrário, o vínculo mais antigo (menor id) por estabilidade.
 */
export function agregarVinculosPorContato(
  vinculos: VinculoLinha[],
  cobrancas: CobrancaAgg[],
  contatosMeta: Record<number, ContatoMeta>,
): ClienteAgregado[] {
  const porContato = new Map<number, VinculoLinha[]>();
  for (const v of vinculos) {
    const arr = porContato.get(v.contatoId);
    if (arr) arr.push(v);
    else porContato.set(v.contatoId, [v]);
  }

  const result: ClienteAgregado[] = [];
  for (const [contatoId, vs] of porContato) {
    const primario =
      vs.find((v) => v.primario === true) ??
      vs.slice().sort((a, b) => a.id - b.id)[0];
    const asaasCustomerIds = vs.map((v) => v.asaasCustomerId);
    const setIds = new Set(asaasCustomerIds);

    let pendente = 0;
    let vencido = 0;
    let pago = 0;
    let total = 0;
    for (const c of cobrancas) {
      if (!setIds.has(c.asaasCustomerId)) continue;
      total++;
      const val = parseFloat(c.valor) || 0;
      if (c.status === "PENDING") pendente += val;
      else if (c.status === "OVERDUE") vencido += val;
      else if (c.status === "RECEIVED" || c.status === "CONFIRMED" || c.status === "RECEIVED_IN_CASH") pago += val;
    }

    const meta = contatosMeta[contatoId];
    const nomeResolvido = primario.nome ?? "";
    result.push({
      id: primario.id,
      contatoId,
      asaasCustomerIds,
      asaasCustomerId: primario.asaasCustomerId,
      cpfCnpj: primario.cpfCnpj || "",
      nome: nomeResolvido,
      contatoNome: meta?.nome ?? nomeResolvido,
      contatoTelefone: meta?.telefone ?? null,
      contatoEmail: meta?.email ?? null,
      totalCobrancas: total,
      pendente,
      vencido,
      pago,
    });
  }

  return result;
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

/**
 * Router Admin — Judit (Créditos, Monitoramentos, Transações)
 *
 * Visibilidade completa em tempo real para o admin sobre:
 * - Créditos por escritório (saldo, comprado, consumido)
 * - Transações (compra/consumo/bonus/estorno)
 * - Monitoramentos ativos de todos os usuários
 * - Credenciais e status de validação
 * - Alertas de saldo baixo
 * - Cobranças mensais do cron
 */

import { z } from "zod";
import { eq, desc, sql, lt, and, or, like } from "drizzle-orm";
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  juditCreditos,
  juditTransacoes,
  juditMonitoramentos,
  juditCredenciais,
  escritorios,
  users,
} from "../../drizzle/schema";

export const adminJuditRouter = router({
  /**
   * KPIs gerais — números de alto nível atualizados em tempo real.
   */
  kpis: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return null;

    // Créditos totais vendidos e consumidos
    const [credTotals] = await db
      .select({
        totalSaldo: sql<number>`COALESCE(SUM(${juditCreditos.saldo}), 0)`,
        totalComprado: sql<number>`COALESCE(SUM(${juditCreditos.totalComprado}), 0)`,
        totalConsumido: sql<number>`COALESCE(SUM(${juditCreditos.totalConsumido}), 0)`,
        totalEscritorios: sql<number>`COUNT(*)`,
      })
      .from(juditCreditos);

    // Monitoramentos por status
    const monStats = await db
      .select({
        status: juditMonitoramentos.statusJudit,
        count: sql<number>`COUNT(*)`,
      })
      .from(juditMonitoramentos)
      .groupBy(juditMonitoramentos.statusJudit);

    const monByStatus: Record<string, number> = {};
    for (const row of monStats) monByStatus[row.status] = Number(row.count);

    // Escritórios com saldo baixo (< 10 créditos)
    const [lowBalance] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(juditCreditos)
      .where(lt(juditCreditos.saldo, 10));

    // Transações últimas 24h
    const ontem = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [txRecentes] = await db
      .select({
        count: sql<number>`COUNT(*)`,
        totalConsumo: sql<number>`COALESCE(SUM(CASE WHEN ${juditTransacoes.tipo} = 'consumo' THEN ${juditTransacoes.quantidade} ELSE 0 END), 0)`,
        totalCompra: sql<number>`COALESCE(SUM(CASE WHEN ${juditTransacoes.tipo} = 'compra' THEN ${juditTransacoes.quantidade} ELSE 0 END), 0)`,
      })
      .from(juditTransacoes)
      .where(sql`${juditTransacoes.createdAt} >= ${ontem}`);

    // Credenciais por status
    const credStats = await db
      .select({
        status: juditCredenciais.status,
        count: sql<number>`COUNT(*)`,
      })
      .from(juditCredenciais)
      .groupBy(juditCredenciais.status);

    const credByStatus: Record<string, number> = {};
    for (const row of credStats) credByStatus[row.status] = Number(row.count);

    return {
      creditos: {
        saldoTotal: Number(credTotals?.totalSaldo || 0),
        totalComprado: Number(credTotals?.totalComprado || 0),
        totalConsumido: Number(credTotals?.totalConsumido || 0),
        escritoriosComCredito: Number(credTotals?.totalEscritorios || 0),
        escritoriosSaldoBaixo: Number(lowBalance?.count || 0),
      },
      monitoramentos: {
        ativos: (monByStatus.created || 0) + (monByStatus.updating || 0) + (monByStatus.updated || 0),
        pausados: monByStatus.paused || 0,
        deletados: monByStatus.deleted || 0,
        total: Object.values(monByStatus).reduce((a, b) => a + b, 0),
      },
      ultimas24h: {
        transacoes: Number(txRecentes?.count || 0),
        creditosConsumidos: Number(txRecentes?.totalConsumo || 0),
        creditosComprados: Number(txRecentes?.totalCompra || 0),
      },
      credenciais: {
        ativas: credByStatus.ativa || 0,
        validando: credByStatus.validando || 0,
        erro: credByStatus.erro || 0,
        total: Object.values(credByStatus).reduce((a, b) => a + b, 0),
      },
    };
  }),

  /**
   * Créditos por escritório — saldo atual de cada escritório.
   */
  creditosPorEscritorio: adminProcedure
    .input(z.object({ limite: z.number().min(1).max(200).optional() }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];

      const rows = await db
        .select({
          id: juditCreditos.id,
          escritorioId: juditCreditos.escritorioId,
          saldo: juditCreditos.saldo,
          totalComprado: juditCreditos.totalComprado,
          totalConsumido: juditCreditos.totalConsumido,
          updatedAt: juditCreditos.updatedAt,
          escritorioNome: escritorios.nome,
        })
        .from(juditCreditos)
        .leftJoin(escritorios, eq(escritorios.id, juditCreditos.escritorioId))
        .orderBy(desc(juditCreditos.updatedAt))
        .limit(input?.limite || 100);

      return rows;
    }),

  /**
   * Escritórios com saldo baixo — alerta para ação proativa.
   */
  alertasSaldoBaixo: adminProcedure
    .input(z.object({ limiar: z.number().optional() }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const limiar = input?.limiar || 10;

      return db
        .select({
          escritorioId: juditCreditos.escritorioId,
          saldo: juditCreditos.saldo,
          totalConsumido: juditCreditos.totalConsumido,
          escritorioNome: escritorios.nome,
        })
        .from(juditCreditos)
        .leftJoin(escritorios, eq(escritorios.id, juditCreditos.escritorioId))
        .where(lt(juditCreditos.saldo, limiar))
        .orderBy(juditCreditos.saldo);
    }),

  /**
   * Log de transações — todas as movimentações de crédito.
   */
  transacoes: adminProcedure
    .input(z.object({
      limite: z.number().min(1).max(500).optional(),
      tipo: z.enum(["compra", "consumo", "bonus", "estorno"]).optional(),
      escritorioId: z.number().optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];

      const conditions: any[] = [];
      if (input?.tipo) conditions.push(eq(juditTransacoes.tipo, input.tipo));
      if (input?.escritorioId) conditions.push(eq(juditTransacoes.escritorioId, input.escritorioId));

      const rows = await db
        .select({
          id: juditTransacoes.id,
          escritorioId: juditTransacoes.escritorioId,
          tipo: juditTransacoes.tipo,
          quantidade: juditTransacoes.quantidade,
          saldoAnterior: juditTransacoes.saldoAnterior,
          saldoDepois: juditTransacoes.saldoDepois,
          operacao: juditTransacoes.operacao,
          detalhes: juditTransacoes.detalhes,
          userId: juditTransacoes.userId,
          createdAt: juditTransacoes.createdAt,
          escritorioNome: escritorios.nome,
        })
        .from(juditTransacoes)
        .leftJoin(escritorios, eq(escritorios.id, juditTransacoes.escritorioId))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(juditTransacoes.createdAt))
        .limit(input?.limite || 100);

      return rows;
    }),

  /**
   * Todos os monitoramentos — visão admin cross-tenant.
   */
  monitoramentos: adminProcedure
    .input(z.object({
      limite: z.number().min(1).max(200).optional(),
      status: z.string().optional(),
      tipo: z.enum(["movimentacoes", "novas_acoes"]).optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];

      const conditions: any[] = [];
      if (input?.status) conditions.push(eq(juditMonitoramentos.statusJudit, input.status as any));
      if (input?.tipo) conditions.push(eq(juditMonitoramentos.tipoMonitoramento, input.tipo));

      return db
        .select({
          id: juditMonitoramentos.id,
          searchType: juditMonitoramentos.searchType,
          searchKey: juditMonitoramentos.searchKey,
          tipoMonitoramento: juditMonitoramentos.tipoMonitoramento,
          statusJudit: juditMonitoramentos.statusJudit,
          apelido: juditMonitoramentos.apelido,
          clienteUserId: juditMonitoramentos.clienteUserId,
          totalAtualizacoes: juditMonitoramentos.totalAtualizacoes,
          ultimaCobrancaMensal: juditMonitoramentos.ultimaCobrancaMensal,
          createdAt: juditMonitoramentos.createdAt,
          updatedAt: juditMonitoramentos.updatedAt,
        })
        .from(juditMonitoramentos)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(juditMonitoramentos.updatedAt))
        .limit(input?.limite || 100);
    }),

  /**
   * Credenciais — todas as credenciais cadastradas por todos os escritórios.
   */
  credenciais: adminProcedure
    .input(z.object({ status: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];

      const conditions: any[] = [];
      if (input?.status) conditions.push(eq(juditCredenciais.status, input.status as any));

      return db
        .select({
          id: juditCredenciais.id,
          escritorioId: juditCredenciais.escritorioId,
          customerKey: juditCredenciais.customerKey,
          systemName: juditCredenciais.systemName,
          username: juditCredenciais.username,
          status: juditCredenciais.status,
          mensagemErro: juditCredenciais.mensagemErro,
          createdAt: juditCredenciais.createdAt,
          escritorioNome: escritorios.nome,
        })
        .from(juditCredenciais)
        .leftJoin(escritorios, eq(escritorios.id, juditCredenciais.escritorioId))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(juditCredenciais.createdAt))
        .limit(100);
    }),
});

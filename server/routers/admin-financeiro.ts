/**
 * Router de Financeiro Admin — gestão da cobrança SaaS Jurify.
 *
 * Diferente do financeiro do cliente (escritório cobrando seus clientes),
 * este módulo é o Jurify cobrando os escritórios assinantes. Usa a API
 * key admin do Asaas (via getAdminAsaasClient) pra operar.
 *
 * Operações:
 *   - Visão consolidada: MRR, receita 30d, pendentes, vencidos
 *   - Listar pagamentos (com filtro de status)
 *   - Listar assinaturas (com join de usuário local)
 *   - Cancelar pagamento / assinatura
 *   - Cash flow mensal
 */

import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { users, subscriptions as subsTable } from "../../drizzle/schema";
import { getAdminAsaasClient, isAsaasBillingConfigured } from "../billing/asaas-billing-client";
import { registrarAuditoria } from "../_core/audit";
import { createLogger } from "../_core/logger";

const log = createLogger("admin-financeiro");

/**
 * Cria um helper que retorna o client Asaas admin, OU throwe erro
 * amigável se não configurado. Usado em todo endpoint deste router.
 */
async function getClient() {
  const ok = await isAsaasBillingConfigured();
  if (!ok) {
    throw new Error(
      "Asaas admin não configurado. Configure em /admin/integrations antes de usar o módulo financeiro.",
    );
  }
  return getAdminAsaasClient();
}

export const adminFinanceiroRouter = router({
  /** Status da integração + saldo atual */
  status: adminProcedure.query(async () => {
    const ok = await isAsaasBillingConfigured();
    if (!ok) return { conectado: false, saldo: 0, modo: "sandbox" as const };

    try {
      const client = await getAdminAsaasClient();
      const saldo = await client.obterSaldo();
      return {
        conectado: true,
        saldo: saldo.balance,
        modo: client.modo,
      };
    } catch (err: any) {
      log.error({ err: err.message }, "Falha ao buscar saldo Asaas");
      return { conectado: true, saldo: 0, modo: "sandbox" as const };
    }
  }),

  /**
   * KPIs do financeiro: MRR, receita nos últimos 30 dias, pagamentos
   * pendentes (soma de value), pagamentos vencidos (soma), contagem de
   * assinaturas ativas.
   */
  kpis: adminProcedure.query(async () => {
    const client = await getClient();

    // Paginado: antes pegava `limit: 100` (primeira página apenas), o
    // que zerava MRR/receita30d quando Jurify cresceu além de 100
    // assinaturas ou 100 cobranças recentes. Agora itera todas as
    // páginas (cap em 100 páginas × 100 itens = 10k registros).
    const cobs = await client.listarTodasCobrancasPaginado();
    const subs = await client.listarTodasAssinaturasPaginado();

    const agora = Date.now();
    const trinta = agora - 30 * 24 * 60 * 60 * 1000;

    let receita30d = 0;
    let pendente = 0;
    let vencido = 0;
    let pago30d = 0;

    for (const c of cobs) {
      if (c.deleted) continue;
      const d = c.paymentDate
        ? new Date(c.paymentDate).getTime()
        : new Date(c.dateCreated).getTime();

      if (c.status === "PENDING") pendente += c.value;
      if (c.status === "OVERDUE") vencido += c.value;
      if (
        (c.status === "RECEIVED" ||
          c.status === "CONFIRMED" ||
          c.status === "RECEIVED_IN_CASH") &&
        d >= trinta
      ) {
        receita30d += c.value;
        pago30d += 1;
      }
    }

    // MRR = soma das assinaturas ACTIVE
    const mrr = subs
      .filter((s) => s.status === "ACTIVE" && !s.deleted)
      .reduce((sum, s) => {
        // Normaliza ciclos não-mensais pra base mensal
        const mensal =
          s.cycle === "MONTHLY" ? s.value :
          s.cycle === "YEARLY" ? s.value / 12 :
          s.cycle === "SEMIANNUALLY" ? s.value / 6 :
          s.cycle === "QUARTERLY" ? s.value / 3 :
          s.cycle === "BIMONTHLY" ? s.value / 2 :
          s.cycle === "WEEKLY" ? s.value * 4.33 :
          s.cycle === "BIWEEKLY" ? s.value * 2.17 :
          s.value;
        return sum + mensal;
      }, 0);

    return {
      mrr: Math.round(mrr * 100), // centavos
      receita30d: Math.round(receita30d * 100),
      pendente: Math.round(pendente * 100),
      vencido: Math.round(vencido * 100),
      pago30d,
      assinaturasAtivas: subs.filter((s) => s.status === "ACTIVE" && !s.deleted).length,
    };
  }),

  /**
   * Lista pagamentos (cobranças) do Asaas admin, com filtros.
   * Enriquece com nome do escritório quando possível.
   */
  listarPagamentos: adminProcedure
    .input(z.object({
      status: z.enum(["PENDING", "RECEIVED", "CONFIRMED", "OVERDUE", "REFUNDED"]).optional(),
      limit: z.number().min(1).max(200).default(100),
    }).optional())
    .query(async ({ input }) => {
      const client = await getClient();
      const params = input || { limit: 100 };
      const cobs = await client.listarCobrancas({
        status: params.status as any,
        limit: params.limit,
      });

      // Enriquecer com dados do user Jurify via externalReference ou customerId
      const db = await getDb();
      let userMap = new Map<string, { id: number; name: string | null; email: string | null }>();
      if (db) {
        const allUsers = await db
          .select({ id: users.id, name: users.name, email: users.email, asaasCustomerId: users.asaasCustomerId })
          .from(users);
        for (const u of allUsers) {
          if (u.asaasCustomerId) {
            userMap.set(u.asaasCustomerId, { id: u.id, name: u.name, email: u.email });
          }
        }
      }

      return cobs.data
        .filter((c) => !c.deleted)
        .map((c) => {
          const userInfo = userMap.get(c.customer);
          return {
            id: c.id,
            customerId: c.customer,
            userName: userInfo?.name ?? null,
            userEmail: userInfo?.email ?? null,
            userId: userInfo?.id ?? null,
            status: c.status,
            value: c.value,
            netValue: c.netValue,
            billingType: c.billingType,
            dueDate: c.dueDate,
            paymentDate: c.paymentDate ?? null,
            dateCreated: c.dateCreated,
            description: c.description ?? null,
            invoiceUrl: c.invoiceUrl,
            externalReference: c.externalReference ?? null,
          };
        });
    }),

  /**
   * Lista assinaturas do Asaas admin com join dos dados locais do user
   */
  listarAssinaturas: adminProcedure.query(async () => {
    const client = await getClient();
    const subs = await client.listarAssinaturas({ limit: 100 });

    const db = await getDb();
    let userMap = new Map<string, { id: number; name: string | null; email: string | null }>();
    if (db) {
      const allUsers = await db
        .select({ id: users.id, name: users.name, email: users.email, asaasCustomerId: users.asaasCustomerId })
        .from(users);
      for (const u of allUsers) {
        if (u.asaasCustomerId) {
          userMap.set(u.asaasCustomerId, { id: u.id, name: u.name, email: u.email });
        }
      }
    }

    return subs.data
      .filter((s) => !s.deleted)
      .map((s) => {
        const userInfo = userMap.get(s.customer);
        return {
          id: s.id,
          customerId: s.customer,
          userName: userInfo?.name ?? null,
          userEmail: userInfo?.email ?? null,
          userId: userInfo?.id ?? null,
          status: s.status,
          value: s.value,
          cycle: s.cycle,
          nextDueDate: s.nextDueDate,
          description: s.description ?? null,
          billingType: s.billingType,
          externalReference: s.externalReference ?? null,
        };
      });
  }),

  /**
   * Cash flow mensal: receita (paga), pendente e vencida por mês,
   * últimos N meses.
   */
  cashFlowMensal: adminProcedure
    .input(z.object({ meses: z.number().min(1).max(24).default(6) }))
    .query(async ({ input }) => {
      const client = await getClient();
      // Paginado: antes pegava `limit: 200` e perdia meses inteiros
      // quando Jurify acumulava muitos pagamentos no período.
      const cobs = await client.listarTodasCobrancasPaginado();

      // Inicializa meses com zero
      const meses: Record<string, { mes: string; recebido: number; pendente: number; vencido: number }> = {};
      for (let i = input.meses - 1; i >= 0; i--) {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        meses[key] = { mes: key, recebido: 0, pendente: 0, vencido: 0 };
      }

      for (const c of cobs) {
        if (c.deleted) continue;
        // Data relevante: paymentDate se paga, senão dueDate
        const dateStr =
          c.paymentDate ||
          (c.status === "PENDING" || c.status === "OVERDUE" ? c.dueDate : c.dateCreated);
        const d = new Date(dateStr);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        if (!(key in meses)) continue;

        if (c.status === "RECEIVED" || c.status === "CONFIRMED" || c.status === "RECEIVED_IN_CASH") {
          meses[key].recebido += c.value;
        } else if (c.status === "PENDING") {
          meses[key].pendente += c.value;
        } else if (c.status === "OVERDUE") {
          meses[key].vencido += c.value;
        }
      }

      return Object.values(meses);
    }),

  /**
   * Cancela (deleta) uma cobrança específica no Asaas. Auditado.
   */
  cancelarPagamento: adminProcedure
    .input(z.object({
      paymentId: z.string(),
      motivo: z.string().min(3).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      const client = await getClient();

      // Buscar detalhes antes de excluir (pra auditar)
      let detalhes: Record<string, unknown> = { motivo: input.motivo };
      try {
        const cob = await client.buscarCobranca(input.paymentId);
        detalhes = {
          motivo: input.motivo,
          valor: cob.value,
          status: cob.status,
          customer: cob.customer,
        };
      } catch (err) {
        log.warn({ err: String(err) }, "Falha ao buscar cobrança antes de cancelar");
      }

      await client.excluirCobranca(input.paymentId);

      await registrarAuditoria({
        ctx,
        acao: "financeiro.cancelarPagamento",
        alvoTipo: "payment",
        alvoNome: input.paymentId,
        detalhes,
      });

      return { success: true, mensagem: "Cobrança cancelada" };
    }),

  /**
   * Cancela uma assinatura no Asaas + marca local como canceled.
   * Atalho do admin.cancelarAssinaturaAdmin mas via asaasSubId em vez
   * do id local.
   */
  cancelarAssinaturaPorAsaasId: adminProcedure
    .input(z.object({
      asaasSubscriptionId: z.string(),
      motivo: z.string().min(3).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      const client = await getClient();
      await client.cancelarAssinatura(input.asaasSubscriptionId);

      // Marcar local se existir
      const db = await getDb();
      if (db) {
        await db
          .update(subsTable)
          .set({ status: "canceled" })
          .where(eq(subsTable.asaasSubscriptionId, input.asaasSubscriptionId));
      }

      await registrarAuditoria({
        ctx,
        acao: "financeiro.cancelarAssinatura",
        alvoTipo: "subscription",
        alvoNome: input.asaasSubscriptionId,
        detalhes: { motivo: input.motivo },
      });

      return { success: true, mensagem: "Assinatura cancelada" };
    }),
});

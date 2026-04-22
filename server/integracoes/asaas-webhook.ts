/**
 * Webhook Asaas — Recebe eventos em tempo real (cobranças + clientes).
 *
 * O Asaas envia um POST com header `asaas-access-token` que deve
 * bater com o webhookToken do escritório.
 *
 * Eventos tratados:
 * COBRANÇAS:
 * - PAYMENT_CREATED → cria registro local
 * - PAYMENT_UPDATED → atualiza registro local
 * - PAYMENT_RECEIVED / PAYMENT_CONFIRMED → marca como pago
 * - PAYMENT_OVERDUE → marca como vencido
 * - PAYMENT_REFUNDED → marca como estornado
 * - PAYMENT_DELETED → remove registro local
 * - PAYMENT_RESTORED → cria/atualiza registro
 *
 * CLIENTES:
 * - CUSTOMER_CREATED → cria contato no CRM + vínculo
 * - CUSTOMER_UPDATED → atualiza dados do contato
 * - CUSTOMER_DELETED → remove vínculo (mantém contato no CRM)
 */

import type { Express, Request, Response } from "express";
import { getDb } from "../db";
import { asaasConfig, asaasCobrancas, asaasClientes, contatos } from "../../drizzle/schema";
import { eq, and, or, like } from "drizzle-orm";
import { createLogger } from "../_core/logger";
import { normalizePhoneBR } from "../../shared/whatsapp-types";
const log = createLogger("integracoes-asaas-webhook");

/**
 * Extrai o telefone do payload do Asaas e normaliza — garante DDI 55
 * em números BR sem DDI. NÃO mexe no 9º dígito: essa ambiguidade é
 * resolvida no envio por `resolverJidWhatsApp`, que consulta o servidor
 * do WhatsApp. Assim, sincronizar o Asaas não quebra mensagens pra
 * contatos cujo número só existe no padrão antigo (8 dígitos).
 */
function telefoneDoAsaas(customer: { phone?: string; mobilePhone?: string }): string | null {
  const raw = customer.mobilePhone || customer.phone;
  if (!raw) return null;
  const normalizado = normalizePhoneBR(raw);
  return normalizado || null;
}

interface AsaasWebhookPayload {
  event: string;
  payment?: {
    id: string;
    customer: string;
    billingType: string;
    value: number;
    netValue: number;
    status: string;
    dueDate: string;
    paymentDate?: string;
    description?: string;
    invoiceUrl?: string;
    bankSlipUrl?: string;
    externalReference?: string;
    deleted?: boolean;
  };
  customer?: {
    id: string;
    name: string;
    cpfCnpj?: string;
    email?: string;
    phone?: string;
    mobilePhone?: string;
    deleted?: boolean;
  };
}

export function registerAsaasWebhook(app: Express) {
  app.post("/api/webhooks/asaas", async (req: Request, res: Response) => {
    try {
      const accessToken = req.headers["asaas-access-token"] as string;
      const body = req.body as AsaasWebhookPayload;

      if (!body || !body.event) {
        return res.status(400).json({ error: "Payload inválido" });
      }

      if (!accessToken) {
        return res.status(401).json({ error: "Token ausente" });
      }

      const db = await getDb();
      if (!db) return res.status(500).json({ error: "Database indisponível" });

      // Identificar o escritório pelo webhookToken
      const [cfg] = await db.select().from(asaasConfig)
        .where(eq(asaasConfig.webhookToken, accessToken))
        .limit(1);

      if (!cfg) {
        log.warn(`[Asaas Webhook] Token não reconhecido: ${accessToken.slice(0, 8)}...`);
        return res.status(401).json({ error: "Token inválido" });
      }

      const escritorioId = cfg.escritorioId;

      // ─── EVENTOS DE COBRANÇA ─────────────────────────────────────────
      if (body.event.startsWith("PAYMENT_") && body.payment) {
        const payment = body.payment;
        log.info(`[Asaas Webhook] Escritório ${escritorioId} | ${body.event} | Payment: ${payment.id} | Status: ${payment.status}`);

        const [local] = await db.select().from(asaasCobrancas)
          .where(and(
            eq(asaasCobrancas.asaasPaymentId, payment.id),
            eq(asaasCobrancas.escritorioId, escritorioId)
          ))
          .limit(1);

        if (body.event === "PAYMENT_DELETED" || payment.deleted) {
          if (local) {
            await db.delete(asaasCobrancas).where(eq(asaasCobrancas.id, local.id));
            log.info(`[Asaas Webhook] Cobrança ${payment.id} DELETADA localmente`);
          }
        } else if (local) {
          // Atualizar registro existente
          await db.update(asaasCobrancas).set({
            status: payment.status,
            valor: payment.value.toString(),
            valorLiquido: payment.netValue?.toString() || local.valorLiquido,
            vencimento: payment.dueDate,
            dataPagamento: payment.paymentDate || local.dataPagamento,
            descricao: payment.description || local.descricao,
            invoiceUrl: payment.invoiceUrl || local.invoiceUrl,
            bankSlipUrl: payment.bankSlipUrl || local.bankSlipUrl,
          }).where(eq(asaasCobrancas.id, local.id));
        } else {
          // Criar novo registro (PAYMENT_CREATED, PAYMENT_RECEIVED, PAYMENT_RESTORED, etc)
          const [vinculo] = await db.select().from(asaasClientes)
            .where(and(
              eq(asaasClientes.asaasCustomerId, payment.customer),
              eq(asaasClientes.escritorioId, escritorioId)
            ))
            .limit(1);

          await db.insert(asaasCobrancas).values({
            escritorioId,
            contatoId: vinculo?.contatoId || null,
            asaasPaymentId: payment.id,
            asaasCustomerId: payment.customer,
            valor: payment.value.toString(),
            valorLiquido: payment.netValue?.toString() || null,
            vencimento: payment.dueDate,
            formaPagamento: (payment.billingType as any) || "UNDEFINED",
            status: payment.status,
            descricao: payment.description || null,
            invoiceUrl: payment.invoiceUrl || null,
            bankSlipUrl: payment.bankSlipUrl || null,
            dataPagamento: payment.paymentDate || null,
            externalReference: payment.externalReference || null,
          });
          log.info(`[Asaas Webhook] Cobrança ${payment.id} CRIADA localmente`);
        }

        // SmartFlow: disparar cenário "pagamento_recebido" se pagamento confirmado
        if (payment.status === "RECEIVED" || payment.status === "CONFIRMED" || payment.status === "RECEIVED_IN_CASH") {
          try {
            const { dispararPagamentoRecebido } = await import("../smartflow/dispatcher");
            await dispararPagamentoRecebido(escritorioId, {
              pagamentoId: payment.id,
              valor: Math.round((payment.value || 0) * 100),
              descricao: payment.description || `Pagamento ${payment.id}`,
              tipo: payment.billingType || "UNDEFINED",
              assinaturaId: (payment as any).subscription || undefined,
              clienteNome: payment.customer ? undefined : undefined, // Asaas não envia nome aqui
              clienteAsaasId: payment.customer,
            });
          } catch (err: any) {
            log.warn({ err: err.message }, "[Asaas Webhook] SmartFlow pagamento_recebido falhou (não bloqueia)");
          }
        }

        // SmartFlow: disparar cenário "pagamento_vencido" no PAYMENT_OVERDUE
        if (body.event === "PAYMENT_OVERDUE" || payment.status === "OVERDUE") {
          try {
            const { dispararPagamentoVencido } = await import("../smartflow/dispatcher");
            const [vinculo2] = await db.select().from(asaasClientes)
              .where(and(
                eq(asaasClientes.asaasCustomerId, payment.customer),
                eq(asaasClientes.escritorioId, escritorioId)
              )).limit(1);
            await dispararPagamentoVencido(escritorioId, {
              pagamentoId: payment.id,
              valor: Math.round((payment.value || 0) * 100),
              descricao: payment.description || `Cobrança ${payment.id}`,
              vencimento: payment.dueDate,
              clienteAsaasId: payment.customer,
              clienteNome: vinculo2?.nome || undefined,
              contatoId: vinculo2?.contatoId || undefined,
            });
          } catch (err: any) {
            log.warn({ err: err.message }, "[Asaas Webhook] SmartFlow pagamento_vencido falhou (não bloqueia)");
          }
        }
      }

      // ─── EVENTOS DE CLIENTE ──────────────────────────────────────────
      else if (body.event.startsWith("CUSTOMER_") && body.customer) {
        const customer = body.customer;
        log.info(`[Asaas Webhook] Escritório ${escritorioId} | ${body.event} | Customer: ${customer.id}`);

        const [vincLocal] = await db.select().from(asaasClientes)
          .where(and(
            eq(asaasClientes.asaasCustomerId, customer.id),
            eq(asaasClientes.escritorioId, escritorioId)
          ))
          .limit(1);

        if (body.event === "CUSTOMER_DELETED" || customer.deleted) {
          if (vincLocal) {
            await db.delete(asaasClientes).where(eq(asaasClientes.id, vincLocal.id));
            log.info(`[Asaas Webhook] Cliente ${customer.id} DELETADO localmente`);
          }
        } else if (body.event === "CUSTOMER_CREATED") {
          if (!vincLocal) {
            const cpfLimpo = (customer.cpfCnpj || "").replace(/\D/g, "");
            // Procurar contato existente por CPF/CNPJ
            let contatoId: number | null = null;
            if (cpfLimpo) {
              const [contato] = await db.select().from(contatos)
                .where(and(
                  eq(contatos.escritorioId, escritorioId),
                  or(eq(contatos.cpfCnpj, cpfLimpo), like(contatos.cpfCnpj, `%${cpfLimpo}%`))
                )).limit(1);
              contatoId = contato?.id || null;
            }

            if (contatoId) {
              // Contato existe — ATUALIZAR dados com os novos do Asaas (nome novo)
              await db.update(contatos).set({
                nome: customer.name,
                cpfCnpj: cpfLimpo || null,
                email: customer.email || null,
                telefone: telefoneDoAsaas(customer),
              }).where(eq(contatos.id, contatoId));

              // Remover vínculos antigos para este contato (de Asaas customers anteriores)
              await db.delete(asaasClientes).where(and(
                eq(asaasClientes.escritorioId, escritorioId),
                eq(asaasClientes.contatoId, contatoId)
              ));
            } else {
              // Criar contato novo no CRM
              const [novo] = await db.insert(contatos).values({
                escritorioId,
                nome: customer.name,
                cpfCnpj: cpfLimpo || null,
                email: customer.email || null,
                telefone: telefoneDoAsaas(customer),
                origem: "manual",
              }).$returningId();
              contatoId = novo.id;
            }

            await db.insert(asaasClientes).values({
              escritorioId,
              contatoId,
              asaasCustomerId: customer.id,
              cpfCnpj: cpfLimpo,
              nome: customer.name,
            });
            log.info(`[Asaas Webhook] Cliente ${customer.id} CRIADO localmente (contato ${contatoId})`);
          }
        } else if (body.event === "CUSTOMER_UPDATED") {
          if (vincLocal) {
            const cpfLimpo = (customer.cpfCnpj || "").replace(/\D/g, "");
            await db.update(contatos).set({
              nome: customer.name,
              cpfCnpj: cpfLimpo || null,
              email: customer.email || null,
              telefone: customer.mobilePhone || customer.phone || null,
            }).where(eq(contatos.id, vincLocal.contatoId));

            await db.update(asaasClientes).set({
              nome: customer.name,
              cpfCnpj: cpfLimpo,
            }).where(eq(asaasClientes.id, vincLocal.id));
            log.info(`[Asaas Webhook] Cliente ${customer.id} ATUALIZADO localmente`);
          }
        }
      }

      return res.status(200).json({ received: true });
    } catch (err: any) {
      log.error("[Asaas Webhook] Erro:", err.message, err.stack);
      return res.status(500).json({ error: "Erro interno" });
    }
  });
}

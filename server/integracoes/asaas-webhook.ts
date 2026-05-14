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
import { asaasConfig, asaasCobrancas, asaasClientes, asaasConfigCobrancaPai, contatos, escritorios } from "../../drizzle/schema";
import { eq, and, or, like } from "drizzle-orm";
import { createLogger } from "../_core/logger";
import { marcarEventoProcessado } from "./asaas-idempotency";
import { inferirAtendentePorCobranca } from "../escritorio/db-financeiro";
import { extrairDataPagamento, inserirVinculoAsaasIdempotente } from "./asaas-sync";
import { gerarDespesaTaxaAsaas } from "./asaas-despesas-auto";
import { dataHojeBR } from "../../shared/escritorio-types";
const log = createLogger("integracoes-asaas-webhook");

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
    /** Data informada pelo cliente como "quando pagou" — usado no
     *  RECEIVED_IN_CASH e como fallback informativo. */
    clientPaymentDate?: string;
    /** Data de confirmação (CONFIRMED) — preenchido antes do crédito
     *  cair em conta. Usado como fallback de "data do pagamento". */
    confirmedDate?: string;
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

        if (body.event === "PAYMENT_DELETED" || payment.deleted) {
          await db.delete(asaasCobrancas).where(and(
            eq(asaasCobrancas.asaasPaymentId, payment.id),
            eq(asaasCobrancas.escritorioId, escritorioId),
          ));
          log.info(`[Asaas Webhook] Cobrança ${payment.id} DELETADA localmente (ou nada a fazer)`);
        } else {
          // Upsert idempotente: retry do Asaas não cria duplicata. A constraint
          // UNIQUE(escritorioId, asaasPaymentId) protege o banco e permite que
          // o mesmo POST chegando 2× produza no máximo 1 linha.
          const [vinculo] = await db.select().from(asaasClientes)
            .where(and(
              eq(asaasClientes.asaasCustomerId, payment.customer),
              eq(asaasClientes.escritorioId, escritorioId)
            ))
            .limit(1);

          // Inferência de atendente: só usada no INSERT inicial. Em UPDATE
          // não tocamos no atendenteId — atribuição manual via bulk-edit
          // sempre vence retries do Asaas.
          const atendenteInferido = await inferirAtendentePorCobranca(
            escritorioId,
            payment.externalReference || null,
            vinculo?.contatoId ?? null,
          );

          // Config-pai (parcelamento/assinatura): se a cobrança veio de
          // um pai com config persistida no `criarParcelamento`/
          // `criarAssinatura`, sobrescreve atendente/categoria/override.
          // Não-fatal: se a tabela não existe ou query falha, segue
          // pelo path padrão.
          const parentId =
            (payment as any).installment ||
            (payment as any).subscription ||
            null;
          let configPai: {
            atendenteId: number | null;
            categoriaId: number | null;
            comissionavelOverride: boolean | null;
          } | null = null;
          if (parentId) {
            try {
              const [linha] = await db
                .select({
                  atendenteId: asaasConfigCobrancaPai.atendenteId,
                  categoriaId: asaasConfigCobrancaPai.categoriaId,
                  comissionavelOverride: asaasConfigCobrancaPai.comissionavelOverride,
                })
                .from(asaasConfigCobrancaPai)
                .where(
                  and(
                    eq(asaasConfigCobrancaPai.escritorioId, escritorioId),
                    eq(asaasConfigCobrancaPai.asaasParentId, parentId),
                  ),
                )
                .limit(1);
              if (linha) configPai = linha;
            } catch (err: any) {
              log.warn(
                { err: err.message, parentId },
                "[Asaas Webhook] falha ao ler config-pai, seguindo com path padrão",
              );
            }
          }

          await db
            .insert(asaasCobrancas)
            .values({
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
              dataPagamento: extrairDataPagamento(payment),
              externalReference: payment.externalReference || null,
              // Config-pai vence inferência (operador escolheu explicitamente
              // no momento de criar parcelamento/assinatura).
              atendenteId: configPai?.atendenteId ?? atendenteInferido,
              categoriaId: configPai?.categoriaId ?? null,
              comissionavelOverride: configPai?.comissionavelOverride ?? null,
            })
            .onDuplicateKeyUpdate({
              set: {
                status: payment.status,
                valor: payment.value.toString(),
                valorLiquido: payment.netValue?.toString() || null,
                vencimento: payment.dueDate,
                dataPagamento: extrairDataPagamento(payment),
                descricao: payment.description || null,
                invoiceUrl: payment.invoiceUrl || null,
                bankSlipUrl: payment.bankSlipUrl || null,
                formaPagamento: (payment.billingType as any) || "UNDEFINED",
                externalReference: payment.externalReference || null,
                // Se a cobrança já existia órfã (criada por outro caminho
                // sem vínculo), adota o contato do vínculo atual.
                ...(vinculo?.contatoId ? { contatoId: vinculo.contatoId } : {}),
              },
            });
          log.info(`[Asaas Webhook] Cobrança ${payment.id} upsert aplicado`);
        }

        // SmartFlow: disparar cenário "pagamento_recebido" se pagamento confirmado.
        // Guardado por `marcarEventoProcessado` para retries do Asaas (mesmo
        // event+paymentId chegando 2-3 vezes) não gerarem WhatsApp/e-mail
        // duplicado pro cliente.
        if (payment.status === "RECEIVED" || payment.status === "CONFIRMED" || payment.status === "RECEIVED_IN_CASH") {
          const primeiraVez = await marcarEventoProcessado(escritorioId, payment.id, "PAYMENT_RECEIVED");
          if (primeiraVez) {
            // Invalida cache de saldo: pagamento confirmado provavelmente
            // mudou o saldo no Asaas. Próxima leitura de `obterSaldo`
            // vai detectar cache stale e refetchar.
            try {
              await db
                .update(asaasConfig)
                .set({ saldoAtualizadoEm: null })
                .where(eq(asaasConfig.escritorioId, escritorioId));
            } catch (err: any) {
              log.warn({ err: err.message }, "[Asaas Webhook] falha ao invalidar cache de saldo (não bloqueia)");
            }

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

            // Despesa automática de taxa Asaas (valor - netValue).
            // Idempotência: além do `primeiraVez` acima, o helper usa
            // UNIQUE INDEX (cobrancaOriginalId, origem) como defesa final.
            // Falha aqui é não-fatal: cobrança principal já foi gravada.
            try {
              const taxaPositiva =
                typeof payment.netValue === "number" &&
                typeof payment.value === "number" &&
                payment.value > payment.netValue;
              if (taxaPositiva) {
                const [cobLocal] = await db
                  .select({ id: asaasCobrancas.id })
                  .from(asaasCobrancas)
                  .where(and(
                    eq(asaasCobrancas.escritorioId, escritorioId),
                    eq(asaasCobrancas.asaasPaymentId, payment.id),
                  ))
                  .limit(1);
                const [esc] = await db
                  .select({ ownerId: escritorios.ownerId })
                  .from(escritorios)
                  .where(eq(escritorios.id, escritorioId))
                  .limit(1);
                if (cobLocal && esc) {
                  await gerarDespesaTaxaAsaas({
                    escritorioId,
                    cobrancaOriginalId: cobLocal.id,
                    valor: payment.value,
                    valorLiquido: payment.netValue,
                    dataPagamento:
                      extrairDataPagamento(payment) ?? dataHojeBR(),
                    descricaoCobranca: payment.description ?? null,
                    criadoPorUserId: esc.ownerId,
                  });
                }
              }
            } catch (err: any) {
              log.warn(
                { err: err.message, paymentId: payment.id },
                "[Asaas Webhook] gerarDespesaTaxaAsaas falhou (não bloqueia)",
              );
            }
          }
        }

        // SmartFlow: disparar cenário "pagamento_vencido" no PAYMENT_OVERDUE.
        // Mesma proteção de idempotência.
        if (body.event === "PAYMENT_OVERDUE" || payment.status === "OVERDUE") {
          const primeiraVez = await marcarEventoProcessado(escritorioId, payment.id, "PAYMENT_OVERDUE");
          if (primeiraVez) {
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
              // Contato existe — ATUALIZAR dados com os novos do Asaas (nome novo).
              // NÃO deletamos vínculos antigos: Asaas permite duplicatas de customer
              // com o mesmo CPF, e o CRM referência todos no mesmo contato (N:1).
              await db.update(contatos).set({
                nome: customer.name,
                cpfCnpj: cpfLimpo || null,
                email: customer.email || null,
                telefone: customer.mobilePhone || customer.phone || null,
              }).where(eq(contatos.id, contatoId));
            } else {
              // Criar contato novo no CRM. Origem "asaas" pra deixar
              // claro que veio da sincronização (não foi cadastro manual).
              const [novo] = await db.insert(contatos).values({
                escritorioId,
                nome: customer.name,
                cpfCnpj: cpfLimpo || null,
                email: customer.email || null,
                telefone: customer.mobilePhone || customer.phone || null,
                origem: "asaas",
              }).$returningId();
              contatoId = novo.id;
            }

            await inserirVinculoAsaasIdempotente({
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

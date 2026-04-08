/**
 * Asaas Billing — cliente de pagamento para a mensalidade do SaaS Jurify.
 *
 * Este módulo é a "ponta admin" do Asaas. Enquanto cada escritório usa
 * o Asaas para cobrar SEUS clientes (router-asaas), aqui o Jurify usa
 * o Asaas para cobrar OS PRÓPRIOS escritórios (assinatura SaaS).
 *
 * A API key fica em `admin_integracoes` (provedor = "asaas"), criptografada
 * com a mesma chave AES da aplicação.
 *
 * SEPARAÇÃO IMPORTANTE:
 *   - asaasClient (para escritórios)         → server/integracoes/asaas-client.ts
 *   - asaasBillingClient (para o Jurify SaaS) → este arquivo
 *   - Tabelas: subscriptions (SaaS) ≠ asaas_cobrancas (escritórios)
 */

import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { adminIntegracoes } from "../../drizzle/schema";
import { decrypt } from "../escritorio/crypto-utils";
import { AsaasClient } from "../integracoes/asaas-client";
import { createLogger } from "../_core/logger";

const log = createLogger("billing-asaas");

/**
 * Carrega a API key admin do Asaas (criptografada em admin_integracoes)
 * e retorna um cliente pronto pra usar.
 *
 * @throws Error se a integração não estiver configurada/conectada
 */
export async function getAdminAsaasClient(): Promise<AsaasClient> {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");

  const [reg] = await db
    .select()
    .from(adminIntegracoes)
    .where(eq(adminIntegracoes.provedor, "asaas"))
    .limit(1);

  if (!reg || !reg.apiKeyEncrypted || !reg.apiKeyIv || !reg.apiKeyTag) {
    throw new Error(
      "Asaas não configurado. O administrador precisa adicionar a API key do Asaas em /admin/integrations.",
    );
  }

  if (reg.status !== "conectado") {
    throw new Error(
      `Integração Asaas com status "${reg.status}". Verifique no painel admin.`,
    );
  }

  const apiKey = decrypt(reg.apiKeyEncrypted, reg.apiKeyIv, reg.apiKeyTag);
  return new AsaasClient(apiKey);
}

/**
 * Verifica se o Asaas está configurado, sem lançar exceção.
 * Útil para health-check / decidir se mostra fluxo de assinatura.
 */
export async function isAsaasBillingConfigured(): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return false;
    const [reg] = await db
      .select()
      .from(adminIntegracoes)
      .where(eq(adminIntegracoes.provedor, "asaas"))
      .limit(1);
    return !!(
      reg &&
      reg.apiKeyEncrypted &&
      reg.apiKeyIv &&
      reg.apiKeyTag &&
      reg.status === "conectado"
    );
  } catch (err) {
    log.warn({ err: String(err) }, "isAsaasBillingConfigured falhou");
    return false;
  }
}

/**
 * Retorna o webhookSecret do registro asaas (gerado no salvar inicial).
 * O Asaas envia este token no header `asaas-access-token` em cada webhook
 * — usamos para validar a origem.
 */
export async function getAsaasBillingWebhookSecret(): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const [reg] = await db
    .select({ webhookSecret: adminIntegracoes.webhookSecret })
    .from(adminIntegracoes)
    .where(eq(adminIntegracoes.provedor, "asaas"))
    .limit(1);
  return reg?.webhookSecret ?? null;
}

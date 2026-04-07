/**
 * Router — WhatsApp CoEx (Embedded Signup)
 *
 * Integra o fluxo de Embedded Signup do Facebook para criar canais
 * WhatsApp Cloud API por escritório (a Meta exige App ID/Secret do admin
 * + code OAuth do cliente final).
 */

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { adminIntegracoes, canaisIntegrados } from "../../drizzle/schema";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";

export const whatsappCoexRouter = router({
  /** Retorna App ID e Config ID (não-sensíveis) para o frontend carregar o Facebook SDK */
  getConfig: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return null;
    try {
      const [row] = await db
        .select()
        .from(adminIntegracoes)
        .where(eq(adminIntegracoes.provedor, "whatsapp_cloud"))
        .limit(1);
      if (!row?.apiKeyEncrypted || !row?.apiKeyIv || !row?.apiKeyTag) return null;
      const { decrypt } = await import("../escritorio/crypto-utils");
      const raw = decrypt(row.apiKeyEncrypted, row.apiKeyIv, row.apiKeyTag);
      const config = JSON.parse(raw);
      return { appId: config.appId || "", configId: config.configId || "" };
    } catch {
      return null;
    }
  }),

  /** Recebe o code do Facebook Embedded Signup, troca por access token, salva canal */
  exchangeCode: protectedProcedure
    .input(
      z.object({
        code: z.string().min(10),
        wabaId: z.string().optional(),
        phoneNumberId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");

      const db = await getDb();
      if (!db) throw new Error("DB indisponível");

      // 1. Buscar App ID e App Secret do admin
      const [adminRow] = await db
        .select()
        .from(adminIntegracoes)
        .where(eq(adminIntegracoes.provedor, "whatsapp_cloud"))
        .limit(1);
      if (!adminRow?.apiKeyEncrypted || !adminRow?.apiKeyIv || !adminRow?.apiKeyTag) {
        throw new Error("WhatsApp Cloud API não configurada pelo administrador.");
      }
      const { decrypt, encryptConfig } = await import("../escritorio/crypto-utils");
      const adminConfig = JSON.parse(
        decrypt(adminRow.apiKeyEncrypted, adminRow.apiKeyIv, adminRow.apiKeyTag),
      );
      const appId = adminConfig.appId;
      const appSecret = adminConfig.appSecret;
      if (!appId || !appSecret) throw new Error("App ID ou App Secret não configurados.");

      // 2. Trocar code por access token
      const axios = (await import("axios")).default;
      const tokenRes = await axios.get("https://graph.facebook.com/v21.0/oauth/access_token", {
        params: { client_id: appId, client_secret: appSecret, code: input.code },
        timeout: 15000,
      });
      const accessToken = tokenRes.data?.access_token;
      if (!accessToken) throw new Error("Falha ao obter access token do Facebook.");

      // 3. Buscar info do telefone se phoneNumberId fornecido
      let telefone = "";
      let nomeVerificado = "";
      const phoneNumberId = input.phoneNumberId || "";
      if (phoneNumberId) {
        try {
          const phoneRes = await axios.get(`https://graph.facebook.com/v21.0/${phoneNumberId}`, {
            params: { fields: "display_phone_number,verified_name" },
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout: 10000,
          });
          telefone = phoneRes.data?.display_phone_number || "";
          nomeVerificado = phoneRes.data?.verified_name || "";
        } catch {
          /* ignore */
        }
      }

      // 4. Salvar canal (atualiza se já existir, cria caso contrário)
      const config = { accessToken, phoneNumberId, wabaId: input.wabaId || "", coexMode: "true" };
      const { encrypted, iv, tag } = encryptConfig(config);

      const [existente] = await db
        .select()
        .from(canaisIntegrados)
        .where(
          and(
            eq(canaisIntegrados.escritorioId, esc.escritorio.id),
            eq(canaisIntegrados.tipo, "whatsapp_api"),
          ),
        )
        .limit(1);

      if (existente) {
        await db
          .update(canaisIntegrados)
          .set({
            configEncrypted: encrypted,
            configIv: iv,
            configTag: tag,
            status: "conectado",
            telefone: telefone || existente.telefone,
            nome: nomeVerificado ? `WhatsApp CoEx (${nomeVerificado})` : existente.nome,
          })
          .where(eq(canaisIntegrados.id, existente.id));
      } else {
        await db.insert(canaisIntegrados).values({
          escritorioId: esc.escritorio.id,
          tipo: "whatsapp_api",
          nome: nomeVerificado ? `WhatsApp CoEx (${nomeVerificado})` : "WhatsApp CoEx",
          status: "conectado",
          configEncrypted: encrypted,
          configIv: iv,
          configTag: tag,
          telefone,
        });
      }

      return { success: true, telefone, nome: nomeVerificado };
    }),
});

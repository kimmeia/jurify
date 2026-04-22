/**
 * Router — Canais Meta (WhatsApp, Instagram, Messenger) via Embedded Signup.
 *
 * Este router unifica o fluxo de conexão "Conectar com Facebook" para os três
 * canais da Meta. Em vez de pedir ao usuário final App ID / App Secret / Page ID /
 * Access Token manualmente (padrão antigo), usamos o Facebook Login SDK:
 *
 *   1. Admin cadastra App ID + App Secret uma única vez em Admin → Integrações
 *   2. Cliente final clica em "Conectar com Facebook" no card do canal
 *   3. Popup do Facebook abre, cliente autoriza o escopo necessário
 *   4. Frontend envia o `code` OAuth para cá
 *   5. Trocamos o code por access_token
 *   6. Buscamos os dados do canal (número, nome da página, etc.)
 *   7. Salvamos o canal criptografado
 *
 * Escopos por canal:
 *   - whatsapp:   whatsapp_business_management, whatsapp_business_messaging
 *   - instagram:  instagram_basic, instagram_manage_messages, pages_show_list
 *   - messenger:  pages_messaging, pages_show_list, pages_manage_metadata
 */

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { adminIntegracoes, canaisIntegrados } from "../../drizzle/schema";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { createLogger } from "../_core/logger";

const log = createLogger("meta-channels");

// ─── Configuração Meta (compartilhada entre os 3 canais) ──────────────────────

interface MetaAppConfig {
  appId: string;
  appSecret: string;
  configId?: string;
}

/**
 * Retorna o App ID, App Secret e Config ID do app Meta.
 *
 * Ordem de prioridade:
 *   1. Variáveis de ambiente (META_APP_ID, META_APP_SECRET, META_CONFIG_ID)
 *   2. Tabela `adminIntegracoes` (compatibilidade legado)
 *
 * Variáveis de ambiente são preferidas porque:
 *   - Não exigem painel admin no app pra configurar
 *   - São mais seguras (não passam pelo banco/criptografia)
 *   - Funcionam em deploy headless (Railway, Vercel, etc.)
 */
async function getMetaAppConfig(): Promise<MetaAppConfig | null> {
  // 1. Tenta env vars primeiro
  const envAppId = process.env.META_APP_ID;
  const envAppSecret = process.env.META_APP_SECRET;
  if (envAppId && envAppSecret) {
    return {
      appId: envAppId,
      appSecret: envAppSecret,
      configId: process.env.META_CONFIG_ID || undefined,
    };
  }

  // 2. Fallback para o banco (legado — admin cadastrava via painel)
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
    const config = JSON.parse(raw) as {
      appId?: string;
      appSecret?: string;
      configId?: string;
    };
    if (!config.appId || !config.appSecret) return null;
    return {
      appId: config.appId,
      appSecret: config.appSecret,
      // META_CONFIG_ID em env var tem prioridade sobre o do banco — permite
      // configurar Embedded Signup sem precisar re-salvar credenciais via
      // painel admin quando o appId/secret já estão persistidos lá.
      configId: process.env.META_CONFIG_ID || config.configId,
    };
  } catch (err) {
    log.warn({ err: String(err) }, "Falha ao carregar config Meta");
    return null;
  }
}

/**
 * Extrai mensagem legível de um erro axios ao chamar o Graph API. O Facebook
 * retorna `{ error: { message, type, code, error_subcode, fbtrace_id } }`
 * dentro do body da resposta — sem isso, o usuário só vê o genérico
 * "Request failed with status code 400" do axios.
 */
export function explicarErroFacebook(err: unknown, contexto: string): string {
  const e = err as {
    response?: {
      status?: number;
      data?: { error?: { message?: string; type?: string; code?: number; error_subcode?: number; fbtrace_id?: string } };
    };
    message?: string;
  };
  const fbError = e?.response?.data?.error;
  const status = e?.response?.status;
  if (fbError?.message) {
    const trace = fbError.fbtrace_id ? ` (fbtrace_id=${fbtrace_id_safe(fbError.fbtrace_id)})` : "";
    return `${contexto}: ${fbError.message}${trace}`;
  }
  if (status) return `${contexto}: Facebook retornou HTTP ${status}.`;
  return `${contexto}: ${e?.message || "erro desconhecido"}`;
}

function fbtrace_id_safe(id: string): string {
  // Sanitiza — mantém só alfanuméricos / underscores / hífens curtos.
  return id.replace(/[^A-Za-z0-9_\-=]/g, "").slice(0, 48);
}

/**
 * Troca o `code` OAuth retornado pelo Facebook Login por um access_token
 * de longa duração usando o App Secret do admin.
 */
async function exchangeCodeForToken(code: string, redirectUri?: string): Promise<string> {
  const config = await getMetaAppConfig();
  if (!config?.appId || !config?.appSecret) {
    throw new Error(
      "Meta API não configurada. Defina META_APP_ID e META_APP_SECRET nas variáveis de ambiente do servidor.",
    );
  }

  // Dois fluxos distintos:
  //
  //  1. Embedded Signup (WhatsApp com config_id): a Meta usa um redirect_uri
  //     interno opaco no popup. Passar QUALQUER valor na troca do code
  //     (vazio ou não) gera mismatch. O correto é OMITIR o parâmetro.
  //
  //  2. Facebook Login clássico / Login for Business sem config_id: a Meta
  //     exige o mesmo redirect_uri usado no login. O frontend envia a URL
  //     da página (window.location.href) e a gente repassa.
  //
  // O frontend sinaliza qual fluxo é enviando (ou omitindo) redirectUri.
  const params: Record<string, string> = {
    client_id: config.appId,
    client_secret: config.appSecret,
    code,
  };
  if (typeof redirectUri === "string" && redirectUri.length > 0) {
    params.redirect_uri = redirectUri;
  }

  const axios = (await import("axios")).default;
  try {
    const tokenRes = await axios.get("https://graph.facebook.com/v21.0/oauth/access_token", {
      params,
      timeout: 15000,
    });
    const accessToken = tokenRes.data?.access_token;
    if (!accessToken) {
      log.warn({ resp: tokenRes.data }, "oauth/access_token respondeu 200 sem access_token");
      throw new Error("Falha ao obter access token do Facebook (resposta vazia).");
    }
    return accessToken;
  } catch (err: any) {
    if (err?.message?.startsWith("Falha ao obter access token")) throw err;
    log.warn(
      {
        status: err?.response?.status,
        fbError: err?.response?.data?.error,
        appId: config.appId,
        redirectUriUsado: params.redirect_uri ?? "<omitido>",
      },
      "[metaChannels] exchangeCodeForToken falhou",
    );
    throw new Error(explicarErroFacebook(err, "Falha na troca do código OAuth com a Meta"));
  }
}

// ─── Router ────────────────────────────────────────────────────────────────

export const metaChannelsRouter = router({
  /**
   * Retorna os parâmetros públicos (não-sensíveis) que o frontend precisa
   * para inicializar o Facebook Login SDK.
   */
  getConfig: protectedProcedure.query(async () => {
    const config = await getMetaAppConfig();
    if (!config?.appId) return null;
    return {
      appId: config.appId,
      configId: config.configId || "",
    };
  }),

  /**
   * Conecta WhatsApp Business via Embedded Signup.
   * Recebe o code OAuth + session_info (waba_id, phone_number_id) e persiste o canal.
   */
  connectWhatsApp: protectedProcedure
    .input(
      z.object({
        code: z.string().min(10),
        wabaId: z.string().optional(),
        phoneNumberId: z.string().optional(),
        redirectUri: z.string().url().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");

      const db = await getDb();
      if (!db) throw new Error("DB indisponível");

      const accessToken = await exchangeCodeForToken(input.code, input.redirectUri);

      // Embedded Signup do WhatsApp requer que o usuário selecione um número
      // e um WABA. Se `phoneNumberId` vier vazio, significa que o usuário só
      // completou o login OAuth mas NÃO terminou o fluxo de onboarding — não
      // podemos marcar o canal como "conectado" porque ele não funciona.
      if (!input.phoneNumberId || !input.wabaId) {
        throw new Error(
          "Conexão não finalizada: selecione um número WhatsApp Business e conclua o Embedded Signup da Meta antes de fechar a janela.",
        );
      }

      // Busca info do telefone
      let telefone = "";
      let nomeVerificado = "";
      let erroTelefone: string | null = null;
      try {
        const axios = (await import("axios")).default;
        const phoneRes = await axios.get(
          `https://graph.facebook.com/v21.0/${input.phoneNumberId}`,
          {
            params: { fields: "display_phone_number,verified_name" },
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout: 10000,
          },
        );
        telefone = phoneRes.data?.display_phone_number || "";
        nomeVerificado = phoneRes.data?.verified_name || "";
      } catch (err: any) {
        erroTelefone = explicarErroFacebook(err, "Falha ao buscar dados do número WhatsApp");
        log.warn(
          {
            status: err?.response?.status,
            fbError: err?.response?.data?.error,
            phoneNumberId: input.phoneNumberId,
          },
          "[metaChannels] falha ao buscar info do telefone WhatsApp",
        );
      }

      // Validação final — se mesmo com phoneNumberId não obtivemos número
      // do Graph API, a conexão está quebrada. Recusa repassando a mensagem
      // real da Meta pro usuário (permissão faltando, token revogado, etc).
      if (!telefone) {
        throw new Error(
          erroTelefone ||
            "Não foi possível validar o número WhatsApp na Meta. Verifique se o número está ativo na sua conta WhatsApp Business e tente novamente.",
        );
      }

      const { encryptConfig } = await import("../escritorio/crypto-utils");
      const config = {
        accessToken,
        phoneNumberId: input.phoneNumberId || "",
        wabaId: input.wabaId || "",
        coexMode: "true",
      };
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
            nome: nomeVerificado ? `WhatsApp (${nomeVerificado})` : existente.nome,
            mensagemErro: null,
          })
          .where(eq(canaisIntegrados.id, existente.id));
      } else {
        await db.insert(canaisIntegrados).values({
          escritorioId: esc.escritorio.id,
          tipo: "whatsapp_api",
          nome: nomeVerificado ? `WhatsApp (${nomeVerificado})` : "WhatsApp",
          status: "conectado",
          configEncrypted: encrypted,
          configIv: iv,
          configTag: tag,
          telefone,
        });
      }

      log.info({ escritorioId: esc.escritorio.id, telefone }, "WhatsApp conectado via Embedded Signup");
      return { success: true, telefone, nome: nomeVerificado, canal: "whatsapp" as const };
    }),

  /**
   * Conecta Instagram Business via Facebook Login.
   * Recebe o code OAuth e o pageId da página conectada ao Instagram Business.
   */
  connectInstagram: protectedProcedure
    .input(
      z.object({
        code: z.string().min(10),
        pageId: z.string().optional(),
        redirectUri: z.string().url().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");

      const db = await getDb();
      if (!db) throw new Error("DB indisponível");

      const accessToken = await exchangeCodeForToken(input.code, input.redirectUri);

      // Busca páginas do usuário e o Instagram Business ligado
      const axios = (await import("axios")).default;
      let pageId = input.pageId || "";
      let pageAccessToken = "";
      let igUserId = "";
      let igUsername = "";

      try {
        // 1. Lista páginas do usuário
        const pagesRes = await axios.get("https://graph.facebook.com/v21.0/me/accounts", {
          params: { fields: "id,name,access_token,instagram_business_account", access_token: accessToken },
          timeout: 10000,
        });
        const pages = pagesRes.data?.data || [];
        const page = pageId ? pages.find((p: any) => p.id === pageId) : pages[0];
        if (!page) throw new Error("Nenhuma página Facebook com Instagram Business encontrada.");

        pageId = page.id;
        pageAccessToken = page.access_token;

        // 2. Pega o Instagram Business Account
        if (page.instagram_business_account?.id) {
          igUserId = page.instagram_business_account.id;
          const igRes = await axios.get(
            `https://graph.facebook.com/v21.0/${igUserId}`,
            {
              params: { fields: "username,name", access_token: pageAccessToken },
              timeout: 10000,
            },
          );
          igUsername = igRes.data?.username || "";
        }
      } catch (err: any) {
        log.error(
          {
            status: err?.response?.status,
            fbError: err?.response?.data?.error,
          },
          "[metaChannels] Falha ao buscar páginas Instagram",
        );
        // "Nenhuma página Facebook..." já é nossa mensagem; repassa.
        if (err?.message?.startsWith("Nenhuma página")) throw err;
        throw new Error(explicarErroFacebook(err, "Falha ao carregar conta Instagram"));
      }

      if (!igUserId) {
        throw new Error(
          "Instagram Business não encontrado. Converta sua conta em Business no app do Instagram e vincule a uma página Facebook.",
        );
      }

      const { encryptConfig } = await import("../escritorio/crypto-utils");
      const config = {
        accessToken,
        pageAccessToken,
        pageId,
        igUserId,
        igUsername,
      };
      const { encrypted, iv, tag } = encryptConfig(config);

      const [existente] = await db
        .select()
        .from(canaisIntegrados)
        .where(
          and(
            eq(canaisIntegrados.escritorioId, esc.escritorio.id),
            eq(canaisIntegrados.tipo, "instagram"),
          ),
        )
        .limit(1);

      const nome = igUsername ? `Instagram (@${igUsername})` : "Instagram";
      if (existente) {
        await db
          .update(canaisIntegrados)
          .set({
            configEncrypted: encrypted,
            configIv: iv,
            configTag: tag,
            status: "conectado",
            nome,
            mensagemErro: null,
          })
          .where(eq(canaisIntegrados.id, existente.id));
      } else {
        await db.insert(canaisIntegrados).values({
          escritorioId: esc.escritorio.id,
          tipo: "instagram",
          nome,
          status: "conectado",
          configEncrypted: encrypted,
          configIv: iv,
          configTag: tag,
        });
      }

      log.info({ escritorioId: esc.escritorio.id, igUsername }, "Instagram conectado via Facebook Login");
      return { success: true, username: igUsername, canal: "instagram" as const };
    }),

  /**
   * Conecta Messenger (Facebook Page) via Facebook Login.
   */
  connectMessenger: protectedProcedure
    .input(
      z.object({
        code: z.string().min(10),
        pageId: z.string().optional(),
        redirectUri: z.string().url().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");

      const db = await getDb();
      if (!db) throw new Error("DB indisponível");

      const accessToken = await exchangeCodeForToken(input.code, input.redirectUri);

      const axios = (await import("axios")).default;
      let pageId = input.pageId || "";
      let pageName = "";
      let pageAccessToken = "";

      try {
        const pagesRes = await axios.get("https://graph.facebook.com/v21.0/me/accounts", {
          params: { fields: "id,name,access_token", access_token: accessToken },
          timeout: 10000,
        });
        const pages = pagesRes.data?.data || [];
        const page = pageId ? pages.find((p: any) => p.id === pageId) : pages[0];
        if (!page) throw new Error("Nenhuma página Facebook encontrada.");
        pageId = page.id;
        pageName = page.name;
        pageAccessToken = page.access_token;
      } catch (err: any) {
        log.error(
          {
            status: err?.response?.status,
            fbError: err?.response?.data?.error,
          },
          "[metaChannels] Falha ao buscar páginas Messenger",
        );
        if (err?.message?.startsWith("Nenhuma página")) throw err;
        throw new Error(explicarErroFacebook(err, "Falha ao carregar páginas do Facebook"));
      }

      const { encryptConfig } = await import("../escritorio/crypto-utils");
      const config = {
        accessToken,
        pageAccessToken,
        pageId,
        pageName,
      };
      const { encrypted, iv, tag } = encryptConfig(config);

      const [existente] = await db
        .select()
        .from(canaisIntegrados)
        .where(
          and(
            eq(canaisIntegrados.escritorioId, esc.escritorio.id),
            eq(canaisIntegrados.tipo, "facebook"),
          ),
        )
        .limit(1);

      const nome = pageName ? `Messenger (${pageName})` : "Messenger";
      if (existente) {
        await db
          .update(canaisIntegrados)
          .set({
            configEncrypted: encrypted,
            configIv: iv,
            configTag: tag,
            status: "conectado",
            nome,
            mensagemErro: null,
          })
          .where(eq(canaisIntegrados.id, existente.id));
      } else {
        await db.insert(canaisIntegrados).values({
          escritorioId: esc.escritorio.id,
          tipo: "facebook",
          nome,
          status: "conectado",
          configEncrypted: encrypted,
          configIv: iv,
          configTag: tag,
        });
      }

      log.info({ escritorioId: esc.escritorio.id, pageName }, "Messenger conectado");
      return { success: true, pageName, canal: "messenger" as const };
    }),

  /**
   * Testa a conexão do canal atualizando info do provedor.
   * Útil para o indicador de saúde no card de integrações.
   */
  testConnection: protectedProcedure
    .input(z.object({ canalId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");

      const db = await getDb();
      if (!db) throw new Error("DB indisponível");

      const [canal] = await db
        .select()
        .from(canaisIntegrados)
        .where(
          and(
            eq(canaisIntegrados.id, input.canalId),
            eq(canaisIntegrados.escritorioId, esc.escritorio.id),
          ),
        )
        .limit(1);

      if (!canal) throw new Error("Canal não encontrado");
      if (!canal.configEncrypted || !canal.configIv || !canal.configTag) {
        throw new Error("Canal sem configuração");
      }

      const { decryptConfig } = await import("../escritorio/crypto-utils");
      const config = decryptConfig(canal.configEncrypted, canal.configIv, canal.configTag);

      const axios = (await import("axios")).default;
      try {
        if (canal.tipo === "whatsapp_api" && config.phoneNumberId && config.accessToken) {
          await axios.get(`https://graph.facebook.com/v21.0/${config.phoneNumberId}`, {
            params: { fields: "display_phone_number" },
            headers: { Authorization: `Bearer ${config.accessToken}` },
            timeout: 8000,
          });
        } else if (canal.tipo === "instagram" && config.igUserId && config.pageAccessToken) {
          await axios.get(`https://graph.facebook.com/v21.0/${config.igUserId}`, {
            params: { fields: "username", access_token: config.pageAccessToken },
            timeout: 8000,
          });
        } else if (canal.tipo === "facebook" && config.pageId && config.pageAccessToken) {
          await axios.get(`https://graph.facebook.com/v21.0/${config.pageId}`, {
            params: { fields: "name", access_token: config.pageAccessToken },
            timeout: 8000,
          });
        } else {
          throw new Error("Configuração incompleta");
        }

        await db
          .update(canaisIntegrados)
          .set({ status: "conectado", mensagemErro: null, ultimaSync: new Date() })
          .where(eq(canaisIntegrados.id, input.canalId));

        return { ok: true };
      } catch (err: any) {
        const msg = explicarErroFacebook(err, "Falha no teste da conexão");
        log.warn(
          {
            canalId: input.canalId,
            tipo: canal.tipo,
            status: err?.response?.status,
            fbError: err?.response?.data?.error,
          },
          "[metaChannels] testConnection falhou",
        );
        await db
          .update(canaisIntegrados)
          .set({ status: "erro", mensagemErro: msg.slice(0, 500) })
          .where(eq(canaisIntegrados.id, input.canalId));
        return { ok: false, error: msg };
      }
    }),
});

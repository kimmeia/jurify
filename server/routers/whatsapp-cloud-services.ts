/**
 * Router — serviços da WhatsApp Cloud API oficial (Meta) além do envio de
 * texto, que já é coberto por `metaChannels` (conexão) e `canal-envio`
 * (envio automático).
 *
 * Cobre:
 *   - Message Templates: listar / criar / excluir (Management API da WABA)
 *   - Enviar template aprovado com variáveis preenchidas
 *   - Business Profile: ler / atualizar perfil do número
 *   - Mensagens interativas (botões / listas) + reações
 *
 * Gate de permissão:
 *   - Operações de GESTÃO (criar/excluir template, editar perfil) exigem
 *     admin/matriz (`checkPermissionAdminOuMatriz` em "configuracoes").
 *   - Leitura e envio são `protectedProcedure` (qualquer colaborador logado),
 *     coerente com o envio manual de mensagens no Atendimento.
 */

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { canaisIntegrados } from "../../drizzle/schema";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { checkPermissionAdminOuMatriz } from "../escritorio/check-permission";
import { explicarErroFacebook } from "./meta-channels";
import { createLogger } from "../_core/logger";
import type { WACategoriaTemplate, WAVerticalNegocio } from "../../shared/whatsapp-cloud-types";

const log = createLogger("whatsapp-cloud-services");

interface CanalCloud {
  escritorioId: number;
  colaboradorId: number;
  canalId: number;
  accessToken: string;
  phoneNumberId: string;
  wabaId: string;
}

/**
 * Carrega e descriptografa a config de um canal WhatsApp Cloud do escritório
 * do usuário, validando tipo e credenciais. Lança Error legível em qualquer
 * problema (canal de outro escritório, tipo errado, config ausente).
 */
async function carregarCanalCloud(userId: number, canalId: number): Promise<CanalCloud> {
  const esc = await getEscritorioPorUsuario(userId);
  if (!esc) throw new Error("Escritório não encontrado.");

  const db = await getDb();
  if (!db) throw new Error("DB indisponível");

  const [canal] = await db
    .select()
    .from(canaisIntegrados)
    .where(and(eq(canaisIntegrados.id, canalId), eq(canaisIntegrados.escritorioId, esc.escritorio.id)))
    .limit(1);

  if (!canal) throw new Error("Canal não encontrado.");
  if (canal.tipo !== "whatsapp_api") {
    throw new Error("Este recurso só está disponível para canais WhatsApp Business API (Cloud).");
  }
  if (!canal.configEncrypted || !canal.configIv || !canal.configTag) {
    throw new Error("Canal sem configuração. Reconecte o WhatsApp antes de usar este recurso.");
  }

  const { decryptConfig } = await import("../escritorio/crypto-utils");
  const config = decryptConfig(canal.configEncrypted, canal.configIv, canal.configTag) as {
    accessToken?: string;
    phoneNumberId?: string;
    wabaId?: string;
  };

  if (!config.accessToken || !config.phoneNumberId) {
    throw new Error("Configuração do canal incompleta (access_token ou phone_number_id ausente).");
  }

  return {
    escritorioId: esc.escritorio.id,
    colaboradorId: esc.colaborador.id,
    canalId,
    accessToken: config.accessToken,
    phoneNumberId: config.phoneNumberId,
    wabaId: config.wabaId || "",
  };
}

async function exigirGestao(userId: number): Promise<void> {
  const perm = await checkPermissionAdminOuMatriz(userId, "configuracoes", "editar");
  if (!perm.allowed) {
    throw new Error(
      "Apenas donos, gestores ou cargos com permissão de editar configurações podem gerenciar templates e perfil do WhatsApp.",
    );
  }
}

const botaoTemplateSchema = z.object({
  type: z.enum(["QUICK_REPLY", "URL", "PHONE_NUMBER"]),
  text: z.string().min(1).max(25),
  url: z.string().url().optional(),
  phone_number: z.string().optional(),
});

export const whatsappCloudRouter = router({
  // ─── Templates ──────────────────────────────────────────────────────────

  /** Lista os templates de mensagem da WABA do canal. */
  listarTemplates: protectedProcedure
    .input(z.object({ canalId: z.number() }))
    .query(async ({ ctx, input }) => {
      const c = await carregarCanalCloud(ctx.user.id, input.canalId);
      if (!c.wabaId) {
        throw new Error("Canal sem WABA ID. Reconecte o WhatsApp via Embedded Signup.");
      }
      const { WhatsAppCloudClient } = await import("../integracoes/whatsapp-cloud");
      const client = new WhatsAppCloudClient({
        accessToken: c.accessToken,
        phoneNumberId: c.phoneNumberId,
      });
      try {
        return await client.listarTemplates(c.wabaId);
      } catch (err) {
        throw new Error(explicarErroFacebook(err, "Falha ao listar templates do WhatsApp"));
      }
    }),

  /** Cria um template de mensagem na WABA. Fica "Em análise" até a Meta aprovar. */
  criarTemplate: protectedProcedure
    .input(
      z.object({
        canalId: z.number(),
        nome: z
          .string()
          .min(1)
          .max(512)
          .regex(/^[a-z0-9_]+$/, "Use apenas letras minúsculas, números e underscore."),
        idioma: z.string().min(2).max(10).default("pt_BR"),
        categoria: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]),
        corpo: z.string().min(1).max(1024),
        exemplosCorpo: z.array(z.string()).optional(),
        cabecalhoTexto: z.string().max(60).optional(),
        rodapeTexto: z.string().max(60).optional(),
        botoes: z.array(botaoTemplateSchema).max(10).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await exigirGestao(ctx.user.id);
      const c = await carregarCanalCloud(ctx.user.id, input.canalId);
      if (!c.wabaId) {
        throw new Error("Canal sem WABA ID. Reconecte o WhatsApp via Embedded Signup.");
      }
      const { WhatsAppCloudClient } = await import("../integracoes/whatsapp-cloud");
      const client = new WhatsAppCloudClient({
        accessToken: c.accessToken,
        phoneNumberId: c.phoneNumberId,
      });
      try {
        const result = await client.criarTemplate(c.wabaId, {
          nome: input.nome,
          idioma: input.idioma,
          categoria: input.categoria as WACategoriaTemplate,
          corpo: input.corpo,
          exemplosCorpo: input.exemplosCorpo,
          cabecalhoTexto: input.cabecalhoTexto,
          rodapeTexto: input.rodapeTexto,
          botoes: input.botoes,
        });
        log.info({ escritorioId: c.escritorioId, nome: input.nome }, "Template WhatsApp criado");
        return result;
      } catch (err) {
        throw new Error(explicarErroFacebook(err, "Falha ao criar template no WhatsApp"));
      }
    }),

  /** Exclui um template (por nome) da WABA. */
  excluirTemplate: protectedProcedure
    .input(z.object({ canalId: z.number(), nome: z.string().min(1), hsmId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await exigirGestao(ctx.user.id);
      const c = await carregarCanalCloud(ctx.user.id, input.canalId);
      if (!c.wabaId) {
        throw new Error("Canal sem WABA ID. Reconecte o WhatsApp via Embedded Signup.");
      }
      const { WhatsAppCloudClient } = await import("../integracoes/whatsapp-cloud");
      const client = new WhatsAppCloudClient({
        accessToken: c.accessToken,
        phoneNumberId: c.phoneNumberId,
      });
      try {
        await client.excluirTemplate(c.wabaId, input.nome, input.hsmId);
        log.info({ escritorioId: c.escritorioId, nome: input.nome }, "Template WhatsApp excluído");
        return { success: true };
      } catch (err) {
        throw new Error(explicarErroFacebook(err, "Falha ao excluir template do WhatsApp"));
      }
    }),

  /** Envia um template aprovado com parâmetros preenchidos. */
  enviarTemplate: protectedProcedure
    .input(
      z.object({
        canalId: z.number(),
        telefone: z.string().min(8).max(20),
        templateName: z.string().min(1),
        languageCode: z.string().min(2).max(10).default("pt_BR"),
        parametrosCorpo: z.array(z.string()).optional(),
        headerImageUrl: z.string().url().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const c = await carregarCanalCloud(ctx.user.id, input.canalId);
      const { WhatsAppCloudClient, montarComponentesEnvio } = await import(
        "../integracoes/whatsapp-cloud"
      );
      const client = new WhatsAppCloudClient({
        accessToken: c.accessToken,
        phoneNumberId: c.phoneNumberId,
      });
      const components = montarComponentesEnvio({
        bodyParams: input.parametrosCorpo,
        headerImageUrl: input.headerImageUrl,
      });
      // Template é iniciado pela empresa (proativo): passa pelas travas anti-ban
      // (disjuntor + teto diário + rate). Sem opt-in — é envio manual do operador,
      // que escolheu o destinatário. Antes este endpoint furava TODAS as travas.
      const db = await getDb();
      const guard = db ? await import("../integracoes/whatsapp-envio-guard") : null;
      if (db && guard) {
        const permitido = await guard.podeEnviar({ db, canalId: c.canalId, telefone: input.telefone, proativo: true });
        if (!permitido.ok) throw new Error(permitido.erro);
      }
      try {
        const msgId = await client.enviarTemplate(
          input.telefone,
          input.templateName,
          input.languageCode,
          components,
        );
        if (db && guard) await guard.registrarSucessoEnvio({ db, canalId: c.canalId, proativo: true });
        return { success: true, idExterno: msgId };
      } catch (err) {
        const erro = explicarErroFacebook(err, "Falha ao enviar template do WhatsApp");
        if (db && guard) await guard.registrarFalhaEnvio({ db, canalId: c.canalId, erro }).catch(() => {});
        throw new Error(erro);
      }
    }),

  // ─── Business Profile ─────────────────────────────────────────────────────

  /** Lê o perfil de negócio do número. */
  getPerfil: protectedProcedure
    .input(z.object({ canalId: z.number() }))
    .query(async ({ ctx, input }) => {
      const c = await carregarCanalCloud(ctx.user.id, input.canalId);
      const { WhatsAppCloudClient } = await import("../integracoes/whatsapp-cloud");
      const client = new WhatsAppCloudClient({
        accessToken: c.accessToken,
        phoneNumberId: c.phoneNumberId,
      });
      try {
        return await client.getBusinessProfile();
      } catch (err) {
        throw new Error(explicarErroFacebook(err, "Falha ao carregar perfil do WhatsApp"));
      }
    }),

  /** Atualiza o perfil de negócio do número. */
  atualizarPerfil: protectedProcedure
    .input(
      z.object({
        canalId: z.number(),
        about: z.string().max(139).optional(),
        address: z.string().max(256).optional(),
        description: z.string().max(512).optional(),
        email: z.string().email().max(128).optional().or(z.literal("")),
        vertical: z
          .enum([
            "UNDEFINED", "OTHER", "AUTO", "BEAUTY", "APPAREL", "EDU", "ENTERTAIN",
            "EVENT_PLAN", "FINANCE", "GROCERY", "GOVT", "HOTEL", "HEALTH",
            "NONPROFIT", "PROF_SERVICES", "RETAIL", "TRAVEL", "RESTAURANT", "NOT_A_BIZ",
          ])
          .optional(),
        websites: z.array(z.string().url()).max(2).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await exigirGestao(ctx.user.id);
      const c = await carregarCanalCloud(ctx.user.id, input.canalId);
      const { WhatsAppCloudClient } = await import("../integracoes/whatsapp-cloud");
      const client = new WhatsAppCloudClient({
        accessToken: c.accessToken,
        phoneNumberId: c.phoneNumberId,
      });
      const fields: Record<string, unknown> = {};
      if (input.about !== undefined) fields.about = input.about;
      if (input.address !== undefined) fields.address = input.address;
      if (input.description !== undefined) fields.description = input.description;
      if (input.email !== undefined) fields.email = input.email;
      if (input.vertical !== undefined) fields.vertical = input.vertical as WAVerticalNegocio;
      if (input.websites !== undefined) fields.websites = input.websites;
      try {
        await client.atualizarBusinessProfile(fields);
        log.info({ escritorioId: c.escritorioId, canalId: input.canalId }, "Perfil WhatsApp atualizado");
        return { success: true };
      } catch (err) {
        throw new Error(explicarErroFacebook(err, "Falha ao atualizar perfil do WhatsApp"));
      }
    }),

  // ─── Mensagens interativas + reações ────────────────────────────────────────

  /** Envia mensagem com botões de resposta rápida (até 3). */
  enviarBotoes: protectedProcedure
    .input(
      z.object({
        canalId: z.number(),
        telefone: z.string().min(8).max(20),
        corpo: z.string().min(1).max(1024),
        botoes: z
          .array(z.object({ id: z.string().min(1).max(256), titulo: z.string().min(1).max(20) }))
          .min(1)
          .max(3),
        cabecalho: z.string().max(60).optional(),
        rodape: z.string().max(60).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const c = await carregarCanalCloud(ctx.user.id, input.canalId);
      // Guard anti-ban: este endpoint furava TODAS as travas (disjuntor, teto
      // diário, rate) — com conta restrita continuava martelando a Meta.
      const db = await getDb();
      const guard = db ? await import("../integracoes/whatsapp-envio-guard") : null;
      if (db && guard) {
        const permitido = await guard.podeEnviar({ db, canalId: input.canalId, telefone: input.telefone, proativo: true });
        if (!permitido.ok) throw new Error(permitido.erro);
      }
      const { WhatsAppCloudClient } = await import("../integracoes/whatsapp-cloud");
      const client = new WhatsAppCloudClient({
        accessToken: c.accessToken,
        phoneNumberId: c.phoneNumberId,
      });
      try {
        const msgId = await client.enviarBotoes(input.telefone, input.corpo, input.botoes, {
          cabecalho: input.cabecalho,
          rodape: input.rodape,
        });
        if (db && guard) await guard.registrarSucessoEnvio({ db, canalId: input.canalId, proativo: true });
        return { success: true, idExterno: msgId };
      } catch (err: any) {
        if (db && guard) {
          const apiMsg = err?.response?.data?.error?.message || err?.message || "";
          await guard.registrarFalhaEnvio({ db, canalId: input.canalId, erro: apiMsg }).catch(() => {});
        }
        throw new Error(explicarErroFacebook(err, "Falha ao enviar botões no WhatsApp"));
      }
    }),

  /** Envia mensagem com lista de opções (menu). */
  enviarLista: protectedProcedure
    .input(
      z.object({
        canalId: z.number(),
        telefone: z.string().min(8).max(20),
        corpo: z.string().min(1).max(1024),
        botaoTexto: z.string().min(1).max(20),
        secoes: z
          .array(
            z.object({
              titulo: z.string().min(1).max(24),
              itens: z
                .array(
                  z.object({
                    id: z.string().min(1).max(200),
                    titulo: z.string().min(1).max(24),
                    descricao: z.string().max(72).optional(),
                  }),
                )
                .min(1)
                .max(10),
            }),
          )
          .min(1)
          .max(10),
        cabecalho: z.string().max(60).optional(),
        rodape: z.string().max(60).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const c = await carregarCanalCloud(ctx.user.id, input.canalId);
      const db = await getDb();
      const guard = db ? await import("../integracoes/whatsapp-envio-guard") : null;
      if (db && guard) {
        const permitido = await guard.podeEnviar({ db, canalId: input.canalId, telefone: input.telefone, proativo: true });
        if (!permitido.ok) throw new Error(permitido.erro);
      }
      const { WhatsAppCloudClient } = await import("../integracoes/whatsapp-cloud");
      const client = new WhatsAppCloudClient({
        accessToken: c.accessToken,
        phoneNumberId: c.phoneNumberId,
      });
      try {
        const msgId = await client.enviarLista(
          input.telefone,
          input.corpo,
          input.botaoTexto,
          input.secoes,
          { cabecalho: input.cabecalho, rodape: input.rodape },
        );
        if (db && guard) await guard.registrarSucessoEnvio({ db, canalId: input.canalId, proativo: true });
        return { success: true, idExterno: msgId };
      } catch (err: any) {
        if (db && guard) {
          const apiMsg = err?.response?.data?.error?.message || err?.message || "";
          await guard.registrarFalhaEnvio({ db, canalId: input.canalId, erro: apiMsg }).catch(() => {});
        }
        throw new Error(explicarErroFacebook(err, "Falha ao enviar lista no WhatsApp"));
      }
    }),

  /** Reage a uma mensagem com um emoji (emoji vazio remove a reação). */
  enviarReacao: protectedProcedure
    .input(
      z.object({
        canalId: z.number(),
        telefone: z.string().min(8).max(20),
        messageId: z.string().min(1),
        emoji: z.string().max(8),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const c = await carregarCanalCloud(ctx.user.id, input.canalId);
      // Reação referencia mensagem existente (não-proativa): respeita o
      // disjuntor/rate, mas não conta contra o teto diário.
      const db = await getDb();
      const guard = db ? await import("../integracoes/whatsapp-envio-guard") : null;
      if (db && guard) {
        const permitido = await guard.podeEnviar({ db, canalId: input.canalId, proativo: false });
        if (!permitido.ok) throw new Error(permitido.erro);
      }
      const { WhatsAppCloudClient } = await import("../integracoes/whatsapp-cloud");
      const client = new WhatsAppCloudClient({
        accessToken: c.accessToken,
        phoneNumberId: c.phoneNumberId,
      });
      try {
        const msgId = await client.enviarReacao(input.telefone, input.messageId, input.emoji);
        if (db && guard) await guard.registrarSucessoEnvio({ db, canalId: input.canalId, proativo: false });
        return { success: true, idExterno: msgId };
      } catch (err: any) {
        if (db && guard) {
          const apiMsg = err?.response?.data?.error?.message || err?.message || "";
          await guard.registrarFalhaEnvio({ db, canalId: input.canalId, erro: apiMsg }).catch(() => {});
        }
        throw new Error(explicarErroFacebook(err, "Falha ao reagir no WhatsApp"));
      }
    }),
});

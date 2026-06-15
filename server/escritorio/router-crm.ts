/**
 * Router tRPC — CRM: Contatos, Conversas, Mensagens, Leads
 * Fase 3
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getEscritorioPorUsuario } from "./db-escritorio";
import { getDb } from "../db";
import { checkPermission, checkPermissionAdminOuMatriz } from "./check-permission";
import {
  criarContato, criarOuReutilizarContato, listarContatos, atualizarContato, unificarContatos,
  buscarContatoPorTelefone,
  criarConversa, listarConversas, contarConversasPorStatus, atualizarConversa, excluirConversa,
  enviarMensagem, listarMensagens,
  criarLead, listarLeads, atualizarLead, excluirLead,
  obterMetricasDashboard, distribuirLead, obterMetricasDetalhadas,
} from "./db-crm";
import { conversas, contatos, leads } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { excluirClienteEmCascata } from "./excluir-cliente";
import { createLogger } from "../_core/logger";
import path from "path";
import { promises as fsp } from "fs";
import { fileTypeFromBuffer } from "file-type";
import { prepararAudioParaCloud } from "../integracoes/whatsapp-cloud-audio";
import type { WhatsAppCloudClient } from "../integracoes/whatsapp-cloud";
const log = createLogger("escritorio-router-crm");

/**
 * Converte a URL devolvida pelo uploadRouter (`/uploads/escritorio_X/foo.webm`)
 * em path absoluto que o socket Baileys consegue ler do disco. URLs HTTP
 * absolutas passam intactas — o Baileys também aceita.
 */
export function resolverMediaPathLocal(mediaUrl: string): string {
  if (/^https?:\/\//i.test(mediaUrl)) return mediaUrl;
  if (mediaUrl.startsWith("/uploads/")) {
    return path.resolve(process.cwd(), mediaUrl.slice(1));
  }
  return mediaUrl;
}

/**
 * Confirma que um colaborador pertence ao escritório. Usado antes de gravar um
 * `responsavelId` vindo do client (seletor de responsável do Pipeline) — sem
 * isso um id forjado atribuiria o lead a alguém de outro escritório.
 */
async function colaboradorDoEscritorio(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  escritorioId: number,
  colaboradorId: number,
): Promise<boolean> {
  const { colaboradores } = await import("../../drizzle/schema");
  const [c] = await db
    .select({ id: colaboradores.id })
    .from(colaboradores)
    .where(and(eq(colaboradores.id, colaboradorId), eq(colaboradores.escritorioId, escritorioId)))
    .limit(1);
  return !!c;
}

/**
 * Envia o conteúdo pela Cloud API escolhendo o método certo pelo tipo.
 *
 * Mídia local (o caso normal: upload devolve `/uploads/...`) sobe os bytes
 * pra Meta via uploadMedia e manda por media_id — assim não dependemos de uma
 * URL pública. Áudio passa antes pelo conversor (Chrome grava webm, que a
 * Cloud API rejeita). URLs HTTP externas caem no envio por `link`. Texto e
 * tipos sem mídia seguem como texto.
 */
async function enviarConteudoCloudApi(
  client: WhatsAppCloudClient,
  telefone: string,
  tipo: string | undefined,
  conteudo: string,
  mediaUrl: string | undefined,
): Promise<string> {
  if (tipo && tipo !== "texto" && mediaUrl) {
    const origem = resolverMediaPathLocal(mediaUrl);
    const ehHttp = /^https?:\/\//i.test(origem);

    if (tipo === "audio") {
      if (ehHttp) return client.enviarAudio(telefone, origem);
      const { path: audioPath, mime } = await prepararAudioParaCloud(origem);
      const buf = await fsp.readFile(audioPath);
      const mediaId = await client.uploadMedia(buf, mime, path.basename(audioPath));
      return client.enviarAudioPorId(telefone, mediaId);
    }

    if (tipo === "imagem" || tipo === "documento" || tipo === "video") {
      if (ehHttp) {
        return tipo === "imagem"
          ? client.enviarImagem(telefone, origem, conteudo || undefined)
          : tipo === "video"
            ? client.enviarVideo(telefone, origem, conteudo || undefined)
            : client.enviarDocumento(telefone, origem, path.basename(origem), conteudo || undefined);
      }
      const buf = await fsp.readFile(origem);
      const ft = await fileTypeFromBuffer(buf);
      const mime = ft?.mime
        || (tipo === "imagem" ? "image/jpeg" : tipo === "video" ? "video/mp4" : "application/octet-stream");
      const mediaId = await client.uploadMedia(buf, mime, path.basename(origem));
      return tipo === "imagem"
        ? client.enviarImagemPorId(telefone, mediaId, conteudo || undefined)
        : tipo === "video"
          ? client.enviarVideoPorId(telefone, mediaId, conteudo || undefined)
          : client.enviarDocumentoPorId(telefone, mediaId, path.basename(origem), conteudo || undefined);
    }
  }

  return client.enviarTexto(telefone, conteudo);
}

export const crmRouter = router({
  // ─── Contatos ──────────────────────────────────────────────────────────────

  criarContato: protectedProcedure
    .input(z.object({
      nome: z.string().min(1).max(255),
      telefone: z.string().max(20).optional(),
      email: z.string().email().optional().or(z.literal("")),
      cpfCnpj: z.string().max(18).optional(),
      origem: z.enum(["whatsapp", "instagram", "facebook", "telefone", "manual", "site"]).optional(),
      tags: z.array(z.string()).optional(),
      observacoes: z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "clientes", "criar");
      if (!perm.allowed) throw new Error("Sem permissão para criar contatos.");
      const id = await criarContato({ escritorioId: perm.escritorioId, ...input });
      return { id };
    }),

  listarContatos: protectedProcedure
    .input(z.object({ busca: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return [];
      return listarContatos(esc.escritorio.id, input?.busca);
    }),

  atualizarContato: protectedProcedure
    .input(z.object({
      id: z.number(),
      nome: z.string().min(1).max(255).optional(),
      telefone: z.string().max(20).optional(),
      telefonesSecundarios: z.array(z.string().max(20)).max(5).optional(),
      email: z.string().email().optional().or(z.literal("")),
      cpfCnpj: z.string().max(18).optional(),
      tags: z.array(z.string()).optional(),
      observacoes: z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      const { id, ...dados } = input;
      await atualizarContato(id, esc.escritorio.id, dados);
      return { success: true };
    }),

  unificarContatos: protectedProcedure
    .input(z.object({
      principalId: z.number(),
      duplicadoId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermissionAdminOuMatriz(ctx.user.id, "clientes", "excluir");
      if (!perm.allowed) {
        throw new Error("Apenas dono, gestor ou cargo com permissão de excluir clientes pode unificar contatos.");
      }
      return unificarContatos(perm.escritorioId, input.principalId, input.duplicadoId);
    }),

  excluirContato: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermissionAdminOuMatriz(ctx.user.id, "clientes", "excluir");
      if (!perm.allowed) throw new Error("Sem permissão.");
      // Cascata: cancela cobranças no Asaas + deleta todos os dados
      // vinculados (conversas, mensagens, leads, tarefas, arquivos, etc).
      const resultado = await excluirClienteEmCascata(input.id, perm.escritorioId);
      return resultado;
    }),

  // ─── Conversas ─────────────────────────────────────────────────────────────

  criarConversa: protectedProcedure
    .input(z.object({
      contatoId: z.number(),
      canalId: z.number(),
      assunto: z.string().max(255).optional(),
      prioridade: z.enum(["baixa", "normal", "alta", "urgente"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");

      // Distribuir automaticamente
      const atendenteId = (await distribuirLead(esc.escritorio.id, input.contatoId).catch(() => null)) ?? esc.colaborador.id;
      const id = await criarConversa({
        escritorioId: esc.escritorio.id,
        contatoId: input.contatoId,
        canalId: input.canalId,
        atendenteId,
        assunto: input.assunto,
        prioridade: input.prioridade,
      });
      return { id, atendenteId };
    }),

  listarConversas: protectedProcedure
    .input(z.object({
      status: z.enum(["aguardando", "em_atendimento", "resolvido", "fechado"]).optional(),
      atendenteId: z.number().optional(),
      atendenteIds: z.array(z.number()).optional(),
      setorId: z.number().optional(),
      canalId: z.number().optional(),
      dataInicio: z.string().optional(),
      dataFim: z.string().optional(),
      limite: z.number().int().min(1).max(1000).optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "atendimento", "ver");
      if (!perm.allowed) return [];
      const filtros: any = { ...(input ?? {}) };
      // Respeita verProprios — força filtro pelo próprio colaborador,
      // ignorando qualquer atendenteId/atendenteIds/setorId vindo do client.
      if (!perm.verTodos && perm.verProprios) {
        filtros.atendenteId = perm.colaboradorId;
        delete filtros.atendenteIds;
        delete filtros.setorId;
      }
      return listarConversas(perm.escritorioId, filtros);
    }),

  /** Contagem real por status (pros pills do Inbox baterem com >100 conversas). */
  contarConversas: protectedProcedure
    .input(z.object({
      atendenteId: z.number().optional(),
      atendenteIds: z.array(z.number()).optional(),
      setorId: z.number().optional(),
      dataInicio: z.string().optional(),
      dataFim: z.string().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "atendimento", "ver");
      if (!perm.allowed) return { todos: 0, aguardando: 0, em_atendimento: 0, resolvido: 0 };
      const filtros: any = { ...(input ?? {}) };
      if (!perm.verTodos && perm.verProprios) {
        filtros.atendenteId = perm.colaboradorId;
        delete filtros.atendenteIds;
        delete filtros.setorId;
      }
      return contarConversasPorStatus(perm.escritorioId, filtros);
    }),

  atualizarConversa: protectedProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["aguardando", "em_atendimento", "resolvido", "fechado"]).optional(),
      atendenteId: z.number().optional(),
      prioridade: z.enum(["baixa", "normal", "alta", "urgente"]).optional(),
      assunto: z.string().max(255).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      const { id, ...dados } = input;
      await atualizarConversa(id, esc.escritorio.id, dados);
      return { success: true };
    }),

  excluirConversa: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "atendimento", "excluir");
      if (!perm.allowed) throw new Error("Sem permissão para excluir conversas.");
      await excluirConversa(input.id, perm.escritorioId);
      return { success: true };
    }),

  // ─── Mensagens ─────────────────────────────────────────────────────────────

  enviarMensagem: protectedProcedure
    .input(z.object({
      conversaId: z.number(),
      conteudo: z.string().min(1).max(5000),
      tipo: z.enum(["texto", "imagem", "audio", "video", "documento"]).optional(),
      // Quando o tipo é mídia (audio/imagem/documento), o frontend faz
      // upload primeiro e passa aqui a URL devolvida pelo uploadRouter.
      // Aceita tanto `/uploads/...` (path local do projeto) quanto URL
      // HTTP absoluta — o resolverMediaPath() lida com os dois.
      mediaUrl: z.string().max(2000).optional(),
      // Quando informado, envia como template HSM via Cloud API em vez de
      // mensagem livre. `nome` = nome do template Meta aprovado;
      // `idioma` = código BCP-47 (default pt_BR); `params` = valores pros
      // {{1}}, {{2}}... do corpo, na ordem. Só funciona em canal whatsapp_api.
      metaTemplate: z.object({
        nome: z.string().min(1).max(100),
        idioma: z.string().max(20).optional(),
        params: z.array(z.string().max(200)).max(20).optional(),
      }).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");

      // Salvar mensagem no banco
      const id = await enviarMensagem({
        conversaId: input.conversaId,
        remetenteId: esc.colaborador.id,
        direcao: "saida",
        tipo: input.tipo,
        conteudo: input.conteudo,
        mediaUrl: input.mediaUrl,
      });

      // Marcar conversa como em_atendimento se estava aguardando
      await atualizarConversa(input.conversaId, esc.escritorio.id, { status: "em_atendimento" });

      // Enviar via WhatsApp se a conversa for de um canal whatsapp_qr
      try {
        const { getDb } = await import("../db");
        const { conversas, contatos, canaisIntegrados } = await import("../../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const db = await getDb();
        if (db) {
          // Buscar conversa + contato + canal
          const [convData] = await db.select({
            canalId: conversas.canalId,
            telefone: contatos.telefone,
            canalTipo: canaisIntegrados.tipo,
            chatIdExterno: conversas.chatIdExterno,
          })
            .from(conversas)
            .innerJoin(contatos, eq(conversas.contatoId, contatos.id))
            .innerJoin(canaisIntegrados, eq(conversas.canalId, canaisIntegrados.id))
            .where(eq(conversas.id, input.conversaId))
            .limit(1);

          log.debug({
            conversaId: input.conversaId,
            canalId: convData?.canalId,
            canalTipo: convData?.canalTipo,
            telefone: convData?.telefone,
            chatIdExterno: convData?.chatIdExterno,
          }, "Dados da conversa");

          if (convData && convData.canalTipo === "whatsapp_qr") {
            const { getWhatsappManager } = await import("../integracoes/whatsapp-baileys");
            const manager = getWhatsappManager();

            if (manager.isConectado(convData.canalId)) {
              // Preferência por chatIdExterno (já é JID de conversa existente).
              // Fallback pro telefone — enviarMensagemJid resolve a quirk BR
              // com/sem "9" via onWhatsApp() automaticamente.
              const destinatario = convData.chatIdExterno || convData.telefone;
              if (destinatario) {
                // Para mídia, resolve o path local antes de mandar pro Baileys:
                // upload devolve "/uploads/escritorio_X/foo.webm" mas o socket
                // precisa de path absoluto OU URL HTTP. Texto puro ignora.
                const mediaParaBaileys = input.mediaUrl
                  ? resolverMediaPathLocal(input.mediaUrl)
                  : undefined;
                await manager.enviarMensagemJid(
                  convData.canalId,
                  destinatario,
                  input.conteudo,
                  input.tipo,
                  mediaParaBaileys,
                  undefined,
                );
                log.info(`[CRM] Mensagem enviada via WhatsApp QR para ${destinatario}`);
              } else {
                log.warn(`[CRM] Sem destinatário para conversa ${input.conversaId}`);
              }
            } else {
              log.warn(`[CRM] Canal WhatsApp QR ${convData.canalId} não conectado`);
            }
          } else if (convData && convData.canalTipo === "whatsapp_api") {
            // Cloud API (CoEx) — enviar via API oficial
            try {
              const [canalRow] = await db.select().from(canaisIntegrados).where(eq(canaisIntegrados.id, convData.canalId)).limit(1);
              if (canalRow?.configEncrypted && canalRow?.configIv && canalRow?.configTag) {
                const { decryptConfig } = await import("./crypto-utils");
                const config = decryptConfig(canalRow.configEncrypted, canalRow.configIv, canalRow.configTag);
                if (config.accessToken && config.phoneNumberId) {
                  const { WhatsAppCloudClient } = await import("../integracoes/whatsapp-cloud");
                  const { resolverDestinatarioCloudApi } = await import("../integracoes/canal-envio");
                  const client = new WhatsAppCloudClient({ accessToken: config.accessToken, phoneNumberId: config.phoneNumberId });
                  // chatIdExterno (wa_id de quem conversa) primeiro: o telefone
                  // do cadastro pode ter sido trocado (vínculo Asaas, edição) e
                  // apontar pra outro número — a Meta rejeitaria o envio mesmo
                  // com a janela de 24h desta conversa aberta.
                  const telefone = resolverDestinatarioCloudApi({
                    telefone: convData.telefone,
                    chatIdExterno: convData.chatIdExterno,
                  });
                  if (telefone) {
                    let msgId: string;
                    if (input.metaTemplate) {
                      // Template Meta: monta o array de components com 1 body
                      // com 1 parameter por {{N}} preenchido. Sem params = template
                      // sem variáveis (caso comum dos "lembrete fixo").
                      const params = input.metaTemplate.params ?? [];
                      const components = params.length > 0
                        ? [{ type: "body", parameters: params.map((p) => ({ type: "text", text: String(p) })) }]
                        : undefined;
                      msgId = await client.enviarTemplate(telefone, input.metaTemplate.nome, input.metaTemplate.idioma || "pt_BR", components);
                      log.info(`[CRM] Template Meta "${input.metaTemplate.nome}" enviado pra ${telefone} (msgId: ${msgId})`);
                    } else {
                      msgId = await enviarConteudoCloudApi(client, telefone, input.tipo, input.conteudo, input.mediaUrl);
                      log.info(`[CRM] Mensagem enviada via Cloud API CoEx para ${telefone} (msgId: ${msgId})`);
                    }
                    // Atualizar idExterno da mensagem para rastrear status
                    if (msgId) {
                      const { mensagens } = await import("../../drizzle/schema");
                      await db.update(mensagens).set({ idExterno: msgId, status: "enviada" }).where(eq(mensagens.id, id));
                    }
                  } else {
                    // Sem destinatário válido a mensagem nunca sai — marca
                    // falha em vez de deixá-la "pendente" eterna na UI.
                    log.warn(`[CRM] Conversa ${input.conversaId} sem destinatário válido pra Cloud API`);
                    const { mensagens } = await import("../../drizzle/schema");
                    await db.update(mensagens).set({ status: "falha" }).where(eq(mensagens.id, id));
                  }
                } else { log.warn(`[CRM] Canal CoEx ${convData.canalId} sem accessToken ou phoneNumberId`); }
              }
            } catch (cloudErr: any) {
              // Persistir a falha (não só logar): a UI mostra status real e o
              // erro de integração externa não morre no response.
              log.error(`[CRM] Erro ao enviar via Cloud API:`, cloudErr?.response?.data?.error || cloudErr.message);
              try {
                const { mensagens } = await import("../../drizzle/schema");
                await db.update(mensagens).set({ status: "falha" }).where(eq(mensagens.id, id));
              } catch { /* não mascarar o erro original */ }
            }
          }
        }
      } catch (err: any) {
        // Não falhar a mutation se WhatsApp der erro — mensagem já está salva
        log.error(`[CRM] Erro ao enviar via WhatsApp:`, err.message, err.stack);
      }

      return { id };
    }),

  listarMensagens: protectedProcedure
    .input(z.object({
      conversaId: z.number(),
      limite: z.number().max(200).optional(),
      beforeId: z.number().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "atendimento", "ver");
      if (!perm.allowed) return [];

      const db = await getDb();
      if (!db) return [];

      // Valida que a conversa pertence ao escritório do colaborador.
      // Filtra direto no WHERE pra evitar mismatch manual de tipos.
      const [conv] = await db
        .select({
          id: conversas.id,
          atendenteId: conversas.atendenteId,
        })
        .from(conversas)
        .where(and(
          eq(conversas.id, input.conversaId),
          eq(conversas.escritorioId, perm.escritorioId),
        ))
        .limit(1);
      if (!conv) return [];

      // Se só pode ver próprios, conversa precisa estar atribuída a ele
      if (!perm.verTodos && perm.verProprios && conv.atendenteId !== perm.colaboradorId) {
        return [];
      }
      return listarMensagens(input.conversaId, input.limite ?? 50, input.beforeId);
    }),

  /** Inicia nova conversa: cria contato (se não existe) + conversa + envia 1ª mensagem */
  iniciarConversa: protectedProcedure
    .input(z.object({
      telefone: z.string().min(8).max(20),
      nome: z.string().min(1).max(255).optional(),
      mensagem: z.string().min(1).max(5000),
      canalId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");

      // Normaliza telefone: remove formatação e garante DDI 55 (Brasil).
      // O frontend manda só os dígitos do DDD+número (10 ou 11 chars) e o
      // backend prepende o 55 — assim o JID gerado é sempre válido para
      // o WhatsApp internacional.
      const { normalizePhoneBR } = await import("../../shared/whatsapp-types");
      const cleanPhone = normalizePhoneBR(input.telefone);
      if (!cleanPhone || cleanPhone.length < 12) {
        throw new Error("Telefone inválido. Informe DDD + número.");
      }

      // 1. Buscar ou reutilizar contato (verifica CPF + telefone antes de criar)
      const { id: contatoId } = await criarOuReutilizarContato({
        escritorioId: esc.escritorio.id,
        nome: input.nome || cleanPhone,
        telefone: cleanPhone,
        origem: "whatsapp",
      });

      // 2. Resolver JID via Baileys (resolve a quirk BR com/sem "9").
      //    Se o canal não estiver conectado, cai no JID literal — a mensagem
      //    falhará depois mas a conversa fica criada pra atendimento manual.
      const { getWhatsappManager } = await import("../integracoes/whatsapp-baileys");
      const manager = getWhatsappManager();
      let jid = `${cleanPhone}@s.whatsapp.net`;
      if (manager.isConectado(input.canalId)) {
        try {
          const resolvido = await manager.resolverJid(input.canalId, cleanPhone);
          if (resolvido) jid = resolvido;
        } catch (e: any) {
          log.warn({ err: e.message, telefone: cleanPhone }, "[CRM] Falha resolver JID, usando literal");
        }
      }

      // 3. Verificar se já existe conversa aberta com este contato+canal
      const existingConvs = await listarConversas(esc.escritorio.id, {});
      let conversaId: number | null = null;
      for (const c of existingConvs) {
        if (c.contatoId === contatoId && c.canalId === input.canalId &&
          (c.status === "aguardando" || c.status === "em_atendimento")) {
          conversaId = c.id;
          break;
        }
      }
      // Buscar também por chatIdExterno
      if (!conversaId) {
        for (const c of existingConvs) {
          if ((c as any).chatIdExterno === jid && c.canalId === input.canalId && c.status !== "fechado") {
            conversaId = c.id;
            break;
          }
        }
      }

      if (!conversaId) {
        conversaId = await criarConversa({
          escritorioId: esc.escritorio.id,
          contatoId,
          canalId: input.canalId,
          atendenteId: esc.colaborador.id,
          assunto: `WhatsApp: ${input.nome || cleanPhone}`,
          chatIdExterno: jid,
        });
      } else {
        // Reabrir conversa existente
        await atualizarConversa(conversaId, esc.escritorio.id, { status: "em_atendimento" });
      }

      // 4. Salvar mensagem no banco
      const msgId = await enviarMensagem({
        conversaId,
        remetenteId: esc.colaborador.id,
        direcao: "saida",
        conteudo: input.mensagem,
      });

      // 5. Enviar via WhatsApp (jid já resolvido acima)
      try {
        if (manager.isConectado(input.canalId)) {
          await manager.enviarMensagemJid(input.canalId, jid, input.mensagem);
          log.info(`[CRM] Nova conversa iniciada com ${cleanPhone} via WhatsApp (jid=${jid})`);
        }
      } catch (err: any) {
        log.error(`[CRM] Erro ao enviar 1ª mensagem:`, err.message);
      }

      return { conversaId, contatoId };
    }),

  // ─── Leads ─────────────────────────────────────────────────────────────────

  criarLead: protectedProcedure
    .input(z.object({
      contatoId: z.number(),
      conversaId: z.number().optional(),
      valorEstimado: z.string().optional(),
      origemLead: z.string().max(128).optional(),
      responsavelId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "pipeline", "criar", { fallbackModulo: "kanban" });
      if (!perm.allowed) throw new Error("Sem permissão para criar leads.");
      // Lead criado à mão fica com quem criou (ou com o responsável escolhido),
      // não com o rodízio (distribuirLead) — esse existe só pra lead que entra
      // sozinho pelo WhatsApp. Sortear outro atendente aqui era o bug "criou no
      // nome de outra pessoa".
      const { responsavelId: respEscolhido, ...rest } = input;
      const db = await getDb();
      const responsavelId =
        respEscolhido && db && (await colaboradorDoEscritorio(db, perm.escritorioId, respEscolhido))
          ? respEscolhido
          : perm.colaboradorId;
      const id = await criarLead({ escritorioId: perm.escritorioId, responsavelId, ...rest });
      return { id, responsavelId };
    }),

  listarLeads: protectedProcedure
    .input(z.object({ etapa: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "pipeline", "ver", { fallbackModulo: "kanban" });
      if (!perm.allowed) return [];
      const todos = await listarLeads(perm.escritorioId, input?.etapa);
      // verProprios: filtra in-memory (lista de leads é pequena por escritório)
      if (!perm.verTodos && perm.verProprios) {
        return todos.filter((l: any) => l.responsavelId === perm.colaboradorId);
      }
      return todos;
    }),

  atualizarLead: protectedProcedure
    .input(z.object({
      id: z.number(),
      etapaFunil: z.enum(["novo", "qualificado", "proposta", "negociacao", "fechado_ganho", "fechado_perdido"]).optional(),
      valorEstimado: z.string().optional(),
      responsavelId: z.number().optional(),
      probabilidade: z.number().min(0).max(100).optional(),
      motivoPerda: z.string().max(255).optional(),
      observacoes: z.string().max(2000).optional(),
      origemLead: z.string().max(128).nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "pipeline", "editar", { fallbackModulo: "kanban" });
      if (!perm.allowed) throw new Error("Sem permissão para editar leads.");
      const { id, ...dados } = input;
      await atualizarLead(id, perm.escritorioId, dados);

      // Lead chegou em "fechado_ganho" (fechou contrato) → promove o contato
      // a Cliente. Cobre arrastar o card pra "Ganho" no Pipeline e editar a
      // etapa na ficha. Idempotente. Mesmo gatilho do registrarFechamento.
      if (input.etapaFunil === "fechado_ganho") {
        const db = await getDb();
        if (db) {
          const [lead] = await db
            .select({ contatoId: leads.contatoId })
            .from(leads)
            .where(and(eq(leads.id, id), eq(leads.escritorioId, perm.escritorioId)))
            .limit(1);
          if (lead?.contatoId) {
            await db
              .update(contatos)
              .set({ estagio: "cliente" })
              .where(and(eq(contatos.id, lead.contatoId), eq(contatos.escritorioId, perm.escritorioId)));
          }
        }
      }
      return { success: true };
    }),

  excluirLead: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "pipeline", "excluir", { fallbackModulo: "kanban" });
      if (!perm.allowed) throw new Error("Sem permissão para excluir leads.");
      await excluirLead(input.id, perm.escritorioId);
      return { success: true };
    }),

  /** Cria lead a partir de uma conversa existente (da conversa para o pipeline) */
  criarLeadDeConversa: protectedProcedure
    .input(z.object({
      conversaId: z.number(),
      valorEstimado: z.string().optional(),
      responsavelId: z.number().optional(),
      etapaFunil: z.enum(["novo", "qualificado", "proposta", "negociacao", "fechado_ganho", "fechado_perdido"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");

      // Busca a conversa direto por id (NÃO via listarConversas, que é capada —
      // conversa além do limite dava "não encontrada" e quebrava o botão).
      const db = await getDb();
      if (!db) throw new Error("Database indisponível");
      const [conv] = await db
        .select({ contatoId: conversas.contatoId, atendenteId: conversas.atendenteId })
        .from(conversas)
        .where(and(eq(conversas.id, input.conversaId), eq(conversas.escritorioId, esc.escritorio.id)))
        .limit(1);
      if (!conv) throw new Error("Conversa não encontrada.");

      // Responsável: escolha explícita do operador → atendente da conversa →
      // quem está criando. NUNCA o rodízio (distribuirLead): ele existe pra lead
      // que chega sozinho pelo WhatsApp; criar a oportunidade à mão sorteando
      // outro atendente era o bug "cria a oportunidade no nome de outro".
      const responsavelId =
        input.responsavelId && (await colaboradorDoEscritorio(db, esc.escritorio.id, input.responsavelId))
          ? input.responsavelId
          : (conv.atendenteId ?? esc.colaborador.id);

      const id = await criarLead({
        escritorioId: esc.escritorio.id,
        contatoId: conv.contatoId,
        conversaId: input.conversaId,
        responsavelId,
        valorEstimado: input.valorEstimado,
        etapaFunil: input.etapaFunil,
        origemLead: "whatsapp",
      });
      return { id, responsavelId };
    }),

  // ─── Métricas ──────────────────────────────────────────────────────────────

  metricas: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return { totalContatos: 0, conversasAbertas: 0, conversasAguardando: 0, leadsNovos: 0, leadsGanhos: 0, valorPipeline: 0, tempoMedioResposta: 0 };
    return obterMetricasDashboard(esc.escritorio.id);
  }),

  /** Métricas detalhadas para dashboard do Atendimento */
  metricasDetalhadas: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return null;
    return obterMetricasDetalhadas(esc.escritorio.id);
  }),

  /** Transferir conversa para outro atendente */
  transferirConversa: protectedProcedure
    .input(z.object({ conversaId: z.number(), novoAtendenteId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");

      await atualizarConversa(input.conversaId, esc.escritorio.id, {
        atendenteId: input.novoAtendenteId,
        status: "em_atendimento",
      });

      // Registra a transferência como mensagem de sistema
      await enviarMensagem({
        conversaId: input.conversaId,
        remetenteId: esc.colaborador.id,
        direcao: "saida",
        tipo: "texto",
        conteudo: `[Sistema] Conversa transferida para outro atendente.`,
      });

      // Notifica via SSE
      try {
        const { emitirParaEscritorio } = await import("../_core/sse-notifications");
        emitirParaEscritorio(esc.escritorio.id, {
          tipo: "conversa_atribuida",
          titulo: "Conversa transferida",
          mensagem: `Conversa transferida para atendente #${input.novoAtendenteId}`,
          dados: { conversaId: input.conversaId, novoAtendenteId: input.novoAtendenteId },
        });
      } catch { /* SSE opcional */ }

      return { success: true };
    }),

  /** Lista atendentes do escritório (para seletor de transferência) */
  listarAtendentes: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return [];
    const db = await getDb();
    if (!db) return [];

    const { colaboradores, users } = await import("../../drizzle/schema");
    const { eq, and } = await import("drizzle-orm");
    const rows = await db
      .select({
        id: colaboradores.id,
        userId: colaboradores.userId,
        cargo: colaboradores.cargo,
        setorId: colaboradores.setorId,
        nome: users.name,
        email: users.email,
      })
      .from(colaboradores)
      .innerJoin(users, eq(colaboradores.userId, users.id))
      .where(and(eq(colaboradores.escritorioId, esc.escritorio.id), eq(colaboradores.ativo, true)));

    return rows;
  }),

  /** Vincular número de telefone adicional a um contato existente */
  vincularNumero: protectedProcedure
    .input(z.object({
      contatoId: z.number(),
      telefone: z.string().min(8).max(20),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      const db = await getDb();
      if (!db) throw new Error("DB indisponível");

      const { contatos } = await import("../../drizzle/schema");
      const { eq, and } = await import("drizzle-orm");

      // Buscar contato
      const [contato] = await db.select().from(contatos)
        .where(and(eq(contatos.id, input.contatoId), eq(contatos.escritorioId, esc.escritorio.id)))
        .limit(1);
      if (!contato) throw new Error("Contato não encontrado");

      // Adicionar ao campo telefonesAnteriores (histórico)
      const anteriores = contato.telefonesAnteriores
        ? JSON.parse(contato.telefonesAnteriores) as string[]
        : [];

      // Salvar telefone atual no histórico e colocar o novo como principal
      if (contato.telefone && !anteriores.includes(contato.telefone)) {
        anteriores.push(contato.telefone);
      }
      if (!anteriores.includes(input.telefone)) {
        anteriores.push(input.telefone);
      }

      await db.update(contatos)
        .set({ telefonesAnteriores: JSON.stringify(anteriores) })
        .where(eq(contatos.id, input.contatoId));

      return { success: true, telefonesAnteriores: anteriores };
    }),

  /**
   * Zera o contador de não lidas da conversa — chamado quando o atendente
   * a abre no inbox (e a cada mensagem que chega com ela aberta).
   */
  marcarConversaLida: protectedProcedure
    .input(z.object({ conversaId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      const db = await getDb();
      if (!db) throw new Error("DB indisponível");

      await db.update(conversas)
        .set({ lidaPeloAtendenteEm: new Date() })
        .where(and(eq(conversas.id, input.conversaId), eq(conversas.escritorioId, esc.escritorio.id)));

      return { success: true };
    }),

  /**
   * Vincular conversa a contato existente.
   *
   * Caso clássico: esposa do cliente chama de outro número → o handler do
   * WhatsApp cria um contato fantasma (lead só com nome/telefone) + a
   * conversa. O operador vincula ao cliente real. Quando o contato de
   * origem é esse fantasma, o cadastro inteiro é absorvido via
   * `unificarContatos`: conversas/leads migram, o número vira telefone
   * secundário do cliente (próximas mensagens já caem nele e o
   * atendente/SmartFlow veem o contexto certo) e o fantasma some.
   *
   * Cadastro de origem "rico" (com CPF, email, processo vinculado ou já
   * promovido a cliente) NÃO é absorvido — só a conversa muda de dono,
   * preservando o outro cadastro e o roteamento das mensagens dele.
   */
  vincularConversaAoContato: protectedProcedure
    .input(z.object({ conversaId: z.number(), contatoId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      const db = await getDb();
      if (!db) throw new Error("DB indisponível");

      const { clienteProcessos } = await import("../../drizzle/schema");

      const [conv] = await db.select({ id: conversas.id, contatoId: conversas.contatoId })
        .from(conversas)
        .where(and(eq(conversas.id, input.conversaId), eq(conversas.escritorioId, esc.escritorio.id)))
        .limit(1);
      if (!conv) throw new Error("Conversa não encontrada");

      const [destino] = await db.select({ id: contatos.id }).from(contatos)
        .where(and(eq(contatos.id, input.contatoId), eq(contatos.escritorioId, esc.escritorio.id)))
        .limit(1);
      if (!destino) throw new Error("Contato não encontrado");

      if (conv.contatoId === destino.id) return { success: true, unificado: false };

      const [origem] = await db.select().from(contatos)
        .where(and(eq(contatos.id, conv.contatoId), eq(contatos.escritorioId, esc.escritorio.id)))
        .limit(1);

      let ehFantasma = !!origem && !origem.cpfCnpj && !origem.email && origem.estagio === "lead";
      if (ehFantasma && origem) {
        const [processo] = await db.select({ id: clienteProcessos.id }).from(clienteProcessos)
          .where(and(
            eq(clienteProcessos.contatoId, origem.id),
            eq(clienteProcessos.escritorioId, esc.escritorio.id),
          ))
          .limit(1);
        if (processo) ehFantasma = false;
      }

      if (ehFantasma && origem) {
        await unificarContatos(esc.escritorio.id, destino.id, origem.id);
        return { success: true, unificado: true };
      }

      await db.update(conversas)
        .set({ contatoId: destino.id })
        .where(and(eq(conversas.id, input.conversaId), eq(conversas.escritorioId, esc.escritorio.id)));

      return { success: true, unificado: false };
    }),
});

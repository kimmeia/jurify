/**
 * Router tRPC — CRM: Contatos, Conversas, Mensagens, Leads
 * Fase 3
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getEscritorioPorUsuario } from "./db-escritorio";
import { getDb } from "../db";
import { checkPermission } from "./check-permission";
import {
  criarContato, listarContatos, atualizarContato,
  buscarContatoPorTelefone,
  criarConversa, listarConversas, atualizarConversa, excluirConversa,
  enviarMensagem, listarMensagens,
  criarLead, listarLeads, atualizarLead, excluirLead,
  obterMetricasDashboard, distribuirLead, obterMetricasDetalhadas,
} from "./db-crm";
import { conversas } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { excluirClienteEmCascata } from "./excluir-cliente";
import { createLogger } from "../_core/logger";
const log = createLogger("escritorio-router-crm");

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

  excluirContato: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      if (esc.colaborador.cargo !== "dono" && esc.colaborador.cargo !== "gestor") throw new Error("Sem permissão.");
      // Cascata: cancela cobranças no Asaas + deleta todos os dados
      // vinculados (conversas, mensagens, leads, tarefas, arquivos, etc).
      const resultado = await excluirClienteEmCascata(input.id, esc.escritorio.id);
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
      const atendenteId = await distribuirLead(esc.escritorio.id, input.contatoId) ?? esc.colaborador.id;
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
    }).optional())
    .query(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "atendimento", "ver");
      if (!perm.allowed) return [];
      const filtros = input ?? {};
      // Respeita verProprios — força filtro pelo próprio colaborador,
      // ignorando qualquer atendenteId vindo do client.
      if (!perm.verTodos && perm.verProprios) {
        filtros.atendenteId = perm.colaboradorId;
      }
      return listarConversas(perm.escritorioId, filtros);
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
              const destinatario = convData.chatIdExterno || convData.telefone;
              if (destinatario) {
                await manager.enviarMensagemJid(convData.canalId, destinatario, input.conteudo);
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
                  const client = new WhatsAppCloudClient({ accessToken: config.accessToken, phoneNumberId: config.phoneNumberId });
                  const telefone = convData.telefone?.replace(/\D/g, "") || "";
                  if (telefone) {
                    const msgId = await client.enviarTexto(telefone, input.conteudo);
                    log.info(`[CRM] Mensagem enviada via Cloud API CoEx para ${telefone} (msgId: ${msgId})`);
                    // Atualizar idExterno da mensagem para rastrear status
                    if (msgId) {
                      const { mensagens } = await import("../../drizzle/schema");
                      await db.update(mensagens).set({ idExterno: msgId, status: "enviada" }).where(eq(mensagens.id, id));
                    }
                  }
                } else { log.warn(`[CRM] Canal CoEx ${convData.canalId} sem accessToken ou phoneNumberId`); }
              }
            } catch (cloudErr: any) { log.error(`[CRM] Erro ao enviar via Cloud API:`, cloudErr.message); }
          }
        }
      } catch (err: any) {
        // Não falhar a mutation se WhatsApp der erro — mensagem já está salva
        log.error(`[CRM] Erro ao enviar via WhatsApp:`, err.message, err.stack);
      }

      return { id };
    }),

  listarMensagens: protectedProcedure
    .input(z.object({ conversaId: z.number(), limite: z.number().max(200).optional() }))
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
      return listarMensagens(input.conversaId, input.limite ?? 50);
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

      // 1. Buscar contato existente por telefone (query exata, não .endsWith)
      const contatoExistente = await buscarContatoPorTelefone(esc.escritorio.id, cleanPhone);
      let contatoId: number;
      if (contatoExistente) {
        contatoId = contatoExistente.id;
      } else {
        contatoId = await criarContato({
          escritorioId: esc.escritorio.id,
          nome: input.nome || cleanPhone,
          telefone: cleanPhone,
          origem: "whatsapp",
        });
      }

      // 2. Verificar se já existe conversa aberta com este contato+canal
      const jid = `${cleanPhone}@s.whatsapp.net`;
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

      // 3. Salvar mensagem no banco
      const msgId = await enviarMensagem({
        conversaId,
        remetenteId: esc.colaborador.id,
        direcao: "saida",
        conteudo: input.mensagem,
      });

      // 4. Enviar via WhatsApp
      try {
        const { getWhatsappManager } = await import("../integracoes/whatsapp-baileys");
        const manager = getWhatsappManager();
        if (manager.isConectado(input.canalId)) {
          await manager.enviarMensagemJid(input.canalId, jid, input.mensagem);
          log.info(`[CRM] Nova conversa iniciada com ${cleanPhone} via WhatsApp`);
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
    }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "pipeline", "criar");
      if (!perm.allowed) throw new Error("Sem permissão para criar leads.");
      const responsavelId = await distribuirLead(perm.escritorioId, input.contatoId) ?? perm.colaboradorId;
      const id = await criarLead({ escritorioId: perm.escritorioId, responsavelId, ...input });
      return { id, responsavelId };
    }),

  listarLeads: protectedProcedure
    .input(z.object({ etapa: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "pipeline", "ver");
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
    }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "pipeline", "editar");
      if (!perm.allowed) throw new Error("Sem permissão para editar leads.");
      const { id, ...dados } = input;
      await atualizarLead(id, perm.escritorioId, dados);
      return { success: true };
    }),

  excluirLead: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "pipeline", "excluir");
      if (!perm.allowed) throw new Error("Sem permissão para excluir leads.");
      await excluirLead(input.id, perm.escritorioId);
      return { success: true };
    }),

  /** Cria lead a partir de uma conversa existente (da conversa para o pipeline) */
  criarLeadDeConversa: protectedProcedure
    .input(z.object({
      conversaId: z.number(),
      valorEstimado: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");

      // Buscar a conversa para pegar contatoId
      const convs = await listarConversas(esc.escritorio.id, {});
      const conv = convs.find(c => c.id === input.conversaId);
      if (!conv) throw new Error("Conversa não encontrada.");

      const responsavelId = await distribuirLead(esc.escritorio.id, conv.contatoId) ?? esc.colaborador.id;
      const id = await criarLead({
        escritorioId: esc.escritorio.id,
        contatoId: conv.contatoId,
        conversaId: input.conversaId,
        responsavelId,
        valorEstimado: input.valorEstimado,
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

  /** Vincular conversa a contato existente (mesclar) */
  vincularConversaAoContato: protectedProcedure
    .input(z.object({ conversaId: z.number(), contatoId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      const db = await getDb();
      if (!db) throw new Error("DB indisponível");

      const { conversas } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      await db.update(conversas)
        .set({ contatoId: input.contatoId })
        .where(eq(conversas.id, input.conversaId));

      return { success: true };
    }),
});

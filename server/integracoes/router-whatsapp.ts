/**
 * Router tRPC — WhatsApp Baileys: Sessão QR, Envio de Mensagens
 * Etapa 3: Endpoints para conectar/desconectar WhatsApp, enviar mensagens
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { atualizarStatusCanal, registrarAudit } from "../escritorio/db-canais";
import { getWhatsappManager } from "./whatsapp-baileys";
import { processarMensagemRecebida } from "./whatsapp-handler";
import type { WhatsappSessionStatus } from "../../shared/whatsapp-types";

// ─── Inicializar callbacks do manager ────────────────────────────────────────

const manager = getWhatsappManager();

// Callback: quando mensagem chega, processa no CRM
manager.setOnMensagem(async (canalId, escritorioId, msg) => {
  try {
    await processarMensagemRecebida(canalId, escritorioId, msg);
  } catch (err: any) {
    console.error(`[WhatsApp Router] Erro ao processar mensagem canal ${canalId}:`, err.message);
  }
});

// Callback: quando status muda, atualiza no banco
manager.setOnStatusChange(async (canalId, status, extra) => {
  try {
    const dbStatus = mapStatusToDb(status);
    const mensagemErro = (extra?.error as string) || undefined;

    const { getDb } = await import("../db");
    const { canaisIntegrados } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const db = await getDb();
    if (db) {
      const [canal] = await db.select({ escritorioId: canaisIntegrados.escritorioId })
        .from(canaisIntegrados).where(eq(canaisIntegrados.id, canalId)).limit(1);
      if (canal) {
        await atualizarStatusCanal(canalId, canal.escritorioId, dbStatus, mensagemErro);
        console.log(`[WhatsApp Router] Status canal ${canalId} atualizado: ${dbStatus}`);
      }
    }
  } catch (err: any) {
    console.error(`[WhatsApp Router] Erro ao atualizar status canal ${canalId}:`, err.message);
  }
});

// Auto-restaurar sessões ao iniciar o servidor (após 5s para dar tempo do DB conectar)
setTimeout(async () => {
  try {
    const { getDb } = await import("../db");
    const { canaisIntegrados } = await import("../../drizzle/schema");
    const { eq, and } = await import("drizzle-orm");
    const db = await getDb();
    if (db) {
      const canais = await db.select({ id: canaisIntegrados.id, escritorioId: canaisIntegrados.escritorioId })
        .from(canaisIntegrados)
        .where(and(eq(canaisIntegrados.tipo, "whatsapp_qr"), eq(canaisIntegrados.status, "conectado")));
      if (canais.length > 0) {
        console.log(`[WhatsApp Router] Restaurando ${canais.length} sessão(ões) WhatsApp...`);
        await manager.restaurarSessoesSalvas(canais.map(c => ({ canalId: c.id, escritorioId: c.escritorioId })));
      }
    }
  } catch (err: any) {
    console.error(`[WhatsApp Router] Erro ao restaurar sessões:`, err.message);
  }
}, 5000);

function mapStatusToDb(status: WhatsappSessionStatus): "conectado" | "desconectado" | "pendente" | "erro" | "banido" {
  switch (status) {
    case "conectado": return "conectado";
    case "desconectado": return "desconectado";
    case "aguardando_qr": return "pendente";
    case "conectando": return "pendente";
    case "erro": return "erro";
    case "banido": return "banido";
    default: return "desconectado";
  }
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const whatsappRouter = router({
  /** Inicia sessão WhatsApp (gera QR code) */
  iniciarSessao: protectedProcedure
    .input(z.object({ canalId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      if (esc.colaborador.cargo !== "dono" && esc.colaborador.cargo !== "gestor") {
        throw new Error("Apenas donos e gestores podem conectar WhatsApp.");
      }

      const info = await manager.iniciarSessao(input.canalId, esc.escritorio.id);

      // Atualizar status no banco
      const dbStatus = mapStatusToDb(info.status);
      await atualizarStatusCanal(input.canalId, esc.escritorio.id, dbStatus, info.mensagemErro);

      await registrarAudit({
        escritorioId: esc.escritorio.id,
        colaboradorId: esc.colaborador.id,
        canalId: input.canalId,
        acao: "conectou",
        detalhes: `WhatsApp sessão iniciada. Status: ${info.status}`,
      });

      return info;
    }),

  /** Desconecta sessão WhatsApp */
  desconectarSessao: protectedProcedure
    .input(z.object({ canalId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      if (esc.colaborador.cargo !== "dono" && esc.colaborador.cargo !== "gestor") {
        throw new Error("Sem permissão.");
      }

      await manager.desconectarSessao(input.canalId);
      await atualizarStatusCanal(input.canalId, esc.escritorio.id, "desconectado");

      await registrarAudit({
        escritorioId: esc.escritorio.id,
        colaboradorId: esc.colaborador.id,
        canalId: input.canalId,
        acao: "desconectou",
        detalhes: "WhatsApp desconectado manualmente",
      });

      return { success: true };
    }),

  /** Obtém status/QR da sessão (polling) */
  statusSessao: protectedProcedure
    .input(z.object({ canalId: z.number() }))
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");

      return manager.getSessionInfo(input.canalId);
    }),

  /** Envia mensagem de texto via WhatsApp */
  enviarMensagem: protectedProcedure
    .input(z.object({
      canalId: z.number(),
      telefone: z.string().min(10).max(20),
      conteudo: z.string().min(1).max(5000),
      tipo: z.enum(["texto", "imagem", "audio", "documento"]).optional(),
      mediaUrl: z.string().url().optional(),
      mediaCaption: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");

      if (!manager.isConectado(input.canalId)) {
        throw new Error("WhatsApp não conectado. Inicie a sessão primeiro.");
      }

      const result = await manager.enviarMensagem(input.canalId, {
        telefone: input.telefone,
        conteudo: input.conteudo,
        tipo: input.tipo,
        mediaUrl: input.mediaUrl,
        mediaCaption: input.mediaCaption,
      });

      return result;
    }),

  /** Lista todas as sessões ativas do escritório */
  sessoes: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return [];

    // Retorna apenas sessões do escritório (o manager é global)
    const todas = manager.listarSessoes();
    // TODO: filtrar por escritorioId quando disponível no state
    return todas;
  }),
});

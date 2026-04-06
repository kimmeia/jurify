/**
 * Router tRPC — Twilio VoIP: Chamadas telefônicas
 * 
 * Rotas:
 * - iniciarChamada: liga para um número usando Twilio
 * - statusChamada: consulta status de uma chamada ativa
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { listarCanais, obterConfigCanal } from "../escritorio/db-canais";
import { iniciarChamada, statusChamada, encerrarChamada } from "./twilio-client";
import type { TwilioConfig } from "./twilio-client";

/** Helper: obtém config do Twilio para o escritório do usuário */
async function getTwilioConfig(userId: number): Promise<{ config: TwilioConfig; escritorioId: number }> {
  const esc = await getEscritorioPorUsuario(userId);
  if (!esc) throw new Error("Escritório não encontrado.");

  const canais = await listarCanais(esc.escritorio.id);
  const twilioCanal = canais.find(c => c.tipo === "telefone_voip" && c.temConfig);
  if (!twilioCanal) throw new Error("Twilio não configurado. Vá em Configurações → Integrações → Twilio VoIP.");

  const config = await obterConfigCanal(twilioCanal.id, esc.escritorio.id);
  if (!config || !config.twilioSid || !config.twilioAuthToken || !config.twilioPhoneNumber) {
    throw new Error("Configuração do Twilio incompleta. Verifique SID, Auth Token e Número.");
  }

  return {
    config: {
      twilioSid: config.twilioSid,
      twilioAuthToken: config.twilioAuthToken,
      twilioPhoneNumber: config.twilioPhoneNumber,
    },
    escritorioId: esc.escritorio.id,
  };
}

export const twilioRouter = router({
  /** Inicia uma chamada telefônica via Twilio */
  iniciarChamada: protectedProcedure
    .input(z.object({
      destino: z.string().min(8, "Número inválido"),
    }))
    .mutation(async ({ ctx, input }) => {
      const { config } = await getTwilioConfig(ctx.user.id);
      const resultado = await iniciarChamada(config, input.destino);

      if (!resultado.success) {
        throw new Error(resultado.erro || "Falha ao iniciar chamada");
      }

      return {
        callSid: resultado.callSid,
        status: resultado.status,
      };
    }),

  /** Consulta status de uma chamada */
  statusChamada: protectedProcedure
    .input(z.object({
      callSid: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { config } = await getTwilioConfig(ctx.user.id);
      return statusChamada(config, input.callSid);
    }),

  /** Encerra uma chamada ativa */
  encerrarChamada: protectedProcedure
    .input(z.object({
      callSid: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { config } = await getTwilioConfig(ctx.user.id);
      const resultado = await encerrarChamada(config, input.callSid);
      if (!resultado.success) {
        throw new Error(resultado.erro || "Falha ao encerrar chamada");
      }
      return { success: true };
    }),
});

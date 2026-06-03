/**
 * Router tRPC — WhatsApp Business Calling API (ligação de voz no mesmo número).
 *
 * Usa o MESMO canal `whatsapp_api` (phone_number_id) já conectado pra mensagem.
 * Control plane das chamadas:
 *   - habilitar/checar calling no número (gestão)
 *   - pedir permissão de ligação ao cliente (pré-requisito de saída)
 *   - iniciar (saída) / aceitar / recusar / encerrar chamadas
 *   - histórico de chamadas
 *
 * A troca de SDP (offer/answer) é o navegador do atendente quem faz: estas
 * mutations recebem/repassam o SDP pra Meta. A sinalização em tempo real
 * (entregar o `connect` recebido ao navegador) é a Fase 2.
 */

import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { chamadas } from "../../drizzle/schema";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { obterConfigCanal } from "../escritorio/db-canais";
import { checkPermissionAdminOuMatriz } from "../escritorio/check-permission";
import { WhatsAppCloudClient } from "../integracoes/whatsapp-cloud";
import { explicarErroFacebook } from "./meta-channels";
import { createLogger } from "../_core/logger";

const log = createLogger("router-whatsapp-calling");

/**
 * Executa uma chamada à Graph API traduzindo erros 4xx pro motivo REAL da Meta
 * (`err.response.data.error.message`) em vez do genérico "Request failed with
 * status code 400" do axios. Loga o envelope completo — erro de integração
 * externa não pode viver só no response (observabilidade).
 */
async function comErroMeta<T>(contexto: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    log.warn(
      { status: err?.response?.status, fbError: err?.response?.data?.error },
      `[Calling] ${contexto} falhou`,
    );
    throw new Error(explicarErroFacebook(err, contexto));
  }
}

interface EscInfo {
  escritorioId: number;
  colaboradorId: number;
}

/** Resolve o escritório do usuário (lança erro legível se ausente). */
async function getEsc(userId: number): Promise<EscInfo> {
  const esc = await getEscritorioPorUsuario(userId);
  if (!esc) throw new Error("Escritório não encontrado.");
  return { escritorioId: esc.escritorio.id, colaboradorId: esc.colaborador.id };
}

/** Monta o client Cloud a partir da config (decriptada) de um canal do escritório. */
async function clientDoCanal(escritorioId: number, canalId: number): Promise<WhatsAppCloudClient> {
  const cfg = await obterConfigCanal(canalId, escritorioId);
  if (!cfg?.accessToken || !cfg?.phoneNumberId) {
    throw new Error(
      "Canal WhatsApp Business API (Cloud) não configurado. Conecte o número em Configurações → Integrações.",
    );
  }
  return new WhatsAppCloudClient({
    accessToken: cfg.accessToken,
    phoneNumberId: cfg.phoneNumberId,
    wabaId: cfg.wabaId,
  });
}

/**
 * Carrega a chamada pelo call_id GARANTINDO que pertence ao escritório do
 * usuário (defesa contra atuar numa chamada de outro tenant). Devolve também o
 * client do canal dono da chamada, pronto pra aceitar/encerrar.
 */
async function carregarChamada(userId: number, callId: string) {
  const esc = await getEsc(userId);
  const db = await getDb();
  if (!db) throw new Error("DB indisponível");
  const [cham] = await db
    .select()
    .from(chamadas)
    .where(and(eq(chamadas.callIdExterno, callId), eq(chamadas.escritorioId, esc.escritorioId)))
    .limit(1);
  if (!cham) throw new Error("Chamada não encontrada.");
  const client = await clientDoCanal(esc.escritorioId, cham.canalId);
  return { esc, cham, client };
}

async function exigirGestao(userId: number): Promise<void> {
  const perm = await checkPermissionAdminOuMatriz(userId, "configuracoes", "editar");
  if (!perm.allowed) {
    throw new Error(
      "Apenas donos, gestores ou cargos com permissão de editar configurações podem alterar a ligação do WhatsApp.",
    );
  }
}

export const whatsappCallingRouter = router({
  /** Lê se a ligação está habilitada no número + config bruta da Meta. */
  statusCalling: protectedProcedure
    .input(z.object({ canalId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const esc = await getEsc(ctx.user.id);
      const client = await clientDoCanal(esc.escritorioId, input.canalId);
      const raw = await comErroMeta("Falha ao ler a configuração de ligação", () =>
        client.getCallingSettings(),
      );
      const status = typeof raw.status === "string" ? raw.status : "";
      return { habilitado: status.toUpperCase() === "ENABLED", status, raw };
    }),

  /** Habilita/desabilita ligação no número (gestão). */
  definirCalling: protectedProcedure
    .input(
      z.object({
        canalId: z.number().int().positive(),
        habilitar: z.boolean(),
        mostrarIcone: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await exigirGestao(ctx.user.id);
      const esc = await getEsc(ctx.user.id);
      const client = await clientDoCanal(esc.escritorioId, input.canalId);
      const extra =
        input.mostrarIcone === undefined
          ? undefined
          : { call_icon_visibility: input.mostrarIcone ? "DEFAULT" : "DISABLE_ALL" };
      await comErroMeta("Falha ao alterar a ligação", () =>
        client.definirStatusCalling(input.habilitar ? "ENABLED" : "DISABLED", extra),
      );
      return { habilitado: input.habilitar };
    }),

  /** Envia o pedido de permissão de ligação ao cliente (pré-requisito de saída). */
  pedirPermissao: protectedProcedure
    .input(
      z.object({
        canalId: z.number().int().positive(),
        telefone: z.string().min(8),
        texto: z.string().min(1).max(1024).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await getEsc(ctx.user.id);
      const client = await clientDoCanal(esc.escritorioId, input.canalId);
      const texto =
        input.texto ||
        "Podemos te ligar pelo WhatsApp para falar sobre o seu atendimento?";
      const messageId = await comErroMeta("Falha ao enviar o pedido de permissão", () =>
        client.pedirPermissaoLigacao(input.telefone, texto),
      );
      return { messageId };
    }),

  /**
   * Inicia uma chamada da empresa pro cliente (saída) com o SDP offer do
   * navegador. Registra a chamada no log já com o call_id retornado.
   */
  iniciarChamada: protectedProcedure
    .input(
      z.object({
        canalId: z.number().int().positive(),
        telefone: z.string().min(8),
        sdpOffer: z.string().min(1),
        contatoId: z.number().int().positive().optional(),
        conversaId: z.number().int().positive().optional(),
        bizOpaqueCallbackData: z.string().max(255).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await getEsc(ctx.user.id);
      const client = await clientDoCanal(esc.escritorioId, input.canalId);
      const callId = await comErroMeta("Falha ao iniciar a chamada", () =>
        client.iniciarChamada(input.telefone, input.sdpOffer, input.bizOpaqueCallbackData),
      );
      if (!callId) throw new Error("A Meta não retornou o identificador da chamada.");

      const db = await getDb();
      if (db) {
        await db.insert(chamadas).values({
          escritorioId: esc.escritorioId,
          canalId: input.canalId,
          contatoId: input.contatoId ?? null,
          conversaId: input.conversaId ?? null,
          atendenteId: esc.colaboradorId,
          callIdExterno: callId,
          direcao: "saida",
          status: "conectando",
          telefone: input.telefone.replace(/\D/g, ""),
          bizOpaqueCallbackData: input.bizOpaqueCallbackData ?? null,
        });
      }
      log.info({ callId, telefone: input.telefone.replace(/\D/g, "") }, "[Calling] chamada de saída iniciada");
      return { callId };
    }),

  /** Pre-aceita uma chamada recebida com o SDP answer (prepara mídia). */
  preAceitar: protectedProcedure
    .input(z.object({ callId: z.string().min(1), sdpAnswer: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { client } = await carregarChamada(ctx.user.id, input.callId);
      await comErroMeta("Falha ao pré-aceitar a chamada", () =>
        client.preAceitarChamada(input.callId, input.sdpAnswer),
      );
      const db = await getDb();
      if (db) {
        await db
          .update(chamadas)
          .set({ status: "conectando" })
          .where(eq(chamadas.callIdExterno, input.callId));
      }
      return { ok: true };
    }),

  /** Aceita (atende) uma chamada recebida com o SDP answer. */
  aceitar: protectedProcedure
    .input(z.object({ callId: z.string().min(1), sdpAnswer: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { esc, client } = await carregarChamada(ctx.user.id, input.callId);
      await comErroMeta("Falha ao atender a chamada", () =>
        client.aceitarChamada(input.callId, input.sdpAnswer),
      );
      const db = await getDb();
      if (db) {
        await db
          .update(chamadas)
          .set({ status: "em_andamento", atendenteId: esc.colaboradorId, atendidaEm: new Date() })
          .where(eq(chamadas.callIdExterno, input.callId));
      }
      return { ok: true };
    }),

  /** Recusa uma chamada recebida. */
  rejeitar: protectedProcedure
    .input(z.object({ callId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { client } = await carregarChamada(ctx.user.id, input.callId);
      await comErroMeta("Falha ao recusar a chamada", () => client.rejeitarChamada(input.callId));
      const db = await getDb();
      if (db) {
        await db
          .update(chamadas)
          .set({ status: "rejeitada", encerradaEm: new Date() })
          .where(eq(chamadas.callIdExterno, input.callId));
      }
      return { ok: true };
    }),

  /** Encerra uma chamada em andamento (de qualquer direção). */
  encerrar: protectedProcedure
    .input(z.object({ callId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { client } = await carregarChamada(ctx.user.id, input.callId);
      await comErroMeta("Falha ao encerrar a chamada", () => client.encerrarChamada(input.callId));
      const db = await getDb();
      if (db) {
        await db
          .update(chamadas)
          .set({ status: "encerrada", encerradaEm: new Date() })
          .where(eq(chamadas.callIdExterno, input.callId));
      }
      return { ok: true };
    }),

  /** Histórico de chamadas do escritório (opcionalmente filtrado por contato). */
  historico: protectedProcedure
    .input(
      z
        .object({
          contatoId: z.number().int().positive().optional(),
          limit: z.number().int().min(1).max(200).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const esc = await getEsc(ctx.user.id);
      const db = await getDb();
      if (!db) return [];
      const cond = input?.contatoId
        ? and(eq(chamadas.escritorioId, esc.escritorioId), eq(chamadas.contatoId, input.contatoId))
        : eq(chamadas.escritorioId, esc.escritorioId);
      return db
        .select()
        .from(chamadas)
        .where(cond)
        .orderBy(desc(chamadas.createdAt))
        .limit(input?.limit ?? 50);
    }),
});

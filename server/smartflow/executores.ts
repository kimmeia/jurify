/**
 * SmartFlow Executores Reais — implementação concreta dos handlers.
 *
 * Conecta o engine puro aos serviços externos:
 * - IA: OpenAI / Anthropic (via resolverAPIKey)
 * - Cal.com: buscar horários e criar agendamentos
 * - WhatsApp: enviar mensagens
 */

import { SmartflowExecutores } from "./engine";
import { createLogger } from "../_core/logger";

const log = createLogger("smartflow-executores");

/**
 * Resolve o client Cal.com para um escritório — lê o canal com `tipo=calcom`,
 * descriptografa config e devolve um `CalcomClient` pronto. Retorna `null`
 * se o escritório não tem canal configurado.
 */
async function obterCalcomClient(escritorioId: number, defaultDuration = 30) {
  const { getDb } = await import("../db");
  const { canaisIntegrados } = await import("../../drizzle/schema");
  const { eq, and, or: orOp, like } = await import("drizzle-orm");
  const { decryptConfig } = await import("../escritorio/crypto-utils");
  const db = await getDb();
  if (!db) return null;

  const [canal] = await db
    .select()
    .from(canaisIntegrados)
    .where(
      and(
        eq(canaisIntegrados.escritorioId, escritorioId),
        orOp(eq(canaisIntegrados.tipo, "calcom"), like(canaisIntegrados.nome, "%Cal.com%")),
      ),
    )
    .limit(1);

  if (!canal?.configEncrypted || !canal.configIv || !canal.configTag) return null;
  const cfg = decryptConfig(canal.configEncrypted, canal.configIv, canal.configTag);
  if (!cfg?.apiKey) return null;

  const { CalcomClient } = await import("../integracoes/calcom-client");
  return new CalcomClient({
    apiKey: cfg.apiKey,
    baseUrl: cfg.baseUrl || "https://api.cal.com/v2",
    defaultDuration,
  });
}

/**
 * Cria executores reais para um escritório específico.
 */
export function criarExecutoresReais(escritorioId: number): SmartflowExecutores {
  return {
    async chamarIA(prompt: string, mensagem: string): Promise<string> {
      // Resolve API key do escritório (ChatGPT ou Claude)
      const { obterConfigChatBot, gerarRespostaAnthropic } = await import("../integracoes/chatbot-openai");
      const config = await obterConfigChatBot(escritorioId);

      if (config?.openaiApiKey) {
        // OpenAI
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${config.openaiApiKey}` },
          body: JSON.stringify({
            model: config.modelo || "gpt-4o-mini",
            messages: [{ role: "system", content: prompt }, { role: "user", content: mensagem }],
            max_tokens: 300,
            temperature: 0.3,
          }),
        });
        if (!res.ok) throw new Error(`OpenAI ${res.status}`);
        const data = await res.json();
        return data.choices?.[0]?.message?.content?.trim() || "";
      }

      // Tenta Claude via canal
      try {
        const { getDb } = await import("../db");
        const { canaisIntegrados } = await import("../../drizzle/schema");
        const { eq, and, or: orOp, like } = await import("drizzle-orm");
        const { decryptConfig } = await import("../escritorio/crypto-utils");
        const db = await getDb();
        if (db) {
          const [canal] = await db.select().from(canaisIntegrados)
            .where(and(eq(canaisIntegrados.escritorioId, escritorioId), orOp(eq(canaisIntegrados.tipo, "claude"), like(canaisIntegrados.nome, "%Claude%"))))
            .limit(1);
          if (canal?.configEncrypted && canal.configIv && canal.configTag) {
            const cfg = decryptConfig(canal.configEncrypted, canal.configIv, canal.configTag);
            if (cfg?.anthropicApiKey) {
              const result = await gerarRespostaAnthropic(cfg.anthropicApiKey, "claude-haiku-4-5-20251001", prompt, [], mensagem, 300, 0.3);
              if (result.resposta) return result.resposta;
            }
          }
        }
      } catch { /* fallback */ }

      throw new Error("Nenhuma IA configurada. Configure em Integrações → ChatGPT ou Claude.");
    },

    async executarAgente(agenteId: number, mensagem: string): Promise<string> {
      const { obterAgentePorId } = await import("../integracoes/router-agentes-ia");
      const cfg = await obterAgentePorId(escritorioId, agenteId);
      if (!cfg) {
        throw new Error(`Agente ${agenteId} não encontrado, inativo ou sem API key configurada.`);
      }

      // Concatena prompt do agente + bloco de docs RAG já formatado.
      const systemPrompt = [cfg.prompt, cfg.contextoDocumentos].filter(Boolean).join("\n\n");

      if (cfg.provider === "anthropic") {
        const { gerarRespostaAnthropic } = await import("../integracoes/chatbot-openai");
        const r = await gerarRespostaAnthropic(
          cfg.anthropicApiKey!,
          cfg.modelo,
          systemPrompt,
          [],
          mensagem,
          cfg.maxTokens,
          cfg.temperatura,
        );
        if (r.erro) throw new Error(`Agente Anthropic: ${r.erro}`);
        return r.resposta || "";
      }

      // OpenAI
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.openaiApiKey}`,
        },
        body: JSON.stringify({
          model: cfg.modelo || "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: mensagem },
          ],
          max_tokens: cfg.maxTokens,
          temperature: cfg.temperatura,
        }),
      });
      if (!res.ok) throw new Error(`Agente OpenAI: ${res.status}`);
      const data = await res.json();
      return data.choices?.[0]?.message?.content?.trim() || "";
    },

    async buscarHorarios(duracao: number): Promise<string[]> {
      try {
        const client = await obterCalcomClient(escritorioId, duracao);
        if (!client) return [];
        // Busca event types primeiro pra pegar o ID
        const eventTypes = await client.listarEventTypes();
        if (eventTypes.length === 0) return [];
        const now = new Date();
        const endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 dias
        const slots = await client.buscarSlots({
          eventTypeId: eventTypes[0].id,
          startTime: now.toISOString(),
          endTime: endDate.toISOString(),
        });
        return slots.map((s: any) => {
          const d = new Date(s.time || s.start);
          return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
        }).slice(0, 10);
      } catch (err: any) {
        log.error({ err: err.message }, "SmartFlow: erro ao buscar horários Cal.com");
        return [];
      }
    },

    async criarAgendamento(horario: string, nome: string, email: string): Promise<string> {
      try {
        const client = await obterCalcomClient(escritorioId);
        if (!client) throw new Error("Cal.com não configurado");

        const eventTypes = await client.listarEventTypes();
        if (eventTypes.length === 0) throw new Error("Nenhum tipo de evento configurado no Cal.com");

        const booking = await client.criarBooking({
          eventTypeId: eventTypes[0].id,
          start: horario,
          name: nome || "Cliente",
          email: email || "cliente@jurify.com.br",
        });

        if (!booking) throw new Error("Falha ao criar agendamento no Cal.com");
        log.info({ bookingId: booking.id, horario, nome }, "SmartFlow: agendamento criado no Cal.com");
        return String(booking.id);
      } catch (err: any) {
        log.error({ err: err.message }, "SmartFlow: erro ao criar agendamento Cal.com");
        throw err;
      }
    },

    async listarBookings(params) {
      try {
        const client = await obterCalcomClient(escritorioId);
        if (!client) return [];
        const bookings = await client.listarBookings({ status: params?.status || "upcoming" });
        return bookings.map((b) => ({
          id: b.id,
          titulo: b.title,
          startTime: b.startTime,
          endTime: b.endTime,
          status: b.status,
          attendeeNome: b.attendees?.[0]?.name,
          attendeeEmail: b.attendees?.[0]?.email,
        }));
      } catch (err: any) {
        log.error({ err: err.message }, "SmartFlow: erro ao listar bookings Cal.com");
        return [];
      }
    },

    async cancelarBooking(bookingId, motivo) {
      try {
        const client = await obterCalcomClient(escritorioId);
        if (!client) return false;
        const id = Number(bookingId);
        if (Number.isNaN(id)) throw new Error(`bookingId inválido: ${bookingId}`);
        const ok = await client.cancelarBooking(id, motivo);
        if (ok) log.info({ bookingId: id }, "SmartFlow: booking cancelado no Cal.com");
        return ok;
      } catch (err: any) {
        log.error({ err: err.message }, "SmartFlow: erro ao cancelar booking Cal.com");
        return false;
      }
    },

    async reagendarBooking(bookingId, novoHorario, motivo) {
      try {
        const client = await obterCalcomClient(escritorioId);
        if (!client) return false;
        const id = Number(bookingId);
        if (Number.isNaN(id)) throw new Error(`bookingId inválido: ${bookingId}`);
        const res = await client.reagendarBooking(id, { start: novoHorario, reason: motivo });
        if (res) log.info({ bookingId: id, novoHorario }, "SmartFlow: booking reagendado no Cal.com");
        return !!res;
      } catch (err: any) {
        log.error({ err: err.message }, "SmartFlow: erro ao reagendar booking Cal.com");
        return false;
      }
    },

    async enviarWhatsApp(telefone: string, mensagem: string): Promise<boolean> {
      // Delega pro manager do WhatsApp já existente
      try {
        const { getDb } = await import("../db");
        const { canaisIntegrados } = await import("../../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) return false;

        // Busca canal WhatsApp ativo do escritório
        const canais = await db.select().from(canaisIntegrados)
          .where(and(
            eq(canaisIntegrados.escritorioId, escritorioId),
            eq(canaisIntegrados.tipo, "whatsapp_qr"),
            eq(canaisIntegrados.status, "conectado"),
          ))
          .limit(1);

        if (canais.length === 0) return false;
        const canalId = canais[0].id;

        const { getWhatsappManager } = await import("../integracoes/whatsapp-baileys");
        const m = getWhatsappManager();
        if (m.isConectado(canalId)) {
          await m.enviarMensagemJid(canalId, telefone, mensagem);
          return true;
        }
        return false;
      } catch (err: any) {
        log.error({ err: err.message }, "SmartFlow: erro ao enviar WhatsApp");
        return false;
      }
    },

    async criarCardKanban(params): Promise<number> {
      try {
        const { getDb } = await import("../db");
        const { kanbanCards, kanbanColunas, kanbanFunis } = await import("../../drizzle/schema");
        const { eq, and, asc } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) throw new Error("DB indisponível");

        let colunaId = params.colunaId;

        // Se não tem colunaId mas tem funilId, pega a primeira coluna
        if (!colunaId && params.funilId) {
          const [col] = await db.select({ id: kanbanColunas.id }).from(kanbanColunas)
            .where(eq(kanbanColunas.funilId, params.funilId))
            .orderBy(asc(kanbanColunas.ordem)).limit(1);
          colunaId = col?.id;
        }

        // Se não tem funilId nem colunaId, pega o primeiro funil do escritório
        if (!colunaId) {
          const [funil] = await db.select({ id: kanbanFunis.id }).from(kanbanFunis)
            .where(eq(kanbanFunis.escritorioId, escritorioId)).limit(1);
          if (funil) {
            const [col] = await db.select({ id: kanbanColunas.id }).from(kanbanColunas)
              .where(eq(kanbanColunas.funilId, funil.id))
              .orderBy(asc(kanbanColunas.ordem)).limit(1);
            colunaId = col?.id;
          }
        }

        if (!colunaId) throw new Error("Nenhum funil/coluna encontrado. Crie um funil no Kanban primeiro.");

        // Verificar duplicata por asaasPaymentId
        if (params.asaasPaymentId) {
          const [existente] = await db.select({ id: kanbanCards.id }).from(kanbanCards)
            .where(eq(kanbanCards.asaasPaymentId, params.asaasPaymentId)).limit(1);
          if (existente) return existente.id; // Já existe, retorna sem duplicar
        }

        const [r] = await db.insert(kanbanCards).values({
          escritorioId,
          colunaId,
          titulo: params.titulo,
          descricao: params.descricao || null,
          clienteId: params.clienteId || null,
          prioridade: (params.prioridade as any) || "media",
          asaasPaymentId: params.asaasPaymentId || null,
          ordem: 0,
        });
        return (r as { insertId: number }).insertId;
      } catch (err: any) {
        log.error({ err: err.message }, "SmartFlow: erro ao criar card Kanban");
        throw err;
      }
    },

    async chamarWebhook(url: string, dados: any): Promise<any> {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dados),
      });
      if (!res.ok) throw new Error(`Webhook retornou ${res.status}`);
      return res.json();
    },
  };
}

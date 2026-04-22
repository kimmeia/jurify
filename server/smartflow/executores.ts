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
 * Prepara o telefone pra resolução de JID no WhatsApp.
 *
 * - Se o input já é um JID (contém `@`), devolve direto.
 * - Senão, gera um conjunto de candidatos numéricos cobrindo os dois
 *   padrões BR (com/sem 9º dígito) e com/sem DDI 55. O chamador
 *   consulta o Baileys (`onWhatsApp`) pra saber qual existe.
 *
 * Retorna `null` pra entradas vazias ou com menos de 8 dígitos.
 */
export function prepararCandidatosJid(
  telefone: string | null | undefined,
): { jid: string } | { candidatos: string[] } | null {
  if (!telefone) return null;
  const raw = String(telefone).trim();
  if (!raw) return null;
  if (raw.includes("@")) return { jid: raw };

  const clean = raw.replace(/\D/g, "");
  if (clean.length < 8) return null;

  const candidatos = new Set<string>();
  candidatos.add(clean);

  const comDDI = clean.startsWith("55") ? clean : `55${clean}`;
  candidatos.add(comDDI);

  if (comDDI.length === 13) {
    const ddd = comDDI.substring(2, 4);
    const nono = comDDI.charAt(4);
    const local = comDDI.substring(5);
    if (nono === "9" && ["6", "7", "8", "9"].includes(local.charAt(0))) {
      candidatos.add(`55${ddd}${local}`);
    }
  } else if (comDDI.length === 12) {
    const ddd = comDDI.substring(2, 4);
    const local = comDDI.substring(4);
    if (["6", "7", "8", "9"].includes(local.charAt(0))) {
      candidatos.add(`55${ddd}9${local}`);
    }
  }

  return { candidatos: Array.from(candidatos) };
}

/**
 * Interface mínima do manager de WhatsApp usada por `resolverJidWhatsApp`.
 * Facilita mocks em testes.
 */
export interface CheckWhatsappManager {
  checarNumerosWhatsApp(
    canalId: number,
    candidatos: string[],
  ): Promise<Array<{ jid: string; exists: boolean; lid?: string }>>;
}

/**
 * Resolve o JID canônico de um telefone consultando o servidor do
 * WhatsApp via `onWhatsApp`. Evita adivinhação determinística — o
 * servidor devolve qual variação está registrada na conta.
 *
 * Retorna `null` se o telefone é inválido ou nenhum candidato existe.
 */
export async function resolverJidWhatsApp(
  manager: CheckWhatsappManager,
  canalId: number,
  telefone: string | null | undefined,
): Promise<string | null> {
  const prep = prepararCandidatosJid(telefone);
  if (!prep) return null;
  if ("jid" in prep) return prep.jid;

  const results = await manager.checarNumerosWhatsApp(canalId, prep.candidatos);
  const match = results.find((r) => r.exists);
  if (!match) return null;
  return match.lid || match.jid;
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

    async buscarHorarios(duracao: number): Promise<string[]> {
      try {
        const { getDb } = await import("../db");
        const { canaisIntegrados } = await import("../../drizzle/schema");
        const { eq, and, or: orOp, like } = await import("drizzle-orm");
        const { decryptConfig } = await import("../escritorio/crypto-utils");
        const db = await getDb();
        if (!db) return [];

        const [canal] = await db.select().from(canaisIntegrados)
          .where(and(eq(canaisIntegrados.escritorioId, escritorioId), orOp(eq(canaisIntegrados.tipo, "calcom"), like(canaisIntegrados.nome, "%Cal.com%"))))
          .limit(1);

        if (!canal?.configEncrypted || !canal.configIv || !canal.configTag) return [];
        const cfg = decryptConfig(canal.configEncrypted, canal.configIv, canal.configTag);
        if (!cfg?.apiKey) return [];

        const { CalcomClient } = await import("../integracoes/calcom-client");
        const client = new CalcomClient({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl || "https://api.cal.com/v2", defaultDuration: duracao });
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
        const { getDb } = await import("../db");
        const { canaisIntegrados } = await import("../../drizzle/schema");
        const { eq, and, or: orOp, like } = await import("drizzle-orm");
        const { decryptConfig } = await import("../escritorio/crypto-utils");
        const db = await getDb();
        if (!db) throw new Error("DB indisponível");

        const [canal] = await db.select().from(canaisIntegrados)
          .where(and(eq(canaisIntegrados.escritorioId, escritorioId), orOp(eq(canaisIntegrados.tipo, "calcom"), like(canaisIntegrados.nome, "%Cal.com%"))))
          .limit(1);

        if (!canal?.configEncrypted || !canal.configIv || !canal.configTag) throw new Error("Cal.com não configurado");
        const cfg = decryptConfig(canal.configEncrypted, canal.configIv, canal.configTag);
        if (!cfg?.apiKey) throw new Error("API Key Cal.com não encontrada");

        const { CalcomClient } = await import("../integracoes/calcom-client");
        const client = new CalcomClient({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl || "https://api.cal.com/v2", defaultDuration: 30 });

        // Busca event types pra pegar o ID
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

    async enviarWhatsApp(telefone: string, mensagem: string): Promise<boolean> {
      try {
        const { getDb } = await import("../db");
        const { canaisIntegrados } = await import("../../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) return false;

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
        if (!m.isConectado(canalId)) return false;

        const jid = await resolverJidWhatsApp(m, canalId, telefone);
        if (!jid) {
          log.warn({ telefone, canalId }, "SmartFlow: telefone não registrado no WhatsApp");
          return false;
        }

        await m.enviarMensagemJid(canalId, jid, mensagem);
        return true;
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

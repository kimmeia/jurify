/**
 * Webhook Judit.IO — Recebe notificações de monitoramentos e consultas.
 *
 * A Judit envia um POST com o payload completo do processo atualizado.
 * O webhook salva os dados na tabela judit_respostas e atualiza o monitoramento.
 *
 * Eventos:
 * - response_created (response_type=lawsuit) → atualização de processo
 * - response_created (response_type=application_info, code=600) → request_completed
 * - response_created (response_type=application_error) → erro na consulta
 */

import type { Express, Request, Response } from "express";
import { getDb } from "../db";
import { adminIntegracoes, juditMonitoramentos, juditRespostas, juditNovasAcoes } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { decrypt } from "../escritorio/crypto-utils";
import { JuditClient } from "./judit-client";
import { createLogger } from "../_core/logger";
const log = createLogger("integracoes-judit-webhook");

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER: OBTER API KEY DECRIPTOGRAFADA
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Retorna a API key da Judit decriptografada, ou null se não conectada.
 * Usar apenas no backend — nunca expor a key para o frontend.
 */
export async function getJuditApiKey(): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;

  const reg = await db
    .select()
    .from(adminIntegracoes)
    .where(and(eq(adminIntegracoes.provedor, "judit"), eq(adminIntegracoes.status, "conectado")))
    .limit(1);

  if (reg.length === 0 || !reg[0].apiKeyEncrypted || !reg[0].apiKeyIv || !reg[0].apiKeyTag) {
    return null;
  }

  try {
    return decrypt(reg[0].apiKeyEncrypted, reg[0].apiKeyIv, reg[0].apiKeyTag);
  } catch {
    return null;
  }
}

/**
 * Retorna uma instância autenticada do JuditClient, ou null se não conectada.
 */
export async function getJuditClient(): Promise<JuditClient | null> {
  const apiKey = await getJuditApiKey();
  if (!apiKey) return null;
  return new JuditClient(apiKey);
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEBHOOK
// ═══════════════════════════════════════════════════════════════════════════════

interface JuditWebhookPayload {
  user_id: string;
  callback_id: string;
  event_type: string;
  reference_type: "request" | "tracking";
  reference_id: string;
  payload: {
    request_id: string;
    response_id: string;
    response_type: string;
    response_data: any;
    user_id: string;
    created_at: string;
    origin?: string;
    origin_id?: string;
    tags?: {
      cached_response?: boolean;
      [key: string]: any;
    };
  };
}

export function registerJuditWebhook(app: Express) {
  app.post("/api/webhooks/judit", async (req: Request, res: Response) => {
    try {
      const body = req.body as JuditWebhookPayload;

      if (!body || !body.event_type || !body.payload) {
        return res.status(400).json({ error: "Payload inválido" });
      }

      log.info(
        `[Judit Webhook] Evento: ${body.event_type} | Tipo: ${body.reference_type} | Ref: ${body.reference_id} | Response: ${body.payload.response_type}`
      );

      const db = await getDb();
      if (!db) {
        log.error("[Judit Webhook] Database indisponível");
        return res.status(500).json({ error: "Database indisponível" });
      }

      // ─── NEW LAWSUIT: nova ação detectada pelo monitoramento de novas ações ──
      // A Judit envia event_type="new_lawsuit" quando uma nova ação é
      // distribuída contra uma pessoa/empresa sendo monitorada. Diferente
      // do response_created, aqui não é uma atualização em processo
      // existente — é uma PROCESSO NOVO que apareceu contra o monitorado.
      if (body.event_type === "new_lawsuit") {
        const trackingId = body.reference_id;
        if (!trackingId) {
          return res.status(200).json({ received: true, warning: "no_tracking_id" });
        }

        const monLocal = await db
          .select()
          .from(juditMonitoramentos)
          .where(eq(juditMonitoramentos.trackingId, trackingId))
          .limit(1);
        if (monLocal.length === 0) {
          log.warn(`[Judit Webhook] new_lawsuit para tracking ${trackingId} não encontrado`);
          return res.status(200).json({ received: true, warning: "tracking_not_found" });
        }

        const mon = monLocal[0];
        const data = body.payload?.response_data || {};
        const cnj = data.code || data.cnj || data.lawsuit_code || "";

        if (!cnj) {
          log.warn("[Judit Webhook] new_lawsuit sem CNJ — ignorando");
          return res.status(200).json({ received: true, warning: "no_cnj" });
        }

        // Dedup: não insere a mesma nova ação 2x (unique index protege, mas
        // checamos antes pra evitar erro desnecessário)
        const existe = await db
          .select()
          .from(juditNovasAcoes)
          .where(
            and(
              eq(juditNovasAcoes.cnj, cnj),
              eq(juditNovasAcoes.monitoramentoId, mon.id),
            ),
          )
          .limit(1);
        if (existe.length > 0) {
          log.info(`[Judit Webhook] new_lawsuit ${cnj} já existe localmente`);
          return res.status(200).json({ received: true, duplicate: true });
        }

        // Extrai informações úteis do payload
        const polos: { ativo: any[]; passivo: any[] } = { ativo: [], passivo: [] };
        for (const p of data.parties || []) {
          if (p.side === "Active") polos.ativo.push({ name: p.name, document: p.main_document });
          else if (p.side === "Passive") polos.passivo.push({ name: p.name, document: p.main_document });
        }

        // Detecta área do direito pela classe/assuntos
        const areaDireito = detectarAreaDireito(
          data.classifications?.[0]?.name || "",
          data.subjects?.map((s: any) => s.name).join(" ") || "",
        );

        await db.insert(juditNovasAcoes).values({
          monitoramentoId: mon.id,
          cnj,
          tribunal: data.tribunal_acronym || null,
          classeProcesso: data.classifications?.[0]?.name || null,
          areaDireito,
          poloAtivo: polos.ativo.length > 0 ? JSON.stringify(polos.ativo) : null,
          poloPassivo: polos.passivo.length > 0 ? JSON.stringify(polos.passivo) : null,
          dataDistribuicao: data.distribution_date || null,
          valorCausa: data.amount ? Math.round(data.amount * 100) : null,
          payloadCompleto: JSON.stringify(data).slice(0, 50000),
          lido: false,
          alertaEnviado: false,
        });

        // Incrementa contador no monitoramento
        await db
          .update(juditMonitoramentos)
          .set({ totalNovasAcoes: (mon.totalNovasAcoes || 0) + 1 })
          .where(eq(juditMonitoramentos.id, mon.id));

        // Disparar notificação SSE pro usuário
        try {
          const { emitirNotificacao } = await import("../_core/sse-notifications");
          if (mon.clienteUserId) {
            emitirNotificacao(mon.clienteUserId, {
              tipo: "nova_acao",
              titulo: "⚠️ Nova ação detectada!",
              mensagem: `${areaDireito || data.classifications?.[0]?.name || "Nova ação"}: ${cnj}`,
              dados: { monitoramentoId: mon.id, cnj, areaDireito },
            });
          }
        } catch {
          /* SSE indisponível — não bloqueia */
        }

        log.info(
          { cnj, trackingId, areaDireito, valorCausa: data.amount },
          "Nova ação detectada e registrada",
        );
        return res.status(200).json({ received: true, registered: true });
      }

      // Ignorar outros eventos que não são response_created
      if (body.event_type !== "response_created") {
        return res.status(200).json({ received: true, ignored: true });
      }

      const { payload } = body;

      // Identificar o monitoramento pelo origin_id (que é o tracking_id)
      // Em tracking, origin_id === tracking_id
      const trackingId = body.reference_type === "tracking" ? body.reference_id : null;

      if (!trackingId) {
        // Pode ser resposta de uma consulta avulsa, não de monitoramento
        log.info("[Judit Webhook] Resposta de consulta avulsa (não tracking), ignorando armazenamento");
        return res.status(200).json({ received: true });
      }

      // Buscar monitoramento local
      const monLocal = await db
        .select()
        .from(juditMonitoramentos)
        .where(eq(juditMonitoramentos.trackingId, trackingId))
        .limit(1);

      if (monLocal.length === 0) {
        log.warn(`[Judit Webhook] Tracking ${trackingId} não encontrado localmente`);
        return res.status(200).json({ received: true, warning: "tracking_not_found_locally" });
      }

      const mon = monLocal[0];

      // Tratar conforme o tipo de resposta
      if (payload.response_type === "lawsuit") {
        const data = payload.response_data;
        const cachedResponse = payload.tags?.cached_response ?? false;
        const stepsCount = data?.last_step?.steps_count ?? data?.steps?.length ?? 0;

        // Salvar resposta
        await db.insert(juditRespostas).values({
          monitoramentoId: mon.id,
          responseId: payload.response_id,
          requestId: payload.request_id,
          responseType: "lawsuit",
          responseData: JSON.stringify(data),
          cachedResponse,
          stepsCount,
        });

        // Atualizar monitoramento com dados da última movimentação
        const lastStep = data?.last_step;
        await db
          .update(juditMonitoramentos)
          .set({
            statusJudit: "updated",
            tribunal: data?.tribunal_acronym || mon.tribunal,
            nomePartes: data?.name || mon.nomePartes,
            ultimaMovimentacao: lastStep?.content || mon.ultimaMovimentacao,
            ultimaMovimentacaoData: lastStep?.step_date || mon.ultimaMovimentacaoData,
            totalAtualizacoes: mon.totalAtualizacoes + 1,
          })
          .where(eq(juditMonitoramentos.id, mon.id));

        // Se o monitoramento usava credencial e ela estava "validando",
        // agora sabemos que funciona → marcar como "ativa"
        if (mon.credencialId) {
          try {
            const { juditCredenciais } = await import("../../drizzle/schema");
            await db
              .update(juditCredenciais)
              .set({ status: "ativa", mensagemErro: null })
              .where(
                and(
                  eq(juditCredenciais.id, mon.credencialId),
                  eq(juditCredenciais.status, "validando"),
                ),
              );
          } catch { /* best-effort */ }
        }

        log.info(
          `[Judit Webhook] Processo ${data?.code} atualizado. Última mov: ${lastStep?.content?.slice(0, 60)}...`
        );
      } else if (payload.response_type === "application_info") {
        // request_completed — a consulta do tracking terminou
        const code = payload.response_data?.code;
        if (code === 600) {
          log.info(`[Judit Webhook] Tracking ${trackingId} — consulta concluída`);
        }
      } else if (payload.response_type === "application_error") {
        const errMsg = payload.response_data?.message || "UNKNOWN_ERROR";
        log.warn(`[Judit Webhook] Tracking ${trackingId} — erro: ${errMsg}`);

        // Salvar resposta de erro
        await db.insert(juditRespostas).values({
          monitoramentoId: mon.id,
          responseId: payload.response_id,
          requestId: payload.request_id,
          responseType: "application_error",
          responseData: JSON.stringify(payload.response_data),
          stepsCount: 0,
        });

        // Se o erro é de autenticação/credencial, marca a credencial como "erro"
        const errLower = errMsg.toLowerCase();
        const isCredentialError =
          errLower.includes("credential") ||
          errLower.includes("authentication") ||
          errLower.includes("login") ||
          errLower.includes("senha") ||
          errLower.includes("password") ||
          errLower.includes("unauthorized") ||
          errLower.includes("403") ||
          errLower.includes("captcha");

        if (mon.credencialId && isCredentialError) {
          try {
            const { juditCredenciais } = await import("../../drizzle/schema");
            await db
              .update(juditCredenciais)
              .set({ status: "erro", mensagemErro: errMsg })
              .where(eq(juditCredenciais.id, mon.credencialId));
            log.warn(
              { credencialId: mon.credencialId, err: errMsg },
              "[Judit Webhook] Credencial marcada como erro — login falhou",
            );
          } catch { /* best-effort */ }
        }
      }

      return res.status(200).json({ received: true });
    } catch (err: any) {
      log.error("[Judit Webhook] Erro:", err.message);
      return res.status(500).json({ error: "Erro interno" });
    }
  });
}

/**
 * Detecta a área do direito baseada na classe e assuntos do processo.
 * É um classificador simples baseado em palavras-chave — o módulo de
 * Atendimento futuro pode usar IA pra fazer classificação mais precisa.
 *
 * Útil pra alertas: admin pode querer ser avisado ESPECIALMENTE de
 * novas ações trabalhistas, por exemplo.
 */
function detectarAreaDireito(classe: string, assuntos: string): string {
  const texto = `${classe} ${assuntos}`.toLowerCase();

  const mapa: Array<{ area: string; palavras: string[] }> = [
    {
      area: "Trabalhista",
      palavras: ["trabalh", "reclamação trabalh", "rescisão", "horas extras", "fgts", "aviso prévio", "vínculo empregatício", "equiparação salarial"],
    },
    {
      area: "Tributário",
      palavras: ["tribut", "imposto", "icms", "ipi", "pis", "cofins", "fiscal", "execução fiscal", "dívida ativa"],
    },
    {
      area: "Previdenciário",
      palavras: ["previdenc", "inss", "auxílio", "aposentadoria", "pensão", "benefício"],
    },
    {
      area: "Consumidor",
      palavras: ["consumidor", "cdc", "vício", "defeito", "propaganda enganosa", "cobrança indevida"],
    },
    {
      area: "Bancário",
      palavras: ["bancár", "revisional", "juros abusivos", "cédula de crédito", "financiamento", "capitalização"],
    },
    {
      area: "Família",
      palavras: ["família", "divórcio", "alimentos", "guarda", "união estável", "inventário", "separação"],
    },
    {
      area: "Civil",
      palavras: ["civil", "indenização", "dano moral", "dano material", "responsabilidade", "posse", "propriedade"],
    },
    {
      area: "Penal",
      palavras: ["penal", "criminal", "ação penal", "inquérito", "denúncia"],
    },
    {
      area: "Empresarial",
      palavras: ["empresarial", "societário", "falência", "recuperação judicial", "marca"],
    },
    {
      area: "Imobiliário",
      palavras: ["imobiliár", "despejo", "locação", "aluguel", "condomínio", "usucapião"],
    },
  ];

  for (const { area, palavras } of mapa) {
    for (const p of palavras) {
      if (texto.includes(p)) return area;
    }
  }

  return "Outros";
}

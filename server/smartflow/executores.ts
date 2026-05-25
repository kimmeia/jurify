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
import { montarHistoricoMensagens } from "./historico-conversa";
import type { ChatBotMessage } from "../integracoes/chatbot-openai";

const log = createLogger("smartflow-executores");

/** Timeout pra chamadas LLM dentro do SmartFlow — atendimento via WhatsApp
 *  precisa responder rápido; 30s já é generoso pro usuário não desistir. */
const LLM_TIMEOUT_MS = 30000;

/**
 * Invoca o LLM com a config completa (provider + modelo + keys + RAG).
 *
 * Compartilhada entre `chamarIA` (passo `ia_responder` sem agenteId) e
 * `executarAgente` (com agenteId). Centraliza:
 *   - escolha do provider (Anthropic vs OpenAI) baseada em `provider`,
 *     não em "tem openaiApiKey?" (que falhava quando o canal só tem Claude)
 *   - inclusão de docs RAG (`contextoDocumentos`) no system prompt
 *   - respeito a `maxTokens` e `temperatura` do agente
 *   - timeout consistente
 */
async function invocarLLM(
  cfg: {
    provider: "openai" | "anthropic";
    modelo: string;
    openaiApiKey?: string;
    anthropicApiKey?: string;
    maxTokens: number;
    temperatura: number;
    contextoDocumentos?: string;
    /** Bloco de contexto do cliente (campos personalizados já coletados). */
    contextoCliente?: string;
  },
  systemPromptBase: string,
  mensagem: string,
  historico: ChatBotMessage[] = [],
): Promise<string> {
  const systemPrompt = [systemPromptBase, cfg.contextoDocumentos, cfg.contextoCliente]
    .filter(Boolean)
    .join("\n\n");

  if (cfg.provider === "anthropic") {
    if (!cfg.anthropicApiKey) {
      throw new Error("Provider anthropic sem anthropicApiKey configurada.");
    }
    const { gerarRespostaAnthropic } = await import("../integracoes/chatbot-openai");
    const r = await gerarRespostaAnthropic(
      cfg.anthropicApiKey,
      cfg.modelo,
      systemPrompt,
      historico,
      mensagem,
      cfg.maxTokens,
      cfg.temperatura,
      LLM_TIMEOUT_MS,
    );
    if (r.erro || !r.resposta) throw new Error(r.erro || "Claude não retornou resposta");
    return r.resposta;
  }

  if (!cfg.openaiApiKey) {
    throw new Error("Provider openai sem openaiApiKey configurada.");
  }
  const historicoMsgs = historico.slice(-20).map((m) => ({
    role: m.role === "system" ? ("user" as const) : m.role,
    content: m.content,
  }));
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
        ...historicoMsgs,
        { role: "user", content: mensagem },
      ],
      max_tokens: cfg.maxTokens,
      temperature: cfg.temperatura,
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content?.trim() || "";
}

/**
 * Carrega o histórico recente de uma conversa pra dar memória ao passo
 * `ia_responder`. Sem isso, a IA respondia cada mensagem no vácuo (só via a
 * mensagem atual). Busca as últimas mensagens, remove a atual (já salva antes
 * do fluxo rodar) e devolve em ordem cronológica. Silencioso — falha aqui só
 * faz a IA perder a memória, não derruba o fluxo.
 */
async function carregarHistoricoConversa(
  conversaId: number,
  mensagemAtual: string,
  limite = 20,
): Promise<ChatBotMessage[]> {
  try {
    const { getDb } = await import("../db");
    const { mensagens } = await import("../../drizzle/schema");
    const { eq, desc } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return [];
    const rows = await db
      .select({
        direcao: mensagens.direcao,
        conteudo: mensagens.conteudo,
        tipo: mensagens.tipo,
      })
      .from(mensagens)
      .where(eq(mensagens.conversaId, conversaId))
      .orderBy(desc(mensagens.createdAt), desc(mensagens.id))
      .limit(limite + 10); // margem: a atual + mensagens de sistema/vazias filtradas
    return montarHistoricoMensagens(rows, mensagemAtual, limite);
  } catch (err: any) {
    log.warn({ err: err.message, conversaId }, "SmartFlow: falha ao carregar histórico da conversa");
    return [];
  }
}

/**
 * Resolve o client Cal.com para um escritório — lê o canal com `tipo=calcom`,
 * descriptografa config e devolve um `CalcomClient` pronto. Retorna `null`
 * se o escritório não tem canal configurado.
 */
export async function obterCalcomClient(escritorioId: number, defaultDuration = 30) {
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
 * Resolve o bloco de contexto do cliente (campos personalizados já capturados)
 * pra injetar no system prompt. Retorna "" quando não há contatoId, contato
 * sem campos preenchidos, ou nenhum campo passa pelos filtros do helper.
 *
 * Falhas (DB indisponível, JSON malformado, etc) → "" silencioso, pra não
 * derrubar a chamada da IA. A IA ainda funciona sem o contexto.
 */
async function resolverContextoCliente(
  escritorioId: number,
  contatoId: number | undefined,
): Promise<string> {
  if (!contatoId) return "";
  try {
    const { getDb } = await import("../db");
    const { contatos, camposPersonalizadosCliente } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return "";

    const [contato] = await db
      .select({ camposPersonalizados: contatos.camposPersonalizados })
      .from(contatos)
      .where(eq(contatos.id, contatoId))
      .limit(1);
    if (!contato?.camposPersonalizados) return "";

    const defs = await db
      .select({
        chave: camposPersonalizadosCliente.chave,
        label: camposPersonalizadosCliente.label,
        tipo: camposPersonalizadosCliente.tipo,
      })
      .from(camposPersonalizadosCliente)
      .where(eq(camposPersonalizadosCliente.escritorioId, escritorioId));
    if (defs.length === 0) return "";

    const { montarContextoCliente } = await import("../_core/contexto-cliente-ia");
    return montarContextoCliente(contato.camposPersonalizados, defs);
  } catch (e: any) {
    log.warn({ err: e?.message, contatoId }, "falha ao resolver contexto do cliente — IA segue sem ele");
    return "";
  }
}

/**
 * Cria executores reais para um escritório específico.
 */
export function criarExecutoresReais(escritorioId: number): SmartflowExecutores {
  return {
    async chamarIA(prompt: string, mensagem: string, contatoId?: number, conversaId?: number): Promise<string> {
      // Resolve config do agente ativo do escritório (provider + key + modelo
      // + maxTokens/temperatura + docs RAG). Antes desse fix, esta função
      // ignorava `provider` e tentava OpenAI primeiro — então escritórios
      // com só Claude configurado caíam num caminho de fallback que
      // hardcodava model="claude-haiku-4-5" e maxTokens=300 ignorando o
      // que estava no agente. Agora respeita 100% da config do agente
      // ativo, igual ao `executarAgente`.
      const { obterConfigChatBot } = await import("../integracoes/chatbot-openai");
      const config = await obterConfigChatBot(escritorioId);

      if (!config || !config.provider) {
        throw new Error(
          "Nenhuma IA configurada. Configure em Integrações → ChatGPT ou Claude.",
        );
      }

      const contextoCliente = await resolverContextoCliente(escritorioId, contatoId);
      const historico = conversaId ? await carregarHistoricoConversa(conversaId, mensagem) : [];

      return invocarLLM(
        {
          provider: config.provider,
          modelo: config.modelo,
          openaiApiKey: config.openaiApiKey,
          anthropicApiKey: config.anthropicApiKey,
          maxTokens: config.maxTokens ?? 300,
          temperatura: config.temperatura ?? 0.3,
          contextoDocumentos: config.contextoDocumentos,
          contextoCliente,
        },
        prompt,
        mensagem,
        historico,
      );
    },

    async buscarContatoCrm(params) {
      try {
        const { getDb } = await import("../db");
        const { contatos } = await import("../../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) return null;

        // Coluna alvo varia conforme tipo de busca.
        const coluna =
          params.tipoBusca === "email"
            ? contatos.email
            : params.tipoBusca === "cpfCnpj"
            ? contatos.cpfCnpj
            : contatos.telefone;

        // Normaliza pra string trimada — buscas exatas; em telefone, pode
        // ser que cliente cadastrou com 55 e gatilho veio sem (ou vice-versa).
        // Aqui mantemos exact match — o passo `ia_extrair_campos` cuida da
        // normalização semântica antes (IA entende variações).
        const valor = params.valor.trim();
        if (!valor) return null;

        const [c] = await db
          .select({
            id: contatos.id,
            nome: contatos.nome,
            telefone: contatos.telefone,
            email: contatos.email,
            atendenteResponsavelId: contatos.atendenteResponsavelId,
            camposPersonalizados: contatos.camposPersonalizados,
          })
          .from(contatos)
          .where(and(eq(contatos.escritorioId, escritorioId), eq(coluna, valor)))
          .limit(1);
        if (!c) return null;

        let campos: Record<string, unknown> = {};
        if (c.camposPersonalizados) {
          try {
            const parsed = JSON.parse(c.camposPersonalizados);
            if (parsed && typeof parsed === "object") campos = parsed;
          } catch {
            /* JSON inválido — ignora */
          }
        }
        return {
          contatoId: c.id,
          nome: c.nome || "",
          telefone: c.telefone || null,
          email: c.email || null,
          atendenteResponsavelId: c.atendenteResponsavelId ?? null,
          camposPersonalizados: campos,
        };
      } catch (err: any) {
        log.warn({ err: err.message, tipoBusca: params.tipoBusca }, "SmartFlow: falha em buscarContatoCrm");
        return null;
      }
    },

    async listarAcoesCliente(params) {
      try {
        const { getDb } = await import("../db");
        const { clienteProcessos } = await import("../../drizzle/schema");
        const { eq, and, desc } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) return [];

        const conds: any[] = [
          eq(clienteProcessos.escritorioId, escritorioId),
          eq(clienteProcessos.contatoId, params.contatoId),
        ];
        if (params.tipoFiltro) conds.push(eq(clienteProcessos.tipo, params.tipoFiltro));
        if (params.poloFiltro) conds.push(eq(clienteProcessos.polo, params.poloFiltro));

        const linhas = await db
          .select({
            id: clienteProcessos.id,
            numeroCnj: clienteProcessos.numeroCnj,
            apelido: clienteProcessos.apelido,
            classe: clienteProcessos.classe,
            tipo: clienteProcessos.tipo,
            polo: clienteProcessos.polo,
            valorCausa: clienteProcessos.valorCausa,
            createdAt: clienteProcessos.createdAt,
          })
          .from(clienteProcessos)
          .where(and(...conds))
          .orderBy(desc(clienteProcessos.createdAt))
          .limit(params.limite || 10);

        return linhas.map((l) => ({
          id: l.id,
          numeroCnj: l.numeroCnj,
          apelido: l.apelido,
          classe: l.classe,
          tipo: l.tipo,
          polo: l.polo,
          valorCausa: l.valorCausa,
          createdAt: l.createdAt,
        }));
      } catch (err: any) {
        log.warn({ err: err.message, contatoId: params.contatoId }, "SmartFlow: falha em listarAcoesCliente");
        return [];
      }
    },

    async buscarMovimentacoesProcesso(params) {
      try {
        const { getDb } = await import("../db");
        const { eventosProcesso, clienteProcessos } = await import("../../drizzle/schema");
        const { eq, and, gte, inArray, desc } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) return [];

        // Resolve o CNJ. Quando `processoRef` é número, busca em
        // cliente_processos pra extrair o `numeroCnj`. Quando é string,
        // assume que já é um CNJ.
        let cnj: string | null = null;
        if (typeof params.processoRef === "number") {
          const [proc] = await db
            .select({ numeroCnj: clienteProcessos.numeroCnj })
            .from(clienteProcessos)
            .where(
              and(
                eq(clienteProcessos.id, params.processoRef),
                eq(clienteProcessos.escritorioId, escritorioId),
              ),
            )
            .limit(1);
          if (!proc?.numeroCnj) {
            log.debug({ processoId: params.processoRef }, "Processo sem CNJ — sem eventos");
            return [];
          }
          cnj = proc.numeroCnj;
        } else {
          cnj = String(params.processoRef).trim();
          if (!cnj) return [];
        }

        const desde = new Date();
        desde.setDate(desde.getDate() - (params.diasJanela || 30));

        const conds: any[] = [
          eq(eventosProcesso.escritorioId, escritorioId),
          eq(eventosProcesso.cnjAfetado, cnj),
          gte(eventosProcesso.dataEvento, desde),
        ];
        if (params.tipos && params.tipos.length > 0) {
          conds.push(inArray(eventosProcesso.tipo, params.tipos as any));
        }

        const linhas = await db
          .select({
            id: eventosProcesso.id,
            tipo: eventosProcesso.tipo,
            dataEvento: eventosProcesso.dataEvento,
            conteudo: eventosProcesso.conteudo,
            fonte: eventosProcesso.fonte,
            cnjAfetado: eventosProcesso.cnjAfetado,
          })
          .from(eventosProcesso)
          .where(and(...conds))
          .orderBy(desc(eventosProcesso.dataEvento))
          .limit(params.limite || 10);

        return linhas.map((l) => ({
          id: l.id,
          tipo: l.tipo,
          dataEvento: l.dataEvento,
          conteudo: l.conteudo,
          fonte: l.fonte,
          cnjAfetado: l.cnjAfetado,
        }));
      } catch (err: any) {
        log.warn({ err: err.message }, "SmartFlow: falha em buscarMovimentacoesProcesso");
        return [];
      }
    },

    async extrairCamposIA(params): Promise<Record<string, unknown>> {
      // Reusa a mesma config do chatbot pra escolher provider + key + modelo.
      // Tool calling é suportado por OpenAI e Anthropic; o módulo llm-extracao
      // monta o request específico de cada um.
      const { obterConfigChatBot } = await import("../integracoes/chatbot-openai");
      const config = await obterConfigChatBot(escritorioId);
      if (!config || !config.provider) {
        throw new Error("Nenhuma IA configurada. Configure em Integrações → ChatGPT ou Claude.");
      }
      const { extrairCamposEstruturados } = await import("../integracoes/llm-extracao");
      const contextoCliente = await resolverContextoCliente(escritorioId, params.contatoId);
      // Histórico da conversa: sem isso a extração só via a última mensagem e
      // perdia dados informados antes (nome numa msg, data noutra).
      const historico = params.conversaId
        ? await carregarHistoricoConversa(params.conversaId, params.mensagem)
        : [];
      const r = await extrairCamposEstruturados(
        {
          provider: config.provider,
          modelo: config.modelo,
          openaiApiKey: config.openaiApiKey,
          anthropicApiKey: config.anthropicApiKey,
          // Extração é determinística — força 0 mesmo se config tem temp maior.
          temperatura: 0,
          maxTokens: config.maxTokens ?? 1024,
        },
        params.mensagem,
        params.campos,
        contextoCliente || undefined,
        historico,
      );
      return r.campos;
    },

    async executarAgente(agenteId: number, mensagem: string, contatoId?: number, conversaId?: number): Promise<string> {
      const { obterAgentePorId } = await import("../integracoes/router-agentes-ia");
      const cfg = await obterAgentePorId(escritorioId, agenteId);
      if (!cfg) {
        throw new Error(`Agente ${agenteId} não encontrado, inativo ou sem API key configurada.`);
      }

      const contextoCliente = await resolverContextoCliente(escritorioId, contatoId);
      const historico = conversaId ? await carregarHistoricoConversa(conversaId, mensagem) : [];

      return invocarLLM(
        {
          provider: cfg.provider,
          modelo: cfg.modelo,
          openaiApiKey: cfg.openaiApiKey,
          anthropicApiKey: cfg.anthropicApiKey,
          maxTokens: cfg.maxTokens,
          temperatura: cfg.temperatura,
          contextoDocumentos: cfg.contextoDocumentos,
          contextoCliente,
        },
        cfg.prompt,
        mensagem,
        historico,
      );
    },

    async extrairCamposDoAgente(agenteId: number, contatoId: number, conversaId: number): Promise<Record<string, unknown>> {
      try {
        const { extrairECaptarCampos } = await import("../integracoes/agente-captura-campos");
        const capturados = await extrairECaptarCampos({ agenteId, contatoId, conversaId, escritorioId, forcar: true });
        const out: Record<string, unknown> = {};
        for (const c of capturados) out[c.chave] = c.valor;
        if (capturados.length > 0) {
          log.info({ agenteId, contatoId, campos: Object.keys(out) }, "SmartFlow: campos capturados pelo agente no fluxo");
        }
        return out;
      } catch (err: any) {
        // Não-fatal: extração nunca quebra a resposta do agente.
        log.warn({ err: err?.message || String(err), agenteId }, "SmartFlow: falha ao extrair campos do agente");
        return {};
      }
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
          email: email || "cliente@juridflow.com.br",
        });

        if (!booking) throw new Error("Falha ao criar agendamento no Cal.com");
        log.info({ bookingId: booking.id, horario, nome }, "SmartFlow: agendamento criado no Cal.com");
        return String(booking.id);
      } catch (err: any) {
        log.error({ err: err.message }, "SmartFlow: erro ao criar agendamento Cal.com");
        throw err;
      }
    },

    async criarAgendamentoInterno(params): Promise<number> {
      const { criarAgendamento: criarNaAgenda } = await import("../escritorio/db-agendamento");
      // `criadoPorId`: o bot não é um usuário; atribui ao próprio responsável
      // (satisfaz o NOT NULL e é coerente — o compromisso "é" do advogado).
      const id = await criarNaAgenda({
        escritorioId,
        criadoPorId: params.responsavelId,
        responsavelId: params.responsavelId,
        tipo: params.tipo as any,
        titulo: params.titulo,
        descricao: params.descricao,
        dataInicio: params.dataInicio,
        dataFim: params.dataFim,
        local: params.local,
        prioridade: params.prioridade as any,
        contatoId: params.contatoId,
        contatoTelefone: params.contatoTelefone,
      });
      log.info({ agendamentoId: id, responsavelId: params.responsavelId }, "SmartFlow: compromisso criado na Agenda interna");
      return id;
    },

    async verificarDisponibilidadeAgenda(params): Promise<{ disponivel: boolean; conflitos: number }> {
      try {
        const { getDb } = await import("../db");
        const { agendamentos } = await import("../../drizzle/schema");
        const { eq, and, gte, lte } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) return { disponivel: true, conflitos: 0 }; // sem DB: não bloqueia
        const nStart = new Date(params.dataInicio);
        const nFim = new Date(params.dataFim);
        // Busca compromissos do responsável começando até 1 dia antes do fim
        // pedido (cobre overlaps de compromissos longos sem varrer a agenda toda).
        const janelaInicio = new Date(nStart.getTime() - 24 * 60 * 60 * 1000);
        const rows = await db
          .select({
            dataInicio: agendamentos.dataInicio,
            dataFim: agendamentos.dataFim,
            status: agendamentos.status,
          })
          .from(agendamentos)
          .where(and(
            eq(agendamentos.escritorioId, escritorioId),
            eq(agendamentos.responsavelId, params.responsavelId),
            gte(agendamentos.dataInicio, janelaInicio),
            lte(agendamentos.dataInicio, nFim),
          ));
        let conflitos = 0;
        for (const r of rows) {
          if (r.status === "cancelado") continue;
          const eStart = new Date(r.dataInicio);
          const eEnd = r.dataFim ? new Date(r.dataFim) : new Date(eStart.getTime() + 60 * 60 * 1000);
          // Overlap clássico: começa antes do fim do novo E termina depois do início.
          if (eStart < nFim && eEnd > nStart) conflitos++;
        }
        return { disponivel: conflitos === 0, conflitos };
      } catch (err: any) {
        log.warn({ err: err.message }, "SmartFlow: falha ao verificar disponibilidade da agenda");
        return { disponivel: true, conflitos: 0 }; // em erro, não bloqueia o fluxo
      }
    },

    async listarAgendaResponsavel(params): Promise<Array<{ titulo: string; inicio: string; fim: string; status: string }>> {
      try {
        const { getDb } = await import("../db");
        const { agendamentos } = await import("../../drizzle/schema");
        const { eq, and, gte, lte } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) return [];
        const nStart = new Date(params.dataInicio);
        const nFim = new Date(params.dataFim);
        const rows = await db
          .select({
            titulo: agendamentos.titulo,
            dataInicio: agendamentos.dataInicio,
            dataFim: agendamentos.dataFim,
            status: agendamentos.status,
          })
          .from(agendamentos)
          .where(and(
            eq(agendamentos.escritorioId, escritorioId),
            eq(agendamentos.responsavelId, params.responsavelId),
            gte(agendamentos.dataInicio, nStart),
            lte(agendamentos.dataInicio, nFim),
          ));
        return rows
          .filter((r) => r.status !== "cancelado")
          .map((r) => {
            const inicio = new Date(r.dataInicio);
            const fim = r.dataFim ? new Date(r.dataFim) : new Date(inicio.getTime() + 60 * 60 * 1000);
            return {
              titulo: r.titulo ?? "",
              inicio: inicio.toISOString(),
              fim: fim.toISOString(),
              status: r.status ?? "",
            };
          })
          .sort((a, b) => a.inicio.localeCompare(b.inicio));
      } catch (err: any) {
        log.warn({ err: err.message }, "SmartFlow: falha ao listar agenda do responsável");
        return [];
      }
    },

    async editarAgendamentoInterno(params): Promise<void> {
      const { atualizarAgendamento } = await import("../escritorio/db-agendamento");
      await atualizarAgendamento(params.agendamentoId, escritorioId, {
        dataInicio: params.dataInicio,
        dataFim: params.dataFim,
        responsavelId: params.responsavelId,
        titulo: params.titulo,
        descricao: params.descricao,
        status: params.status as any,
      });
      log.info({ agendamentoId: params.agendamentoId, status: params.status }, "SmartFlow: compromisso da Agenda interna editado");
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
      // Roteia pelo helper que abstrai whatsapp_qr (Baileys) vs whatsapp_api
      // (Cloud API oficial Meta). Antes esta função buscava só canais
      // whatsapp_qr — ignorava canais Cloud, fazendo SmartFlow falhar em
      // escritórios que usam só o WhatsApp oficial.
      try {
        const { getDb } = await import("../db");
        const { canaisIntegrados } = await import("../../drizzle/schema");
        const { eq, and, or } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) return false;

        const canais = await db.select().from(canaisIntegrados)
          .where(and(
            eq(canaisIntegrados.escritorioId, escritorioId),
            eq(canaisIntegrados.status, "conectado"),
            or(
              eq(canaisIntegrados.tipo, "whatsapp_qr"),
              eq(canaisIntegrados.tipo, "whatsapp_api"),
            ),
          ))
          .limit(1);

        if (canais.length === 0) return false;
        const canalId = canais[0].id;

        const { enviarMensagemPeloCanal } = await import("../integracoes/canal-envio");
        const r = await enviarMensagemPeloCanal({
          canalId,
          telefone,
          conteudo: mensagem,
        });
        if (!r.ok) {
          log.warn({ canalId, erro: r.erro, provider: r.provider }, "SmartFlow: envio WhatsApp falhou");
        }
        return r.ok;
      } catch (err: any) {
        log.error({ err: err.message }, "SmartFlow: erro ao enviar WhatsApp");
        return false;
      }
    },

    async criarCardKanban(params): Promise<number> {
      try {
        const { getDb } = await import("../db");
        const { kanbanCards, kanbanColunas, kanbanFunis, colaboradores } = await import("../../drizzle/schema");
        const { eq, and, asc } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) throw new Error("DB indisponível");

        let colunaId = params.colunaId;

        if (!colunaId && params.funilId) {
          const [col] = await db.select({ id: kanbanColunas.id }).from(kanbanColunas)
            .where(eq(kanbanColunas.funilId, params.funilId))
            .orderBy(asc(kanbanColunas.ordem)).limit(1);
          colunaId = col?.id;
        }

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

        // Idempotência em 2 camadas:
        //
        // 1. (escritorio, processoId, clienteId) — ATIVA quando o passo
        //    recebe ambos. Cobre o cenário multi-ação: 1 card por
        //    (cliente, ação), independente de quantas cobranças/parcelas
        //    pagas. Próximas execuções (parcelas seguintes) detectam o
        //    card existente e retornam ele.
        //
        // 2. (escritorio, asaasPaymentId) — fallback legado, ATIVA
        //    quando não há processoId (cobrança sem ação vinculada ou
        //    SmartFlow antigo). Cria 1 card por COBRANÇA — comportamento
        //    histórico preservado pra retrocompatibilidade.
        if (params.processoId && params.clienteId) {
          const [existente] = await db.select({ id: kanbanCards.id }).from(kanbanCards)
            .where(and(
              eq(kanbanCards.escritorioId, escritorioId),
              eq(kanbanCards.processoId, params.processoId),
              eq(kanbanCards.clienteId, params.clienteId),
            )).limit(1);
          if (existente) return existente.id;
        } else if (params.asaasPaymentId) {
          const [existente] = await db.select({ id: kanbanCards.id }).from(kanbanCards)
            .where(eq(kanbanCards.asaasPaymentId, params.asaasPaymentId)).limit(1);
          if (existente) return existente.id;
        }

        // Defesa em profundidade: se a config aponta pra colaborador inválido
        // (desativado ou de outro escritório), grava sem responsável em vez
        // de abortar a automação inteira.
        let responsavelIdValido: number | null = null;
        if (params.responsavelId) {
          const [colab] = await db.select({ id: colaboradores.id })
            .from(colaboradores)
            .where(and(
              eq(colaboradores.id, params.responsavelId),
              eq(colaboradores.escritorioId, escritorioId),
              eq(colaboradores.ativo, true),
            )).limit(1);
          responsavelIdValido = colab?.id ?? null;
        }

        // Prazo: prazoDias do passo > prazoPadraoDias do funil > 15 dias.
        let prazo: Date | null = null;
        if (params.prazoDias && params.prazoDias > 0) {
          prazo = new Date(Date.now() + params.prazoDias * 24 * 60 * 60 * 1000);
        } else {
          const [col] = await db.select({ funilId: kanbanColunas.funilId }).from(kanbanColunas)
            .where(eq(kanbanColunas.id, colunaId)).limit(1);
          if (col) {
            const [funil] = await db.select({ prazoPadraoDias: kanbanFunis.prazoPadraoDias }).from(kanbanFunis)
              .where(eq(kanbanFunis.id, col.funilId)).limit(1);
            const dias = funil?.prazoPadraoDias || 15;
            prazo = new Date(Date.now() + dias * 24 * 60 * 60 * 1000);
          }
        }

        const [r] = await db.insert(kanbanCards).values({
          escritorioId,
          colunaId,
          titulo: params.titulo,
          descricao: params.descricao || null,
          cnj: params.cnj || null,
          clienteId: params.clienteId || null,
          responsavelId: responsavelIdValido,
          prioridade: (params.prioridade as any) || "media",
          prazo,
          tags: params.tags || null,
          asaasPaymentId: params.asaasPaymentId || null,
          processoId: params.processoId || null,
          ordem: 0,
        });
        const cardId = (r as { insertId: number }).insertId;

        if (responsavelIdValido !== null) {
          const { notificarCardAtribuido } = await import("../escritorio/notificar-card-kanban");
          await notificarCardAtribuido({
            cardId,
            responsavelColaboradorId: responsavelIdValido,
            atribuidorUserId: null,
            acao: "criado",
            tituloCard: params.titulo,
          });
        }

        return cardId;
      } catch (err: any) {
        log.error({ err: err.message }, "SmartFlow: erro ao criar card Kanban");
        throw err;
      }
    },

    async moverCardKanban(params): Promise<boolean> {
      try {
        const { getDb } = await import("../db");
        const { kanbanCards, kanbanColunas, kanbanMovimentacoes } = await import("../../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) throw new Error("DB indisponível");

        const [card] = await db.select({ id: kanbanCards.id, colunaId: kanbanCards.colunaId })
          .from(kanbanCards)
          .where(and(
            eq(kanbanCards.id, params.cardId),
            eq(kanbanCards.escritorioId, escritorioId),
          )).limit(1);
        if (!card) throw new Error(`Card ${params.cardId} não encontrado`);

        // Valida que a coluna destino pertence ao mesmo escritório (via funil).
        const { kanbanFunis } = await import("../../drizzle/schema");
        const [colDest] = await db.select({ id: kanbanColunas.id, funilEscritorio: kanbanFunis.escritorioId })
          .from(kanbanColunas)
          .innerJoin(kanbanFunis, eq(kanbanColunas.funilId, kanbanFunis.id))
          .where(eq(kanbanColunas.id, params.colunaDestinoId))
          .limit(1);
        if (!colDest || colDest.funilEscritorio !== escritorioId) {
          throw new Error(`Coluna ${params.colunaDestinoId} inválida`);
        }

        if (card.colunaId === params.colunaDestinoId) return true;

        await db.update(kanbanCards)
          .set({ colunaId: params.colunaDestinoId, atrasado: false })
          .where(eq(kanbanCards.id, params.cardId));

        await db.insert(kanbanMovimentacoes).values({
          cardId: params.cardId,
          colunaOrigemId: card.colunaId,
          colunaDestinoId: params.colunaDestinoId,
          movidoPorId: null,
        });

        return true;
      } catch (err: any) {
        log.error({ err: err.message }, "SmartFlow: erro ao mover card Kanban");
        throw err;
      }
    },

    async atribuirResponsavelKanban(params): Promise<boolean> {
      try {
        const { getDb } = await import("../db");
        const { kanbanCards, colaboradores } = await import("../../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) throw new Error("DB indisponível");

        const [card] = await db.select({ id: kanbanCards.id, titulo: kanbanCards.titulo })
          .from(kanbanCards)
          .where(and(
            eq(kanbanCards.id, params.cardId),
            eq(kanbanCards.escritorioId, escritorioId),
          )).limit(1);
        if (!card) throw new Error(`Card ${params.cardId} não encontrado`);

        // Valida colaborador (mesmo escritório, ativo). null = remover responsável.
        let responsavelIdValido: number | null = null;
        if (params.responsavelId !== null && params.responsavelId !== undefined) {
          const [colab] = await db.select({ id: colaboradores.id })
            .from(colaboradores)
            .where(and(
              eq(colaboradores.id, params.responsavelId),
              eq(colaboradores.escritorioId, escritorioId),
              eq(colaboradores.ativo, true),
            )).limit(1);
          if (!colab) throw new Error(`Colaborador ${params.responsavelId} inválido`);
          responsavelIdValido = colab.id;
        }

        await db.update(kanbanCards)
          .set({ responsavelId: responsavelIdValido })
          .where(eq(kanbanCards.id, params.cardId));

        if (responsavelIdValido !== null) {
          const { notificarCardAtribuido } = await import("../escritorio/notificar-card-kanban");
          await notificarCardAtribuido({
            cardId: params.cardId,
            responsavelColaboradorId: responsavelIdValido,
            atribuidorUserId: null,
            acao: "atribuido",
            tituloCard: card.titulo,
          });
        }

        return true;
      } catch (err: any) {
        log.error({ err: err.message }, "SmartFlow: erro ao atribuir responsável do card Kanban");
        throw err;
      }
    },

    async atualizarTagsCardKanban(params): Promise<boolean> {
      try {
        const { getDb } = await import("../db");
        const { kanbanCards } = await import("../../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) throw new Error("DB indisponível");

        const [card] = await db.select({ id: kanbanCards.id, tags: kanbanCards.tags })
          .from(kanbanCards)
          .where(and(
            eq(kanbanCards.id, params.cardId),
            eq(kanbanCards.escritorioId, escritorioId),
          )).limit(1);
        if (!card) throw new Error(`Card ${params.cardId} não encontrado`);

        const atuais = (card.tags || "")
          .split(",")
          .map((t) => t.trim())
          .filter((t) => t.length > 0);
        const novasNorm = params.tags.map((t) => t.trim()).filter((t) => t.length > 0);

        let resultado: string[];
        if (params.modo === "definir") {
          resultado = Array.from(new Set(novasNorm));
        } else if (params.modo === "remover") {
          const remover = new Set(novasNorm.map((t) => t.toLowerCase()));
          resultado = atuais.filter((t) => !remover.has(t.toLowerCase()));
        } else {
          // adicionar (default): união, sem duplicar (case-insensitive).
          const lower = new Set(atuais.map((t) => t.toLowerCase()));
          resultado = [...atuais];
          for (const t of novasNorm) {
            if (!lower.has(t.toLowerCase())) {
              resultado.push(t);
              lower.add(t.toLowerCase());
            }
          }
        }

        // Coluna `tags` é varchar(255) — trunca silenciosamente se passar.
        const csv = resultado.join(", ");
        const csvFinal = csv.length > 255 ? csv.slice(0, 255) : csv;

        await db.update(kanbanCards)
          .set({ tags: csvFinal || null })
          .where(eq(kanbanCards.id, params.cardId));

        return true;
      } catch (err: any) {
        log.error({ err: err.message }, "SmartFlow: erro ao atualizar tags do card Kanban");
        throw err;
      }
    },

    async atualizarTagsContato(params): Promise<string[]> {
      const { getDb } = await import("../db");
      const { contatos } = await import("../../drizzle/schema");
      const { eq, and } = await import("drizzle-orm");
      const { parseTagsTolerante } = await import("../escritorio/db-crm");
      const db = await getDb();
      if (!db) throw new Error("DB indisponível");

      const [c] = await db.select({ id: contatos.id, tags: contatos.tags })
        .from(contatos)
        .where(and(eq(contatos.id, params.contatoId), eq(contatos.escritorioId, escritorioId)))
        .limit(1);
      if (!c) throw new Error(`Contato ${params.contatoId} não encontrado`);

      const atuais = parseTagsTolerante(c.tags);
      const novasNorm = params.tags.map((t) => t.trim()).filter((t) => t.length > 0);

      let resultado: string[];
      if (params.modo === "definir") {
        resultado = Array.from(new Set(novasNorm));
      } else if (params.modo === "remover") {
        const remover = new Set(novasNorm.map((t) => t.toLowerCase()));
        resultado = atuais.filter((t) => !remover.has(t.toLowerCase()));
      } else {
        const lower = new Set(atuais.map((t) => t.toLowerCase()));
        resultado = [...atuais];
        for (const t of novasNorm) {
          if (!lower.has(t.toLowerCase())) {
            resultado.push(t);
            lower.add(t.toLowerCase());
          }
        }
      }

      // contatos.tags é JSON (mesmo formato do CRM).
      await db.update(contatos)
        .set({ tags: resultado.length > 0 ? JSON.stringify(resultado) : null })
        .where(eq(contatos.id, params.contatoId));
      log.info({ contatoId: params.contatoId, modo: params.modo, total: resultado.length }, "SmartFlow: tags do contato atualizadas");
      return resultado;
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

    async buscarCobrancasAbertas(params): Promise<string> {
      try {
        const { getDb } = await import("../db");
        const { asaasCobrancas, asaasClientes } = await import("../../drizzle/schema");
        const { eq, and, inArray } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) return "";

        // Resolve customerId se só veio contatoId.
        let customerId = params.clienteAsaasId;
        if (!customerId && params.contatoId) {
          const [vinc] = await db
            .select({ asaasCustomerId: asaasClientes.asaasCustomerId })
            .from(asaasClientes)
            .where(
              and(
                eq(asaasClientes.escritorioId, escritorioId),
                eq(asaasClientes.contatoId, params.contatoId),
              ),
            )
            .limit(1);
          customerId = vinc?.asaasCustomerId;
        }
        if (!customerId) return "";

        const cobrancas = await db
          .select()
          .from(asaasCobrancas)
          .where(
            and(
              eq(asaasCobrancas.escritorioId, escritorioId),
              eq(asaasCobrancas.asaasCustomerId, customerId),
              inArray(asaasCobrancas.status, ["PENDING", "OVERDUE"]),
            ),
          );

        if (cobrancas.length === 0) return "Não há cobranças em aberto.";

        // Formata cada linha: "• R$ 1.234,56 — vence 15/04 — <link>"
        return cobrancas
          .map((c) => {
            const valorNum = Number(c.valor || 0);
            const valorFmt = valorNum.toLocaleString("pt-BR", {
              style: "currency",
              currency: "BRL",
            });
            let venceTxt = "";
            if (c.vencimento) {
              const d = new Date(`${c.vencimento}T00:00:00`);
              if (!Number.isNaN(d.getTime())) {
                venceTxt = `vence ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
              }
            }
            const link = c.invoiceUrl || c.bankSlipUrl || "";
            const partes = [`• ${valorFmt}`];
            if (venceTxt) partes.push(venceTxt);
            if (link) partes.push(link);
            return partes.join(" — ");
          })
          .join("\n");
      } catch (err: any) {
        log.warn({ err: err.message }, "SmartFlow: erro ao buscar cobranças abertas");
        return "";
      }
    },

    async gerarCobrancaAsaas(params): Promise<{ pagamentoId: string; link?: string }> {
      const { getAsaasClient } = await import("../integracoes/router-asaas");
      const client = await getAsaasClient(escritorioId);
      if (!client) throw new Error("Asaas não configurado neste escritório");

      const { getDb } = await import("../db");
      const { asaasClientes } = await import("../../drizzle/schema");
      const { eq, and } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) throw new Error("DB indisponível");

      // Resolve customerId: vínculo primário > primeiro encontrado.
      const vinculos = await db
        .select({
          asaasCustomerId: asaasClientes.asaasCustomerId,
          primario: asaasClientes.primario,
        })
        .from(asaasClientes)
        .where(and(
          eq(asaasClientes.escritorioId, escritorioId),
          eq(asaasClientes.contatoId, params.contatoId),
        ));
      const principal = vinculos.find((v) => v.primario) ?? vinculos[0];
      if (!principal) throw new Error("Contato não tem cliente Asaas vinculado");

      const dias = params.vencimentoDias ?? 7;
      // Soma "dias" sobre o hoje no fuso BR (evita off-by-one após 21h
      // BRT, quando new Date().toISOString() já mostraria amanhã).
      const { dataHojeBR } = await import("../../shared/escritorio-types");
      const [y, m, d] = dataHojeBR().split("-").map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      dt.setUTCDate(dt.getUTCDate() + dias);
      const dueDate = dt.toISOString().slice(0, 10);

      const cobranca = await client.criarCobranca({
        customer: principal.asaasCustomerId,
        billingType: (params.tipoCobranca ?? "BOLETO") as any,
        value: params.valor,
        dueDate,
        description: params.descricao,
      });

      return {
        pagamentoId: cobranca.id,
        link: cobranca.invoiceUrl || cobranca.bankSlipUrl || undefined,
      };
    },

    async cancelarCobrancaAsaas(params): Promise<boolean> {
      const { getAsaasClient } = await import("../integracoes/router-asaas");
      const client = await getAsaasClient(escritorioId);
      if (!client) throw new Error("Asaas não configurado neste escritório");
      await client.excluirCobranca(params.pagamentoId);
      return true;
    },

    async consultarValorAbertoAsaas(params): Promise<{ total: number; pendente: number; vencido: number; qtdAberto: number }> {
      const { getAsaasClient } = await import("../integracoes/router-asaas");
      const client = await getAsaasClient(escritorioId);
      if (!client) throw new Error("Asaas não configurado neste escritório");

      const { getDb } = await import("../db");
      const { asaasClientes } = await import("../../drizzle/schema");
      const { eq, and } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) throw new Error("DB indisponível");

      const vinculos = await db
        .select({
          asaasCustomerId: asaasClientes.asaasCustomerId,
          primario: asaasClientes.primario,
        })
        .from(asaasClientes)
        .where(and(
          eq(asaasClientes.escritorioId, escritorioId),
          eq(asaasClientes.contatoId, params.contatoId),
        ));
      const principal = vinculos.find((v) => v.primario) ?? vinculos[0];
      if (!principal) throw new Error("Contato não tem cliente Asaas vinculado");

      const r = await client.resumoFinanceiroCliente(principal.asaasCustomerId);
      const qtdAberto = r.cobrancas.filter(
        (c) => c.status === "PENDING" || c.status === "OVERDUE",
      ).length;
      return {
        total: r.total,
        pendente: r.pendente,
        vencido: r.vencido,
        qtdAberto,
      };
    },

    async marcarCobrancaRecebidaAsaas(params): Promise<boolean> {
      const { getAsaasClient } = await import("../integracoes/router-asaas");
      const client = await getAsaasClient(escritorioId);
      if (!client) throw new Error("Asaas não configurado neste escritório");
      await client.confirmarRecebimentoEmDinheiro(params.pagamentoId, {
        value: params.valorRecebido,
        paymentDate: params.dataRecebimento,
      });
      return true;
    },

    async definirCampoPersonalizadoCliente(params): Promise<boolean> {
      const { getDb } = await import("../db");
      const { contatos, camposPersonalizadosCliente } = await import("../../drizzle/schema");
      const { eq, and } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) throw new Error("DB indisponível");

      // Valida que a chave existe no catálogo do escritório.
      const [campo] = await db
        .select({ chave: camposPersonalizadosCliente.chave })
        .from(camposPersonalizadosCliente)
        .where(and(
          eq(camposPersonalizadosCliente.escritorioId, escritorioId),
          eq(camposPersonalizadosCliente.chave, params.chave),
        ))
        .limit(1);
      if (!campo) {
        throw new Error(`Campo personalizado "${params.chave}" não existe no catálogo do escritório`);
      }

      // Busca contato + JSON atual.
      const [contato] = await db
        .select({
          id: contatos.id,
          camposPersonalizados: contatos.camposPersonalizados,
        })
        .from(contatos)
        .where(and(
          eq(contatos.id, params.contatoId),
          eq(contatos.escritorioId, escritorioId),
        ))
        .limit(1);
      if (!contato) throw new Error(`Contato ${params.contatoId} não encontrado`);

      // Merge na chave alvo (preserva outras chaves).
      let camposAtuais: Record<string, unknown> = {};
      if (contato.camposPersonalizados) {
        try {
          const parsed = JSON.parse(contato.camposPersonalizados);
          if (parsed && typeof parsed === "object") camposAtuais = parsed;
        } catch {
          // JSON corrompido — começamos do zero, evita escalar erro.
        }
      }
      camposAtuais[params.chave] = params.valor;

      await db
        .update(contatos)
        .set({ camposPersonalizados: JSON.stringify(camposAtuais) })
        .where(eq(contatos.id, params.contatoId));

      return true;
    },
  };
}

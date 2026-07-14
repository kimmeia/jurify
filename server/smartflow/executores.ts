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
import { montarBodyOpenAIChat } from "../_core/openai-model-params";
import type { ImagemAnexa } from "../../shared/smartflow-types";
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
  imagem?: ImagemAnexa,
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
      imagem,
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
    body: JSON.stringify(montarBodyOpenAIChat({
      model: cfg.modelo || "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        ...historicoMsgs,
        {
          role: "user",
          content: imagem
            ? [
                { type: "text", text: mensagem },
                { type: "image_url", image_url: { url: `data:${imagem.mime};base64,${imagem.base64}` } },
              ]
            : mensagem,
        },
      ],
      maxTokens: cfg.maxTokens,
      temperatura: cfg.temperatura,
    })),
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
 * Persiste um envio de template (HSM) como mensagem de saída na conversa do
 * contato — best-effort. Conecta o disparo proativo ao webhook de status de
 * entrega da Meta (casa por `idExterno`): sem essa linha, o `failed` posterior
 * não tem onde encaixar e o motivo da não-entrega some — o disparo fica
 * "executado" mentindo. Nunca lança: falha aqui não pode derrubar um envio já
 * efetuado na Meta.
 */
async function persistirEnvioTemplate(
  escritorioId: number,
  dados: { contatoId: number; canalId?: number; idExterno: string; conteudo: string },
): Promise<void> {
  try {
    const { getDb } = await import("../db");
    const { canaisIntegrados, conversas } = await import("../../drizzle/schema");
    const { eq, and, or, desc } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return;

    // Canal oficial que efetivou o envio (fallback: o whatsapp_api conectado).
    let canalId = dados.canalId;
    if (!canalId) {
      const [canal] = await db
        .select({ id: canaisIntegrados.id })
        .from(canaisIntegrados)
        .where(
          and(
            eq(canaisIntegrados.escritorioId, escritorioId),
            eq(canaisIntegrados.tipo, "whatsapp_api"),
            eq(canaisIntegrados.status, "conectado"),
          ),
        )
        .limit(1);
      canalId = canal?.id;
    }
    if (!canalId) return;

    // Reusa a conversa não-fechada mais recente do contato nesse canal; senão
    // cria uma. Evita poluir o inbox com conversa duplicada a cada cobrança.
    const [existente] = await db
      .select({ id: conversas.id })
      .from(conversas)
      .where(
        and(
          eq(conversas.escritorioId, escritorioId),
          eq(conversas.canalId, canalId),
          eq(conversas.contatoId, dados.contatoId),
          or(
            eq(conversas.status, "aguardando"),
            eq(conversas.status, "em_atendimento"),
            eq(conversas.status, "resolvido"),
          ),
        ),
      )
      .orderBy(desc(conversas.ultimaMensagemAt))
      .limit(1);

    const { criarConversa, enviarMensagem } = await import("../escritorio/db-crm");
    const conversaId =
      existente?.id ??
      (await criarConversa({ escritorioId, contatoId: dados.contatoId, canalId, assunto: "Cobrança (SmartFlow)" }));

    await enviarMensagem({
      conversaId,
      direcao: "saida",
      tipo: "texto",
      conteudo: dados.conteudo,
      status: "enviada",
      idExterno: dados.idExterno,
    });
  } catch (err: any) {
    log.warn({ err: err?.message, contatoId: dados.contatoId }, "SmartFlow: falha ao persistir envio de template (não-fatal)");
  }
}

/**
 * Cria executores reais para um escritório específico.
 */
export function criarExecutoresReais(escritorioId: number, imagemAtual?: ImagemAnexa): SmartflowExecutores {
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
        imagemAtual,
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
        imagemAtual,
      );
    },

    async conversarComAgente(params): Promise<{ resposta: string; acao: string | null; quando: string | null }> {
      const { obterAgentePorId } = await import("../integracoes/router-agentes-ia");
      const { orquestrarAtendente, gerarSlotsLivres, formatarHorariosLivres } = await import("./engine");
      const cfg = await obterAgentePorId(escritorioId, params.agenteId);
      if (!cfg) throw new Error(`Agente ${params.agenteId} não encontrado, inativo ou sem API key configurada.`);

      const ferramentasBuiltin = (params.ferramentas || []).filter((f) => typeof f === "string" && f.trim());
      const consultas = (params.consultas || []).filter((c) => typeof c === "string" && c.trim());
      const acoesCustom = (params.acoesCustom || []).filter((a) => a && typeof a.nome === "string" && a.nome.trim());
      // Ferramentas efetivas = builtin habilitadas + ações customizadas (mesmo
      // mecanismo: o agente emite o nome e o fluxo roteia por proximoSe[nome]).
      const ferramentas = [...ferramentasBuiltin, ...acoesCustom.map((a) => a.nome.trim())];
      const DESC_ACAO: Record<string, string> = {
        agendar: "o cliente confirmou um horário e você vai marcar. OBRIGATÓRIO: preencha `quando` com a data/hora ISO EXATA que ele escolheu, copiada de um dos horários ISO que você ofereceu (ex: \"2026-05-27T14:00:00-03:00\"). Sem isso o sistema marca no horário errado",
        transferir: "o cliente pediu falar com um humano OU você não consegue resolver",
        encerrar: "a conversa terminou (cliente se despediu ou não quer mais nada)",
        gerar_cobranca: "é o momento de gerar uma cobrança/pagamento pro cliente",
        buscar_processo: "o cliente quer saber de um processo dele e é preciso consultar",
        // Ações customizadas do usuário: a descrição é o "use quando…" que ele escreveu.
        ...Object.fromEntries(acoesCustom.map((a) => [a.nome.trim(), (a.descricao || "").trim() || a.nome.trim()])),
      };
      const DESC_CONSULTA: Record<string, string> = {
        ver_horarios: "precisa saber os horários livres pra oferecer ao cliente (use ANTES de agendar)",
        ver_acoes_cliente: "o cliente pergunta sobre os processos/casos DELE e você precisa saber quais são",
        ver_valor_aberto: "o cliente pergunta sobre pagamentos/valores em aberto dele",
      };
      const lista = (m: Record<string, string>, ids: string[]) =>
        ids.length ? ids.map((id) => `- "${id}": use quando ${m[id] || id}`).join("\n") : "(nenhuma)";

      const hojeFmt = new Date().toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "long", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      });
      // Interpola variáveis ({{atendente}}, {{cliente.nome}}, etc.) no prompt
      // do agente E no roteiro do bloco ANTES de ir pro LLM. Sem `params.vars`,
      // mantém o texto cru (retrocompat). Resolve o caso "distribuir setor →
      // Atendente IA" — o prompt fica dinâmico com o nome do atendente.
      const { interpolarVariaveis } = await import("./interpolar");
      const vars = params.vars ?? {};
      const interp = (s: string): string => Object.keys(vars).length > 0 ? interpolarVariaveis(s, vars as Record<string, any>) : s;
      const promptBase = interp(cfg.prompt);
      const roteiroFinal = params.roteiro?.trim() ? interp(params.roteiro.trim()) : "";
      const instrucao = [
        roteiroFinal ? `ROTEIRO DESTE ATENDIMENTO:\n${roteiroFinal}` : "",
        "Conduza a conversa de forma humana e natural, seguindo o roteiro.",
        `AGORA é ${hojeFmt} (fuso de Brasília). Datas E HORÁRIOS anteriores a este momento JÁ PASSARAM — NUNCA ofereça nem confirme um horário que já passou hoje (ex: se agora são 16:54, NÃO ofereça 15h hoje — ofereça só os horários FUTUROS da lista). Mesmo que apareça na lista da consulta por engano, ignore qualquer horário ≤ agora.`,
        `CONSULTAS (buscam um dado e voltam pra você continuar):\n${lista(DESC_CONSULTA, consultas)}`,
        `AÇÕES (encerram seu turno e seguem o fluxo):\n${lista(DESC_ACAO, ferramentas)}`,
        "Quando precisar de um dado (ex: horários), dispare a CONSULTA correspondente AGORA, no MESMO turno. NUNCA responda só \"um momento\"/\"vou verificar\" e pare — isso deixa o cliente esperando sem resposta. A lista da consulta é COMPLETA: ofereça POUCOS horários ao cliente, mas pra confirmar ou negar um horário específico que ele pedir, olhe a lista INTEIRA — se o horário está nela, está LIVRE (não negue só porque não foi um dos que você ofereceu). Só diga que não tem se realmente não estiver na lista; nunca invente nem prometa checar separado.",
        "REGRA DAS AÇÕES (siga à risca): o padrão é acao=null — continue conversando. Só preencha `acao` quando a CONDIÇÃO daquela ação (descrita acima) estiver claramente satisfeita pela ÚLTIMA mensagem do cliente. NUNCA dispare uma ação na saudação, na 1ª troca, nem só porque ela está habilitada. Ex.: não use \"agendar\" enquanto o cliente não tiver escolhido/confirmado um horário; uma pergunta como \"você é advogado?\" ou \"tenho uma dúvida\" se responde conversando (acao=null), não agendando. Na dúvida, acao=null.",
        "NÃO peça confirmação redundante: quando o cliente JÁ indicar um horário específico que está entre os que você ofereceu (ex: \"quinta às 10\", \"pode ser as 14h\"), dispare `agendar` DIRETO com esse horário em `quando` — dizer um horário da lista JÁ é a confirmação, não pergunte \"confirma?\" de novo. Só confirme se houver ambiguidade real (data sem hora, dois horários possíveis, ou horário fora dos que você ofereceu).",
        "AÇÕES CUSTOMIZADAS (nomes diferentes de agendar/transferir/encerrar/gerar_cobranca/buscar_processo): assim que a CONDIÇÃO descrita na ação (o \"use quando…\") estiver satisfeita pela conversa até aqui, DISPARE A AÇÃO IMEDIATAMENTE na sua próxima resposta. Ex.: se a ação `dados_ok` diz \"use quando já coletou nome, caso e telefone\" e você JÁ tem essas 3 informações, dispare `dados_ok` AGORA — não fique perguntando \"mais alguma coisa?\" nem \"posso prosseguir?\". Confie na descrição e dispare; o fluxo cuida do próximo passo.",
        'Responda SEMPRE em JSON puro (sem markdown): {"resposta": "<mensagem pro cliente>", "acao": "<ação ou null>", "consulta": "<consulta ou null>", "quando": "<ISO do horário escolhido quando acao=agendar; senão null>"}',
      ].filter(Boolean).join("\n\n");

      const contextoCliente = await resolverContextoCliente(escritorioId, params.contatoId);
      const historico = params.conversaId ? await carregarHistoricoConversa(params.conversaId, params.mensagem) : [];
      const llmCfg = {
        provider: cfg.provider, modelo: cfg.modelo, openaiApiKey: cfg.openaiApiKey,
        anthropicApiKey: cfg.anthropicApiKey, maxTokens: cfg.maxTokens, temperatura: cfg.temperatura,
        contextoDocumentos: cfg.contextoDocumentos, contextoCliente,
      };

      // Executa uma consulta e devolve o resultado como texto pro agente.
      const executarConsulta = async (nome: string): Promise<string> => {
        if (nome === "ver_horarios") {
          const respId = params.consultaConfig?.responsavelId;
          if (!respId) return "Não há responsável configurado para checar a agenda.";
          const dias = params.consultaConfig?.dias ?? 7;
          const dur = params.consultaConfig?.duracaoMin ?? 30;
          const agora = new Date();
          const fim = new Date(agora.getTime() + dias * 24 * 60 * 60 * 1000);
          const ocupados = await this.listarAgendaResponsavel({ responsavelId: respId, dataInicio: agora.toISOString(), dataFim: fim.toISOString() });
          // Bloqueios da agenda do escritório (feriados + indisponibilidades).
          // Expande recorrência anual pros próximos `dias` antes de passar
          // pro gerador — o gerador só lida com datas concretas.
          const { listarBloqueios, bloqueiosAplicaveis } = await import("../escritorio/db-agenda-bloqueios");
          const todosBloqueios = await listarBloqueios(escritorioId);
          const diasInteirosBloqueados = new Set<string>();
          const intervalosBloqueados: Array<{ data: string; horaIni: string; horaFim: string }> = [];
          // -3 = offset Brasília. Usa mesma lógica do gerador (baseLocal)
          // pra garantir que dataISO bate com a string que o gerador
          // compara internamente.
          const baseLocalMs = agora.getTime() + -3 * 3600 * 1000;
          for (let d = 0; d < dias; d++) {
            const dia = new Date(baseLocalMs + d * 86400000);
            const dataISO = `${dia.getUTCFullYear()}-${String(dia.getUTCMonth() + 1).padStart(2, "0")}-${String(dia.getUTCDate()).padStart(2, "0")}`;
            for (const b of bloqueiosAplicaveis(dataISO, todosBloqueios)) {
              if (!b.horaInicio || !b.horaFim) diasInteirosBloqueados.add(dataISO);
              else intervalosBloqueados.push({ data: dataISO, horaIni: b.horaInicio, horaFim: b.horaFim });
            }
          }
          // maxSlots alto: a lista precisa ser COMPLETA pra o agente confirmar/negar
          // um horário específico (antes truncava em 4/dia e ele negava o 5º+ livre).
          const livres = gerarSlotsLivres({ agora, dias, incluirFimDeSemana: false, duracaoMin: dur, horaInicio: 9, horaFim: 18, ocupados, maxSlots: 120, diasInteirosBloqueados, intervalosBloqueados });
          return formatarHorariosLivres(livres);
        }
        if (nome === "ver_acoes_cliente") {
          if (!params.contatoId) return "Cliente ainda não identificado no sistema (sem cadastro).";
          const acoes = await this.listarAcoesCliente({ contatoId: params.contatoId, limite: 10 });
          if (acoes.length === 0) return "Este cliente não tem casos/processos cadastrados.";
          const linhas = acoes.map((a) => {
            const ident = a.apelido || a.numeroCnj || a.classe || `Caso #${a.id}`;
            const extra = [a.classe, a.polo ? `polo ${a.polo}` : "", a.numeroCnj && a.numeroCnj !== ident ? a.numeroCnj : ""].filter(Boolean).join(" · ");
            return `- ${ident}${extra ? ` (${extra})` : ""}`;
          }).join("\n");
          return `Casos/processos do cliente (${acoes.length}):\n${linhas}`;
        }
        if (nome === "ver_valor_aberto") {
          if (!params.contatoId) return "Cliente ainda não identificado no sistema (sem cadastro).";
          const texto = await this.buscarCobrancasAbertas({ contatoId: params.contatoId });
          return texto && texto.trim() ? texto.trim() : "O cliente não tem valores em aberto.";
        }
        return `Consulta "${nome}" não implementada.`;
      };

      return orquestrarAtendente({
        ferramentas,
        consultas,
        executarConsulta,
        chamarLLM: (extra) =>
          invocarLLM(
            llmCfg,
            extra ? `${promptBase}\n\n${instrucao}\n\nDADOS JÁ CONSULTADOS NESTE TURNO:\n${extra}` : `${promptBase}\n\n${instrucao}`,
            params.mensagem,
            historico,
          ),
      });
    },

    async resolverResponsavelAgenda(params): Promise<number | null> {
      const { getDb } = await import("../db");
      const { colaboradores, conversas, escritorios } = await import("../../drizzle/schema");
      const { eq, and, inArray } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) return params.responsavelIdPreferido ?? params.atendenteResponsavelId ?? null;

      // Candidatos em ordem de prioridade (advogado fixo → atendente da
      // conversa → responsável do contato → padrão do escritório), sem repetir.
      const candidatos: number[] = [];
      const add = (v: unknown) => {
        const n = Number(v);
        if (Number.isInteger(n) && n > 0 && !candidatos.includes(n)) candidatos.push(n);
      };
      add(params.responsavelIdPreferido);
      if (params.conversaId) {
        const [conv] = await db
          .select({ atendenteId: conversas.atendenteId })
          .from(conversas)
          .where(and(eq(conversas.id, params.conversaId), eq(conversas.escritorioId, escritorioId)))
          .limit(1);
        if (conv?.atendenteId) add(conv.atendenteId);
      }
      add(params.atendenteResponsavelId);

      const [esc] = await db
        .select({ padrao: escritorios.agendaResponsavelPadraoId, ownerId: escritorios.ownerId })
        .from(escritorios)
        .where(eq(escritorios.id, escritorioId))
        .limit(1);
      if (esc?.padrao) add(esc.padrao);

      // Fica só com candidatos que são colaboradores ATIVOS deste escritório,
      // preservando a ordem (um atendente removido não "fura" a cascata).
      if (candidatos.length > 0) {
        const ativos = await db
          .select({ id: colaboradores.id })
          .from(colaboradores)
          .where(and(
            eq(colaboradores.escritorioId, escritorioId),
            eq(colaboradores.ativo, true),
            inArray(colaboradores.id, candidatos),
          ));
        const ativoSet = new Set(ativos.map((r) => r.id));
        for (const c of candidatos) if (ativoSet.has(c)) return c;
      }

      // Fallback final: colaborador "dono" — garante "nunca sem responsável".
      const [dono] = await db
        .select({ id: colaboradores.id })
        .from(colaboradores)
        .where(and(
          eq(colaboradores.escritorioId, escritorioId),
          eq(colaboradores.cargo, "dono"),
          eq(colaboradores.ativo, true),
        ))
        .limit(1);
      if (dono?.id) return dono.id;

      // Último recurso: ownerId (users.id) → colaborador (escritórios legados
      // sem cargo "dono" explícito).
      if (esc?.ownerId) {
        const [ownerColab] = await db
          .select({ id: colaboradores.id })
          .from(colaboradores)
          .where(and(eq(colaboradores.escritorioId, escritorioId), eq(colaboradores.userId, esc.ownerId)))
          .limit(1);
        if (ownerColab?.id) return ownerColab.id;
      }
      return null;
    },

    async distribuirAtendimentoPorSetor(params): Promise<{ id: number; nome: string } | null> {
      const { getDb } = await import("../db");
      const { colaboradores, users, conversas } = await import("../../drizzle/schema");
      const { eq, and, or, inArray, sql } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) return null;

      // MODO "atendente fixo": atribui direto pessoa escolhida, sem setor/round-robin.
      // Verifica que está ativa; se removida/inativa → null (sai por "sem_atendente").
      // SOBRESCREVE qualquer atendente anterior — comportamento intencional do modo
      // "fixo" (o usuário foi explícito sobre quem deve atender).
      if (params.atendenteIdFixo) {
        const [colab] = await db
          .select({ id: colaboradores.id, nome: users.name })
          .from(colaboradores)
          .innerJoin(users, eq(users.id, colaboradores.userId))
          .where(and(
            eq(colaboradores.id, params.atendenteIdFixo),
            eq(colaboradores.escritorioId, escritorioId),
            eq(colaboradores.ativo, true),
          ))
          .limit(1);
        if (!colab?.id) return null;
        if (params.conversaId) {
          await db.update(conversas)
            .set({ atendenteId: colab.id })
            .where(and(eq(conversas.id, params.conversaId), eq(conversas.escritorioId, escritorioId)));
        }
        return { id: colab.id, nome: colab.nome || "Atendente" };
      }

      // Atendentes ATIVOS do setor (com o nome do usuário).
      const candidatos = await db
        .select({
          id: colaboradores.id,
          nome: users.name,
          ultimaAtividade: colaboradores.ultimaAtividade,
          maxSimultaneos: colaboradores.maxAtendimentosSimultaneos,
          ultimaDistribuicao: colaboradores.ultimaDistribuicao,
        })
        .from(colaboradores)
        .innerJoin(users, eq(users.id, colaboradores.userId))
        .where(and(
          eq(colaboradores.escritorioId, escritorioId),
          eq(colaboradores.setorId, params.setorId),
          eq(colaboradores.ativo, true),
        ));
      if (candidatos.length === 0) return null;

      // Carga = conversas abertas (aguardando/em_atendimento) por atendente.
      // Usada como TRAVA de capacidade no rodízio (não como ranking).
      const cargaPorId = new Map<number, number>();
      const cargas = await db
        .select({ atendenteId: conversas.atendenteId, n: sql<number>`COUNT(*)` })
        .from(conversas)
        .where(and(
          eq(conversas.escritorioId, escritorioId),
          inArray(conversas.atendenteId, candidatos.map((c) => c.id)),
          or(eq(conversas.status, "aguardando"), eq(conversas.status, "em_atendimento")),
        ))
        .groupBy(conversas.atendenteId);
      for (const r of cargas) if (r.atendenteId != null) cargaPorId.set(r.atendenteId, Number(r.n));

      // Pool online-first + round-robin puro + capacidade como trava —
      // regras e racional em server/smartflow/distribuicao.ts.
      const { selecionarAtendenteRodizio } = await import("./distribuicao");
      const escolhidoId = selecionarAtendenteRodizio(candidatos, cargaPorId, {
        modoOnline: params.modoDistribuicao,
      });
      if (escolhidoId == null) return null;
      const escolhido = candidatos.find((c) => c.id === escolhidoId)!;

      // Seta o atendente DESTA conversa (sem mexer no status — o bot segue o
      // fluxo) e marca ultimaDistribuicao pro round-robin. NÃO grava
      // contato.responsavelId: o "dono do cliente" é CRM puro (definido só
      // manualmente). A distribuição decide apenas quem atende a conversa —
      // sem amarra escondida que funilava tudo pro mesmo atendente.
      if (params.conversaId) {
        await db.update(conversas)
          .set({ atendenteId: escolhido.id })
          .where(and(eq(conversas.id, params.conversaId), eq(conversas.escritorioId, escritorioId)));
      }
      await db.update(colaboradores)
        .set({ ultimaDistribuicao: new Date() })
        .where(eq(colaboradores.id, escolhido.id));

      return { id: escolhido.id, nome: escolhido.nome || "Atendente" };
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

    async enviarWhatsApp(
      telefone: string,
      mensagem: string,
      opts?: { contatoId?: number; proativo?: boolean },
    ): Promise<boolean> {
      // Envio proativo (SmartFlow/scheduler) pelo canal WhatsApp oficial (Cloud
      // API Meta). `proativo` ativa as travas anti-ban (disjuntor/teto diário/
      // rate/opt-in) no helper; sem isso o disparo em massa de texto escapava
      // de todas as proteções e podia derrubar a conta.
      try {
        const { getDb } = await import("../db");
        const { canaisIntegrados } = await import("../../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) return false;

        const canais = await db.select().from(canaisIntegrados)
          .where(and(
            eq(canaisIntegrados.escritorioId, escritorioId),
            eq(canaisIntegrados.status, "conectado"),
            eq(canaisIntegrados.tipo, "whatsapp_api"),
          ))
          .limit(1);

        if (canais.length === 0) return false;
        const canalId = canais[0].id;

        // Divide mensagens longas em bolhas com pausa (mesma regra das
        // respostas de conversa — config do escritório). Sem typing aqui:
        // envio proativo nem sempre tem conversa/última msg recebida.
        const { escritorios } = await import("../../drizzle/schema");
        const [escCfg] = await db
          .select({
            ativo: escritorios.msgDividirRespostas,
            max: escritorios.msgDividirMax,
            ritmo: escritorios.msgDividirRitmo,
          })
          .from(escritorios)
          .where(eq(escritorios.id, escritorioId))
          .limit(1);

        const { dividirMensagemNatural, calcularDelayDigitacaoMs } = await import(
          "../integracoes/dividir-mensagem"
        );
        const partes = escCfg?.ativo
          ? dividirMensagemNatural(mensagem, { maxMensagens: escCfg.max })
          : [mensagem];

        const { enviarMensagemPeloCanal } = await import("../integracoes/canal-envio");
        let okTodas = true;
        for (let i = 0; i < partes.length; i++) {
          if (i > 0) {
            await new Promise((r) =>
              setTimeout(r, calcularDelayDigitacaoMs(partes[i], escCfg?.ritmo)),
            );
          }
          const r = await enviarMensagemPeloCanal({
            canalId,
            telefone,
            conteudo: partes[i],
            proativo: opts?.proativo,
            contatoId: opts?.contatoId,
            // Proativo (iniciado pela empresa) exige opt-in — não manda texto
            // "frio" pra quem nunca falou com o escritório nem é cliente.
            exigirOptin: opts?.proativo,
          });
          if (!r.ok) {
            log.warn(
              { canalId, erro: r.erro, provider: r.provider, bloqueio: r.bloqueio, parte: i + 1, totalPartes: partes.length },
              "SmartFlow: envio WhatsApp falhou",
            );
            okTodas = false;
            break;
          }
        }
        return okTodas;
      } catch (err: any) {
        log.error({ err: err.message }, "SmartFlow: erro ao enviar WhatsApp");
        return false;
      }
    },

    async enviarWhatsAppInteractive(p): Promise<boolean> {
      try {
        const { enviarInterativoPeloCanalApi } = await import("../integracoes/canal-envio");
        const r = await enviarInterativoPeloCanalApi({
          escritorioId,
          telefone: p.telefone,
          modo: p.modo,
          body: p.body,
          header: p.header,
          footer: p.footer,
          botoes: p.botoes,
          drawerLabel: p.drawerLabel,
          secoes: p.secoes,
        });
        if (!r.ok) {
          log.warn({ erro: r.erro, provider: r.provider, modo: p.modo }, "SmartFlow: envio WhatsApp interativo falhou");
        }
        return r.ok;
      } catch (err: any) {
        log.error({ err: err.message }, "SmartFlow: erro ao enviar WhatsApp interativo");
        return false;
      }
    },

    async enviarWhatsAppTemplate(telefone, template): Promise<{ ok: boolean; erro?: string }> {
      // Template (HSM) só vai pelo canal oficial Meta (Cloud API). O helper
      // resolve o canal whatsapp_api conectado, decripta as credenciais e
      // dispara via Graph API. Devolve { ok, erro } — o motor mostra o motivo
      // real (Meta/canal) em vez de uma mensagem genérica.
      try {
        const { enviarTemplatePeloCanalApi } = await import("../integracoes/canal-envio");
        const r = await enviarTemplatePeloCanalApi({
          escritorioId,
          telefone,
          nome: template.nome,
          idioma: template.idioma,
          componentes: template.componentes,
          contatoId: template.contatoId,
          exigirOptin: true, // fluxo automático — não dispara template "frio" (anti-spam)
        });
        if (!r.ok) {
          log.warn({ erro: r.erro, template: template.nome }, "SmartFlow: envio de template WhatsApp falhou");
        } else if (template.contatoId && r.idExterno) {
          // Persiste o disparo como mensagem de saída na conversa do contato.
          // Sem isso, o envio é fire-and-forget: a Meta aceita (200) mas o
          // webhook `failed` posterior não acha linha por `idExterno` e o
          // motivo da não-entrega some — dava "executado" mentiroso. Agora o
          // template aparece na timeline E fica rastreável pelo status.
          await persistirEnvioTemplate(escritorioId, {
            contatoId: template.contatoId,
            canalId: r.canalId,
            idExterno: r.idExterno,
            conteudo: template.conteudoPreview || `[Template: ${template.nome}]`,
          });
        }
        return { ok: r.ok, erro: r.erro };
      } catch (err: any) {
        log.error({ err: err.message }, "SmartFlow: erro ao enviar template WhatsApp");
        return { ok: false, erro: err?.message || String(err) };
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

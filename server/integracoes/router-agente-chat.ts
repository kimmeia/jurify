/**
 * Router tRPC — Chat Interno do Agente IA.
 *
 * Permite ao advogado conversar direto com um agente treinado (confecção de
 * peças, análises, pesquisas, resumos). Separado do chatbot do WhatsApp e do
 * endpoint `testar` porque tem histórico persistente em threads.
 *
 * Modelo de dados:
 *   - agente_chat_threads    — "conversas" (uma por peça/caso/tarefa)
 *   - agente_chat_mensagens  — mensagens de cada thread
 *
 * Reuso importante:
 *   - resolverAPIKey / providerDoModelo / montarContextoDocumentos — do
 *     router-agentes-ia.ts (já resolvem OpenAI vs Anthropic + docs do agente)
 *   - gerarRespostaAnthropic — do chatbot-openai.ts
 *
 * Créditos: nesta v1 é GRATUITO. Ver TODO em `enviarMensagem`.
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  agentesIa,
  agenteChatThreads,
  agenteChatMensagens,
} from "../../drizzle/schema";
import { eq, and, desc, asc } from "drizzle-orm";
import { toIsoString } from "../_core/dates";
import { montarBodyOpenAIChat } from "../_core/openai-model-params";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { createLogger } from "../_core/logger";
import {
  resolverAPIKey,
  providerDoModelo,
  montarContextoDocumentos,
} from "./router-agentes-ia";
import { gerarRespostaAnthropic } from "./chatbot-openai";

const log = createLogger("router-agente-chat");

const UPLOAD_DIR = path.resolve("./uploads/agentes-escritorio");
const MAX_SIZE_BYTES = 2 * 1024 * 1024 * 1024; // 2GB
const ALLOWED_MIMES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
];
// MIMEs cujo conteúdo entra no contexto da IA (texto puro só)
const TEXT_EXTRACTABLE_MIMES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
]);

// Limite operacional pra extração de binários (PDF, DOCX) — as libs
// carregam o doc inteiro em memória, então arquivos enormes podem estourar
// a RAM do worker. 25MB cobre relatórios/petições comuns; arquivos maiores
// ficam anexados mas sem conteúdo extraído (a IA vê só o nome).
const LIMITE_BINARIO_BYTES = 25 * 1024 * 1024;
const MAX_CHARS_EXTRACAO = 20000;
const MIME_DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Extrai texto de um anexo para alimentar o contexto da IA.
 *
 * Suporta:
 *  - text/plain | markdown | csv | json: lê o buffer como UTF-8
 *  - application/pdf: usa pdf-parse (best-effort, PDFs escaneados sem
 *    OCR retornam vazio; PDFs criptografados lançam erro e caímos pra null)
 *
 * DOC/DOCX ficam de fora — precisaria mammoth, que não está nas deps.
 * O usuário verá um aviso no frontend pra esses casos.
 *
 * Retorna `null` quando não foi possível extrair (formato não suportado,
 * arquivo muito grande, parsing falhou). Nunca lança — a falha cai
 * silenciosamente pro caminho onde a IA vê só o nome do anexo.
 */
export async function extrairTextoAnexo(
  mimeType: string,
  buffer: Buffer,
): Promise<string | null> {
  if (TEXT_EXTRACTABLE_MIMES.has(mimeType)) {
    try {
      return buffer.toString("utf8").slice(0, MAX_CHARS_EXTRACAO);
    } catch {
      return null;
    }
  }
  if (mimeType === "application/pdf") {
    if (buffer.length > LIMITE_BINARIO_BYTES) {
      log.warn({ tamanho: buffer.length }, "PDF acima do limite — extração ignorada");
      return null;
    }
    try {
      // pdf-parse@1.1.4 quebra em Node 22+ com "bad XRef entry"; pdfjs-dist
      // 5.x já está nas deps (usado pelo react-pdf) e roda bem em backend.
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const doc = await pdfjs.getDocument({
        data: new Uint8Array(buffer),
        useSystemFonts: true,
        verbosity: 0,
      }).promise;
      const partes: string[] = [];
      const maxPaginas = Math.min(doc.numPages, 100);
      for (let i = 1; i <= maxPaginas; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        partes.push(content.items.map((it: any) => it.str || "").join(" "));
        // Curto-circuita se já passamos o limite — evita processar PDF
        // gigante por inteiro só pra truncar depois.
        if (partes.join("\n").length > MAX_CHARS_EXTRACAO) break;
      }
      const texto = partes.join("\n").trim();
      return texto ? texto.slice(0, MAX_CHARS_EXTRACAO) : null;
    } catch (err) {
      log.warn(
        { err: String((err as Error)?.message || err).slice(0, 200) },
        "Falha ao extrair texto do PDF",
      );
      return null;
    }
  }
  if (mimeType === MIME_DOCX) {
    if (buffer.length > LIMITE_BINARIO_BYTES) {
      log.warn({ tamanho: buffer.length }, "DOCX acima do limite — extração ignorada");
      return null;
    }
    try {
      const mammoth = (await import("mammoth")).default;
      const result = await mammoth.extractRawText({ buffer });
      const texto = (result.value || "").trim();
      return texto ? texto.slice(0, MAX_CHARS_EXTRACAO) : null;
    } catch (err) {
      log.warn(
        { err: String((err as Error)?.message || err).slice(0, 200) },
        "Falha ao extrair texto do DOCX",
      );
      return null;
    }
  }
  // application/msword (.doc legado) não é suportado por mammoth — o usuário
  // precisa salvar como .docx ou PDF. Retornamos null silenciosamente.
  return null;
}

/** Valida que a thread existe e pertence ao usuário. Retorna thread + agente. */
async function pegarThreadDoUsuario(
  db: any,
  threadId: number,
  userId: number,
  escritorioId: number,
) {
  const [thread] = await db
    .select()
    .from(agenteChatThreads)
    .where(
      and(
        eq(agenteChatThreads.id, threadId),
        eq(agenteChatThreads.usuarioId, userId),
        eq(agenteChatThreads.escritorioId, escritorioId),
      ),
    )
    .limit(1);
  if (!thread) return null;
  const [agente] = await db
    .select()
    .from(agentesIa)
    .where(
      and(
        eq(agentesIa.id, thread.agenteId),
        eq(agentesIa.escritorioId, escritorioId),
      ),
    )
    .limit(1);
  if (!agente) return null;
  return { thread, agente };
}

/** Gera título curto da thread a partir da 1ª pergunta — usando mesma IA do agente. */
async function gerarTituloThread(
  escritorioId: number,
  agente: any,
  primeiraPergunta: string,
): Promise<string | null> {
  try {
    const provider = providerDoModelo(agente.modelo);
    const resolved = await resolverAPIKey(escritorioId, agente, provider);
    if (!resolved || resolved.provider !== provider) return null;
    const prompt =
      "Resuma a pergunta abaixo em um título curto (máx 5 palavras, sem aspas, sem pontuação final).";

    if (resolved.provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": resolved.key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: agente.modelo,
          system: prompt,
          messages: [{ role: "user", content: primeiraPergunta.slice(0, 500) }],
          max_tokens: 30,
          temperature: 0.3,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { content?: Array<{ text?: string }> };
      return (data.content?.[0]?.text || "").trim().slice(0, 200) || null;
    }

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resolved.key}`,
      },
      body: JSON.stringify(montarBodyOpenAIChat({
        model: agente.modelo,
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: primeiraPergunta.slice(0, 500) },
        ],
        maxTokens: 30,
        temperatura: 0.3,
      })),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    return (data.choices[0]?.message?.content || "").trim().slice(0, 200) || null;
  } catch (err: any) {
    log.warn({ err: err?.message }, "Falha ao gerar título da thread");
    return null;
  }
}

export const agenteChatRouter = router({
  // ── THREADS ──────────────────────────────────────────────────────────

  listarThreads: protectedProcedure
    .input(z.object({ agenteId: z.number(), incluirArquivadas: z.boolean().optional() }))
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return [];
      const db = await getDb();
      if (!db) return [];

      const conds: any[] = [
        eq(agenteChatThreads.agenteId, input.agenteId),
        eq(agenteChatThreads.escritorioId, esc.escritorio.id),
        eq(agenteChatThreads.usuarioId, ctx.user.id),
      ];
      if (!input.incluirArquivadas) {
        conds.push(eq(agenteChatThreads.arquivada, false));
      }

      const rows = await db
        .select()
        .from(agenteChatThreads)
        .where(and(...conds))
        .orderBy(desc(agenteChatThreads.updatedAt));

      return rows.map((r) => ({
        id: r.id,
        agenteId: r.agenteId,
        titulo: r.titulo,
        arquivada: r.arquivada,
        createdAt: toIsoString(r.createdAt) ?? "",
        updatedAt: toIsoString(r.updatedAt) ?? "",
      }));
    }),

  criarThread: protectedProcedure
    .input(z.object({ agenteId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "NOT_FOUND", message: "Escritório não encontrado" });
      const db = await getDb();
      if (!db) throw new Error("Database indisponível");

      const [agente] = await db
        .select()
        .from(agentesIa)
        .where(
          and(
            eq(agentesIa.id, input.agenteId),
            eq(agentesIa.escritorioId, esc.escritorio.id),
          ),
        )
        .limit(1);
      if (!agente) throw new TRPCError({ code: "NOT_FOUND", message: "Agente não encontrado" });

      const [result] = await db.insert(agenteChatThreads).values({
        agenteId: input.agenteId,
        escritorioId: esc.escritorio.id,
        usuarioId: ctx.user.id,
        titulo: "Nova conversa",
      });
      return { id: (result as { insertId: number }).insertId };
    }),

  renomearThread: protectedProcedure
    .input(z.object({ threadId: z.number(), titulo: z.string().min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "NOT_FOUND", message: "Escritório não encontrado" });
      const db = await getDb();
      if (!db) throw new Error("Database indisponível");

      const t = await pegarThreadDoUsuario(db, input.threadId, ctx.user.id, esc.escritorio.id);
      if (!t) throw new TRPCError({ code: "FORBIDDEN", message: "Thread não encontrada" });

      await db
        .update(agenteChatThreads)
        .set({ titulo: input.titulo.trim() })
        .where(eq(agenteChatThreads.id, input.threadId));
      return { success: true };
    }),

  arquivarThread: protectedProcedure
    .input(z.object({ threadId: z.number(), arquivada: z.boolean().default(true) }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "NOT_FOUND", message: "Escritório não encontrado" });
      const db = await getDb();
      if (!db) throw new Error("Database indisponível");

      const t = await pegarThreadDoUsuario(db, input.threadId, ctx.user.id, esc.escritorio.id);
      if (!t) throw new TRPCError({ code: "FORBIDDEN", message: "Thread não encontrada" });

      await db
        .update(agenteChatThreads)
        .set({ arquivada: input.arquivada })
        .where(eq(agenteChatThreads.id, input.threadId));
      return { success: true };
    }),

  // ── MENSAGENS ────────────────────────────────────────────────────────

  listarMensagens: protectedProcedure
    .input(z.object({ threadId: z.number() }))
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) return [];
      const db = await getDb();
      if (!db) return [];

      const t = await pegarThreadDoUsuario(db, input.threadId, ctx.user.id, esc.escritorio.id);
      if (!t) throw new TRPCError({ code: "FORBIDDEN", message: "Thread não encontrada" });

      const rows = await db
        .select()
        .from(agenteChatMensagens)
        .where(eq(agenteChatMensagens.threadId, input.threadId))
        .orderBy(asc(agenteChatMensagens.createdAt));

      return rows.map((r) => ({
        id: r.id,
        role: r.role,
        conteudo: r.conteudo,
        anexoUrl: r.anexoUrl,
        anexoNome: r.anexoNome,
        anexoMime: r.anexoMime,
        tokensUsados: r.tokensUsados,
        createdAt: toIsoString(r.createdAt) ?? "",
      }));
    }),

  enviarMensagem: protectedProcedure
    .input(
      z.object({
        threadId: z.number(),
        conteudo: z.string().min(1).max(10000),
        anexo: z
          .object({
            nome: z.string().min(1).max(255),
            tipo: z.string().max(128),
            base64: z.string().min(10),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "NOT_FOUND", message: "Escritório não encontrado" });
      const db = await getDb();
      if (!db) throw new Error("Database indisponível");

      const tg = await pegarThreadDoUsuario(db, input.threadId, ctx.user.id, esc.escritorio.id);
      if (!tg) throw new TRPCError({ code: "FORBIDDEN", message: "Thread não encontrada" });
      const { thread, agente } = tg;

      // TODO(créditos): quando liberar cobrança, descontar 1 crédito aqui
      // via `await consumirCredito(ctx.user.id)` antes de chamar a IA.

      // ── Processa anexo (salva arquivo + extrai texto se possível) ──
      let anexoUrl: string | null = null;
      let anexoNome: string | null = null;
      let anexoMime: string | null = null;
      let anexoConteudo: string | null = null;

      if (input.anexo) {
        const mimeType = input.anexo.tipo.split(";")[0].trim();
        if (!ALLOWED_MIMES.includes(mimeType)) {
          throw new Error(
            `Tipo não permitido: ${mimeType}. Aceitos: PDF, DOCX, TXT, MD, CSV, JSON.`,
          );
        }
        let base64Data = input.anexo.base64;
        if (base64Data.includes(",")) base64Data = base64Data.split(",")[1];
        const buffer = Buffer.from(base64Data, "base64");
        if (buffer.length > MAX_SIZE_BYTES) {
          throw new Error(
            `Arquivo muito grande (${(buffer.length / 1024 / 1024).toFixed(1)}MB). Máximo: 2GB.`,
          );
        }
        const dir = path.join(
          UPLOAD_DIR,
          `escritorio_${esc.escritorio.id}`,
          `agente_${agente.id}`,
          `thread_${thread.id}`,
        );
        ensureDir(dir);
        const ext = path.extname(input.anexo.nome) || ".bin";
        const hash = crypto.randomBytes(8).toString("hex");
        const filename = `${Date.now()}_${hash}${ext}`;
        fs.writeFileSync(path.join(dir, filename), buffer);
        anexoUrl = `/uploads/agentes-escritorio/escritorio_${esc.escritorio.id}/agente_${agente.id}/thread_${thread.id}/${filename}`;
        anexoNome = input.anexo.nome.replace(/[^a-zA-Z0-9._\- ]/g, "_").slice(0, 200);
        anexoMime = mimeType;

        // Extração best-effort de texto pra alimentar o contexto da IA.
        // PDF/TXT/MD/CSV/JSON suportados; DOCX fica só como anexo.
        anexoConteudo = await extrairTextoAnexo(mimeType, buffer);
      }

      // ── Salva mensagem do usuário ──
      await db.insert(agenteChatMensagens).values({
        threadId: thread.id,
        role: "user",
        conteudo: input.conteudo,
        anexoUrl,
        anexoNome,
        anexoMime,
        anexoConteudo,
      });

      // MySQL pula o ON UPDATE quando nenhuma coluna realmente muda; setar
      // updatedAt explícito garante o bump (e protege se titulo vier null).
      await db
        .update(agenteChatThreads)
        .set({ updatedAt: new Date() })
        .where(eq(agenteChatThreads.id, thread.id));

      // ── Monta contexto: histórico (últimas 30) + docs de treinamento ──
      const historicoRows = await db
        .select()
        .from(agenteChatMensagens)
        .where(eq(agenteChatMensagens.threadId, thread.id))
        .orderBy(asc(agenteChatMensagens.createdAt));

      // Limita histórico a 30 últimas mas garante que a msg atual esteja incluída
      const historico = historicoRows.slice(-30);

      const contextoDocs = await montarContextoDocumentos(db, agente.id, esc.escritorio.id);
      const systemPrompt = (agente.prompt || "") + contextoDocs;

      // Se a mensagem atual tem anexo extraído, injeta como contexto adicional
      const messagesForLLM: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];
      for (const m of historico) {
        let content = m.conteudo;
        if (m.id === (historicoRows[historicoRows.length - 1]?.id ?? -1) && anexoConteudo && anexoNome) {
          content = `${content}\n\n--- ANEXO: ${anexoNome} ---\n${anexoConteudo}`;
        } else if (m.anexoNome && !m.anexoConteudo) {
          // anexo que não conseguimos extrair texto — menciona que existe
          content = `${content}\n\n[Anexo: ${m.anexoNome}]`;
        }
        messagesForLLM.push({ role: m.role as any, content });
      }

      // ── Resolve API key e chama IA ──
      const providerPreferido = providerDoModelo(agente.modelo);
      const resolved = await resolverAPIKey(esc.escritorio.id, agente, providerPreferido);
      if (!resolved) {
        throw new Error(
          providerPreferido === "anthropic"
            ? "Nenhuma API key do Claude disponível. Configure em Integrações → Claude."
            : "Nenhuma API key do OpenAI disponível. Configure em Integrações → ChatGPT.",
        );
      }
      if (resolved.provider !== providerPreferido) {
        throw new Error(
          `O modelo "${agente.modelo}" requer ${providerPreferido === "anthropic" ? "Claude" : "OpenAI"}, mas só ${resolved.provider === "anthropic" ? "Claude" : "OpenAI"} está configurado.`,
        );
      }

      const temperatura = parseFloat(agente.temperatura || "0.70");
      const maxTokens = agente.maxTokens || 800;
      let respostaTexto = "";
      let tokensUsados = 0;

      try {
        if (resolved.provider === "anthropic") {
          // Claude recebe apenas user/assistant (system à parte). Filtra system.
          const historicoAnthropic = messagesForLLM
            .filter((m) => m.role !== "system")
            .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
          // Pega última user como msg principal, resto como histórico
          const ultimaUser = historicoAnthropic[historicoAnthropic.length - 1];
          const historicoPrevio = historicoAnthropic.slice(0, -1);

          const r = await gerarRespostaAnthropic(
            resolved.key,
            agente.modelo || "claude-haiku-4-5-20251001",
            systemPrompt,
            historicoPrevio.map((h) => ({ role: h.role, content: h.content })),
            ultimaUser?.content || input.conteudo,
            maxTokens,
            temperatura,
          );
          if (r.erro || !r.resposta) {
            throw new Error(r.erro || "Claude não retornou resposta");
          }
          respostaTexto = r.resposta;
          tokensUsados = r.tokensUsados;
        } else {
          const res = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${resolved.key}`,
            },
            body: JSON.stringify(montarBodyOpenAIChat({
              model: agente.modelo,
              messages: [
                { role: "system", content: systemPrompt },
                ...messagesForLLM.filter((m) => m.role !== "system"),
              ],
              temperatura,
              maxTokens,
            })),
            signal: AbortSignal.timeout(60000),
          });
          if (!res.ok) {
            const text = await res.text();
            throw new Error(`OpenAI retornou ${res.status}: ${text.slice(0, 300)}`);
          }
          const data = (await res.json()) as {
            choices: Array<{ message: { content: string } }>;
            usage?: { total_tokens: number };
          };
          respostaTexto = data.choices[0]?.message?.content?.trim() || "(sem resposta)";
          tokensUsados = data.usage?.total_tokens || 0;
        }
      } catch (err: any) {
        if (err.name === "AbortError" || err.name === "TimeoutError") {
          throw new Error(
            `${resolved.provider === "anthropic" ? "Claude" : "OpenAI"} timeout — verifique a conexão`,
          );
        }
        throw new Error(err.message || "Falha ao chamar IA");
      }

      // ── Persiste resposta ──
      const [insResp] = await db.insert(agenteChatMensagens).values({
        threadId: thread.id,
        role: "assistant",
        conteudo: respostaTexto,
        tokensUsados,
      });

      // ── Se é a 1ª mensagem real, gera título ──
      if (thread.titulo === "Nova conversa") {
        const novoTitulo = await gerarTituloThread(esc.escritorio.id, agente, input.conteudo);
        if (novoTitulo) {
          await db
            .update(agenteChatThreads)
            .set({ titulo: novoTitulo })
            .where(eq(agenteChatThreads.id, thread.id));
        }
      }

      return {
        mensagemId: (insResp as { insertId: number }).insertId,
        resposta: respostaTexto,
        tokensUsados,
      };
    }),
});

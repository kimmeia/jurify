/**
 * Router admin — Agentes de IA globais do Jurify.
 *
 * CRUD de agentes (que serão usados pelos módulos de Atendimento e
 * futuros) + upload de documentos de treinamento.
 *
 * Os agentes usam a API key do OpenAI configurada no admin_integracoes
 * (provedor "openai"), então não precisam armazenar key individual.
 */

import { z } from "zod";
import { eq, desc, and } from "drizzle-orm";
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { agentesAdmin, agenteDocumentos, adminIntegracoes } from "../../drizzle/schema";
import { registrarAuditoria } from "../_core/audit";
import { decrypt } from "../escritorio/crypto-utils";
import { createLogger } from "../_core/logger";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const log = createLogger("admin-agentes-ia");

// Diretório pra uploads dos documentos dos agentes
const UPLOAD_DIR = path.resolve("./uploads/agentes-admin");
const MAX_SIZE_BYTES = 15 * 1024 * 1024; // 15MB
const ALLOWED_MIMES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
];

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Helper: retorna a API key de um provedor admin, ou null.
 * Usado pelos endpoints que consultam IA (ex: testar agente).
 */
async function getAdminKey(provedor: "openai" | "anthropic"): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const [reg] = await db
    .select()
    .from(adminIntegracoes)
    .where(eq(adminIntegracoes.provedor, provedor))
    .limit(1);
  if (!reg || !reg.apiKeyEncrypted || !reg.apiKeyIv || !reg.apiKeyTag) {
    return null;
  }
  try {
    return decrypt(reg.apiKeyEncrypted, reg.apiKeyIv, reg.apiKeyTag);
  } catch (err) {
    log.error({ err: String(err), provedor }, "Falha ao decifrar key");
    return null;
  }
}

/** Detecta o provider do modelo ("claude-*" → anthropic, senão openai) */
function providerDoModelo(modelo: string | null | undefined): "openai" | "anthropic" {
  const m = (modelo || "").toLowerCase();
  if (m.startsWith("claude") || m.includes("anthropic")) return "anthropic";
  return "openai";
}

export const adminAgentesIaRouter = router({
  /** Status das integrações de IA (OpenAI e Anthropic) */
  status: adminProcedure.query(async () => {
    const [openaiKey, anthropicKey] = await Promise.all([
      getAdminKey("openai"),
      getAdminKey("anthropic"),
    ]);
    return {
      openaiConfigurado: !!openaiKey,
      anthropicConfigurado: !!anthropicKey,
    };
  }),

  /** Lista todos os agentes admin, mais recentes primeiro */
  listar: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];

    const agentes = await db
      .select()
      .from(agentesAdmin)
      .orderBy(desc(agentesAdmin.createdAt));

    // Pega contagem de documentos de cada agente
    const docs = await db.select().from(agenteDocumentos);
    const docCount = new Map<number, number>();
    for (const d of docs) {
      docCount.set(d.agenteId, (docCount.get(d.agenteId) || 0) + 1);
    }

    return agentes.map((a) => ({
      ...a,
      modulosPermitidos: a.modulosPermitidos ? a.modulosPermitidos.split(",") : [],
      totalDocumentos: docCount.get(a.id) || 0,
    }));
  }),

  /** Obter detalhes de um agente + seus documentos */
  obter: adminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const [agente] = await db
        .select()
        .from(agentesAdmin)
        .where(eq(agentesAdmin.id, input.id))
        .limit(1);
      if (!agente) throw new Error("Agente não encontrado");

      const documentos = await db
        .select()
        .from(agenteDocumentos)
        .where(eq(agenteDocumentos.agenteId, input.id))
        .orderBy(desc(agenteDocumentos.createdAt));

      return {
        ...agente,
        modulosPermitidos: agente.modulosPermitidos ? agente.modulosPermitidos.split(",") : [],
        documentos,
      };
    }),

  /** Criar novo agente */
  criar: adminProcedure
    .input(z.object({
      nome: z.string().min(2).max(128),
      descricao: z.string().max(512).optional(),
      areaConhecimento: z.string().max(128).optional(),
      modelo: z.enum([
        "gpt-4o-mini",
        "gpt-4o",
        "gpt-4-turbo",
        "gpt-3.5-turbo",
        "claude-sonnet-4-20250514",
        "claude-haiku-4-5-20251001",
      ]).default("gpt-4o-mini"),
      prompt: z.string().min(10).max(8000),
      temperatura: z.string().default("0.70"),
      maxTokens: z.number().min(50).max(4000).default(800),
      modulosPermitidos: z.array(z.string()).optional(),
      ativo: z.boolean().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const [result] = await db.insert(agentesAdmin).values({
        nome: input.nome,
        descricao: input.descricao ?? null,
        areaConhecimento: input.areaConhecimento ?? null,
        modelo: input.modelo,
        prompt: input.prompt,
        temperatura: input.temperatura,
        maxTokens: input.maxTokens,
        ativo: input.ativo,
        modulosPermitidos: input.modulosPermitidos && input.modulosPermitidos.length > 0
          ? input.modulosPermitidos.join(",")
          : null,
        criadoPor: ctx.user.id,
      });

      const agenteId = (result as { insertId: number }).insertId;

      await registrarAuditoria({
        ctx,
        acao: "agente.criar",
        alvoTipo: "agente",
        alvoId: agenteId,
        alvoNome: input.nome,
        detalhes: { modelo: input.modelo },
      });

      return { success: true, id: agenteId };
    }),

  /** Atualizar agente existente */
  atualizar: adminProcedure
    .input(z.object({
      id: z.number(),
      nome: z.string().min(2).max(128).optional(),
      descricao: z.string().max(512).nullable().optional(),
      areaConhecimento: z.string().max(128).nullable().optional(),
      modelo: z.enum([
        "gpt-4o-mini",
        "gpt-4o",
        "gpt-4-turbo",
        "gpt-3.5-turbo",
        "claude-sonnet-4-20250514",
        "claude-haiku-4-5-20251001",
      ]).optional(),
      prompt: z.string().min(10).max(8000).optional(),
      temperatura: z.string().optional(),
      maxTokens: z.number().min(50).max(4000).optional(),
      modulosPermitidos: z.array(z.string()).optional(),
      ativo: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const { id, modulosPermitidos, ...rest } = input;
      const updateData: Record<string, unknown> = { ...rest };
      if (modulosPermitidos !== undefined) {
        updateData.modulosPermitidos = modulosPermitidos.length > 0
          ? modulosPermitidos.join(",")
          : null;
      }

      await db.update(agentesAdmin).set(updateData).where(eq(agentesAdmin.id, id));

      await registrarAuditoria({
        ctx,
        acao: "agente.atualizar",
        alvoTipo: "agente",
        alvoId: id,
      });

      return { success: true };
    }),

  /** Deletar agente (também deleta documentos associados) */
  deletar: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const [agente] = await db.select().from(agentesAdmin).where(eq(agentesAdmin.id, input.id)).limit(1);
      if (!agente) throw new Error("Agente não encontrado");

      // Deleta documentos (CASCADE manual + limpa arquivos do disco)
      const docs = await db
        .select()
        .from(agenteDocumentos)
        .where(eq(agenteDocumentos.agenteId, input.id));
      for (const d of docs) {
        if (d.tipo === "arquivo" && d.url) {
          try {
            const filePath = path.join(UPLOAD_DIR, d.url.replace("/uploads/agentes-admin/", ""));
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          } catch (err) {
            log.warn({ err: String(err), url: d.url }, "Falha ao deletar arquivo");
          }
        }
      }
      await db.delete(agenteDocumentos).where(eq(agenteDocumentos.agenteId, input.id));
      await db.delete(agentesAdmin).where(eq(agentesAdmin.id, input.id));

      await registrarAuditoria({
        ctx,
        acao: "agente.deletar",
        alvoTipo: "agente",
        alvoId: input.id,
        alvoNome: agente.nome,
      });

      return { success: true };
    }),

  /** Alternar ativo/inativo rapidamente */
  toggleAtivo: adminProcedure
    .input(z.object({ id: z.number(), ativo: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db.update(agentesAdmin).set({ ativo: input.ativo }).where(eq(agentesAdmin.id, input.id));
      await registrarAuditoria({
        ctx,
        acao: input.ativo ? "agente.ativar" : "agente.desativar",
        alvoTipo: "agente",
        alvoId: input.id,
      });
      return { success: true };
    }),

  // ═══════════════════════════════════════════════════════════════════════
  // DOCUMENTOS DE TREINAMENTO
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Upload de arquivo: recebe base64, valida tipo/tamanho, salva no
   * disco em /uploads/agentes-admin/{agenteId}/ e cria registro.
   */
  uploadArquivo: adminProcedure
    .input(z.object({
      agenteId: z.number(),
      nome: z.string().min(1).max(255),
      tipo: z.string().max(128),
      base64: z.string().min(10),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const [agente] = await db.select().from(agentesAdmin).where(eq(agentesAdmin.id, input.agenteId)).limit(1);
      if (!agente) throw new Error("Agente não encontrado");

      const mimeType = input.tipo.split(";")[0].trim();
      if (!ALLOWED_MIMES.includes(mimeType)) {
        throw new Error(`Tipo não permitido: ${mimeType}. Aceitos: PDF, DOCX, TXT, MD, CSV, JSON.`);
      }

      let base64Data = input.base64;
      if (base64Data.includes(",")) base64Data = base64Data.split(",")[1];
      const buffer = Buffer.from(base64Data, "base64");

      if (buffer.length > MAX_SIZE_BYTES) {
        throw new Error(`Arquivo muito grande (${(buffer.length / 1024 / 1024).toFixed(1)}MB). Máximo: 15MB.`);
      }

      const agenteDir = path.join(UPLOAD_DIR, `agente_${input.agenteId}`);
      ensureDir(agenteDir);

      const ext = path.extname(input.nome) || ".bin";
      const hash = crypto.randomBytes(8).toString("hex");
      const filename = `${Date.now()}_${hash}${ext}`;
      const filepath = path.join(agenteDir, filename);
      fs.writeFileSync(filepath, buffer);

      const url = `/uploads/agentes-admin/agente_${input.agenteId}/${filename}`;

      await db.insert(agenteDocumentos).values({
        agenteId: input.agenteId,
        nome: input.nome.replace(/[^a-zA-Z0-9._\- ]/g, "_").slice(0, 200),
        tipo: "arquivo",
        url,
        tamanho: buffer.length,
        mimeType,
      });

      await registrarAuditoria({
        ctx,
        acao: "agente.uploadDoc",
        alvoTipo: "agente",
        alvoId: input.agenteId,
        detalhes: { nome: input.nome, tamanho: buffer.length },
      });

      return { success: true, url };
    }),

  /** Adicionar link externo como documento de treinamento */
  adicionarLink: adminProcedure
    .input(z.object({
      agenteId: z.number(),
      nome: z.string().min(1).max(255),
      url: z.string().url().max(1024),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      await db.insert(agenteDocumentos).values({
        agenteId: input.agenteId,
        nome: input.nome,
        tipo: "link",
        url: input.url,
      });

      await registrarAuditoria({
        ctx,
        acao: "agente.addLink",
        alvoTipo: "agente",
        alvoId: input.agenteId,
        detalhes: { url: input.url },
      });

      return { success: true };
    }),

  /** Adicionar texto colado direto como documento de treinamento */
  adicionarTexto: adminProcedure
    .input(z.object({
      agenteId: z.number(),
      nome: z.string().min(1).max(255),
      conteudo: z.string().min(10).max(50000),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      await db.insert(agenteDocumentos).values({
        agenteId: input.agenteId,
        nome: input.nome,
        tipo: "texto",
        conteudo: input.conteudo,
      });

      await registrarAuditoria({
        ctx,
        acao: "agente.addTexto",
        alvoTipo: "agente",
        alvoId: input.agenteId,
      });

      return { success: true };
    }),

  /** Deletar documento de treinamento */
  deletarDocumento: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const [doc] = await db.select().from(agenteDocumentos).where(eq(agenteDocumentos.id, input.id)).limit(1);
      if (!doc) throw new Error("Documento não encontrado");

      // Se é arquivo, remove do disco
      if (doc.tipo === "arquivo" && doc.url) {
        try {
          const filePath = path.join(UPLOAD_DIR, doc.url.replace("/uploads/agentes-admin/", ""));
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch (err) {
          log.warn({ err: String(err) }, "Falha ao deletar arquivo do disco");
        }
      }

      await db.delete(agenteDocumentos).where(eq(agenteDocumentos.id, input.id));

      await registrarAuditoria({
        ctx,
        acao: "agente.deletarDoc",
        alvoTipo: "agente",
        alvoId: doc.agenteId,
        detalhes: { nome: doc.nome, tipo: doc.tipo },
      });

      return { success: true };
    }),

  /**
   * Testa o agente com uma pergunta sample — usa a API do OpenAI
   * e retorna a resposta. Útil pra validar o prompt antes de ativar.
   */
  testar: adminProcedure
    .input(z.object({
      agenteId: z.number(),
      pergunta: z.string().min(1).max(2000),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const [agente] = await db.select().from(agentesAdmin).where(eq(agentesAdmin.id, input.agenteId)).limit(1);
      if (!agente) throw new Error("Agente não encontrado");

      const provider = providerDoModelo(agente.modelo);
      const apiKey = await getAdminKey(provider);
      if (!apiKey) {
        throw new Error(
          provider === "anthropic"
            ? "Anthropic (Claude) não configurado em /admin/integrations. Configure antes de testar agentes com modelos Claude."
            : "OpenAI não configurado em /admin/integrations. Configure antes de testar agentes.",
        );
      }

      // Busca documentos de treinamento pra incluir como contexto
      const docs = await db
        .select()
        .from(agenteDocumentos)
        .where(eq(agenteDocumentos.agenteId, input.agenteId));

      // Contexto simplificado: junta o conteúdo dos documentos do tipo "texto"
      // + metadados dos arquivos/links. Numa implementação de RAG real,
      // seria feito embedding search, mas como primeiro passo funciona.
      const contextos: string[] = [];
      for (const d of docs) {
        if (d.tipo === "texto" && d.conteudo) {
          contextos.push(`[${d.nome}]\n${d.conteudo}`);
        } else if (d.tipo === "link" && d.url) {
          contextos.push(`[Link: ${d.nome}] ${d.url}`);
        } else if (d.tipo === "arquivo") {
          contextos.push(`[Arquivo anexado: ${d.nome}]`);
        }
      }
      const contextoStr = contextos.length > 0
        ? `\n\n--- CONHECIMENTO DISPONÍVEL ---\n${contextos.join("\n\n").slice(0, 8000)}`
        : "";

      const systemPrompt = agente.prompt + contextoStr;
      const temperatura = parseFloat(agente.temperatura);

      try {
        if (provider === "anthropic") {
          const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: agente.modelo,
              system: systemPrompt,
              messages: [{ role: "user", content: input.pergunta }],
              max_tokens: agente.maxTokens,
              temperature: temperatura,
            }),
            signal: AbortSignal.timeout(30000),
          });

          if (!res.ok) {
            const text = await res.text();
            throw new Error(`Claude retornou ${res.status}: ${text.slice(0, 300)}`);
          }

          const data = (await res.json()) as {
            content?: Array<{ text?: string }>;
            usage?: { input_tokens?: number; output_tokens?: number };
          };

          return {
            resposta: data.content?.[0]?.text?.trim() || "(sem resposta)",
            tokensUsados: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
          };
        }

        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: agente.modelo,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: input.pergunta },
            ],
            temperature: temperatura,
            max_tokens: agente.maxTokens,
          }),
          signal: AbortSignal.timeout(30000),
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`OpenAI retornou ${res.status}: ${text.slice(0, 300)}`);
        }

        const data = (await res.json()) as {
          choices: Array<{ message: { content: string } }>;
          usage?: { total_tokens: number };
        };

        return {
          resposta: data.choices[0]?.message?.content || "(sem resposta)",
          tokensUsados: data.usage?.total_tokens || 0,
        };
      } catch (err: any) {
        if (err.name === "AbortError" || err.name === "TimeoutError") {
          throw new Error(`${provider === "anthropic" ? "Claude" : "OpenAI"} timeout — verifique a conexão`);
        }
        throw new Error(err.message || "Falha ao chamar IA");
      }
    }),
});

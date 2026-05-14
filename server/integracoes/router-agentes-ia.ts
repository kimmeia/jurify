/**
 * Router de Agentes IA — por escritório.
 *
 * Cada escritório pode criar múltiplos agentes especializados pra usar
 * em diferentes módulos (Atendimento/chatbot, Análise processual,
 * Resumos, etc).
 *
 * Features:
 *   - CRUD básico (listar/criar/atualizar/excluir/toggleAtivo)
 *   - Upload de documentos de treinamento (arquivos, links, textos)
 *   - Teste em tempo real com a API do OpenAI
 *
 * A API key do OpenAI pode ser:
 *   1. Individual por agente (campo openaiApiKey criptografado)
 *   2. Global do escritório (via primeiro agente com key definida)
 *   3. Fallback pra key admin do Jurify (admin_integracoes.openai)
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { checkPermission } from "../escritorio/check-permission";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { agentesIa, agenteIaDocumentos, adminIntegracoes } from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";

/** Helper: valida ownership de um agente quando verProprios. */
async function podeMexerNoAgente(
  db: any,
  agenteId: number,
  escritorioId: number,
  userId: number,
): Promise<boolean> {
  const [a] = await db.select({ criadoPor: agentesIa.criadoPor })
    .from(agentesIa)
    .where(and(eq(agentesIa.id, agenteId), eq(agentesIa.escritorioId, escritorioId)))
    .limit(1);
  if (!a) return false;
  return a.criadoPor === userId;
}
import { decrypt as adminDecrypt } from "../escritorio/crypto-utils";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { createLogger } from "../_core/logger";

const log = createLogger("router-agentes-ia");

const ENCRYPTION_KEY = process.env.CANAIS_ENCRYPTION_KEY || "0".repeat(64);
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

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function encryptApiKey(apiKey: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(ENCRYPTION_KEY, "hex"), iv);
  let encrypted = cipher.update(apiKey, "utf8", "base64");
  encrypted += cipher.final("base64");
  return { encrypted, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

function decryptApiKey(encrypted: string, iv: string, tag: string): string {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    Buffer.from(ENCRYPTION_KEY, "hex"),
    Buffer.from(iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  let decrypted = decipher.update(encrypted, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

/**
 * Resolve qual API key do OpenAI usar para um agente:
 *   1. Key individual do agente (se presente)
 *   2. Qualquer key de outro agente do mesmo escritório (primeiro achado)
 *   3. Key global do admin (admin_integracoes provedor="openai")
 */
/**
 * Resolve qual API key e provider usar para um agente.
 * Retorna { provider: "openai"|"anthropic", key: string } ou null.
 *
 * Ordem de resolução:
 *   1. Key individual do agente (se presente)
 *   2. Canal ChatGPT ou Claude (Configurações → Integrações)
 *      - Se agente tem provider definido, usa esse
 *      - Se tem os dois, prioriza pelo provider do agente
 *   3. Key admin global (fallback)
 */
export async function resolverAPIKey(
  escritorioId: number,
  agenteAtual: any,
  providerPreferido?: string,
): Promise<{ provider: "openai" | "anthropic"; key: string } | null> {
  // 1. Agente tem sua própria key (sempre OpenAI por legado)
  if (agenteAtual?.openaiApiKey && agenteAtual.apiKeyIv && agenteAtual.apiKeyTag) {
    try {
      const key = decryptApiKey(agenteAtual.openaiApiKey, agenteAtual.apiKeyIv, agenteAtual.apiKeyTag);
      return { provider: "openai", key };
    } catch { /* fall through */ }
  }

  const db = await getDb();
  if (!db) return null;

  // 2. Canais de integração (ChatGPT e/ou Claude)
  try {
    const { canaisIntegrados } = await import("../../drizzle/schema");
    const { or: orOp, like } = await import("drizzle-orm");
    const { decryptConfig } = await import("../escritorio/crypto-utils");

    const canalRows = await db
      .select()
      .from(canaisIntegrados)
      .where(
        and(
          eq(canaisIntegrados.escritorioId, escritorioId),
          orOp(
            eq(canaisIntegrados.tipo, "chatgpt"),
            eq(canaisIntegrados.tipo, "claude"),
            like(canaisIntegrados.nome, "%ChatGPT%"),
            like(canaisIntegrados.nome, "%Claude%"),
          ),
        ),
      );

    let openaiKey: string | null = null;
    let anthropicKey: string | null = null;

    for (const row of canalRows) {
      if (row.configEncrypted && row.configIv && row.configTag) {
        try {
          const config = decryptConfig(row.configEncrypted, row.configIv, row.configTag);
          if (config?.openaiApiKey) openaiKey = config.openaiApiKey;
          if (config?.anthropicApiKey) anthropicKey = config.anthropicApiKey;
        } catch { /* ignore */ }
      }
    }

    // Se o agente tem provider preferido, usar esse
    if (providerPreferido === "anthropic" && anthropicKey) {
      return { provider: "anthropic", key: anthropicKey };
    }
    if (providerPreferido === "openai" && openaiKey) {
      return { provider: "openai", key: openaiKey };
    }
    // Sem preferência, usa o que tiver
    if (anthropicKey) return { provider: "anthropic", key: anthropicKey };
    if (openaiKey) return { provider: "openai", key: openaiKey };
  } catch { /* ignore */ }

  // 3. Outro agente do escritório com key
  const outrosAgentes = await db
    .select()
    .from(agentesIa)
    .where(eq(agentesIa.escritorioId, escritorioId));
  for (const a of outrosAgentes) {
    if (a.openaiApiKey && a.apiKeyIv && a.apiKeyTag) {
      try {
        return { provider: "openai", key: decryptApiKey(a.openaiApiKey, a.apiKeyIv, a.apiKeyTag) };
      } catch { /* ignore */ }
    }
  }

  // 4. Key admin global
  try {
    const [reg] = await db
      .select()
      .from(adminIntegracoes)
      .where(eq(adminIntegracoes.provedor, "openai"))
      .limit(1);
    if (reg && reg.apiKeyEncrypted && reg.apiKeyIv && reg.apiKeyTag) {
      return { provider: "openai", key: adminDecrypt(reg.apiKeyEncrypted, reg.apiKeyIv, reg.apiKeyTag) };
    }
  } catch (err) {
    log.warn({ err: String(err) }, "Falha ao buscar key admin");
  }

  return null;
}

/** Detecta o provider preferido pelo nome do modelo */
export function providerDoModelo(modelo: string | null | undefined): "openai" | "anthropic" {
  const m = (modelo || "").toLowerCase();
  if (m.startsWith("claude") || m.includes("anthropic")) return "anthropic";
  return "openai";
}

/** Monta o bloco de contexto com documentos de treinamento do agente. */
export async function montarContextoDocumentos(
  db: any,
  agenteId: number,
  escritorioId: number,
): Promise<string> {
  const docs = await db
    .select()
    .from(agenteIaDocumentos)
    .where(
      and(
        eq(agenteIaDocumentos.agenteId, agenteId),
        eq(agenteIaDocumentos.escritorioId, escritorioId),
      ),
    );
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
  return contextos.length > 0
    ? `\n\n--- CONHECIMENTO DISPONÍVEL ---\n${contextos.join("\n\n").slice(0, 8000)}`
    : "";
}

export const agentesIaRouter = router({
  /** Lista todos os agentes do escritório + contagem de documentos */
  listar: protectedProcedure.query(async ({ ctx }) => {
    const perm = await checkPermission(ctx.user.id, "agentesIa", "ver");
    if (!perm.allowed) return [];
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return [];
    const db = await getDb();
    if (!db) return [];

    const conds: any[] = [eq(agentesIa.escritorioId, perm.escritorioId)];
    // verProprios: filtra agentes criados pelo próprio usuário
    if (!perm.verTodos && perm.verProprios) {
      conds.push(eq(agentesIa.criadoPor, ctx.user.id));
    }

    const rows = await db
      .select()
      .from(agentesIa)
      .where(and(...conds))
      .orderBy(desc(agentesIa.createdAt));

    // Contagem de documentos por agente (só os do próprio escritório)
    const docs = await db
      .select({ agenteId: agenteIaDocumentos.agenteId })
      .from(agenteIaDocumentos)
      .where(eq(agenteIaDocumentos.escritorioId, esc.escritorio.id));
    const docCount = new Map<number, number>();
    for (const d of docs) {
      docCount.set(d.agenteId, (docCount.get(d.agenteId) || 0) + 1);
    }

    return rows.map((r) => ({
      id: r.id,
      nome: r.nome,
      descricao: r.descricao || "",
      areaConhecimento: r.areaConhecimento || "",
      modelo: r.modelo,
      prompt: r.prompt,
      ativo: r.ativo,
      canalId: r.canalId,
      maxTokens: r.maxTokens,
      temperatura: r.temperatura,
      modulosPermitidos: r.modulosPermitidos ? r.modulosPermitidos.split(",") : [],
      temApiKey: !!(r.openaiApiKey && r.apiKeyIv && r.apiKeyTag),
      totalDocumentos: docCount.get(r.id) || 0,
      createdAt: r.createdAt ? (r.createdAt as Date).toISOString() : "",
    }));
  }),

  /** Obter detalhes de um agente + seus documentos */
  obter: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      const db = await getDb();
      if (!db) throw new Error("Database indisponível");

      const [agente] = await db
        .select()
        .from(agentesIa)
        .where(and(eq(agentesIa.id, input.id), eq(agentesIa.escritorioId, esc.escritorio.id)))
        .limit(1);
      if (!agente) throw new Error("Agente não encontrado");

      const documentos = await db
        .select()
        .from(agenteIaDocumentos)
        .where(
          and(
            eq(agenteIaDocumentos.agenteId, input.id),
            eq(agenteIaDocumentos.escritorioId, esc.escritorio.id),
          ),
        )
        .orderBy(desc(agenteIaDocumentos.createdAt));

      return {
        id: agente.id,
        nome: agente.nome,
        descricao: agente.descricao || "",
        areaConhecimento: agente.areaConhecimento || "",
        modelo: agente.modelo,
        prompt: agente.prompt,
        temperatura: agente.temperatura,
        maxTokens: agente.maxTokens,
        ativo: agente.ativo,
        canalId: agente.canalId,
        modulosPermitidos: agente.modulosPermitidos ? agente.modulosPermitidos.split(",") : [],
        temApiKey: !!(agente.openaiApiKey && agente.apiKeyIv && agente.apiKeyTag),
        documentos,
      };
    }),

  criar: protectedProcedure
    .input(
      z.object({
        nome: z.string().min(2).max(128),
        descricao: z.string().max(512).optional(),
        areaConhecimento: z.string().max(128).optional(),
        modelo: z.string().default("gpt-4o-mini"),
        prompt: z.string().min(10),
        canalId: z.number().optional(),
        openaiApiKey: z.string().min(10).optional(),
        maxTokens: z.number().min(100).max(4000).optional(),
        temperatura: z.string().optional(),
        modulosPermitidos: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "agentesIa", "criar");
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para criar agentes." });
      const db = await getDb();
      if (!db) throw new Error("Database indisponível");

      let apiKeyEncrypted: string | null = null,
        apiKeyIv: string | null = null,
        apiKeyTag: string | null = null;
      if (input.openaiApiKey) {
        const enc = encryptApiKey(input.openaiApiKey);
        apiKeyEncrypted = enc.encrypted;
        apiKeyIv = enc.iv;
        apiKeyTag = enc.tag;
      }

      const [result] = await db.insert(agentesIa).values({
        escritorioId: perm.escritorioId,
        nome: input.nome,
        descricao: input.descricao || null,
        areaConhecimento: input.areaConhecimento || null,
        modelo: input.modelo,
        prompt: input.prompt,
        canalId: input.canalId || null,
        openaiApiKey: apiKeyEncrypted,
        apiKeyIv,
        apiKeyTag,
        maxTokens: input.maxTokens || 500,
        temperatura: input.temperatura || "0.70",
        modulosPermitidos:
          input.modulosPermitidos && input.modulosPermitidos.length > 0
            ? input.modulosPermitidos.join(",")
            : null,
        ativo: false,
        criadoPor: ctx.user.id,
      });
      return { id: (result as { insertId: number }).insertId };
    }),

  atualizar: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        nome: z.string().min(2).max(128).optional(),
        descricao: z.string().max(512).optional(),
        areaConhecimento: z.string().max(128).optional(),
        modelo: z.string().optional(),
        prompt: z.string().min(10).optional(),
        canalId: z.number().nullable().optional(),
        openaiApiKey: z.string().min(10).optional(),
        maxTokens: z.number().min(100).max(4000).optional(),
        temperatura: z.string().optional(),
        ativo: z.boolean().optional(),
        modulosPermitidos: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "agentesIa", "editar");
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para editar agentes." });
      const db = await getDb();
      if (!db) throw new Error("Database indisponível");

      if (!perm.verTodos && perm.verProprios) {
        const ok = await podeMexerNoAgente(db, input.id, perm.escritorioId, ctx.user.id);
        if (!ok) throw new TRPCError({ code: "FORBIDDEN", message: "Você só pode editar seus próprios agentes." });
      }

      const u: Record<string, unknown> = {};
      if (input.nome !== undefined) u.nome = input.nome;
      if (input.descricao !== undefined) u.descricao = input.descricao;
      if (input.areaConhecimento !== undefined) u.areaConhecimento = input.areaConhecimento;
      if (input.modelo !== undefined) u.modelo = input.modelo;
      if (input.prompt !== undefined) u.prompt = input.prompt;
      if (input.canalId !== undefined) u.canalId = input.canalId;
      if (input.maxTokens !== undefined) u.maxTokens = input.maxTokens;
      if (input.temperatura !== undefined) u.temperatura = input.temperatura;
      if (input.ativo !== undefined) u.ativo = input.ativo;
      if (input.modulosPermitidos !== undefined) {
        u.modulosPermitidos =
          input.modulosPermitidos.length > 0 ? input.modulosPermitidos.join(",") : null;
      }
      if (input.openaiApiKey) {
        const enc = encryptApiKey(input.openaiApiKey);
        u.openaiApiKey = enc.encrypted;
        u.apiKeyIv = enc.iv;
        u.apiKeyTag = enc.tag;
      }
      await db
        .update(agentesIa)
        .set(u)
        .where(and(eq(agentesIa.id, input.id), eq(agentesIa.escritorioId, perm.escritorioId)));
      return { success: true };
    }),

  excluir: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const perm = await checkPermission(ctx.user.id, "agentesIa", "excluir");
      if (!perm.allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para excluir agentes." });
      const db = await getDb();
      if (!db) throw new Error("Database indisponível");

      if (!perm.verTodos && perm.verProprios) {
        const ok = await podeMexerNoAgente(db, input.id, perm.escritorioId, ctx.user.id);
        if (!ok) throw new TRPCError({ code: "FORBIDDEN", message: "Você só pode excluir seus próprios agentes." });
      }

      // Deleta documentos associados (arquivo do disco + DB)
      const docs = await db
        .select()
        .from(agenteIaDocumentos)
        .where(
          and(
            eq(agenteIaDocumentos.agenteId, input.id),
            eq(agenteIaDocumentos.escritorioId, perm.escritorioId),
          ),
        );
      for (const d of docs) {
        if (d.tipo === "arquivo" && d.url) {
          try {
            const filePath = path.join(UPLOAD_DIR, d.url.replace("/uploads/agentes-escritorio/", ""));
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          } catch (err) {
            log.warn({ err: String(err) }, "Falha ao deletar arquivo");
          }
        }
      }
      await db
        .delete(agenteIaDocumentos)
        .where(
          and(
            eq(agenteIaDocumentos.agenteId, input.id),
            eq(agenteIaDocumentos.escritorioId, perm.escritorioId),
          ),
        );
      await db
        .delete(agentesIa)
        .where(and(eq(agentesIa.id, input.id), eq(agentesIa.escritorioId, perm.escritorioId)));
      return { success: true };
    }),

  toggleAtivo: protectedProcedure
    .input(z.object({ id: z.number(), ativo: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      const db = await getDb();
      if (!db) throw new Error("Database indisponível");
      await db
        .update(agentesIa)
        .set({ ativo: input.ativo })
        .where(and(eq(agentesIa.id, input.id), eq(agentesIa.escritorioId, esc.escritorio.id)));
      return { success: true };
    }),

  // ═══════════════════════════════════════════════════════════════════════
  // DOCUMENTOS DE TREINAMENTO
  // ═══════════════════════════════════════════════════════════════════════

  uploadArquivo: protectedProcedure
    .input(
      z.object({
        agenteId: z.number(),
        nome: z.string().min(1).max(255),
        tipo: z.string().max(128),
        base64: z.string().min(10),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      if (esc.colaborador.cargo !== "dono" && esc.colaborador.cargo !== "gestor")
        throw new Error("Sem permissão.");
      const db = await getDb();
      if (!db) throw new Error("Database indisponível");

      // Valida que o agente pertence ao escritório
      const [agente] = await db
        .select()
        .from(agentesIa)
        .where(and(eq(agentesIa.id, input.agenteId), eq(agentesIa.escritorioId, esc.escritorio.id)))
        .limit(1);
      if (!agente) throw new Error("Agente não encontrado");

      const mimeType = input.tipo.split(";")[0].trim();
      if (!ALLOWED_MIMES.includes(mimeType)) {
        throw new Error(`Tipo não permitido: ${mimeType}. Aceitos: PDF, DOCX, TXT, MD, CSV, JSON.`);
      }

      let base64Data = input.base64;
      if (base64Data.includes(",")) base64Data = base64Data.split(",")[1];
      const buffer = Buffer.from(base64Data, "base64");
      if (buffer.length > MAX_SIZE_BYTES) {
        throw new Error(`Arquivo muito grande (${(buffer.length / 1024 / 1024).toFixed(1)}MB). Máximo: 2GB.`);
      }

      const agenteDir = path.join(UPLOAD_DIR, `escritorio_${esc.escritorio.id}`, `agente_${input.agenteId}`);
      ensureDir(agenteDir);
      const ext = path.extname(input.nome) || ".bin";
      const hash = crypto.randomBytes(8).toString("hex");
      const filename = `${Date.now()}_${hash}${ext}`;
      const filepath = path.join(agenteDir, filename);
      fs.writeFileSync(filepath, buffer);
      const url = `/uploads/agentes-escritorio/escritorio_${esc.escritorio.id}/agente_${input.agenteId}/${filename}`;

      await db.insert(agenteIaDocumentos).values({
        agenteId: input.agenteId,
        escritorioId: esc.escritorio.id,
        nome: input.nome.replace(/[^a-zA-Z0-9._\- ]/g, "_").slice(0, 200),
        tipo: "arquivo",
        url,
        tamanho: buffer.length,
        mimeType,
      });

      return { success: true, url };
    }),

  adicionarLink: protectedProcedure
    .input(
      z.object({
        agenteId: z.number(),
        nome: z.string().min(1).max(255),
        url: z.string().url().max(1024),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      const db = await getDb();
      if (!db) throw new Error("Database indisponível");

      const [agente] = await db
        .select()
        .from(agentesIa)
        .where(and(eq(agentesIa.id, input.agenteId), eq(agentesIa.escritorioId, esc.escritorio.id)))
        .limit(1);
      if (!agente) throw new Error("Agente não encontrado");

      await db.insert(agenteIaDocumentos).values({
        agenteId: input.agenteId,
        escritorioId: esc.escritorio.id,
        nome: input.nome,
        tipo: "link",
        url: input.url,
      });
      return { success: true };
    }),

  adicionarTexto: protectedProcedure
    .input(
      z.object({
        agenteId: z.number(),
        nome: z.string().min(1).max(255),
        conteudo: z.string().min(10).max(50000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      const db = await getDb();
      if (!db) throw new Error("Database indisponível");

      const [agente] = await db
        .select()
        .from(agentesIa)
        .where(and(eq(agentesIa.id, input.agenteId), eq(agentesIa.escritorioId, esc.escritorio.id)))
        .limit(1);
      if (!agente) throw new Error("Agente não encontrado");

      await db.insert(agenteIaDocumentos).values({
        agenteId: input.agenteId,
        escritorioId: esc.escritorio.id,
        nome: input.nome,
        tipo: "texto",
        conteudo: input.conteudo,
      });
      return { success: true };
    }),

  deletarDocumento: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      const db = await getDb();
      if (!db) throw new Error("Database indisponível");

      const [doc] = await db
        .select()
        .from(agenteIaDocumentos)
        .where(
          and(
            eq(agenteIaDocumentos.id, input.id),
            eq(agenteIaDocumentos.escritorioId, esc.escritorio.id),
          ),
        )
        .limit(1);
      if (!doc) throw new Error("Documento não encontrado");

      if (doc.tipo === "arquivo" && doc.url) {
        try {
          const filePath = path.join(UPLOAD_DIR, doc.url.replace("/uploads/agentes-escritorio/", ""));
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch (err) {
          log.warn({ err: String(err) }, "Falha ao deletar arquivo");
        }
      }
      await db.delete(agenteIaDocumentos).where(eq(agenteIaDocumentos.id, input.id));
      return { success: true };
    }),

  /**
   * Testar o agente com uma pergunta. Concatena o prompt do agente
   * + conteúdo dos documentos de treinamento como contexto e chama
   * a API do OpenAI.
   */
  testar: protectedProcedure
    .input(
      z.object({
        agenteId: z.number(),
        pergunta: z.string().min(1).max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      const db = await getDb();
      if (!db) throw new Error("Database indisponível");

      const [agente] = await db
        .select()
        .from(agentesIa)
        .where(and(eq(agentesIa.id, input.agenteId), eq(agentesIa.escritorioId, esc.escritorio.id)))
        .limit(1);
      if (!agente) throw new Error("Agente não encontrado");

      const providerPreferido = providerDoModelo(agente.modelo);
      const resolved = await resolverAPIKey(esc.escritorio.id, agente, providerPreferido);
      if (!resolved) {
        throw new Error(
          providerPreferido === "anthropic"
            ? "Nenhuma API key do Claude (Anthropic) disponível. Configure em Configurações → Integrações → Claude."
            : "Nenhuma API key do OpenAI disponível. Configure em Configurações → Integrações → ChatGPT ou adicione uma key no agente.",
        );
      }
      if (resolved.provider !== providerPreferido) {
        throw new Error(
          `O modelo "${agente.modelo}" requer ${providerPreferido === "anthropic" ? "Claude (Anthropic)" : "OpenAI"}, mas somente ${resolved.provider === "anthropic" ? "Claude" : "OpenAI"} está configurado. Configure a integração correta ou troque o modelo do agente.`,
        );
      }

      const contextoStr = await montarContextoDocumentos(db, input.agenteId, esc.escritorio.id);
      const systemPrompt = agente.prompt + contextoStr;
      const temperatura = parseFloat(agente.temperatura || "0.70");
      const maxTokens = agente.maxTokens;

      try {
        if (resolved.provider === "anthropic") {
          const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": resolved.key,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: agente.modelo || "claude-haiku-4-5-20251001",
              system: systemPrompt,
              messages: [{ role: "user", content: input.pergunta }],
              max_tokens: maxTokens,
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
            Authorization: `Bearer ${resolved.key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: agente.modelo,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: input.pergunta },
            ],
            temperature: temperatura,
            max_tokens: maxTokens,
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
          throw new Error(`${resolved.provider === "anthropic" ? "Claude" : "OpenAI"} timeout — verifique a conexão`);
        }
        throw new Error(err.message || "Falha ao chamar IA");
      }
    }),
});

export interface AgenteCanalConfig {
  id: number;
  nome: string;
  prompt: string;
  modelo: string;
  provider: "openai" | "anthropic";
  openaiApiKey?: string;
  anthropicApiKey?: string;
  maxTokens: number;
  temperatura: number;
  /** Bloco de texto com documentos de treinamento, pronto pra concatenar no system prompt */
  contextoDocumentos: string;
}

export async function obterAgenteParaCanal(
  escritorioId: number,
  canalId: number,
): Promise<AgenteCanalConfig | null> {
  const db = await getDb();
  if (!db) return null;
  let [agente] = await db
    .select()
    .from(agentesIa)
    .where(
      and(
        eq(agentesIa.escritorioId, escritorioId),
        eq(agentesIa.canalId, canalId),
        eq(agentesIa.ativo, true),
      ),
    )
    .limit(1);
  if (!agente) {
    const [global] = await db
      .select()
      .from(agentesIa)
      .where(and(eq(agentesIa.escritorioId, escritorioId), eq(agentesIa.ativo, true)))
      .limit(1);
    if (!global) return null;
    agente = global;
  }
  return extrairConfig(escritorioId, agente);
}

/**
 * Busca um agente por ID dentro do escritório e devolve a config completa
 * (provider resolvido + API key + docs RAG), no mesmo shape usado por
 * `obterAgenteParaCanal`. Usada pelo SmartFlow (passo `ia_responder` com
 * `agenteId` no config).
 */
export async function obterAgentePorId(
  escritorioId: number,
  agenteId: number,
): Promise<AgenteCanalConfig | null> {
  const db = await getDb();
  if (!db) return null;
  const [agente] = await db
    .select()
    .from(agentesIa)
    .where(
      and(
        eq(agentesIa.escritorioId, escritorioId),
        eq(agentesIa.id, agenteId),
        eq(agentesIa.ativo, true),
      ),
    )
    .limit(1);
  if (!agente) return null;
  return extrairConfig(escritorioId, agente);
}

async function extrairConfig(
  escritorioId: number,
  a: any,
): Promise<AgenteCanalConfig | null> {
  const providerPreferido = providerDoModelo(a.modelo);
  const resolved = await resolverAPIKey(escritorioId, a, providerPreferido);
  if (!resolved) return null;

  const db = await getDb();
  const contextoDocumentos = db
    ? await montarContextoDocumentos(db, a.id, escritorioId)
    : "";

  return {
    id: a.id,
    nome: a.nome,
    prompt: a.prompt,
    modelo: a.modelo,
    provider: resolved.provider,
    openaiApiKey: resolved.provider === "openai" ? resolved.key : undefined,
    anthropicApiKey: resolved.provider === "anthropic" ? resolved.key : undefined,
    maxTokens: a.maxTokens || 500,
    temperatura: parseFloat(a.temperatura || "0.70"),
    contextoDocumentos,
  };
}

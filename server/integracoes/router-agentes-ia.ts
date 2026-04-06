import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { getDb } from "../db";
import { agentesIa } from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import crypto from "crypto";

const ENCRYPTION_KEY = process.env.CANAIS_ENCRYPTION_KEY || "0".repeat(64);

function encryptApiKey(apiKey: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(ENCRYPTION_KEY, "hex"), iv);
  let encrypted = cipher.update(apiKey, "utf8", "base64");
  encrypted += cipher.final("base64");
  return { encrypted, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

function decryptApiKey(encrypted: string, iv: string, tag: string): string {
  const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(ENCRYPTION_KEY, "hex"), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  let decrypted = decipher.update(encrypted, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export const agentesIaRouter = router({
  listar: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return [];
    const db = await getDb();
    if (!db) return [];
    const rows = await db.select().from(agentesIa).where(eq(agentesIa.escritorioId, esc.escritorio.id)).orderBy(desc(agentesIa.createdAt));
    return rows.map(r => ({ id: r.id, nome: r.nome, descricao: r.descricao || "", modelo: r.modelo, prompt: r.prompt, ativo: r.ativo, canalId: r.canalId, maxTokens: r.maxTokens, temperatura: r.temperatura, temApiKey: !!(r.openaiApiKey && r.apiKeyIv && r.apiKeyTag), createdAt: r.createdAt ? (r.createdAt as Date).toISOString() : "" }));
  }),

  criar: protectedProcedure.input(z.object({ nome: z.string().min(2).max(128), descricao: z.string().max(512).optional(), modelo: z.string().default("gpt-4o-mini"), prompt: z.string().min(10), canalId: z.number().optional(), openaiApiKey: z.string().min(10).optional(), maxTokens: z.number().min(100).max(4000).optional(), temperatura: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      if (esc.colaborador.cargo !== "dono" && esc.colaborador.cargo !== "gestor") throw new Error("Sem permissão.");
      const db = await getDb();
      if (!db) throw new Error("Database indisponível");
      let apiKeyEncrypted: string | null = null, apiKeyIv: string | null = null, apiKeyTag: string | null = null;
      if (input.openaiApiKey) { const enc = encryptApiKey(input.openaiApiKey); apiKeyEncrypted = enc.encrypted; apiKeyIv = enc.iv; apiKeyTag = enc.tag; }
      const [result] = await db.insert(agentesIa).values({ escritorioId: esc.escritorio.id, nome: input.nome, descricao: input.descricao || null, modelo: input.modelo, prompt: input.prompt, canalId: input.canalId || null, openaiApiKey: apiKeyEncrypted, apiKeyIv, apiKeyTag, maxTokens: input.maxTokens || 500, temperatura: input.temperatura || "0.70", ativo: false });
      return { id: (result as any).insertId as number };
    }),

  atualizar: protectedProcedure.input(z.object({ id: z.number(), nome: z.string().min(2).max(128).optional(), descricao: z.string().max(512).optional(), modelo: z.string().optional(), prompt: z.string().min(10).optional(), canalId: z.number().nullable().optional(), openaiApiKey: z.string().min(10).optional(), maxTokens: z.number().min(100).max(4000).optional(), temperatura: z.string().optional(), ativo: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");
      if (esc.colaborador.cargo !== "dono" && esc.colaborador.cargo !== "gestor") throw new Error("Sem permissão.");
      const db = await getDb();
      if (!db) throw new Error("Database indisponível");
      const u: any = {};
      if (input.nome !== undefined) u.nome = input.nome;
      if (input.descricao !== undefined) u.descricao = input.descricao;
      if (input.modelo !== undefined) u.modelo = input.modelo;
      if (input.prompt !== undefined) u.prompt = input.prompt;
      if (input.canalId !== undefined) u.canalId = input.canalId;
      if (input.maxTokens !== undefined) u.maxTokens = input.maxTokens;
      if (input.temperatura !== undefined) u.temperatura = input.temperatura;
      if (input.ativo !== undefined) u.ativo = input.ativo;
      if (input.openaiApiKey) { const enc = encryptApiKey(input.openaiApiKey); u.openaiApiKey = enc.encrypted; u.apiKeyIv = enc.iv; u.apiKeyTag = enc.tag; }
      await db.update(agentesIa).set(u).where(and(eq(agentesIa.id, input.id), eq(agentesIa.escritorioId, esc.escritorio.id)));
      return { success: true };
    }),

  excluir: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) throw new Error("Escritório não encontrado.");
    const db = await getDb();
    if (!db) throw new Error("Database indisponível");
    await db.delete(agentesIa).where(and(eq(agentesIa.id, input.id), eq(agentesIa.escritorioId, esc.escritorio.id)));
    return { success: true };
  }),

  toggleAtivo: protectedProcedure.input(z.object({ id: z.number(), ativo: z.boolean() })).mutation(async ({ ctx, input }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) throw new Error("Escritório não encontrado.");
    const db = await getDb();
    if (!db) throw new Error("Database indisponível");
    await db.update(agentesIa).set({ ativo: input.ativo }).where(and(eq(agentesIa.id, input.id), eq(agentesIa.escritorioId, esc.escritorio.id)));
    return { success: true };
  }),
});

export async function obterAgenteParaCanal(escritorioId: number, canalId: number) {
  const db = await getDb();
  if (!db) return null;
  const [agente] = await db.select().from(agentesIa).where(and(eq(agentesIa.escritorioId, escritorioId), eq(agentesIa.canalId, canalId), eq(agentesIa.ativo, true))).limit(1);
  if (!agente) {
    const [global] = await db.select().from(agentesIa).where(and(eq(agentesIa.escritorioId, escritorioId), eq(agentesIa.ativo, true))).limit(1);
    if (!global) return null;
    return extrairConfig(global);
  }
  return extrairConfig(agente);
}

function extrairConfig(a: any) {
  if (!a.openaiApiKey || !a.apiKeyIv || !a.apiKeyTag) return null;
  try { return { nome: a.nome, prompt: a.prompt, modelo: a.modelo, openaiApiKey: decryptApiKey(a.openaiApiKey, a.apiKeyIv, a.apiKeyTag), maxTokens: a.maxTokens || 500, temperatura: parseFloat(a.temperatura || "0.70") }; }
  catch { return null; }
}

/**
 * Router de modelos de contrato — templates DOCX com placeholders
 * numerados ({{1}}, {{2}}...) inspirados nos templates do WhatsApp.
 *
 * Fluxo:
 *  1. `upload` — operador envia .docx, backend salva no disco e parseia
 *     `{{N}}`. Retorna lista de placeholders detectados.
 *  2. `salvarMapping` — operador define se cada placeholder é "variavel"
 *     (resolve automático: cliente.profissao etc.) ou "manual" (preenche
 *     no momento de gerar).
 *  3. `gerar` — combina cliente + escritório + valores manuais e produz
 *     DOCX preenchido (retornado como base64 pra download direto).
 */

import { z } from "zod";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { protectedProcedure, router } from "../_core/trpc";
import { getEscritorioPorUsuario } from "./db-escritorio";
import { getDb } from "../db";
import {
  contatos,
  escritorios,
  modelosContrato,
  camposPersonalizadosCliente,
} from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createLogger } from "../_core/logger";
import {
  CATALOGO_BASE,
  detectarPlaceholdersNumerados,
  resolverVariavel,
  type Placeholder,
  type VariavelCatalogo,
  type ContextoContrato,
} from "../../shared/modelos-contrato-variaveis";

const log = createLogger("router-modelos-contrato");

const UPLOAD_DIR = path.resolve("./uploads/modelos-contrato");
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIMES = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function requireGestao(cargo: string) {
  if (cargo !== "dono" && cargo !== "gestor") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Apenas dono ou gestor pode gerenciar modelos de contrato.",
    });
  }
}

/** Lê um buffer DOCX, extrai TODO o texto rasteiro de `word/document.xml`
 *  (concatenando entre tags) e retorna pra parsing de placeholders. */
function extrairTextoDocx(buffer: Buffer): string {
  const zip = new PizZip(buffer);
  const doc = zip.file("word/document.xml");
  if (!doc) throw new Error("DOCX inválido — falta word/document.xml");
  const xml = doc.asText();
  // Strip de tags XML — preserva espaços entre runs. Tags fragmentam
  // {{1}} mas docxtemplater normaliza no render. Aqui só queremos detectar.
  return xml.replace(/<[^>]+>/g, " ");
}

/** Renderiza o DOCX substituindo `{{1}}`, `{{2}}`, ... pelos valores
 *  fornecidos. Usa `docxtemplater` que lida com fragmentação de runs. */
function renderizarDocx(
  buffer: Buffer,
  valoresPorNumero: Record<string, string>,
): Buffer {
  const zip = new PizZip(buffer);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: "{{", end: "}}" },
    nullGetter: () => "", // placeholder não preenchido vira string vazia
  });
  doc.render(valoresPorNumero);
  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
}

const placeholderSchema = z.discriminatedUnion("tipo", [
  z.object({
    numero: z.number().int().positive(),
    tipo: z.literal("variavel"),
    variavel: z.string().min(1).max(120),
  }),
  z.object({
    numero: z.number().int().positive(),
    tipo: z.literal("manual"),
    label: z.string().min(1).max(80),
    dica: z.string().max(120).optional(),
  }),
]);

export const modelosContratoRouter = router({
  /** Lista variáveis disponíveis (catálogo base + campos personalizados
   *  do escritório). Usado pela UI de mapeamento. */
  catalogoVariaveis: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return CATALOGO_BASE;
    const db = await getDb();
    if (!db) return CATALOGO_BASE;
    const camposExtras = await db
      .select({
        chave: camposPersonalizadosCliente.chave,
        label: camposPersonalizadosCliente.label,
      })
      .from(camposPersonalizadosCliente)
      .where(eq(camposPersonalizadosCliente.escritorioId, esc.escritorio.id));
    const extras: VariavelCatalogo[] = camposExtras.map((c) => ({
      path: `cliente.campos.${c.chave}`,
      label: c.label,
      grupo: "Campos personalizados",
      exemplo: "",
    }));
    return [...CATALOGO_BASE, ...extras];
  }),

  listar: protectedProcedure.query(async ({ ctx }) => {
    const esc = await getEscritorioPorUsuario(ctx.user.id);
    if (!esc) return [];
    const db = await getDb();
    if (!db) return [];
    const rows = await db
      .select({
        id: modelosContrato.id,
        nome: modelosContrato.nome,
        descricao: modelosContrato.descricao,
        arquivoNome: modelosContrato.arquivoNome,
        tamanho: modelosContrato.tamanho,
        placeholders: modelosContrato.placeholders,
        createdAt: modelosContrato.createdAt,
      })
      .from(modelosContrato)
      .where(eq(modelosContrato.escritorioId, esc.escritorio.id))
      .orderBy(desc(modelosContrato.createdAt));
    return rows.map((r) => ({
      ...r,
      placeholders: JSON.parse(r.placeholders) as Placeholder[],
    }));
  }),

  obter: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [m] = await db
        .select()
        .from(modelosContrato)
        .where(
          and(
            eq(modelosContrato.id, input.id),
            eq(modelosContrato.escritorioId, esc.escritorio.id),
          ),
        )
        .limit(1);
      if (!m) throw new TRPCError({ code: "NOT_FOUND" });
      return {
        ...m,
        placeholders: JSON.parse(m.placeholders) as Placeholder[],
      };
    }),

  /** Faz upload do DOCX e parseia placeholders. Salva como `placeholders`
   *  inicial todos como tipo='manual' com labels genéricos — operador
   *  customiza depois via `salvarMapping`. */
  upload: protectedProcedure
    .input(
      z.object({
        nome: z.string().min(1).max(150),
        descricao: z.string().max(500).optional(),
        arquivoNome: z.string().min(1).max(255),
        mimetype: z.string().max(128),
        base64: z.string().min(10),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "FORBIDDEN" });
      requireGestao(esc.colaborador.cargo);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const mime = input.mimetype.split(";")[0].trim();
      if (!ALLOWED_MIMES.includes(mime)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Apenas arquivos .docx são suportados no momento.",
        });
      }

      let base64Data = input.base64;
      if (base64Data.includes(",")) base64Data = base64Data.split(",")[1];
      const buffer = Buffer.from(base64Data, "base64");
      if (buffer.length > MAX_SIZE_BYTES) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Arquivo muito grande (${(buffer.length / 1024 / 1024).toFixed(1)}MB). Máximo: 10MB.`,
        });
      }

      let texto: string;
      try {
        texto = extrairTextoDocx(buffer);
      } catch (err: unknown) {
        log.warn({ err: err instanceof Error ? err.message : String(err) }, "DOCX inválido");
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Arquivo DOCX corrompido ou inválido.",
        });
      }
      const numerosDetectados = detectarPlaceholdersNumerados(texto);

      // Salva o arquivo no disco
      const escDir = path.join(UPLOAD_DIR, `escritorio_${esc.escritorio.id}`);
      ensureDir(escDir);
      const ext = path.extname(input.arquivoNome) || ".docx";
      const hash = crypto.randomBytes(8).toString("hex");
      const filename = `${Date.now()}_${hash}${ext}`;
      const filepath = path.join(escDir, filename);
      fs.writeFileSync(filepath, buffer);
      const url = `/uploads/modelos-contrato/escritorio_${esc.escritorio.id}/${filename}`;

      // Mapping inicial: cada placeholder vira "manual" com label genérico
      const placeholdersInit: Placeholder[] = numerosDetectados.map((n) => ({
        numero: n,
        tipo: "manual" as const,
        label: `Campo ${n}`,
      }));

      const [r] = await db.insert(modelosContrato).values({
        escritorioId: esc.escritorio.id,
        nome: input.nome,
        descricao: input.descricao || null,
        arquivoUrl: url,
        arquivoNome: input.arquivoNome.replace(/[^a-zA-Z0-9._\- ]/g, "_").slice(0, 200),
        tamanho: buffer.length,
        placeholders: JSON.stringify(placeholdersInit),
        criadoPorUserId: ctx.user.id,
      });

      return {
        id: (r as { insertId: number }).insertId,
        placeholdersDetectados: numerosDetectados,
      };
    }),

  /** Salva o mapeamento (variável vs manual) configurado pelo usuário. */
  salvarMapping: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        nome: z.string().min(1).max(150).optional(),
        descricao: z.string().max(500).nullable().optional(),
        placeholders: z.array(placeholderSchema),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "FORBIDDEN" });
      requireGestao(esc.colaborador.cargo);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [existente] = await db
        .select({ id: modelosContrato.id })
        .from(modelosContrato)
        .where(
          and(
            eq(modelosContrato.id, input.id),
            eq(modelosContrato.escritorioId, esc.escritorio.id),
          ),
        )
        .limit(1);
      if (!existente) throw new TRPCError({ code: "NOT_FOUND" });

      const upd: Record<string, unknown> = {
        placeholders: JSON.stringify(input.placeholders),
      };
      if (input.nome !== undefined) upd.nome = input.nome;
      if (input.descricao !== undefined) upd.descricao = input.descricao;

      await db
        .update(modelosContrato)
        .set(upd)
        .where(eq(modelosContrato.id, input.id));
      return { success: true };
    }),

  excluir: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "FORBIDDEN" });
      requireGestao(esc.colaborador.cargo);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [m] = await db
        .select()
        .from(modelosContrato)
        .where(
          and(
            eq(modelosContrato.id, input.id),
            eq(modelosContrato.escritorioId, esc.escritorio.id),
          ),
        )
        .limit(1);
      if (!m) return { success: true };

      // Apaga arquivo do disco (não-fatal se já removido).
      try {
        const filePath = path.join(
          UPLOAD_DIR,
          m.arquivoUrl.replace("/uploads/modelos-contrato/", ""),
        );
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch (err: unknown) {
        log.warn(
          { err: err instanceof Error ? err.message : String(err), id: m.id },
          "Falha ao remover arquivo do disco — registro já removido do DB",
        );
      }

      await db.delete(modelosContrato).where(eq(modelosContrato.id, input.id));
      return { success: true };
    }),

  /** Gera o DOCX preenchido pra um cliente específico. Retorna como
   *  base64 pra download direto no front (sem armazenamento intermediário). */
  gerar: protectedProcedure
    .input(
      z.object({
        modeloId: z.number(),
        contatoId: z.number(),
        /** Mapa numero → valor. Só usado pros placeholders tipo="manual".
         *  Variáveis ignoram esse map. */
        valoresManuais: z.record(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [modelo] = await db
        .select()
        .from(modelosContrato)
        .where(
          and(
            eq(modelosContrato.id, input.modeloId),
            eq(modelosContrato.escritorioId, esc.escritorio.id),
          ),
        )
        .limit(1);
      if (!modelo) throw new TRPCError({ code: "NOT_FOUND", message: "Modelo não encontrado" });

      const [contato] = await db
        .select()
        .from(contatos)
        .where(
          and(eq(contatos.id, input.contatoId), eq(contatos.escritorioId, esc.escritorio.id)),
        )
        .limit(1);
      if (!contato) throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado" });

      const [escritorio] = await db
        .select()
        .from(escritorios)
        .where(eq(escritorios.id, esc.escritorio.id))
        .limit(1);

      // Parse de campos personalizados
      let camposExtras: Record<string, unknown> = {};
      if (contato.camposPersonalizados) {
        try {
          camposExtras = JSON.parse(contato.camposPersonalizados);
        } catch {
          /* JSON inválido — ignora */
        }
      }

      const ctxContrato: ContextoContrato = {
        cliente: {
          nome: contato.nome,
          cpfCnpj: contato.cpfCnpj,
          telefone: contato.telefone,
          email: contato.email,
          profissao: contato.profissao,
          estadoCivil: contato.estadoCivil,
          nacionalidade: contato.nacionalidade,
          cep: contato.cep,
          logradouro: contato.logradouro,
          numeroEndereco: contato.numeroEndereco,
          complemento: contato.complemento,
          bairro: contato.bairro,
          cidade: contato.cidade,
          uf: contato.uf,
          campos: camposExtras,
        },
        escritorio: escritorio
          ? {
              nome: escritorio.nome,
              cnpj: escritorio.cnpj,
              email: escritorio.email,
              telefone: escritorio.telefone,
            }
          : null,
        hoje: new Date(),
      };

      const placeholders = JSON.parse(modelo.placeholders) as Placeholder[];
      const valores: Record<string, string> = {};
      for (const p of placeholders) {
        const key = String(p.numero);
        if (p.tipo === "variavel") {
          valores[key] = resolverVariavel(p.variavel, ctxContrato);
        } else {
          valores[key] = input.valoresManuais?.[key] || "";
        }
      }

      // Lê arquivo + render
      const filePath = path.join(
        UPLOAD_DIR,
        modelo.arquivoUrl.replace("/uploads/modelos-contrato/", ""),
      );
      if (!fs.existsSync(filePath)) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Arquivo do modelo não encontrado no servidor",
        });
      }
      const buffer = fs.readFileSync(filePath);
      let renderizado: Buffer;
      try {
        renderizado = renderizarDocx(buffer, valores);
      } catch (err: unknown) {
        log.error(
          { err: err instanceof Error ? err.message : String(err), modeloId: modelo.id },
          "Falha ao renderizar DOCX",
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Erro ao gerar contrato. Verifique se o modelo tem sintaxe válida.",
        });
      }

      // Nome sugerido pro download
      const nomeBase = `${modelo.nome} - ${contato.nome}`
        .replace(/[^\w\s.-]/g, "")
        .slice(0, 120);
      const nomeArquivo = `${nomeBase}.docx`;

      return {
        nomeArquivo,
        base64: renderizado.toString("base64"),
      };
    }),
});

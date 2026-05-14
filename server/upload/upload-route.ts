/**
 * Router tRPC — Upload de Arquivos
 *
 * Frontend converte arquivo para base64, envia via tRPC mutation.
 * Backend decodifica e salva em ./uploads/{escritorioId}/
 * Arquivos servidos via Express static em /uploads/
 *
 * Limite: 2GB por arquivo. Suporta PDF, imagens, docs.
 *
 * Validação de tipo: confiar no MIME enviado pelo cliente é inseguro
 * (cliente pode enviar `.exe` declarando `application/pdf`). Por isso
 * checamos a "magic number" do buffer com `file-type`. Para tipos de
 * texto puro (txt/csv) que não têm magic number, validamos heurística:
 * conteúdo precisa ser UTF-8 sem bytes nulos.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { fileTypeFromBuffer } from "file-type";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const UPLOAD_DIR = path.resolve("./uploads");
const MAX_SIZE_BYTES = 2 * 1024 * 1024 * 1024; // 2GB

/**
 * Apaga arquivo do disco a partir de uma URL `/uploads/escritorio_{id}/{file}`.
 * Não-fatal: ENOENT (arquivo já não existe), URL malformada, ou erro de I/O
 * só logam — o caller normalmente está deletando metadado do DB e não pode
 * abortar por causa do binário.
 *
 * Usado por: upload.excluir (procedure), router-clientes.excluirArquivo/
 * excluirPasta/excluirCliente (cleanup de blobs órfãos).
 */
export async function apagarArquivoDoDisco(
  url: string,
  escritorioId: number,
): Promise<void> {
  // Path-traversal guard: URL precisa ser do escritório certo e sem ".."
  const expected = `/uploads/escritorio_${escritorioId}/`;
  if (!url || !url.startsWith(expected) || url.includes("..")) {
    return; // URL externa (S3 legacy, etc) ou maliciosa — ignorar silenciosamente
  }
  const filepath = path.join(UPLOAD_DIR, url.replace("/uploads/", ""));
  try {
    await fs.unlink(filepath);
  } catch (err: any) {
    if (err.code !== "ENOENT") {
      // Log mas não relança — caller já está em destruição.
      // eslint-disable-next-line no-console
      console.warn(`[upload] Falha ao apagar arquivo ${url}: ${err.message}`);
    }
  }
}

// MIME types aceitos. Mantemos lista explícita pra fechar a porta pra
// formatos que nunca deveriam ser aceitos (ex: executáveis, scripts).
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
]);

// Tipos sem magic number — só passam se input.tipo declarar e o conteúdo
// parecer texto válido. Tudo mais precisa bater com fileTypeFromBuffer.
const TIPOS_SEM_MAGIC = new Set(["text/plain", "text/csv"]);

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
}

/** Heurística simples pra "isso parece texto?" — sem bytes nulos e
 *  decodificável como UTF-8. Não é blindagem perfeita, mas barra
 *  binários disfarçados de .txt. */
function pareceTextoPlano(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

export const uploadRouter = router({
  /** Upload de arquivo (base64) */
  enviar: protectedProcedure
    .input(z.object({
      nome: z.string().min(1).max(255),
      tipo: z.string().max(128),
      base64: z.string().min(10), // data:mime;base64,xxxxx or raw base64
      tamanho: z.number().max(MAX_SIZE_BYTES).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "NOT_FOUND", message: "Escritório não encontrado." });

      // 1) Allowlist no MIME declarado — barra cedo formatos óbvios.
      const mimeDeclarado = input.tipo.split(";")[0].trim();
      if (!ALLOWED_TYPES.has(mimeDeclarado)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Tipo de arquivo não permitido: ${mimeDeclarado}. Tipos aceitos: PDF, imagens, documentos.`,
        });
      }

      // 2) Decodifica o base64.
      let base64Data = input.base64;
      if (base64Data.includes(",")) {
        base64Data = base64Data.split(",")[1];
      }
      const buffer = Buffer.from(base64Data, "base64");

      // 3) Limite de tamanho — checagem real depois de decodificar.
      if (buffer.length > MAX_SIZE_BYTES) {
        throw new TRPCError({
          code: "PAYLOAD_TOO_LARGE",
          message: `Arquivo muito grande (${(buffer.length / 1024 / 1024).toFixed(1)}MB). Máximo: 2GB.`,
        });
      }
      if (buffer.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Arquivo vazio." });
      }

      // 4) Validação por magic number — não confia no MIME do cliente.
      //    Pra binários, exige bater com a allowlist. Pra texto puro
      //    (sem magic), heurística UTF-8.
      const detectado = await fileTypeFromBuffer(buffer);
      if (detectado) {
        if (!ALLOWED_TYPES.has(detectado.mime)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Conteúdo do arquivo é "${detectado.mime}", que não é permitido.`,
          });
        }
        // Cliente declarou um tipo, conteúdo é outro: pode ser ataque.
        if (detectado.mime !== mimeDeclarado) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Tipo declarado (${mimeDeclarado}) não bate com o conteúdo (${detectado.mime}).`,
          });
        }
      } else {
        // Sem magic detectada — só aceita se for texto declarado E o
        // conteúdo parecer texto válido.
        if (!TIPOS_SEM_MAGIC.has(mimeDeclarado) || !pareceTextoPlano(buffer)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Não foi possível identificar o tipo do arquivo. Use PDF, imagem ou documento conhecido.",
          });
        }
      }

      // 5) Persistência. Diretório por escritório, nome único.
      const escDir = path.join(UPLOAD_DIR, `escritorio_${esc.escritorio.id}`);
      await ensureDir(escDir);

      const ext = path.extname(input.nome) || ".bin";
      const hash = crypto.randomBytes(8).toString("hex");
      const filename = `${Date.now()}_${hash}${ext}`;
      const filepath = path.join(escDir, filename);

      await fs.writeFile(filepath, buffer);

      const url = `/uploads/escritorio_${esc.escritorio.id}/${filename}`;

      return {
        url,
        nome: sanitizeFilename(input.nome),
        tipo: mimeDeclarado,
        tamanho: buffer.length,
      };
    }),

  /** Excluir arquivo do disco */
  excluir: protectedProcedure
    .input(z.object({ url: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new TRPCError({ code: "NOT_FOUND", message: "Escritório não encontrado." });

      // Segurança: bloqueia chamada com URL fora do escritório / com "..".
      const expected = `/uploads/escritorio_${esc.escritorio.id}/`;
      if (!input.url.startsWith(expected) || input.url.includes("..")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para excluir este arquivo." });
      }

      await apagarArquivoDoDisco(input.url, esc.escritorio.id);
      return { success: true };
    }),
});

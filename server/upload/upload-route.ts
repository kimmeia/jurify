/**
 * Router tRPC — Upload de Arquivos
 * 
 * Frontend converte arquivo para base64, envia via tRPC mutation.
 * Backend decodifica e salva em ./uploads/{escritorioId}/
 * Arquivos servidos via Express static em /uploads/
 * 
 * Limite: 10MB por arquivo. Suporta PDF, imagens, docs.
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const UPLOAD_DIR = path.resolve("./uploads");
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain", "text/csv",
];

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
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
      if (!esc) throw new Error("Escritório não encontrado.");

      // Validar tipo
      const mimeType = input.tipo.split(";")[0].trim();
      if (!ALLOWED_TYPES.includes(mimeType)) {
        throw new Error(`Tipo de arquivo não permitido: ${mimeType}. Tipos aceitos: PDF, imagens, documentos.`);
      }

      // Decodificar base64
      let base64Data = input.base64;
      if (base64Data.includes(",")) {
        base64Data = base64Data.split(",")[1]; // Remove "data:mime;base64,"
      }

      const buffer = Buffer.from(base64Data, "base64");

      // Validar tamanho
      if (buffer.length > MAX_SIZE_BYTES) {
        throw new Error(`Arquivo muito grande (${(buffer.length / 1024 / 1024).toFixed(1)}MB). Máximo: 10MB.`);
      }

      // Criar diretório do escritório
      const escDir = path.join(UPLOAD_DIR, `escritorio_${esc.escritorio.id}`);
      ensureDir(escDir);

      // Gerar nome único
      const ext = path.extname(input.nome) || ".bin";
      const hash = crypto.randomBytes(8).toString("hex");
      const filename = `${Date.now()}_${hash}${ext}`;
      const filepath = path.join(escDir, filename);

      // Salvar arquivo
      fs.writeFileSync(filepath, buffer);

      // URL relativa (servida via Express static)
      const url = `/uploads/escritorio_${esc.escritorio.id}/${filename}`;

      return {
        url,
        nome: sanitizeFilename(input.nome),
        tipo: mimeType,
        tamanho: buffer.length,
      };
    }),

  /** Excluir arquivo do disco */
  excluir: protectedProcedure
    .input(z.object({ url: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const esc = await getEscritorioPorUsuario(ctx.user.id);
      if (!esc) throw new Error("Escritório não encontrado.");

      // Segurança: garantir que o URL é do escritório do usuário
      const expected = `/uploads/escritorio_${esc.escritorio.id}/`;
      if (!input.url.startsWith(expected)) {
        throw new Error("Sem permissão para excluir este arquivo.");
      }

      const filepath = path.join(UPLOAD_DIR, input.url.replace("/uploads/", ""));
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }

      return { success: true };
    }),
});

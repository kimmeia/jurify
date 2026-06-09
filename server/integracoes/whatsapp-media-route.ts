/**
 * Rota Express pra servir arquivos de mídia recebidos via WhatsApp Baileys.
 *
 * `saveMediaFile` em `whatsapp-baileys.ts` salva o arquivo em
 * `<cwd>/.whatsapp-sessions/canal_<id>/media/<arquivo>` e gera a URL
 * `/api/whatsapp-media/<canalId>/<arquivo>`. Sem esta rota o `<img>` do
 * frontend recebia 404 e a imagem aparecia quebrada.
 *
 * Segurança:
 *  - exige sessão autenticada (sdk.authenticateRequest)
 *  - canal precisa pertencer ao escritório do usuário
 *  - sanitiza filename pra prevenir path traversal (rejeita "..", "/")
 *  - serve direto do disco com Content-Type baseado na extensão
 */

import type { Express, Request, Response } from "express";
import path from "path";
import fs from "fs";
import { eq, and } from "drizzle-orm";
import { getDb } from "../db";
import { canaisIntegrados } from "../../drizzle/schema";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { sdk } from "../_core/sdk";
import { createLogger } from "../_core/logger";

const log = createLogger("whatsapp-media-route");

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".pdf": "application/pdf",
};

export function registerWhatsAppMediaRoute(app: Express): void {
  app.get(
    "/api/whatsapp-media/:canalId/:filename",
    async (req: Request, res: Response) => {
      const canalId = Number(req.params.canalId);
      const filename = req.params.filename;

      if (!Number.isFinite(canalId) || canalId <= 0) {
        return res.status(400).json({ error: "canal inválido" });
      }
      // Path traversal guard: o saveMediaFile já sanitiza com
      // `[^a-zA-Z0-9._-]`, mas re-validamos aqui pra defesa em profundidade.
      if (!/^[a-zA-Z0-9._-]+$/.test(filename) || filename.includes("..")) {
        return res.status(400).json({ error: "nome de arquivo inválido" });
      }

      let user: { id: number } | null = null;
      try {
        const u = await sdk.authenticateRequest(req);
        user = u ? { id: u.id } : null;
      } catch {
        user = null;
      }
      if (!user) return res.status(401).json({ error: "não autenticado" });

      const esc = await getEscritorioPorUsuario(user.id);
      if (!esc) return res.status(403).json({ error: "sem escritório" });

      const db = await getDb();
      if (!db) return res.status(503).json({ error: "db indisponível" });

      const [canal] = await db
        .select({ id: canaisIntegrados.id })
        .from(canaisIntegrados)
        .where(
          and(
            eq(canaisIntegrados.id, canalId),
            eq(canaisIntegrados.escritorioId, esc.escritorio.id),
          ),
        )
        .limit(1);
      if (!canal) return res.status(404).json({ error: "canal não encontrado" });

      const filePath = path.join(
        process.cwd(),
        ".whatsapp-sessions",
        `canal_${canalId}`,
        "media",
        filename,
      );

      if (!fs.existsSync(filePath)) {
        log.warn({ canalId, filename }, "Mídia WhatsApp não encontrada no disco");
        return res.status(404).json({ error: "arquivo não encontrado" });
      }

      const ext = path.extname(filename).toLowerCase();
      const mime = MIME_BY_EXT[ext] ?? "application/octet-stream";
      res.setHeader("Content-Type", mime);
      // Mídia do WhatsApp é estável (hash no nome) — cache agressivo OK.
      res.setHeader("Cache-Control", "private, max-age=86400");
      fs.createReadStream(filePath).pipe(res);
    },
  );
}

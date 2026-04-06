/**
 * Rotas Express para exportação e compartilhamento de Parecer Técnico em PDF
 * 
 * POST /api/export/parecer-pdf        → Download direto do PDF
 * POST /api/export/parecer-pdf/share   → Gera PDF, faz upload ao S3, retorna URL pública
 */

import type { Express, Request, Response } from "express";
import { gerarPDF } from "./export-pdf";
import { sdk } from "../_core/sdk";
import { storagePut } from "../storage";

function generateFilename(protocolo?: string): string {
  return protocolo
    ? `parecer-tecnico-${protocolo}.pdf`
    : `parecer-tecnico-${new Date().toISOString().slice(0, 10)}.pdf`;
}

function generateStorageKey(protocolo?: string): string {
  const timestamp = Date.now();
  const rand = Math.random().toString(36).substring(2, 8);
  const slug = protocolo || new Date().toISOString().slice(0, 10);
  return `pareceres/${slug}-${timestamp}-${rand}.pdf`;
}

export function registerPDFExportRoute(app: Express) {
  // ─── Download direto do PDF ─────────────────────────────────────────────────
  app.post("/api/export/parecer-pdf", async (req: Request, res: Response) => {
    try {
      try {
        await sdk.authenticateRequest(req);
      } catch {
        res.status(401).json({ error: "Não autenticado" });
        return;
      }

      const { parecerMarkdown, protocolo } = req.body;

      if (!parecerMarkdown || typeof parecerMarkdown !== "string") {
        res.status(400).json({ error: "parecerMarkdown é obrigatório" });
        return;
      }

      const pdfBuffer = await gerarPDF(parecerMarkdown);
      const filename = generateFilename(protocolo);

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", pdfBuffer.length);
      res.send(pdfBuffer);
    } catch (error) {
      console.error("[PDF Export] Erro ao gerar PDF:", error);
      res.status(500).json({ error: "Erro ao gerar PDF" });
    }
  });

  // ─── Gerar PDF e retornar URL pública para compartilhamento ─────────────────
  app.post("/api/export/parecer-pdf/share", async (req: Request, res: Response) => {
    try {
      try {
        await sdk.authenticateRequest(req);
      } catch {
        res.status(401).json({ error: "Não autenticado" });
        return;
      }

      const { parecerMarkdown, protocolo } = req.body;

      if (!parecerMarkdown || typeof parecerMarkdown !== "string") {
        res.status(400).json({ error: "parecerMarkdown é obrigatório" });
        return;
      }

      // Gerar PDF
      const pdfBuffer = await gerarPDF(parecerMarkdown);
      const filename = generateFilename(protocolo);
      const storageKey = generateStorageKey(protocolo);

      // Upload ao S3
      const { url } = await storagePut(storageKey, pdfBuffer, "application/pdf");

      console.log(`[PDF Share] Parecer "${filename}" uploaded to S3: ${url}`);

      res.json({
        url,
        filename,
        size: pdfBuffer.length,
      });
    } catch (error) {
      console.error("[PDF Share] Erro ao gerar/enviar PDF:", error);
      res.status(500).json({ error: "Erro ao gerar link de compartilhamento" });
    }
  });
}

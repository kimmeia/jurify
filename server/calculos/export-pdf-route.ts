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
import { createLogger } from "../_core/logger";
const log = createLogger("calculos-export-pdf-route");

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

/**
 * Anexa bloco "Revisado por" ao final do markdown.
 *
 * O bloco identifica o advogado humano que revisou e validou o parecer
 * gerado automaticamente. Crítico para responsabilidade profissional —
 * o sistema gera, mas é o advogado que assina e responde por isso.
 */
function appendRevisadoPor(
  markdown: string,
  revisadoPor: { nome: string; oab?: string } | undefined,
): string {
  if (!revisadoPor || !revisadoPor.nome || !revisadoPor.nome.trim()) {
    return markdown;
  }
  const nome = revisadoPor.nome.trim();
  const oab = revisadoPor.oab?.trim();
  const dataRevisao = new Date().toLocaleDateString("pt-BR");

  const bloco =
    `\n\n---\n\n## Revisão Profissional\n\n` +
    `**Revisado por:** ${nome}${oab ? `  \n**OAB:** ${oab}` : ""}  \n` +
    `**Data da revisão:** ${dataRevisao}\n\n` +
    `> Este parecer foi gerado automaticamente pelo sistema e revisado pelo(a) advogado(a) ` +
    `acima identificado(a), que assume a responsabilidade técnica pela análise apresentada.\n`;

  return markdown + bloco;
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

      const { parecerMarkdown, protocolo, revisadoPor } = req.body;

      if (!parecerMarkdown || typeof parecerMarkdown !== "string") {
        res.status(400).json({ error: "parecerMarkdown é obrigatório" });
        return;
      }

      const markdownComRevisao = appendRevisadoPor(parecerMarkdown, revisadoPor);
      const pdfBuffer = await gerarPDF(markdownComRevisao);
      const filename = generateFilename(protocolo);

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", pdfBuffer.length);
      res.send(pdfBuffer);
    } catch (error) {
      log.error({ err: String(error) }, "Erro ao gerar PDF");
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

      const { parecerMarkdown, protocolo, revisadoPor } = req.body;

      if (!parecerMarkdown || typeof parecerMarkdown !== "string") {
        res.status(400).json({ error: "parecerMarkdown é obrigatório" });
        return;
      }

      // Gerar PDF
      const markdownComRevisao = appendRevisadoPor(parecerMarkdown, revisadoPor);
      const pdfBuffer = await gerarPDF(markdownComRevisao);
      const filename = generateFilename(protocolo);
      const storageKey = generateStorageKey(protocolo);

      // Upload ao S3
      const { url } = await storagePut(storageKey, pdfBuffer, "application/pdf");

      log.info(`[PDF Share] Parecer "${filename}" uploaded to S3: ${url}`);

      res.json({
        url,
        filename,
        size: pdfBuffer.length,
      });
    } catch (error) {
      log.error({ err: String(error) }, "Erro ao gerar/enviar PDF compartilhado");
      res.status(500).json({ error: "Erro ao gerar link de compartilhamento" });
    }
  });
}

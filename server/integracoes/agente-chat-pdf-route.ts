/**
 * Rota Express — POST /api/export/chat-pdf
 *
 * Exporta uma thread do chat do agente IA para PDF.
 * Body: { threadId: number }
 *
 * Valida ownership pelo usuário logado (mesmo userId que criou a thread).
 * Converte mensagens em markdown e reusa o `gerarPDF` dos módulos de cálculo.
 */

import type { Express, Request, Response } from "express";
import { gerarPDF } from "../calculos/export-pdf";
import { sdk } from "../_core/sdk";
import { getDb } from "../db";
import {
  agenteChatThreads,
  agenteChatMensagens,
  agentesIa,
} from "../../drizzle/schema";
import { eq, and, asc } from "drizzle-orm";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { createLogger } from "../_core/logger";
const log = createLogger("agente-chat-pdf-route");

/** Converte thread + mensagens em markdown formatado para export. */
function threadToMarkdown(
  agente: { nome: string; areaConhecimento: string | null },
  thread: { titulo: string; createdAt: Date | string | null },
  mensagens: Array<{ role: string; conteudo: string; anexoNome: string | null; createdAt: Date | string | null }>,
): string {
  const dataStr = thread.createdAt
    ? new Date(thread.createdAt).toLocaleString("pt-BR")
    : new Date().toLocaleString("pt-BR");

  const linhas: string[] = [];
  linhas.push(`# ${thread.titulo}`);
  linhas.push("");
  linhas.push(`**Agente:** ${agente.nome}${agente.areaConhecimento ? ` — ${agente.areaConhecimento}` : ""}`);
  linhas.push(`**Iniciado em:** ${dataStr}`);
  linhas.push("");
  linhas.push("---");
  linhas.push("");

  for (const m of mensagens) {
    if (m.role === "system") continue;
    const titulo = m.role === "user" ? "Advogado" : agente.nome;
    linhas.push(`## ${titulo}`);
    linhas.push("");
    if (m.anexoNome) {
      linhas.push(`> Anexo: ${m.anexoNome}`);
      linhas.push("");
    }
    linhas.push(m.conteudo);
    linhas.push("");
  }

  return linhas.join("\n");
}

export function registerAgenteChatPDFRoute(app: Express) {
  app.post("/api/export/chat-pdf", async (req: Request, res: Response) => {
    let user;
    try {
      user = await sdk.authenticateRequest(req);
    } catch {
      res.status(401).json({ error: "Não autenticado" });
      return;
    }

    const { threadId } = req.body;
    if (typeof threadId !== "number" || !Number.isFinite(threadId)) {
      res.status(400).json({ error: "threadId é obrigatório" });
      return;
    }

    try {
      const esc = await getEscritorioPorUsuario((user as any).id);
      if (!esc) {
        res.status(403).json({ error: "Escritório não encontrado" });
        return;
      }

      const db = await getDb();
      if (!db) {
        res.status(503).json({ error: "Database indisponível" });
        return;
      }

      const [thread] = await db
        .select()
        .from(agenteChatThreads)
        .where(
          and(
            eq(agenteChatThreads.id, threadId),
            eq(agenteChatThreads.usuarioId, (user as any).id),
            eq(agenteChatThreads.escritorioId, esc.escritorio.id),
          ),
        )
        .limit(1);

      if (!thread) {
        res.status(404).json({ error: "Thread não encontrada" });
        return;
      }

      const [agente] = await db
        .select()
        .from(agentesIa)
        .where(eq(agentesIa.id, thread.agenteId))
        .limit(1);

      if (!agente) {
        res.status(404).json({ error: "Agente não encontrado" });
        return;
      }

      const mensagens = await db
        .select()
        .from(agenteChatMensagens)
        .where(eq(agenteChatMensagens.threadId, threadId))
        .orderBy(asc(agenteChatMensagens.createdAt));

      const md = threadToMarkdown(
        { nome: agente.nome, areaConhecimento: agente.areaConhecimento },
        { titulo: thread.titulo, createdAt: thread.createdAt as any },
        mensagens.map((m) => ({
          role: m.role,
          conteudo: m.conteudo,
          anexoNome: m.anexoNome,
          createdAt: m.createdAt as any,
        })),
      );

      const pdfBuffer = await gerarPDF(md);
      const slug = thread.titulo
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "conversa";
      const filename = `chat-${slug}-${new Date().toISOString().slice(0, 10)}.pdf`;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", pdfBuffer.length);
      res.send(pdfBuffer);
    } catch (err: any) {
      log.error({ err: err?.message }, "Erro ao gerar PDF do chat");
      res.status(500).json({ error: "Falha ao gerar PDF", detalhes: err?.message });
    }
  });
}

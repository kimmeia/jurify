/**
 * Rota Express dedicada pra preview do PDF de assinatura.
 *
 * Por que não usar /uploads/* direto?
 *  - express.static não loga 404 (silencioso) — difícil debugar quando o
 *    arquivo não existe no disco (filesystem efêmero, race condition,
 *    path errado entre dev/prod).
 *  - Helmet seta `Cross-Origin-Resource-Policy: same-origin` no static.
 *    pdfjs faz fetch em contexto de Web Worker, que algumas combinações
 *    de browser tratam como cross-origin → bloqueia.
 *  - Não dá pra autorizar por token: /uploads é totalmente público
 *    (qualquer um com URL acessa). OK pra docs já assinados via link
 *    público, mas pro EDITOR (operador antes do envio) queremos
 *    auth de sessão.
 *
 * Esta rota:
 *  - GET /api/assinatura/pdf/:id  (com cookie de sessão → operador)
 *  - GET /api/assinatura/pdf/token/:token (sem auth → cliente final)
 *  - Loga miss/404 e retorna JSON com motivo
 *  - Seta `Cross-Origin-Resource-Policy: cross-origin` + Content-Type
 *    explícitos pra evitar bloqueio do pdfjs worker
 */

import type { Express, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { assinaturasDigitais } from "../../drizzle/schema";
import { createLogger } from "../_core/logger";
import { getEscritorioPorUsuario } from "./db-escritorio";
import { sdk } from "../_core/sdk";

const log = createLogger("assinatura-pdf-route");

/**
 * Converte um caminho de URL relativo ("/uploads/assinaturas/X/Y.pdf")
 * pro path absoluto no disco. Resolve a partir do CWD (mesma raíz que
 * express.static usa).
 */
function resolverPathArquivo(documentoUrl: string): string {
  // Aceita só caminhos que começam com /uploads/ — evita path traversal.
  if (!documentoUrl.startsWith("/uploads/") || documentoUrl.includes("..")) {
    throw new Error("Path inválido");
  }
  return path.resolve("." + documentoUrl);
}

function streamPdf(res: Response, filepath: string, filename: string): void {
  // Headers permissivos: pdfjs worker pode rodar em contexto cross-origin
  // virtual mesmo dentro do mesmo domínio. CORP cross-origin permite o
  // fetch. Content-Type explícito evita pdfjs rejeitar por sniffing.
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Cache-Control", "private, max-age=300");
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  fs.createReadStream(filepath).pipe(res);
}

async function carregarAssinaturaPorId(id: number) {
  const db = await getDb();
  if (!db) return null;
  const [a] = await db
    .select()
    .from(assinaturasDigitais)
    .where(eq(assinaturasDigitais.id, id))
    .limit(1);
  return a ?? null;
}

async function carregarAssinaturaPorToken(token: string) {
  const db = await getDb();
  if (!db) return null;
  const [a] = await db
    .select()
    .from(assinaturasDigitais)
    .where(eq(assinaturasDigitais.tokenAssinatura, token))
    .limit(1);
  return a ?? null;
}

/**
 * Resolve user via sdk.authenticateRequest (mesmo padrão do tRPC context).
 * Devolve null em vez de lançar pra a rota tratar como 401 com JSON.
 */
async function resolverUser(req: Request): Promise<{ id: number } | null> {
  try {
    const user = await sdk.authenticateRequest(req);
    return user ? { id: user.id } : null;
  } catch {
    return null;
  }
}

export function registerAssinaturaPdfRoute(app: Express): void {
  /**
   * Operador: serve PDF pelo ID, exige sessão + mesmo escritório.
   * Usado pelo EditorPosicionamentoCampos.
   */
  app.get("/api/assinatura/pdf/:id", async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ erro: "ID inválido" });
    }
    const user = await resolverUser(req);
    if (!user) {
      return res.status(401).json({ erro: "Não autenticado" });
    }
    const esc = await getEscritorioPorUsuario(user.id);
    if (!esc) {
      return res.status(403).json({ erro: "Escritório não encontrado" });
    }
    const a = await carregarAssinaturaPorId(id);
    if (!a) {
      log.warn({ id, userId: user.id, escritorioId: esc.escritorio.id }, "PDF preview: assinatura não encontrada");
      return res.status(404).json({ erro: "Assinatura não encontrada" });
    }
    if (a.escritorioId !== esc.escritorio.id) {
      log.warn({ id, userId: user.id, escritorioReq: esc.escritorio.id, escritorioDoc: a.escritorioId }, "PDF preview: tentativa cross-tenant");
      return res.status(403).json({ erro: "Sem permissão" });
    }
    if (!a.documentoUrl) {
      log.warn({ id }, "PDF preview: assinatura sem documentoUrl");
      return res.status(404).json({ erro: "Documento não disponível" });
    }
    let filepath: string;
    try {
      filepath = resolverPathArquivo(a.documentoUrl);
    } catch {
      return res.status(400).json({ erro: "Path inválido no banco" });
    }
    if (!fs.existsSync(filepath)) {
      log.error({ id, documentoUrl: a.documentoUrl, filepath, cwd: process.cwd() }, "PDF preview: arquivo não existe no disco");
      return res.status(404).json({
        erro: "Arquivo do PDF não foi encontrado no disco",
        detalhe: `Path esperado: ${a.documentoUrl}. Pode ter sido perdido em deploy sem volume persistente.`,
      });
    }
    streamPdf(res, filepath, path.basename(filepath));
  });

  /**
   * Cliente: serve PDF pelo token, sem auth (token É a auth).
   * Usado pela tela /assinar/:token.
   */
  app.get("/api/assinatura/pdf/token/:token", async (req: Request, res: Response) => {
    const token = String(req.params.token);
    if (!token || token.length < 10) {
      return res.status(400).json({ erro: "Token inválido" });
    }
    const a = await carregarAssinaturaPorToken(token);
    if (!a) {
      return res.status(404).json({ erro: "Documento não encontrado" });
    }
    if (!a.documentoUrl) {
      return res.status(404).json({ erro: "Documento não disponível" });
    }
    let filepath: string;
    try {
      filepath = resolverPathArquivo(a.documentoUrl);
    } catch {
      return res.status(400).json({ erro: "Path inválido" });
    }
    if (!fs.existsSync(filepath)) {
      log.error({ tokenPrefix: token.slice(0, 8), documentoUrl: a.documentoUrl, filepath }, "PDF cliente: arquivo não existe");
      return res.status(404).json({ erro: "Arquivo do PDF não foi encontrado" });
    }
    streamPdf(res, filepath, path.basename(filepath));
  });
}

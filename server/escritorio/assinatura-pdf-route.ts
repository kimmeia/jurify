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
 *  - /uploads exige sessão + mesmo escritório desde 10/08. Quem assina é
 *    cliente do escritório, nunca teve login: pra ele o único caminho é a
 *    rota por token abaixo — o token no link É a credencial.
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
import { captureError } from "../_core/sentry";
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

/**
 * Nem todo documento mora no disco: o fluxo "URL do Documento" (Google Docs,
 * PDF de terceiro) grava endereço externo. Devolve a URL a redirecionar, ou
 * null quando o documento é arquivo interno.
 *
 * Esquema fechado em http(s) de propósito: `javascript:`/`data:` gravado no
 * cadastro viraria execução de script na aba do cliente, com o token da
 * assinatura na própria URL.
 */
function urlExternaSegura(documentoUrl: string): string | null {
  if (!/^https?:\/\//i.test(documentoUrl)) return null;
  try {
    const u = new URL(documentoUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    // Endereço completo do próprio sistema apontando pro /uploads é arquivo
    // interno — redirecionar pra lá devolveria o 401 que esta rota existe
    // pra evitar.
    if (u.pathname.startsWith("/uploads/")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Path de disco do documento, aceitando também a URL absoluta do próprio app. */
function caminhoInterno(documentoUrl: string): string | null {
  if (documentoUrl.startsWith("/uploads/")) return documentoUrl;
  try {
    const p = new URL(documentoUrl).pathname;
    return p.startsWith("/uploads/") ? p : null;
  } catch {
    return null;
  }
}

/**
 * Nome que o cliente vê ao salvar. O Chrome no Android não tem visualizador
 * embutido: mesmo com `inline` ele baixa, e o arquivo caía na pasta como
 * "1756389423911_a1b2c3d4.pdf" — ninguém reconhece o próprio contrato depois.
 * `titulo` é texto livre do operador: CR/LF em header derruba a resposta
 * (ERR_INVALID_CHAR), por isso o ASCII vai sanitizado e o acento viaja no
 * `filename*`.
 */
function cabecalhoNome(titulo: string | null | undefined, filepath: string): string {
  const ext = path.extname(filepath) || ".pdf";
  const base = String(titulo || "").trim() || path.basename(filepath, ext);
  const limpo = base.replace(/[\r\n"\\]/g, " ").slice(0, 80).trim() || "documento";
  const ascii = limpo
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 ._-]/g, "")
    .trim() || "documento";
  return `inline; filename="${ascii}${ext}"; filename*=UTF-8''${encodeURIComponent(limpo + ext)}`;
}

/** Content-Type pela extensão — o documento nem sempre é PDF (docx/imagem). */
const MIME_POR_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function streamPdf(res: Response, filepath: string, filename: string, titulo?: string | null): void {
  // Headers permissivos: pdfjs worker pode rodar em contexto cross-origin
  // virtual mesmo dentro do mesmo domínio. CORP cross-origin permite o
  // fetch. Content-Type explícito evita pdfjs rejeitar por sniffing.
  const mime = MIME_POR_EXT[path.extname(filepath).toLowerCase()] || "application/octet-stream";
  res.setHeader("Content-Type", mime);
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Cache-Control", "private, max-age=300");
  res.setHeader(
    "Content-Disposition",
    titulo ? cabecalhoNome(titulo, filepath) : `inline; filename="${filename}"`,
  );
  // sendFile em vez de createReadStream: implementa Range/206, ETag e
  // Last-Modified. O visualizador de PDF do iOS Safari pede faixas de bytes
  // antes de renderizar — com stream simples ele fica na tela branca.
  res.sendFile(filepath, { acceptRanges: true }, (err) => {
    if (err && !res.headersSent) {
      log.error({ filepath, err: (err as Error).message }, "Falha ao enviar arquivo");
      res.status(500).json({ erro: "Falha ao ler o arquivo" });
    }
  });
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
    // Documento cadastrado como link externo (Google Docs, PDF de terceiro)
    // não mora no disco: redireciona, que é o que o botão fazia antes de a
    // leitura passar por aqui.
    const externa = urlExternaSegura(a.documentoUrl);
    if (externa) {
      return res.redirect(302, externa);
    }
    const interno = caminhoInterno(a.documentoUrl);
    if (!interno) {
      log.warn({ tokenPrefix: token.slice(0, 8) }, "PDF cliente: documentoUrl não navegável");
      return res.status(400).json({ erro: "Endereço do documento é inválido" });
    }
    // Espelha a trava de tenancy do middleware de /uploads. Hoje nenhum
    // writer produz divergência — a checagem é o que garante que continue,
    // já que esta é a rota mais exposta do sistema (sem sessão).
    const marcador = interno.match(/escritorio_(\d+)/);
    if (marcador && Number(marcador[1]) !== a.escritorioId) {
      log.error(
        { tokenPrefix: token.slice(0, 8), escritorioDoPath: marcador[1], escritorioDoDoc: a.escritorioId },
        "PDF cliente: path de outro escritório",
      );
      return res.status(403).json({ erro: "Sem acesso a este arquivo" });
    }
    let filepath: string;
    try {
      filepath = resolverPathArquivo(interno);
    } catch {
      return res.status(400).json({ erro: "Path inválido" });
    }
    if (!fs.existsSync(filepath)) {
      log.error({ tokenPrefix: token.slice(0, 8), documentoUrl: a.documentoUrl, filepath }, "PDF cliente: arquivo não existe");
      // Sem isto o sumiço só aparece no stdout do Railway: quem sofre é o
      // cliente do escritório, e ninguém aqui fica sabendo.
      captureError(new Error("Documento de assinatura ausente no disco"), {
        kind: "assinatura-pdf-ausente",
        assinaturaId: a.id,
        escritorioId: a.escritorioId,
        documentoUrl: a.documentoUrl,
      });
      // Cliente abre em aba nova: JSON cru num celular é um beco sem saída.
      if (req.accepts("html")) {
        return res.status(404).type("html").send(
          `<!doctype html><meta charset="utf-8">` +
            `<meta name="viewport" content="width=device-width, initial-scale=1">` +
            `<div style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1.5rem;text-align:center;color:#0f172a">` +
            `<h1 style="font-size:1.1rem">Documento indisponível</h1>` +
            `<p style="font-size:.9rem;color:#475569;line-height:1.6">Não conseguimos abrir o arquivo desta assinatura. ` +
            `Entre em contato com o escritório para receber o documento novamente.</p></div>`,
        );
      }
      return res.status(404).json({ erro: "Arquivo do PDF não foi encontrado" });
    }
    streamPdf(res, filepath, path.basename(filepath), a.titulo);
  });
}

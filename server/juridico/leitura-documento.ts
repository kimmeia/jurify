/**
 * Leitura do CONTEÚDO dos documentos do cliente pro Agente Jurídico usar como
 * fatos na peça. Estratégia por tipo (barata primeiro, Vision só quando preciso):
 *   - PDF/DOCX/TXT com texto → extração direta (pdf-parse/mammoth), grátis.
 *   - Imagem (foto/print) → Vision no modelo do escritório.
 *   - PDF escaneado (sem texto) → Vision (Claude lê PDF nativo; OpenAI não —
 *     devolve nota pedindo Claude ou envio como imagem).
 *
 * `montarConteudoDocumentos` lê os arquivos selecionados e devolve o texto já
 * orçado (limite de chars) pra caber no prompt sem estourar tokens.
 */
import path from "path";
import { promises as fsp } from "fs";
import { and, eq, inArray } from "drizzle-orm";
import { clienteArquivos } from "../../drizzle/schema";
import { extrairTextoDocumento, particionarContexto } from "../_core/agente-doc-extracao";
import { transcreverDocumentoVision } from "./llm";
import { createLogger } from "../_core/logger";

const log = createLogger("juridico-leitura-doc");

const MAX_BYTES = 12 * 1024 * 1024; // 12 MB — evita payload gigante no Vision

const MIME_POR_EXT: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

export function mimeDoNome(nome: string): string {
  const ext = (nome.split(".").pop() || "").toLowerCase();
  return MIME_POR_EXT[ext] || "application/octet-stream";
}

/**
 * Fatia um texto longo (decisão/jurisprudência) em trechos pra virarem fontes
 * embeddáveis na base RAG. Tenta cortar em fim de frase/parágrafo pra não
 * partir no meio; usa sobreposição pra não perder contexto entre trechos.
 */
export function chunkTexto(texto: string, tamanho = 1200, overlap = 150): string[] {
  const limpo = String(texto || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!limpo) return [];
  if (limpo.length <= tamanho) return [limpo];
  const chunks: string[] = [];
  let i = 0;
  while (i < limpo.length) {
    let fim = Math.min(i + tamanho, limpo.length);
    if (fim < limpo.length) {
      const janela = limpo.slice(i, fim);
      const corte = Math.max(janela.lastIndexOf("\n"), janela.lastIndexOf(". "));
      if (corte > tamanho * 0.5) fim = i + corte + 1;
    }
    const trecho = limpo.slice(i, fim).trim();
    if (trecho) chunks.push(trecho);
    if (fim >= limpo.length) break;
    i = Math.max(fim - overlap, i + 1);
  }
  return chunks;
}

const ehImagem = (mime: string) => mime.startsWith("image/");
const ehTextoExtraivel = (mime: string) =>
  mime === "application/pdf" ||
  mime.startsWith("text/") ||
  mime === "application/json" ||
  mime.includes("wordprocessingml") ||
  mime === "application/msword";

/** Lê os bytes de uma url de upload: local (/uploads/...) ou HTTP. */
async function lerBytes(url: string): Promise<Buffer | null> {
  try {
    if (/^https?:\/\//i.test(url)) {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.length <= MAX_BYTES ? buf : null;
    }
    // Path local — resolve dentro de ./uploads (guarda contra path traversal).
    const base = path.resolve("./uploads");
    const rel = url.replace(/^\/?uploads\//, "");
    const full = path.resolve(base, rel);
    if (full !== base && !full.startsWith(base + path.sep)) return null;
    const buf = await fsp.readFile(full);
    return buf.length <= MAX_BYTES ? buf : null;
  } catch {
    return null;
  }
}

export interface ArquivoRef {
  nome: string;
  url: string;
}

export interface LeituraDocumento {
  nome: string;
  texto: string | null;
  via: "extracao" | "vision" | "erro";
  nota?: string;
}

/**
 * Lê o conteúdo de um BUFFER conforme o tipo: extração barata (PDF/DOCX/TXT)
 * ou Vision (imagem / PDF escaneado). Reutilizado tanto pra arquivo de cliente
 * quanto pra upload de decisão no admin.
 */
export async function lerConteudoBuffer(
  escritorioId: number,
  bytes: Buffer,
  nome: string,
  modelo: string,
): Promise<LeituraDocumento> {
  const mime = mimeDoNome(nome);
  if (!bytes || bytes.length === 0) return { nome, texto: null, via: "erro", nota: "arquivo vazio" };
  if (bytes.length > MAX_BYTES) return { nome, texto: null, via: "erro", nota: "arquivo grande demais" };

  if (ehTextoExtraivel(mime)) {
    const r = await extrairTextoDocumento(bytes, mime);
    if (r.texto) return { nome, texto: r.texto, via: "extracao" };
    if (mime === "application/pdf") {
      const v = await transcreverDocumentoVision(escritorioId, { modelo, base64: bytes.toString("base64"), mime, ehPdf: true });
      if (v.texto) return { nome, texto: v.texto, via: "vision" };
      return { nome, texto: null, via: "erro", nota: v.erro || "PDF escaneado sem leitura" };
    }
    return { nome, texto: null, via: "erro", nota: r.erro || "sem texto extraível" };
  }

  if (ehImagem(mime)) {
    const v = await transcreverDocumentoVision(escritorioId, { modelo, base64: bytes.toString("base64"), mime, ehPdf: false });
    if (v.texto) return { nome, texto: v.texto, via: "vision" };
    return { nome, texto: null, via: "erro", nota: v.erro || "não foi possível ler a imagem" };
  }

  return { nome, texto: null, via: "erro", nota: `tipo não suportado (${mime})` };
}

/** Lê o conteúdo de UM documento (por url): extração ou Vision. */
export async function lerConteudoDocumento(
  escritorioId: number,
  arq: ArquivoRef,
  modelo: string,
): Promise<LeituraDocumento> {
  const bytes = await lerBytes(arq.url);
  if (!bytes) return { nome: arq.nome, texto: null, via: "erro", nota: "arquivo não encontrado, grande demais ou inacessível" };
  return lerConteudoBuffer(escritorioId, bytes, arq.nome, modelo);
}

/**
 * Lê os documentos selecionados (por id, do cliente) e devolve o conteúdo
 * concatenado e orçado pra caber no prompt, além das notas de falha (pra UI/log).
 */
export async function montarConteudoDocumentos(
  db: any,
  escritorioId: number,
  contatoId: number,
  documentoIds: number[],
  modelo: string,
): Promise<{ texto: string; notas: string[] }> {
  if (!documentoIds.length) return { texto: "", notas: [] };
  const arquivos = await db
    .select({ id: clienteArquivos.id, nome: clienteArquivos.nome, url: clienteArquivos.url })
    .from(clienteArquivos)
    .where(
      and(
        eq(clienteArquivos.escritorioId, escritorioId),
        eq(clienteArquivos.contatoId, contatoId),
        inArray(clienteArquivos.id, documentoIds),
      ),
    );

  const lidos: LeituraDocumento[] = [];
  for (const a of arquivos) {
    lidos.push(await lerConteudoDocumento(escritorioId, { nome: a.nome, url: a.url }, modelo));
  }

  const comTexto = lidos.filter((l) => l.texto);
  const notas = lidos.filter((l) => !l.texto).map((l) => `${l.nome}: ${l.nota || "não lido"}`);
  if (comTexto.length) {
    log.info({ contatoId, lidos: comTexto.length, falhas: notas.length }, "[Jurídico] documentos lidos pro dossiê");
  }
  const texto = particionarContexto(
    comTexto.map((l) => ({ nome: l.nome, conteudo: l.texto })),
    12000,
    5000,
  );
  return { texto, notas };
}

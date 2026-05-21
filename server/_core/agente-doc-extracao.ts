/**
 * Extração de texto de documentos uploadados (PDF, DOCX, TXT, MD, CSV, JSON).
 *
 * Usada pelo agente IA pra transformar arquivos anexados em conhecimento
 * consultável. Sem isso, a IA só vê o NOME do arquivo no contexto, não o
 * conteúdo — o que faz o feature de "treinar agente" parecer quebrado.
 *
 * Tudo aqui é fire-and-forget: falha na extração loga mas não bloqueia
 * upload, e a UI mostra um indicador "texto não extraído" pro usuário
 * saber que o arquivo está anexado mas não está sendo usado.
 */

import { createLogger } from "./logger";

const log = createLogger("agente-doc-extracao");

export interface ExtracaoResultado {
  texto: string | null;
  erro: string | null;
}

/**
 * Extrai texto de um Buffer baseado no mimeType. Retorna { texto, erro }
 * — texto é null em caso de falha, erro descreve o motivo pra mostrar na UI.
 */
export async function extrairTextoDocumento(
  buffer: Buffer,
  mimeType: string,
): Promise<ExtracaoResultado> {
  if (!buffer || buffer.length === 0) {
    return { texto: null, erro: "Arquivo vazio" };
  }

  const mt = mimeType.toLowerCase().split(";")[0].trim();

  try {
    // Texto puro: ler direto como UTF-8
    if (
      mt === "text/plain" ||
      mt === "text/markdown" ||
      mt === "text/csv" ||
      mt === "application/json"
    ) {
      const texto = buffer.toString("utf-8").trim();
      return { texto: texto || null, erro: texto ? null : "Arquivo sem texto" };
    }

    // PDF: usa pdf-parse
    if (mt === "application/pdf") {
      const pdfParseModule = await import("pdf-parse");
      const pdfParse = (pdfParseModule as any).default || pdfParseModule;
      const data = await pdfParse(buffer);
      const texto = (data?.text || "").trim();
      if (!texto) return { texto: null, erro: "PDF sem texto extraível (possivelmente escaneado)" };
      return { texto, erro: null };
    }

    // DOCX: usa mammoth
    if (
      mt === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      mt === "application/msword"
    ) {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      const texto = (result?.value || "").trim();
      if (!texto) return { texto: null, erro: "DOCX sem texto extraível" };
      return { texto, erro: null };
    }

    return { texto: null, erro: `Tipo não suportado: ${mt}` };
  } catch (e: any) {
    log.warn({ err: e?.message, mt }, "Falha ao extrair texto do documento");
    return { texto: null, erro: `Falha na extração: ${String(e?.message || e).slice(0, 200)}` };
  }
}

/**
 * Particiona um conjunto de documentos pro contexto da IA com limite total
 * e limite por documento. Pra agentes com muitos docs, distribui o espaço
 * sem deixar um doc longo consumir tudo.
 *
 * @param docs lista de { nome, conteudo } — conteudo null/vazio é pulado
 * @param limiteTotal default 8000 chars (mantém custo de tokens controlado)
 * @param limitePorDoc default 3000 chars
 */
export function particionarContexto(
  docs: Array<{ nome: string; conteudo: string | null | undefined }>,
  limiteTotal: number = 8000,
  limitePorDoc: number = 3000,
): string {
  const validos = docs.filter((d) => d.conteudo && d.conteudo.trim().length > 0);
  if (validos.length === 0) return "";

  // Aloca espaço igualitário, mas respeitando que docs curtos liberam pros longos
  const cotaIdeal = Math.min(limitePorDoc, Math.floor(limiteTotal / validos.length));
  const partes: string[] = [];
  let usado = 0;

  for (const d of validos) {
    const restante = limiteTotal - usado;
    if (restante <= 0) break;
    const cota = Math.min(cotaIdeal, restante);
    const conteudo = d.conteudo!.trim();
    const truncado = conteudo.length <= cota
      ? conteudo
      : truncarPalavra(conteudo, cota);
    partes.push(`[${d.nome}]\n${truncado}`);
    usado += truncado.length + d.nome.length + 4;
  }

  return partes.join("\n\n");
}

/**
 * Trunca texto no limite de chars, mas tenta cortar no fim de palavra/frase
 * mais próximo pra não deixar resultado feio.
 */
export function truncarPalavra(texto: string, limite: number): string {
  if (texto.length <= limite) return texto;
  const corte = texto.slice(0, limite);
  // Tenta cortar no fim de frase
  const ultimaFrase = Math.max(
    corte.lastIndexOf(". "),
    corte.lastIndexOf("\n"),
  );
  if (ultimaFrase > limite * 0.7) {
    return corte.slice(0, ultimaFrase + 1).trim() + " […]";
  }
  // Fallback: corta na última palavra
  const ultimaPalavra = corte.lastIndexOf(" ");
  if (ultimaPalavra > limite * 0.5) {
    return corte.slice(0, ultimaPalavra).trim() + " […]";
  }
  return corte + "…";
}

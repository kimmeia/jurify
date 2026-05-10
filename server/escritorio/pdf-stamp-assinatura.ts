/**
 * Estampa assinatura manuscrita no PDF + adiciona página de certificação.
 *
 * Recebe PDF gerado pelo LibreOffice + imagem da assinatura capturada
 * no canvas signature_pad. Retorna PDF "assinado":
 *   1. Imagem da assinatura desenhada na última página do PDF original
 *      (heurística: centralizada, ~110pt de margem inferior — bate com
 *      template típico onde a linha "_____" fica no rodapé).
 *   2. Página final "CERTIFICADO DE ASSINATURA DIGITAL" (DocuSign-style)
 *      com nome, CPF, data/hora, IP, hash SHA-256 do doc original e a
 *      própria imagem da assinatura.
 *
 * Hash SHA-256: gera prova de integridade. Qualquer alteração futura
 * no PDF (re-render, edição) muda o hash, evidenciando adulteração.
 */

import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import crypto from "crypto";

export interface DadosAssinatura {
  pdfOriginal: Buffer;
  assinaturaImagem: Buffer;
  nomeCompleto: string;
  cpf?: string | null;
  ip?: string | null;
  assinadoAt: Date;
}

const MARGEM_INFERIOR_ASSINATURA_PT = 110;
const ASSINATURA_W = 180;
const ASSINATURA_H = 60;
const COR_CINZA_TEXTO = rgb(0.4, 0.4, 0.4);
const COR_CINZA_LINHA = rgb(0.6, 0.6, 0.6);
const COR_CINZA_FOOTER = rgb(0.5, 0.5, 0.5);

export async function estamparAssinatura(dados: DadosAssinatura): Promise<Buffer> {
  const pdfDoc = await PDFDocument.load(dados.pdfOriginal);
  const pngImage = await pdfDoc.embedPng(dados.assinaturaImagem);

  // 1. Estampa na última página do documento original
  const pages = pdfDoc.getPages();
  const lastPage = pages[pages.length - 1];
  const { width: pageW } = lastPage.getSize();
  lastPage.drawImage(pngImage, {
    x: (pageW - ASSINATURA_W) / 2,
    y: MARGEM_INFERIOR_ASSINATURA_PT,
    width: ASSINATURA_W,
    height: ASSINATURA_H,
  });

  // 2. Página de certificação ao final
  const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const cert = pdfDoc.addPage();
  const { height } = cert.getSize();
  let y = height - 60;

  cert.drawText("CERTIFICADO DE ASSINATURA DIGITAL", {
    x: 50,
    y,
    size: 16,
    font: helvBold,
  });
  y -= 40;

  cert.drawText("Documento assinado eletronicamente por:", {
    x: 50,
    y,
    size: 11,
    font: helv,
  });
  y -= 22;
  cert.drawText(dados.nomeCompleto, { x: 50, y, size: 13, font: helvBold });

  if (dados.cpf) {
    y -= 18;
    cert.drawText(`CPF: ${dados.cpf}`, { x: 50, y, size: 11, font: helv });
  }

  y -= 18;
  cert.drawText(
    `Data/hora: ${dados.assinadoAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
    { x: 50, y, size: 11, font: helv },
  );

  if (dados.ip) {
    y -= 18;
    cert.drawText(`Endereço IP: ${dados.ip}`, { x: 50, y, size: 11, font: helv });
  }

  // Hash SHA-256 do PDF ORIGINAL (sem a página de certificação ainda).
  // Quebra em 2 linhas pra caber na largura.
  const hash = crypto.createHash("sha256").update(dados.pdfOriginal).digest("hex");
  y -= 32;
  cert.drawText("Hash SHA-256 do documento original:", {
    x: 50,
    y,
    size: 9,
    font: helv,
    color: COR_CINZA_TEXTO,
  });
  y -= 14;
  cert.drawText(hash.slice(0, 32), {
    x: 50,
    y,
    size: 9,
    font: helv,
    color: COR_CINZA_TEXTO,
  });
  y -= 12;
  cert.drawText(hash.slice(32), {
    x: 50,
    y,
    size: 9,
    font: helv,
    color: COR_CINZA_TEXTO,
  });

  // Imagem da assinatura no certificado
  y -= 50;
  cert.drawImage(pngImage, {
    x: 50,
    y: y - 60,
    width: 200,
    height: 70,
  });
  cert.drawLine({
    start: { x: 50, y: y - 65 },
    end: { x: 250, y: y - 65 },
    thickness: 0.5,
    color: COR_CINZA_LINHA,
  });
  cert.drawText("Assinatura manuscrita capturada digitalmente", {
    x: 50,
    y: y - 78,
    size: 8,
    font: helv,
    color: COR_CINZA_FOOTER,
  });

  cert.drawText(
    "Documento assinado eletronicamente nos termos da Lei 14.063/2020.",
    {
      x: 50,
      y: 40,
      size: 8,
      font: helv,
      color: COR_CINZA_FOOTER,
    },
  );

  return Buffer.from(await pdfDoc.save());
}

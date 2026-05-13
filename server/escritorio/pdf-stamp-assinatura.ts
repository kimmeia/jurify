/**
 * Estampa assinatura no PDF + adiciona página de certificação.
 *
 * 2 modos:
 *
 *  A) LEGADO (campos undefined ou vazio): comportamento original.
 *     Estampa a imagem da assinatura centralizada na última página do
 *     PDF (~110pt de margem inferior — bate com template típico onde a
 *     linha "_____" fica no rodapé).
 *
 *  B) POSICIONAL (campos[] passado): operador definiu via editor visual
 *     onde cada campo cai. Pra cada campo, carimba na pagina/x/y/largura/
 *     altura:
 *       - ASSINATURA → drawImage do PNG
 *       - DATA       → drawText data formatada PT-BR
 *       - NOME       → drawText nome do signatário
 *       - CPF        → drawText CPF (se preenchido)
 *
 * EM AMBOS os modos: página de certificação "CERTIFICADO DE ASSINATURA
 * DIGITAL" é adicionada ao final, com nome, CPF, data/hora, IP, hash
 * SHA-256 do PDF original e a própria imagem da assinatura.
 *
 * Coordenadas: pdf-lib usa origem no canto INFERIOR ESQUERDO da página
 * (y cresce pra cima). Frontend converte de top-left antes de salvar.
 *
 * Hash SHA-256: gera prova de integridade. Qualquer alteração futura no
 * PDF (re-render, edição) muda o hash, evidenciando adulteração.
 */

import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import crypto from "crypto";

export type CampoTipo = "ASSINATURA" | "DATA" | "NOME" | "CPF";

export interface CampoPosicional {
  tipo: CampoTipo;
  /** Página 1-indexed (1 = primeira página) */
  pagina: number;
  /** Coordenadas em pontos PDF, origem bottom-left */
  x: number;
  y: number;
  largura: number;
  altura: number;
}

export interface DadosAssinatura {
  pdfOriginal: Buffer;
  assinaturaImagem: Buffer;
  nomeCompleto: string;
  cpf?: string | null;
  ip?: string | null;
  assinadoAt: Date;
  /**
   * Quando presente e não-vazio: usa fluxo posicional (carimba cada campo
   * na coord específica). Quando undefined/vazio: fluxo legado (centro
   * da última página).
   */
  campos?: CampoPosicional[];
}

const MARGEM_INFERIOR_ASSINATURA_PT = 110;
const ASSINATURA_W = 180;
const ASSINATURA_H = 60;
const COR_CINZA_TEXTO = rgb(0.4, 0.4, 0.4);
const COR_CINZA_LINHA = rgb(0.6, 0.6, 0.6);
const COR_CINZA_FOOTER = rgb(0.5, 0.5, 0.5);
const COR_PRETO = rgb(0.1, 0.1, 0.1);

export async function estamparAssinatura(dados: DadosAssinatura): Promise<Buffer> {
  const pdfDoc = await PDFDocument.load(dados.pdfOriginal);
  const pngImage = await pdfDoc.embedPng(dados.assinaturaImagem);
  const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pages = pdfDoc.getPages();

  const usarPosicional = !!dados.campos && dados.campos.length > 0;

  if (usarPosicional) {
    const dataFormatada = dados.assinadoAt.toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo",
    });
    for (const campo of dados.campos!) {
      // pagina 1-indexed → array 0-indexed
      const page = pages[campo.pagina - 1];
      if (!page) continue; // página inválida — ignora silenciosamente

      if (campo.tipo === "ASSINATURA") {
        page.drawImage(pngImage, {
          x: campo.x,
          y: campo.y,
          width: campo.largura,
          height: campo.altura,
        });
      } else {
        // Texto: DATA/NOME/CPF. Tamanho da fonte derivado da altura da
        // caixa (heurística: 70% da altura, cap em 14pt — texto cabe
        // numa única linha em caixas pequenas tipo "Data: ___").
        const fontSize = Math.min(14, Math.max(8, campo.altura * 0.7));
        let texto = "";
        if (campo.tipo === "DATA") texto = dataFormatada;
        else if (campo.tipo === "NOME") texto = dados.nomeCompleto;
        else if (campo.tipo === "CPF") texto = dados.cpf || "";

        if (texto) {
          // Posiciona o baseline do texto um pouco acima do bottom da
          // caixa pra parecer alinhado verticalmente.
          page.drawText(texto, {
            x: campo.x + 2,
            y: campo.y + (campo.altura - fontSize) / 2 + 1,
            size: fontSize,
            font: helv,
            color: COR_PRETO,
          });
        }
      }
    }
  } else {
    // Fluxo LEGADO: assinatura centralizada na última página
    const lastPage = pages[pages.length - 1];
    const { width: pageW } = lastPage.getSize();
    lastPage.drawImage(pngImage, {
      x: (pageW - ASSINATURA_W) / 2,
      y: MARGEM_INFERIOR_ASSINATURA_PT,
      width: ASSINATURA_W,
      height: ASSINATURA_H,
    });
  }

  // Página de certificação ao final (ambos os modos)
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

  // Hash SHA-256 do PDF ORIGINAL (sem carimbo nem certificação).
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

/**
 * Exportação de Parecer Técnico em PDF v3
 * 
 * Converte o parecer (Markdown) para PDF usando PDFKit (Node.js puro).
 * v3: Corrigido alinhamento (sempre usa margem esquerda explícita),
 *     eliminadas páginas em branco, melhor enquadramento de tabelas.
 */

import PDFDocument from "pdfkit";

// ─── Cores e Estilos ───────────────────────────────────────────────────────────

const COLORS = {
  primary: "#1e40af",
  dark: "#0f172a",
  text: "#1a1a2e",
  muted: "#475569",
  light: "#f1f5f9",
  border: "#cbd5e1",
  tableBg: "#f8fafc",
  white: "#ffffff",
};

const FONTS = {
  regular: "Helvetica",
  bold: "Helvetica-Bold",
  italic: "Helvetica-Oblique",
  boldItalic: "Helvetica-BoldOblique",
};

// ─── Parser Markdown Simples ───────────────────────────────────────────────────

interface ParsedLine {
  type: "h1" | "h2" | "h3" | "p" | "hr" | "table-header" | "table-row" | "table-sep" | "li" | "blockquote" | "empty";
  text: string;
  cells?: string[];
}

function parseMarkdownLines(markdown: string): ParsedLine[] {
  const lines = markdown.split("\n");
  const parsed: ParsedLine[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      parsed.push({ type: "empty", text: "" });
    } else if (trimmed.startsWith("### ")) {
      parsed.push({ type: "h3", text: trimmed.slice(4) });
    } else if (trimmed.startsWith("## ")) {
      parsed.push({ type: "h2", text: trimmed.slice(3) });
    } else if (trimmed.startsWith("# ")) {
      parsed.push({ type: "h1", text: trimmed.slice(2) });
    } else if (trimmed === "---" || trimmed === "***" || trimmed === "___") {
      parsed.push({ type: "hr", text: "" });
    } else if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const cells = trimmed.split("|").slice(1, -1).map(c => c.trim());
      if (cells.every(c => /^[-:]+$/.test(c))) {
        parsed.push({ type: "table-sep", text: "", cells });
      } else {
        const prev = parsed[parsed.length - 1];
        if (!prev || (prev.type !== "table-header" && prev.type !== "table-row" && prev.type !== "table-sep")) {
          parsed.push({ type: "table-header", text: "", cells });
        } else {
          parsed.push({ type: "table-row", text: "", cells });
        }
      }
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || /^\d+\.\s/.test(trimmed)) {
      const text = trimmed.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "");
      parsed.push({ type: "li", text });
    } else if (trimmed.startsWith("> ")) {
      parsed.push({ type: "blockquote", text: trimmed.slice(2) });
    } else {
      parsed.push({ type: "p", text: trimmed });
    }
  }

  return parsed;
}

// ─── Renderizar texto com **bold** e *italic* inline ───────────────────────────

function renderRichText(doc: InstanceType<typeof PDFDocument>, text: string, options: {
  fontSize?: number; color?: string; align?: "left" | "center" | "right" | "justify";
  x?: number; width?: number;
} = {}) {
  const { fontSize = 10, color = COLORS.text, align = "left" } = options;
  const leftMargin = doc.page.margins.left;
  const x = options.x ?? leftMargin;
  const width = options.width ?? (doc.page.width - doc.page.margins.left - doc.page.margins.right);

  const segments: { text: string; bold: boolean; italic: boolean }[] = [];
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), bold: false, italic: false });
    }
    if (match[2]) {
      segments.push({ text: match[2], bold: true, italic: false });
    } else if (match[3]) {
      segments.push({ text: match[3], bold: false, italic: true });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), bold: false, italic: false });
  }

  if (segments.length === 0) {
    segments.push({ text, bold: false, italic: false });
  }

  // Always use explicit x position to prevent drift
  if (segments.length === 1) {
    const seg = segments[0];
    const font = seg.bold ? FONTS.bold : seg.italic ? FONTS.italic : FONTS.regular;
    doc.font(font).fontSize(fontSize).fillColor(color);
    doc.text(seg.text, x, doc.y, { width, align, continued: false });
    return;
  }

  const currentY = doc.y;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const font = seg.bold ? FONTS.bold : seg.italic ? FONTS.italic : FONTS.regular;
    const isLast = i === segments.length - 1;
    doc.font(font).fontSize(fontSize).fillColor(color);
    if (i === 0) {
      doc.text(seg.text, x, currentY, { width, align, continued: !isLast });
    } else {
      doc.text(seg.text, { width, align, continued: !isLast });
    }
  }
}

// ─── Verificar necessidade de nova página ──────────────────────────────────────

function ensureSpace(doc: InstanceType<typeof PDFDocument>, needed: number) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + needed > bottom) {
    doc.addPage();
  }
}

// ─── Resetar posição X para margem esquerda ────────────────────────────────────

function resetX(doc: InstanceType<typeof PDFDocument>) {
  doc.x = doc.page.margins.left;
}

// ─── Calcular larguras de coluna proporcionais ────────────────────────────────

function calculateColumnWidths(
  doc: InstanceType<typeof PDFDocument>,
  headers: string[],
  rows: string[][],
  totalWidth: number,
  fontSize: number
): number[] {
  const colCount = headers.length;
  
  const maxWidths: number[] = [];
  for (let c = 0; c < colCount; c++) {
    let maxW = doc.font(FONTS.bold).fontSize(fontSize).widthOfString(headers[c].replace(/\*\*/g, "")) + 16;
    for (const row of rows) {
      const cellText = (row[c] || "").replace(/\*\*/g, "");
      const w = doc.font(FONTS.regular).fontSize(fontSize).widthOfString(cellText) + 16;
      if (w > maxW) maxW = w;
    }
    maxWidths.push(maxW);
  }

  const totalNeeded = maxWidths.reduce((s, w) => s + w, 0);

  if (totalNeeded <= totalWidth) {
    const extra = totalWidth - totalNeeded;
    return maxWidths.map(w => w + (extra * w / totalNeeded));
  }

  const minWidth = 45;
  return maxWidths.map(w => Math.max(minWidth, (w / totalNeeded) * totalWidth));
}

// ─── Medir altura de célula com word-wrap ──────────────────────────────────────

function measureCellHeight(
  doc: InstanceType<typeof PDFDocument>,
  text: string,
  width: number,
  fontSize: number,
  font: string
): number {
  const cleanText = text.replace(/\*\*/g, "");
  doc.font(font).fontSize(fontSize);
  return doc.heightOfString(cleanText, { width: Math.max(width - 12, 20) });
}

// ─── Renderizar Tabela v3 ─────────────────────────────────────────────────────

function renderTable(doc: InstanceType<typeof PDFDocument>, headers: string[], rows: string[][]) {
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const fontSize = 8.5;
  const cellPadding = 6;
  const startX = doc.page.margins.left;

  const colWidths = calculateColumnWidths(doc, headers, rows, pageWidth, fontSize);

  // Header Row
  let headerHeight = 22;
  for (let c = 0; c < headers.length; c++) {
    const h = measureCellHeight(doc, headers[c], colWidths[c], fontSize, FONTS.bold) + 12;
    if (h > headerHeight) headerHeight = h;
  }

  ensureSpace(doc, headerHeight + 10);
  const headerY = doc.y;

  doc.rect(startX, headerY, pageWidth, headerHeight).fill(COLORS.primary);

  let xPos = startX;
  for (let c = 0; c < headers.length; c++) {
    const cleanHeader = headers[c].replace(/\*\*/g, "");
    doc.font(FONTS.bold).fontSize(fontSize).fillColor(COLORS.white);
    doc.text(cleanHeader, xPos + cellPadding, headerY + 6, {
      width: colWidths[c] - cellPadding * 2,
      align: "left",
    });
    xPos += colWidths[c];
  }
  doc.y = headerY + headerHeight;

  // Data Rows
  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];

    let rowHeight = 22;
    for (let c = 0; c < row.length; c++) {
      const cellText = row[c] || "";
      const isBold = cellText.startsWith("**") && cellText.endsWith("**");
      const font = isBold ? FONTS.bold : FONTS.regular;
      const h = measureCellHeight(doc, cellText, colWidths[c] || 80, fontSize, font) + 12;
      if (h > rowHeight) rowHeight = h;
    }

    ensureSpace(doc, rowHeight + 2);
    const rowY = doc.y;

    if (rowIdx % 2 === 0) {
      doc.rect(startX, rowY, pageWidth, rowHeight).fill(COLORS.tableBg);
    }

    doc.moveTo(startX, rowY + rowHeight)
      .lineTo(startX + pageWidth, rowY + rowHeight)
      .strokeColor(COLORS.border).lineWidth(0.5).stroke();

    xPos = startX;
    for (let c = 0; c < row.length; c++) {
      const cellText = row[c] || "";
      const cleanCell = cellText.replace(/\*\*/g, "");
      const isBold = cellText.startsWith("**") && cellText.endsWith("**");
      doc.font(isBold ? FONTS.bold : FONTS.regular).fontSize(fontSize).fillColor(COLORS.text);
      doc.text(cleanCell, xPos + cellPadding, rowY + 6, {
        width: (colWidths[c] || 80) - cellPadding * 2,
        align: "left",
      });
      xPos += colWidths[c] || 80;
    }
    doc.y = rowY + rowHeight;
  }

  doc.y += 8;
  // Reset X after table to prevent drift
  resetX(doc);
}

// ─── Gerador Principal ────────────────────────────────────────────────────────

export async function gerarPDF(parecerMarkdown: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margins: { top: 55, bottom: 55, left: 50, right: 50 },
        info: {
          Title: "Parecer Técnico — Revisão de Financiamento Bancário",
          Author: "SaaS de Cálculos Jurídicos",
          Creator: "SaaS de Cálculos",
        },
        bufferPages: true,
      });

      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const parsed = parseMarkdownLines(parecerMarkdown);
      const leftMargin = doc.page.margins.left;
      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

      // Collect table data
      let tableHeaders: string[] | null = null;
      let tableRows: string[][] = [];

      const flushTable = () => {
        if (tableHeaders && tableRows.length > 0) {
          renderTable(doc, tableHeaders, tableRows);
        }
        tableHeaders = null;
        tableRows = [];
      };

      for (let i = 0; i < parsed.length; i++) {
        const line = parsed[i];

        if (line.type !== "table-header" && line.type !== "table-row" && line.type !== "table-sep") {
          flushTable();
        }

        // Always reset X before rendering non-table content
        if (line.type !== "table-header" && line.type !== "table-row" && line.type !== "table-sep") {
          resetX(doc);
        }

        switch (line.type) {
          case "h1":
            ensureSpace(doc, 50);
            doc.y += 6;
            doc.font(FONTS.bold).fontSize(15).fillColor(COLORS.dark);
            doc.text(line.text.replace(/\*\*/g, ""), leftMargin, doc.y, { align: "center", width: pageWidth });
            doc.y += 4;
            doc.moveTo(leftMargin, doc.y).lineTo(leftMargin + pageWidth, doc.y)
              .strokeColor(COLORS.primary).lineWidth(2.5).stroke();
            doc.y += 10;
            break;

          case "h2":
            ensureSpace(doc, 35);
            doc.y += 12;
            doc.font(FONTS.bold).fontSize(11.5).fillColor(COLORS.primary);
            doc.text(line.text.replace(/\*\*/g, ""), leftMargin, doc.y, { width: pageWidth });
            doc.y += 2;
            doc.moveTo(leftMargin, doc.y).lineTo(leftMargin + pageWidth, doc.y)
              .strokeColor(COLORS.border).lineWidth(0.5).stroke();
            doc.y += 6;
            break;

          case "h3":
            ensureSpace(doc, 28);
            doc.y += 6;
            doc.font(FONTS.bold).fontSize(10).fillColor(COLORS.dark);
            doc.text(line.text.replace(/\*\*/g, ""), leftMargin, doc.y, { width: pageWidth });
            doc.y += 3;
            break;

          case "p":
            ensureSpace(doc, 18);
            renderRichText(doc, line.text, { fontSize: 9.5, align: "justify", x: leftMargin, width: pageWidth });
            doc.y += 3;
            break;

          case "li":
            ensureSpace(doc, 16);
            {
              const liY = doc.y;
              doc.font(FONTS.regular).fontSize(9.5).fillColor(COLORS.text);
              doc.text("•", leftMargin, liY, { width: 12, continued: false });
              doc.y = liY;
              renderRichText(doc, line.text, { fontSize: 9.5, x: leftMargin + 14, width: pageWidth - 14 });
              doc.y += 2;
            }
            break;

          case "blockquote":
            ensureSpace(doc, 28);
            {
              const bqWidth = pageWidth - 16;
              doc.y += 3;
              const bqStartY = doc.y;
              doc.font(FONTS.italic).fontSize(9).fillColor(COLORS.muted);
              const bqTextHeight = doc.heightOfString(line.text, { width: bqWidth - 10 });
              const bqBoxHeight = Math.max(bqTextHeight + 10, 22);
              doc.rect(leftMargin + 4, bqStartY, bqWidth + 8, bqBoxHeight).fill(COLORS.light);
              doc.rect(leftMargin, bqStartY, 3, bqBoxHeight).fill(COLORS.primary);
              doc.font(FONTS.italic).fontSize(9).fillColor(COLORS.muted);
              doc.text(line.text, leftMargin + 12, bqStartY + 5, { width: bqWidth - 10 });
              doc.y = bqStartY + bqBoxHeight + 3;
            }
            break;

          case "hr":
            doc.y += 8;
            doc.moveTo(leftMargin, doc.y).lineTo(leftMargin + pageWidth, doc.y)
              .strokeColor(COLORS.border).lineWidth(0.5).stroke();
            doc.y += 8;
            break;

          case "table-header":
            tableHeaders = line.cells || [];
            break;

          case "table-sep":
            break;

          case "table-row":
            if (tableHeaders) {
              tableRows.push(line.cells || []);
            }
            break;

          case "empty":
            doc.y += 3;
            break;
        }
      }

      flushTable();

      // Page numbers — use low-level page access to avoid creating new pages
      const range = doc.bufferedPageRange();
      const pageCount = range.count;
      for (let i = 0; i < pageCount; i++) {
        doc.switchToPage(i);
        const savedY = doc.y;
        const savedX = doc.x;
        doc.font(FONTS.regular).fontSize(7.5).fillColor(COLORS.muted);
        const numText = `Página ${i + 1} de ${pageCount}`;
        const textWidth = doc.widthOfString(numText);
        const numX = leftMargin + (pageWidth - textWidth) / 2;
        const numY = doc.page.height - 35;
        // Use _fragment to write text without advancing cursor or creating pages
        if (typeof (doc as any)._fragment === 'function') {
          (doc as any)._fragment(numText, numX, numY, {});
        } else {
          // Fallback: position text carefully
          doc.text(numText, numX, numY, { lineBreak: false });
        }
        doc.y = savedY;
        doc.x = savedX;
      }

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Gera PDF do demonstrativo comparativo (tabela formatada)
 */
export async function gerarPDFDemonstrativo(
  parecerMarkdown: string,
  demonstrativoOriginalHtml: string,
  demonstrativoRecalculadoHtml: string
): Promise<Buffer> {
  const fullMarkdown = parecerMarkdown + "\n\n---\n\n" +
    "## ANEXO — DEMONSTRATIVO ORIGINAL\n\n" + demonstrativoOriginalHtml +
    "\n\n## ANEXO — DEMONSTRATIVO RECALCULADO (GAUSS)\n\n" + demonstrativoRecalculadoHtml;

  return gerarPDF(fullMarkdown);
}

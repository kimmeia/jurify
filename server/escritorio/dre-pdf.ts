/**
 * Gera DRE em PDF usando pdfkit. Layout simples e legível: cabeçalho,
 * tabela de receitas/despesas por categoria, resultado e margem.
 *
 * Retorna Buffer (compatível com Express res.send) ou base64 (UI tRPC).
 */

import PDFDocument from "pdfkit";
import type { DREResultado } from "./dre";

const COLORS = {
  primary: "#1e40af",
  dark: "#0f172a",
  muted: "#475569",
  border: "#cbd5e1",
  tableBg: "#f8fafc",
  receitaAccent: "#059669",
  despesaAccent: "#dc2626",
  resultadoPositivo: "#059669",
  resultadoNegativo: "#dc2626",
} as const;

function formatBRL(n: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(n);
}

function formatData(iso: string): string {
  return iso.split("-").reverse().join("/");
}

/**
 * Gera o DRE como Buffer PDF. nomeEscritorio pra cabeçalho.
 */
export async function gerarDREPDF(
  dre: DREResultado,
  nomeEscritorio: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 50,
        info: {
          Title: `DRE — ${nomeEscritorio}`,
          Author: "Jurify",
          Creator: "Jurify",
        },
      });

      const chunks: Buffer[] = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const left = doc.page.margins.left;
      const right = doc.page.width - doc.page.margins.right;
      const usableWidth = right - left;

      // ─── Cabeçalho ────────────────────────────────────────────────────────
      doc.fontSize(18).fillColor(COLORS.dark).font("Helvetica-Bold");
      doc.text("Demonstrativo de Resultado (DRE)", left, doc.y);
      doc.moveDown(0.3);
      doc.fontSize(11).fillColor(COLORS.muted).font("Helvetica");
      doc.text(nomeEscritorio);
      doc.moveDown(0.2);
      doc.text(
        `Período: ${formatData(dre.periodo.inicio)} a ${formatData(dre.periodo.fim)}`,
      );
      doc.moveDown(0.2);
      doc.fontSize(9).text(
        `Emitido em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
      );
      doc.moveDown(0.8);

      // Linha separadora
      doc
        .strokeColor(COLORS.border)
        .lineWidth(1)
        .moveTo(left, doc.y)
        .lineTo(right, doc.y)
        .stroke();
      doc.moveDown(0.6);

      // ─── Função helper pra renderizar uma seção (Receitas/Despesas) ───────
      const renderSecao = (
        titulo: string,
        accent: string,
        categorias: DREResultado["receitas"]["porCategoria"],
        total: number,
      ) => {
        doc.fillColor(accent).font("Helvetica-Bold").fontSize(13);
        doc.text(titulo, left, doc.y);
        doc.moveDown(0.3);

        // Cabeçalho da tabela
        const yStart = doc.y;
        const colCategoria = left;
        const colCount = left + usableWidth * 0.55;
        const colPercent = left + usableWidth * 0.7;
        const colValor = left + usableWidth * 0.85;

        doc.fontSize(9).fillColor(COLORS.muted).font("Helvetica-Bold");
        doc.text("Categoria", colCategoria, yStart);
        doc.text("Qtd", colCount, yStart, { width: 50, align: "right" });
        doc.text("% seção", colPercent, yStart, { width: 50, align: "right" });
        doc.text("Total", colValor, yStart, {
          width: right - colValor,
          align: "right",
        });
        doc.moveDown(0.4);

        // Linha separadora fina
        doc
          .strokeColor(COLORS.border)
          .lineWidth(0.5)
          .moveTo(left, doc.y)
          .lineTo(right, doc.y)
          .stroke();
        doc.moveDown(0.2);

        // Linhas
        doc.font("Helvetica").fontSize(10).fillColor(COLORS.dark);
        if (categorias.length === 0) {
          doc.fillColor(COLORS.muted).font("Helvetica-Oblique");
          doc.text("Sem lançamentos no período.", colCategoria, doc.y);
          doc.font("Helvetica").fillColor(COLORS.dark);
        } else {
          for (const cat of categorias) {
            const y = doc.y;
            doc.text(cat.categoriaNome, colCategoria, y, {
              width: colCount - colCategoria - 5,
              ellipsis: true,
            });
            doc.text(String(cat.count), colCount, y, {
              width: 50,
              align: "right",
            });
            doc.text(`${cat.percentual.toFixed(1)}%`, colPercent, y, {
              width: 50,
              align: "right",
            });
            doc.text(formatBRL(cat.total), colValor, y, {
              width: right - colValor,
              align: "right",
            });
            doc.moveDown(0.5);

            // Quebra de página preventiva
            if (doc.y > doc.page.height - 100) {
              doc.addPage();
            }
          }
        }

        doc.moveDown(0.2);
        // Linha de total
        doc
          .strokeColor(COLORS.border)
          .lineWidth(0.5)
          .moveTo(left, doc.y)
          .lineTo(right, doc.y)
          .stroke();
        doc.moveDown(0.2);

        const yTotal = doc.y;
        doc.font("Helvetica-Bold").fontSize(10).fillColor(accent);
        doc.text(`Total ${titulo}`, colCategoria, yTotal);
        doc.text(formatBRL(total), colValor, yTotal, {
          width: right - colValor,
          align: "right",
        });
        doc.moveDown(1.0);
      };

      renderSecao(
        "Receitas",
        COLORS.receitaAccent,
        dre.receitas.porCategoria,
        dre.receitas.total,
      );
      renderSecao(
        "Despesas",
        COLORS.despesaAccent,
        dre.despesas.porCategoria,
        dre.despesas.total,
      );

      // ─── Resultado e Margem ───────────────────────────────────────────────
      doc
        .strokeColor(COLORS.border)
        .lineWidth(1)
        .moveTo(left, doc.y)
        .lineTo(right, doc.y)
        .stroke();
      doc.moveDown(0.5);

      const corResultado =
        dre.resultadoLiquido >= 0
          ? COLORS.resultadoPositivo
          : COLORS.resultadoNegativo;

      doc.fontSize(14).font("Helvetica-Bold").fillColor(COLORS.dark);
      doc.text("Resultado Líquido", left, doc.y, { continued: true });
      doc.fillColor(corResultado).text(
        `  ${formatBRL(dre.resultadoLiquido)}`,
        { align: "right" },
      );
      doc.moveDown(0.4);

      const margemTexto = isNaN(dre.margemPercent)
        ? "—"
        : `${dre.margemPercent.toFixed(1)}%`;
      doc.fontSize(10).font("Helvetica").fillColor(COLORS.muted);
      doc.text("Margem líquida", left, doc.y, { continued: true });
      doc.fillColor(corResultado).font("Helvetica-Bold").text(
        `  ${margemTexto}`,
        { align: "right" },
      );

      doc.moveDown(1.5);
      doc.fontSize(8).fillColor(COLORS.muted).font("Helvetica-Oblique");
      doc.text(
        "Receitas: cobranças pagas (status RECEIVED/CONFIRMED/RECEIVED_IN_CASH) no período. " +
          "Despesas: pagamentos efetuados no período (total ou parcial). " +
          "Categorias sem nome aparecem como '(sem categoria)'.",
        { align: "left" },
      );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

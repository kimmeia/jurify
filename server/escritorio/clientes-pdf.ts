/**
 * Gera o "Relatório de Clientes" (aba Clientes do Financeiro) em PDF via pdfkit.
 * Layout retrato A4: cabeçalho, filtros aplicados, KPIs de soma, tabela paginada
 * (mesmas colunas/cores da tela) e linha de totais.
 *
 * Recebe a lista JÁ filtrada/ordenada (mesma lógica de shared/clientes-filtro),
 * então o PDF é fiel ao recorte exibido na tela.
 */

import PDFDocument from "pdfkit";

const COLORS = {
  dark: "#0f172a",
  muted: "#64748b",
  border: "#cbd5e1",
  borderLight: "#e2e8f0",
  blue: "#1e40af",
  amber: "#d97706",
  red: "#dc2626",
  green: "#059669",
  zebra: "#f8fafc",
} as const;

export type ClienteLinhaPDF = {
  contatoNome: string;
  cpfCnpj: string;
  contatoTelefone: string | null;
  contatoEmail: string | null;
  totalCobrancas: number;
  pendente: number;
  vencido: number;
  pago: number;
  diasAtrasoMax: number | null;
};

export type ClientesPDFMeta = {
  nomeEscritorio: string;
  /** Linhas descritivas do recorte (chip, atraso, ordenação, busca). */
  filtros: string[];
  /** Quem gerou (email/nome) — pra auditoria no rodapé do cabeçalho. */
  geradoPor: string;
};

function formatBRL(n: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(n);
}

function soDigitos(s: string): string {
  return (s || "").replace(/\D/g, "");
}

function formatCpfCnpj(raw: string): string {
  const d = soDigitos(raw);
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return raw || "—";
}

function formatTelefone(raw: string): string {
  const d = soDigitos(raw);
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  return raw;
}

function contatoDisplay(tel: string | null, email: string | null): string {
  if (tel && soDigitos(tel).length >= 10) return formatTelefone(tel);
  if (tel) return tel;
  if (email) return email;
  return "—";
}

export async function gerarClientesPDF(
  clientes: ClienteLinhaPDF[],
  meta: ClientesPDFMeta,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 36,
        bufferPages: true,
        info: {
          Title: `Relatório de Clientes — ${meta.nomeEscritorio}`,
          Author: "JuridFlow",
          Creator: "JuridFlow",
        },
      });

      const chunks: Buffer[] = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const left = doc.page.margins.left;
      const right = doc.page.width - doc.page.margins.right;
      const usable = right - left;

      // Totais do recorte
      const totalPend = clientes.reduce((s, c) => s + (c.pendente || 0), 0);
      const totalVenc = clientes.reduce((s, c) => s + (c.vencido || 0), 0);
      const totalPago = clientes.reduce((s, c) => s + (c.pago || 0), 0);
      const totalCobr = clientes.reduce((s, c) => s + (c.totalCobrancas || 0), 0);

      // ─── Cabeçalho ────────────────────────────────────────────────────────
      const topY = doc.page.margins.top;
      const agora = new Date().toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        dateStyle: "short",
        timeStyle: "short",
      });
      doc.fontSize(11).font("Helvetica-Bold").fillColor(COLORS.blue);
      doc.text(meta.nomeEscritorio, left, topY, { width: usable * 0.6 });
      doc.fontSize(8).font("Helvetica").fillColor(COLORS.muted);
      doc.text(`Emitido em ${agora}`, left + usable * 0.6, topY, {
        width: usable * 0.4,
        align: "right",
      });
      doc.text(`por ${meta.geradoPor}`, left + usable * 0.6, topY + 11, {
        width: usable * 0.4,
        align: "right",
      });

      doc.y = topY + 26;
      doc.fontSize(19).font("Helvetica-Bold").fillColor(COLORS.dark);
      doc.text("Relatório de Clientes", left, doc.y);
      doc.moveDown(0.12);
      doc.fontSize(9).font("Helvetica").fillColor(COLORS.muted);
      doc.text("Posição financeira por cliente — módulo Financeiro", left, doc.y);
      doc.moveDown(0.5);

      doc
        .strokeColor(COLORS.border)
        .lineWidth(1)
        .moveTo(left, doc.y)
        .lineTo(right, doc.y)
        .stroke();
      doc.moveDown(0.5);

      // ─── Filtros aplicados ────────────────────────────────────────────────
      doc.fontSize(8).font("Helvetica-Bold").fillColor(COLORS.muted);
      doc.text("FILTROS APLICADOS", left, doc.y);
      doc.moveDown(0.12);
      doc.fontSize(9).font("Helvetica").fillColor(COLORS.dark);
      doc.text(meta.filtros.join("   ·   "), left, doc.y, { width: usable });
      doc.moveDown(0.6);

      // ─── KPIs ─────────────────────────────────────────────────────────────
      const kpiGap = 8;
      const kpiW = (usable - kpiGap * 3) / 4;
      const kpiH = 38;
      const kpiY = doc.y;
      const kpis: { lab: string; val: string; color: string }[] = [
        { lab: "CLIENTES", val: String(clientes.length), color: COLORS.dark },
        { lab: "TOTAL PENDENTE", val: formatBRL(totalPend), color: COLORS.amber },
        { lab: "TOTAL VENCIDO", val: formatBRL(totalVenc), color: COLORS.red },
        { lab: "TOTAL PAGO", val: formatBRL(totalPago), color: COLORS.green },
      ];
      kpis.forEach((k, i) => {
        const x = left + i * (kpiW + kpiGap);
        doc
          .roundedRect(x, kpiY, kpiW, kpiH, 4)
          .lineWidth(0.8)
          .strokeColor(COLORS.borderLight)
          .stroke();
        doc.fontSize(7).font("Helvetica-Bold").fillColor(COLORS.muted);
        doc.text(k.lab, x + 8, kpiY + 7, { width: kpiW - 16, lineBreak: false });
        doc.fontSize(13).font("Helvetica-Bold").fillColor(k.color);
        doc.text(k.val, x + 8, kpiY + 18, {
          width: kpiW - 16,
          lineBreak: false,
          ellipsis: true,
        });
      });
      doc.y = kpiY + kpiH + 14;

      // ─── Tabela ───────────────────────────────────────────────────────────
      const cols = {
        nome: { x: left, w: usable * 0.25 },
        doc: { x: left + usable * 0.25, w: usable * 0.14 },
        contato: { x: left + usable * 0.39, w: usable * 0.15 },
        cobr: { x: left + usable * 0.54, w: usable * 0.07 },
        pend: { x: left + usable * 0.61, w: usable * 0.1 },
        venc: { x: left + usable * 0.71, w: usable * 0.1 },
        pago: { x: left + usable * 0.81, w: usable * 0.1 },
        atraso: { x: left + usable * 0.91, w: usable * 0.09 },
      };
      const ROW_H = 15;
      const bottomLimit = doc.page.height - doc.page.margins.bottom - 24;

      const drawHeader = (y: number): number => {
        doc.fontSize(7).font("Helvetica-Bold").fillColor(COLORS.muted);
        doc.text("NOME", cols.nome.x, y, { width: cols.nome.w, lineBreak: false });
        doc.text("CPF/CNPJ", cols.doc.x, y, { width: cols.doc.w, lineBreak: false });
        doc.text("CONTATO", cols.contato.x, y, { width: cols.contato.w, lineBreak: false });
        doc.text("COBR.", cols.cobr.x, y, { width: cols.cobr.w, align: "center", lineBreak: false });
        doc.text("PENDENTE", cols.pend.x, y, { width: cols.pend.w, align: "right", lineBreak: false });
        doc.text("VENCIDO", cols.venc.x, y, { width: cols.venc.w, align: "right", lineBreak: false });
        doc.text("PAGO", cols.pago.x, y, { width: cols.pago.w, align: "right", lineBreak: false });
        doc.text("ATRASO", cols.atraso.x, y, { width: cols.atraso.w, align: "right", lineBreak: false });
        const yLine = y + 11;
        doc
          .strokeColor(COLORS.border)
          .lineWidth(1)
          .moveTo(left, yLine)
          .lineTo(right, yLine)
          .stroke();
        return yLine + 4;
      };

      const drawRow = (c: ClienteLinhaPDF, y: number, zebra: boolean) => {
        if (zebra) {
          doc.rect(left, y - 2, usable, ROW_H).fill(COLORS.zebra);
        }
        doc.font("Helvetica").fontSize(8).fillColor(COLORS.dark);
        doc.text(c.contatoNome || "—", cols.nome.x, y, {
          width: cols.nome.w - 4,
          ellipsis: true,
          lineBreak: false,
        });
        doc.fontSize(7.5).fillColor(COLORS.muted);
        doc.text(formatCpfCnpj(c.cpfCnpj), cols.doc.x, y, {
          width: cols.doc.w - 4,
          ellipsis: true,
          lineBreak: false,
        });
        doc.text(contatoDisplay(c.contatoTelefone, c.contatoEmail), cols.contato.x, y, {
          width: cols.contato.w - 4,
          ellipsis: true,
          lineBreak: false,
        });
        doc.fontSize(8).fillColor(COLORS.dark);
        doc.text(String(c.totalCobrancas), cols.cobr.x, y, {
          width: cols.cobr.w,
          align: "center",
          lineBreak: false,
        });
        doc.fillColor(c.pendente > 0 ? COLORS.amber : COLORS.border);
        doc.text(c.pendente > 0 ? formatBRL(c.pendente) : "—", cols.pend.x, y, {
          width: cols.pend.w,
          align: "right",
          lineBreak: false,
        });
        doc.fillColor(c.vencido > 0 ? COLORS.red : COLORS.border);
        doc.text(c.vencido > 0 ? formatBRL(c.vencido) : "—", cols.venc.x, y, {
          width: cols.venc.w,
          align: "right",
          lineBreak: false,
        });
        doc.fillColor(c.pago > 0 ? COLORS.green : COLORS.border);
        doc.text(c.pago > 0 ? formatBRL(c.pago) : "—", cols.pago.x, y, {
          width: cols.pago.w,
          align: "right",
          lineBreak: false,
        });
        if (c.diasAtrasoMax != null) {
          doc.font("Helvetica-Bold").fillColor(COLORS.red);
          doc.text(`${c.diasAtrasoMax} dias`, cols.atraso.x, y, {
            width: cols.atraso.w,
            align: "right",
            lineBreak: false,
          });
        } else {
          doc.font("Helvetica").fillColor(COLORS.border);
          doc.text("—", cols.atraso.x, y, {
            width: cols.atraso.w,
            align: "right",
            lineBreak: false,
          });
        }
      };

      let y = drawHeader(doc.y);
      if (clientes.length === 0) {
        doc.font("Helvetica-Oblique").fontSize(9).fillColor(COLORS.muted);
        doc.text("Nenhum cliente bate com os filtros aplicados.", left, y + 4);
      } else {
        let zebra = false;
        for (const c of clientes) {
          if (y + ROW_H > bottomLimit) {
            doc.addPage();
            y = drawHeader(doc.page.margins.top);
            zebra = false;
          }
          drawRow(c, y, zebra);
          y += ROW_H;
          zebra = !zebra;
        }

        // Linha de totais
        if (y + ROW_H + 6 > bottomLimit) {
          doc.addPage();
          y = doc.page.margins.top;
        }
        doc
          .strokeColor(COLORS.border)
          .lineWidth(1)
          .moveTo(left, y)
          .lineTo(right, y)
          .stroke();
        y += 5;
        doc.font("Helvetica-Bold").fontSize(8).fillColor(COLORS.muted);
        doc.text(`TOTAIS (${clientes.length} clientes)`, cols.nome.x, y, {
          width: cols.contato.x + cols.contato.w - cols.nome.x,
          lineBreak: false,
        });
        doc.fillColor(COLORS.dark);
        doc.text(String(totalCobr), cols.cobr.x, y, { width: cols.cobr.w, align: "center", lineBreak: false });
        doc.fillColor(COLORS.amber);
        doc.text(formatBRL(totalPend), cols.pend.x, y, { width: cols.pend.w, align: "right", lineBreak: false });
        doc.fillColor(COLORS.red);
        doc.text(formatBRL(totalVenc), cols.venc.x, y, { width: cols.venc.w, align: "right", lineBreak: false });
        doc.fillColor(COLORS.green);
        doc.text(formatBRL(totalPago), cols.pago.x, y, { width: cols.pago.w, align: "right", lineBreak: false });
        doc.fillColor(COLORS.border);
        doc.text("—", cols.atraso.x, y, { width: cols.atraso.w, align: "right", lineBreak: false });
      }

      // ─── Rodapé com paginação ─────────────────────────────────────────────
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        const fy = doc.page.height - doc.page.margins.bottom + 8;
        doc.fontSize(7.5).font("Helvetica").fillColor(COLORS.muted);
        doc.text("Gerado por JuridFlow · Dados sincronizados do Asaas", left, fy, {
          width: usable * 0.7,
          align: "left",
          lineBreak: false,
        });
        doc.text(`Página ${i + 1} de ${range.count}`, left + usable * 0.7, fy, {
          width: usable * 0.3,
          align: "right",
          lineBreak: false,
        });
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

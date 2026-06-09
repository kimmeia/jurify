/**
 * Gera o Relatório de Agendamentos em PDF (pdfkit) — espelha a aba Agenda de
 * Relatórios: KPIs por resultado (compareceu / não veio / remarcou / sem
 * registro) + taxa de comparecimento, série por período empilhada por
 * resultado, distribuição por tipo e ranking por atendente.
 *
 * Mesmo padrão do `relatorios-comercial-pdf.ts`: retorna Buffer (base64 na
 * camada tRPC).
 */

import PDFDocument from "pdfkit";

export type AgendaPdfData = {
  periodo: { inicio: string | Date; fim: string | Date };
  granularidade: string;
  totais: {
    total: number;
    compareceu: number;
    naoCompareceu: number;
    remarcado: number;
    pendente: number;
    taxaComparecimento: number | null;
  };
  porTipo: Array<{ tipo: string; total: number }>;
  serie: Array<{
    bucket: string;
    compareceu: number;
    naoCompareceu: number;
    remarcado: number;
    pendente: number;
    total: number;
  }>;
  porAtendente: Array<{
    colabId: number;
    nome: string;
    total: number;
    compareceu: number;
    naoCompareceu: number;
    remarcado: number;
    pendente: number;
    taxaComparecimento: number | null;
  }>;
};

// ── Formatação ──────────────────────────────────────────────────────────────

function formatData(v: string | Date): string {
  const iso = typeof v === "string" ? v : v.toISOString();
  return iso.slice(0, 10).split("-").reverse().join("/");
}
function formatBucket(bucket: string, gran: string): string {
  const [y, m, d] = bucket.slice(0, 10).split("-");
  if (!y || !m) return bucket;
  return gran === "mes" ? `${m}/${y}` : `${d}/${m}`;
}
function taxaStr(t: number | null): string {
  return t == null ? "—" : `${t}%`;
}

// ── Paleta (espelha as cores da tela) ───────────────────────────────────────

const C = {
  dark: "#0f172a",
  muted: "#64748b",
  faint: "#94a3b8",
  line: "#e2e8f0",
  emerald: "#059669", emeraldBd: "#a7f3d0",
  rose: "#e11d48", roseBd: "#fecdd3",
  amber: "#d97706", amberBd: "#fde68a",
  indigo: "#4f46e5",
  violet: "#7c3aed", violetBd: "#ddd6fe",
} as const;

const TIPO_LABELS: Record<string, string> = {
  prazo_processual: "Prazo processual",
  audiencia: "Audiência",
  reuniao_comercial: "Reunião comercial",
  tarefa: "Tarefa",
  follow_up: "Follow-up",
  outro: "Outro",
};

function corTaxa(p: number): string {
  if (p >= 75) return C.emerald;
  if (p >= 60) return C.amber;
  return C.rose;
}

/** Gera o Relatório de Agendamentos como Buffer PDF. */
export async function gerarAgendaPdf(args: {
  data: AgendaPdfData;
  nomeEscritorio: string;
  tipoLabel: string;
  atendenteLabel: string;
}): Promise<Buffer> {
  const { data, nomeEscritorio, tipoLabel, atendenteLabel } = args;

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 40,
        bufferPages: true,
        info: {
          Title: `Relatório de Agendamentos — ${nomeEscritorio}`,
          Author: "JuridFlow",
          Creator: "JuridFlow",
        },
      });

      const chunks: Buffer[] = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const L = doc.page.margins.left;
      const R = doc.page.width - doc.page.margins.right;
      const W = R - L;
      const PH = doc.page.height;
      const BOTTOM = PH - 48;

      const ensure = (space: number) => {
        if (doc.y + space > BOTTOM) {
          doc.addPage();
          doc.y = doc.page.margins.top;
        }
      };
      const hr = (y: number, color: string = C.line, w = 0.7) => {
        doc.save().strokeColor(color).lineWidth(w).moveTo(L, y).lineTo(R, y).stroke().restore();
      };
      const rrect = (
        x: number, y: number, w: number, h: number, r: number,
        fill?: string, stroke?: string, sw = 1,
      ) => {
        doc.save();
        if (fill) doc.roundedRect(x, y, w, h, r).fill(fill);
        if (stroke) doc.roundedRect(x, y, w, h, r).lineWidth(sw).stroke(stroke);
        doc.restore();
      };
      const sectionHeader = (title: string, accent: string, subtitle?: string) => {
        ensure(subtitle ? 40 : 30);
        const y = doc.y;
        doc.save().roundedRect(L, y + 1, 3.5, 13, 1.5).fill(accent).restore();
        doc.fillColor(C.dark).font("Helvetica-Bold").fontSize(12.5).text(title, L + 10, y);
        if (subtitle) {
          doc.fillColor(C.faint).font("Helvetica").fontSize(7.5)
            .text(subtitle, L + 10, doc.y + 1, { width: W - 10 });
        }
        doc.moveDown(0.45);
      };

      // ── Cabeçalho ──────────────────────────────────────────────────────────
      doc.save().rect(0, 0, doc.page.width, 5).fill(C.indigo).restore();
      doc.fillColor(C.dark).font("Helvetica-Bold").fontSize(20)
        .text("Relatório de Agendamentos", L, 42);
      doc.fillColor(C.muted).font("Helvetica").fontSize(10.5)
        .text(nomeEscritorio, L, doc.y + 1);

      const emitido = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
      let y = doc.y + 6;
      rrect(L, y, W, 34, 5, "#f8fafc", C.line, 0.8);
      const colMeta = W / 2;
      const meta = (label: string, val: string, x: number, yy: number) => {
        doc.fillColor(C.faint).font("Helvetica").fontSize(7.5).text(label.toUpperCase(), x, yy);
        doc.fillColor(C.dark).font("Helvetica-Bold").fontSize(9)
          .text(val, x, yy + 9, { width: colMeta - 16, lineBreak: false, ellipsis: true });
      };
      meta("Período", `${formatData(data.periodo.inicio)} a ${formatData(data.periodo.fim)}`, L + 10, y + 6);
      meta("Tipo", tipoLabel, L + colMeta, y + 6);
      meta("Atendente", atendenteLabel, L + 10, y + 21 - 4);
      meta("Emitido em", emitido, L + colMeta, y + 21 - 4);
      doc.y = y + 44;

      // ── 1) RESUMO (KPIs por resultado) ───────────────────────────────────────
      sectionHeader("Resumo do período", C.emerald, "Resultado de comparecimento dos compromissos.");
      {
        const t = data.totais;
        const cards: Array<{ label: string; value: string; color: string; bd: string }> = [
          { label: "Agendamentos", value: String(t.total), color: C.dark, bd: C.line },
          { label: "Compareceram", value: String(t.compareceu), color: C.emerald, bd: C.emeraldBd },
          { label: "Não vieram", value: String(t.naoCompareceu), color: C.rose, bd: C.roseBd },
          { label: "Remarcaram", value: String(t.remarcado), color: C.amber, bd: C.amberBd },
          { label: "Sem resultado", value: String(t.pendente), color: C.muted, bd: C.line },
          { label: "Taxa de comparecimento", value: taxaStr(t.taxaComparecimento), color: C.violet, bd: C.violetBd },
        ];
        const gap = 7, n = cards.length, cw = (W - gap * (n - 1)) / n, ch = 56;
        ensure(ch + 12);
        const y0 = doc.y;
        cards.forEach((it, i) => {
          const x = L + i * (cw + gap);
          rrect(x, y0, cw, ch, 5, "#ffffff", it.bd, 1.1);
          doc.fillColor(it.color).font("Helvetica-Bold").fontSize(15)
            .text(it.value, x + 4, y0 + 9, { width: cw - 8, align: "center", lineBreak: false });
          doc.fillColor(C.muted).font("Helvetica").fontSize(6.6)
            .text(it.label, x + 4, y0 + 31, { width: cw - 8, align: "center" });
        });
        doc.y = y0 + ch + 14;
      }

      // ── 2) AGENDAMENTOS POR PERÍODO (barras empilhadas por resultado) ─────────
      sectionHeader(
        "Agendamentos por período", C.indigo,
        "Empilhado por resultado: compareceu (verde), não veio (vermelho), remarcou (âmbar).",
      );
      if (data.serie.length === 0) {
        doc.fillColor(C.muted).font("Helvetica-Oblique").fontSize(9)
          .text("Sem agendamentos no período.", L, doc.y);
        doc.moveDown(0.8);
      } else {
        const chartH = 120, padL = 26, plotX = L + padL, plotW = W - padL;
        ensure(chartH + 28);
        const top = doc.y, base = top + chartH;
        const stackTotal = (s: AgendaPdfData["serie"][number]) =>
          s.compareceu + s.naoCompareceu + s.remarcado;
        const maxV = Math.max(...data.serie.map(stackTotal), 1);
        [0, 0.5, 1].forEach((f) => {
          const yy = base - chartH * f;
          hr(yy, "#eef2f6", 0.6);
          doc.fillColor(C.faint).font("Helvetica").fontSize(6.5)
            .text(String(Math.round(maxV * f)), L, yy - 3, { width: padL - 5, align: "right" });
        });
        const n = data.serie.length;
        const slot = plotW / n;
        const bw = Math.min(34, slot * 0.62);
        const hOf = (v: number) => chartH * (v / maxV);
        const step = Math.max(1, Math.ceil(n / 10));
        data.serie.forEach((s, i) => {
          const cx = plotX + slot * i + (slot - bw) / 2;
          let yTop = base;
          ([
            [s.compareceu, C.emerald],
            [s.naoCompareceu, C.rose],
            [s.remarcado, C.amber],
          ] as Array<[number, string]>).forEach(([v, color]) => {
            if (v > 0) {
              const hh = hOf(v);
              rrect(cx, yTop - hh, bw, hh, 0, color);
              yTop -= hh;
            }
          });
          const tot = stackTotal(s);
          if (tot > 0) {
            doc.fillColor(C.muted).font("Helvetica-Bold").fontSize(6.5)
              .text(String(tot), cx - 4, yTop - 9, { width: bw + 8, align: "center", lineBreak: false });
          }
          if (i % step === 0 || i === n - 1) {
            doc.fillColor(C.faint).font("Helvetica").fontSize(6)
              .text(formatBucket(s.bucket, data.granularidade), cx - 8, base + 4, { width: bw + 16, align: "center", lineBreak: false });
          }
        });
        doc.y = base + 18;
      }

      // ── 3) POR TIPO DE COMPROMISSO ───────────────────────────────────────────
      ensure(60);
      sectionHeader("Por tipo de compromisso", C.violet);
      if (data.porTipo.length === 0) {
        doc.fillColor(C.muted).font("Helvetica-Oblique").fontSize(9)
          .text("Sem dados no período.", L, doc.y);
        doc.moveDown(0.8);
      } else {
        const maxT = Math.max(...data.porTipo.map((x) => x.total), 1);
        const labW = 120, valW = 36, barX = L + labW + 6, barW = W - labW - valW - 12;
        data.porTipo.forEach((x) => {
          ensure(20);
          const yr = doc.y;
          doc.fillColor(C.dark).font("Helvetica").fontSize(8.5)
            .text(TIPO_LABELS[x.tipo] || x.tipo, L, yr + 3, { width: labW, lineBreak: false, ellipsis: true });
          rrect(barX, yr, barW, 14, 7, "#eef2f6");
          rrect(barX, yr, Math.max(barW * (x.total / maxT), 10), 14, 7, C.violet);
          doc.fillColor(C.dark).font("Helvetica-Bold").fontSize(8.5)
            .text(String(x.total), barX + barW + 4, yr + 3, { width: valW, align: "right", lineBreak: false });
          doc.y = yr + 18;
        });
        doc.y += 6;
      }

      // ── 4) POR ATENDENTE (ranking) ───────────────────────────────────────────
      ensure(60);
      sectionHeader("Por atendente", C.amber, "Ordenado por nº de agendamentos. Taxa = compareceu ÷ (compareceu + não veio + remarcou).");
      if (data.porAtendente.length === 0) {
        doc.fillColor(C.muted).font("Helvetica-Oblique").fontSize(9)
          .text("Sem agendamentos no período.", L, doc.y);
        doc.moveDown(0.8);
      } else {
        const xRank = L, xNome = L + 20, xTotal = L + 190, wTotal = 40,
          xVeio = L + 232, wVeio = 40, xNao = L + 276, wNao = 40,
          xRem = L + 320, wRem = 46, xTaxa = L + 372;
        const wTaxaBar = 70;
        const yh = doc.y;
        doc.fillColor(C.muted).font("Helvetica-Bold").fontSize(7.5);
        doc.text("#", xRank, yh, { width: 16 });
        doc.text("Atendente", xNome, yh, { width: 166 });
        doc.text("Total", xTotal, yh, { width: wTotal, align: "right" });
        doc.text("Veio", xVeio, yh, { width: wVeio, align: "right" });
        doc.text("Não", xNao, yh, { width: wNao, align: "right" });
        doc.text("Remarc.", xRem, yh, { width: wRem, align: "right" });
        doc.text("Taxa", xTaxa, yh, { width: R - xTaxa, align: "left" });
        doc.y = yh + 12;
        hr(doc.y, C.line, 0.7);
        doc.y += 4;

        data.porAtendente.forEach((a, idx) => {
          ensure(22);
          const yr = doc.y;
          doc.fillColor(C.muted).font("Helvetica").fontSize(8.5)
            .text(`${idx + 1}º`, xRank, yr + 3, { width: 16 });
          doc.fillColor(C.dark).font("Helvetica-Bold").fontSize(8.5)
            .text(a.nome, xNome, yr + 3, { width: 166, lineBreak: false, ellipsis: true });
          doc.fillColor(C.dark).font("Helvetica-Bold").fontSize(8.5)
            .text(String(a.total), xTotal, yr + 3, { width: wTotal, align: "right" });
          doc.fillColor(C.emerald).font("Helvetica").fontSize(8.5)
            .text(String(a.compareceu), xVeio, yr + 3, { width: wVeio, align: "right" });
          doc.fillColor(C.rose).font("Helvetica").fontSize(8.5)
            .text(String(a.naoCompareceu), xNao, yr + 3, { width: wNao, align: "right" });
          doc.fillColor(C.amber).font("Helvetica").fontSize(8.5)
            .text(String(a.remarcado), xRem, yr + 3, { width: wRem, align: "right" });
          if (a.taxaComparecimento == null) {
            doc.fillColor(C.faint).font("Helvetica").fontSize(8.5)
              .text("—", xTaxa, yr + 3, { width: R - xTaxa });
          } else {
            const by = yr + 5;
            rrect(xTaxa, by, wTaxaBar, 6, 3, "#e5e7eb");
            rrect(xTaxa, by, wTaxaBar * Math.min(1, a.taxaComparecimento / 100), 6, 3, corTaxa(a.taxaComparecimento));
            doc.fillColor(C.dark).font("Helvetica-Bold").fontSize(7.5)
              .text(`${a.taxaComparecimento}%`, xTaxa + wTaxaBar + 4, yr + 3, { width: R - xTaxa - wTaxaBar - 4, align: "left" });
          }
          doc.y = yr + 20;
          hr(doc.y - 2, "#f1f5f9", 0.5);
        });
        doc.y += 8;
      }

      // ── Rodapé (paginação) ───────────────────────────────────────────────────
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        doc.page.margins.bottom = 0;
        doc.fillColor(C.faint).font("Helvetica").fontSize(7.5)
          .text("JuridFlow · Relatório de Agendamentos", L, PH - 30, { width: W / 2, lineBreak: false });
        doc.text(`Página ${i + 1} de ${range.count}`, L + W / 2, PH - 30, { width: W / 2, align: "right", lineBreak: false });
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

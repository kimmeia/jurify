/**
 * Gera o Relatório de Produção em PDF (pdfkit) — espelha a aba Produção de
 * Relatórios: KPIs de entrada e prazo com comparativo, distribuição por etapa
 * do funil, quebra das movimentações de card e entrega por responsável.
 *
 * Mesmo padrão do `relatorios-agenda-pdf.ts`: retorna Buffer (base64 na
 * camada tRPC).
 */

import PDFDocument from "pdfkit";
import {
  calcularDelta, calcularDeltaPontos, formatarDelta, type DeltaKpi,
} from "../../shared/relatorios-comparativo";

export type ProducaoPdfData = {
  periodo: { dataInicio: string; dataFim: string };
  cardsTotal: number;
  cardsDentroPrazo: number;
  cardsAtrasados: number;
  taxaDentroPrazo: number;
  anterior: {
    cardsTotal: number;
    cardsDentroPrazo: number;
    cardsAtrasados: number;
    taxaDentroPrazo: number | null;
  } | null;
  movimentacaoDetalhe: {
    entraram: number;
    avancaram: number;
    voltaram: number;
    concluidos: number;
    total: number;
  };
  cardsPorColuna: Array<{ coluna: string; total: number; conclusao: boolean }>;
  porResponsavel: Array<{
    nome: string;
    total: number;
    noPrazo: number;
    atrasados: number;
    taxaDentroPrazo: number | null;
  }>;
};

// ── Formatação ──────────────────────────────────────────────────────────────

function formatData(v: string): string {
  return v.slice(0, 10).split("-").reverse().join("/");
}
function formatMilhar(v: number): string {
  return v.toLocaleString("pt-BR");
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
  indigo: "#4f46e5", indigoBd: "#c7d2fe",
  violet: "#7c3aed", violetBd: "#ddd6fe",
} as const;

/** Cor da taxa de entrega relativa à média do escritório — o mesmo critério
 *  da tela: o que importa é quem está acima e quem está abaixo da casa. */
function corTaxa(taxa: number | null, referencia: number | null): string {
  if (taxa == null) return C.faint;
  if (referencia == null || referencia === 0) return C.dark;
  if (taxa >= referencia) return C.emerald;
  if (taxa >= referencia * 0.7) return C.amber;
  return C.rose;
}

/** Gera o Relatório de Produção como Buffer PDF. */
export async function gerarProducaoPdf(args: {
  data: ProducaoPdfData;
  nomeEscritorio: string;
  funilLabel: string;
  responsavelLabel: string;
}): Promise<Buffer> {
  const { data, nomeEscritorio, funilLabel, responsavelLabel } = args;

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 40,
        bufferPages: true,
        info: {
          Title: `Relatório de Produção — ${nomeEscritorio}`,
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

      const kpiRow = (
        cards: Array<{ label: string; value: string; delta: DeltaKpi | null; bd: string; color: string }>,
      ) => {
        const gap = 7, n = cards.length, cw = (W - gap * (n - 1)) / n, ch = 58;
        ensure(ch + 12);
        const y0 = doc.y;
        cards.forEach((it, i) => {
          const x = L + i * (cw + gap);
          rrect(x, y0, cw, ch, 5, "#ffffff", it.bd, 1.1);
          doc.fillColor(it.color).font("Helvetica-Bold").fontSize(15)
            .text(it.value, x + 4, y0 + 8, { width: cw - 8, align: "center", lineBreak: false });
          doc.fillColor(C.muted).font("Helvetica").fontSize(6.6)
            .text(it.label, x + 4, y0 + 29, { width: cw - 8, align: "center" });
          if (it.delta) {
            doc.fillColor(it.delta.bom ? C.emerald : C.rose).font("Helvetica-Bold").fontSize(6.8)
              .text(
                `${formatarDelta(it.delta)} vs. anterior`,
                x + 4, y0 + 43, { width: cw - 8, align: "center", lineBreak: false },
              );
          }
        });
        doc.y = y0 + ch + 12;
      };

      /** Barras horizontais rotuladas com valor e (opcional) percentual. */
      const barras = (
        itens: Array<{ rotulo: string; total: number; cor: string }>,
        vazio: string,
        comPercentual: boolean,
      ) => {
        if (itens.length === 0) {
          doc.fillColor(C.muted).font("Helvetica-Oblique").fontSize(9).text(vazio, L, doc.y);
          doc.moveDown(0.8);
          return;
        }
        const max = Math.max(...itens.map((x) => x.total), 1);
        const soma = itens.reduce((a, x) => a + x.total, 0);
        const labW = 150, valW = 42, pctW = comPercentual ? 34 : 0;
        const barX = L + labW + 6, barW = W - labW - valW - pctW - 12;
        itens.forEach((x) => {
          ensure(20);
          const yr = doc.y;
          doc.fillColor(C.dark).font("Helvetica").fontSize(8.5)
            .text(x.rotulo, L, yr + 3, { width: labW, lineBreak: false, ellipsis: true });
          rrect(barX, yr, barW, 14, 7, "#eef2f6");
          rrect(barX, yr, Math.max(barW * (x.total / max), 10), 14, 7, x.cor);
          doc.fillColor(C.dark).font("Helvetica-Bold").fontSize(8.5)
            .text(formatMilhar(x.total), barX + barW + 4, yr + 3, { width: valW, align: "right", lineBreak: false });
          if (comPercentual) {
            doc.fillColor(C.faint).font("Helvetica").fontSize(8)
              .text(
                soma > 0 ? `${Math.round((x.total / soma) * 100)}%` : "—",
                barX + barW + 4 + valW, yr + 3, { width: pctW, align: "right", lineBreak: false },
              );
          }
          doc.y = yr + 18;
        });
        doc.y += 6;
      };

      const ant = data.anterior;

      // ── Cabeçalho ──────────────────────────────────────────────────────────
      doc.save().rect(0, 0, doc.page.width, 5).fill(C.indigo).restore();
      doc.fillColor(C.dark).font("Helvetica-Bold").fontSize(20)
        .text("Relatório de Produção", L, 42);
      doc.fillColor(C.muted).font("Helvetica").fontSize(10.5)
        .text(nomeEscritorio, L, doc.y + 1);

      const emitido = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
      const yMeta = doc.y + 6;
      rrect(L, yMeta, W, 52, 5, "#f8fafc", C.line, 0.8);
      const colMeta = W / 2;
      const meta = (label: string, val: string, x: number, yy: number) => {
        doc.fillColor(C.faint).font("Helvetica").fontSize(7.5).text(label.toUpperCase(), x, yy);
        doc.fillColor(C.dark).font("Helvetica-Bold").fontSize(9)
          .text(val, x, yy + 9, { width: colMeta - 16, lineBreak: false, ellipsis: true });
      };
      meta("Período", `${formatData(data.periodo.dataInicio)} a ${formatData(data.periodo.dataFim)}`, L + 10, yMeta + 7);
      meta("Funil", funilLabel, L + colMeta, yMeta + 7);
      meta("Responsável", responsavelLabel, L + 10, yMeta + 30);
      meta("Emitido em", emitido, L + colMeta, yMeta + 30);
      doc.y = yMeta + 62;

      // ── 1) ENTRADA E PRAZO ─────────────────────────────────────────────────
      sectionHeader(
        "Entrada e prazo", C.indigo,
        ant ? "Comparado com o período imediatamente anterior, de mesma duração." : undefined,
      );
      kpiRow([
        {
          label: "Processos no período", value: formatMilhar(data.cardsTotal),
          delta: calcularDelta(data.cardsTotal, ant?.cardsTotal), bd: C.indigoBd, color: C.dark,
        },
        {
          label: "Dentro do prazo", value: formatMilhar(data.cardsDentroPrazo),
          delta: calcularDelta(data.cardsDentroPrazo, ant?.cardsDentroPrazo),
          bd: C.emeraldBd, color: C.emerald,
        },
        {
          label: "Atrasados", value: formatMilhar(data.cardsAtrasados),
          delta: calcularDelta(data.cardsAtrasados, ant?.cardsAtrasados, true),
          bd: data.cardsAtrasados > 0 ? C.roseBd : C.line,
          color: data.cardsAtrasados > 0 ? C.rose : C.muted,
        },
        {
          label: "Taxa dentro do prazo", value: `${data.taxaDentroPrazo}%`,
          delta: calcularDeltaPontos(data.taxaDentroPrazo, ant?.taxaDentroPrazo),
          bd: C.violetBd, color: C.violet,
        },
      ]);

      // ── 2) DISTRIBUIÇÃO POR ETAPA ──────────────────────────────────────────
      sectionHeader("Distribuição por etapa", C.violet, "Etapas de conclusão em verde.");
      barras(
        data.cardsPorColuna.map((c) => ({
          rotulo: c.coluna,
          total: c.total,
          cor: c.conclusao ? C.emerald : C.indigo,
        })),
        "Nenhum card no funil.",
        true,
      );

      // ── 3) MOVIMENTAÇÃO DE CARDS ───────────────────────────────────────────
      ensure(70);
      const mov = data.movimentacaoDetalhe;
      sectionHeader(
        "Movimentação de cards", C.amber,
        `${formatMilhar(mov.total)} movimentações no período. "Voltaram de etapa" mede retrabalho.`,
      );
      barras(
        [
          { rotulo: "Entraram", total: mov.entraram, cor: C.indigo },
          { rotulo: "Avançaram de etapa", total: mov.avancaram, cor: C.violet },
          { rotulo: "Concluídos", total: mov.concluidos, cor: C.emerald },
          { rotulo: "Voltaram de etapa", total: mov.voltaram, cor: C.amber },
        ],
        "Sem movimentação no período.",
        false,
      );

      // ── 4) POR RESPONSÁVEL ─────────────────────────────────────────────────
      ensure(70);
      const somaResp = data.porResponsavel.reduce(
        (a, r) => ({
          total: a.total + r.total,
          noPrazo: a.noPrazo + r.noPrazo,
          atrasados: a.atrasados + r.atrasados,
        }),
        { total: 0, noPrazo: 0, atrasados: 0 },
      );
      const taxaMedia = somaResp.total > 0
        ? Math.round((somaResp.noPrazo / somaResp.total) * 100)
        : null;

      sectionHeader(
        "Produção por responsável", C.emerald,
        "Taxa = processos no prazo ÷ processos do responsável. Cor compara com a média do escritório.",
      );
      if (data.porResponsavel.length === 0) {
        doc.fillColor(C.muted).font("Helvetica-Oblique").fontSize(9)
          .text("Nenhum processo com responsável no período.", L, doc.y);
        doc.moveDown(0.8);
      } else {
        const xNome = L, wNome = 200, wCol = 62;
        const xTotal = L + 210, xPrazo = xTotal + 70, xAtras = xPrazo + 70, xTaxa = xAtras + 70;
        const yh = doc.y;
        doc.fillColor(C.muted).font("Helvetica-Bold").fontSize(7.5);
        doc.text("Responsável", xNome, yh, { width: wNome });
        doc.text("Processos", xTotal, yh, { width: wCol, align: "right" });
        doc.text("No prazo", xPrazo, yh, { width: wCol, align: "right" });
        doc.text("Atrasados", xAtras, yh, { width: wCol, align: "right" });
        doc.text("Taxa", xTaxa, yh, { width: R - xTaxa, align: "right" });
        doc.y = yh + 12;
        hr(doc.y, C.line, 0.7);
        doc.y += 4;

        data.porResponsavel.forEach((r) => {
          ensure(20);
          const yr = doc.y;
          doc.fillColor(C.dark).font("Helvetica-Bold").fontSize(8.5)
            .text(r.nome, xNome, yr + 3, { width: wNome, lineBreak: false, ellipsis: true });
          doc.font("Helvetica").fontSize(8.5);
          doc.fillColor(C.dark).text(formatMilhar(r.total), xTotal, yr + 3, { width: wCol, align: "right" });
          doc.fillColor(C.emerald).text(formatMilhar(r.noPrazo), xPrazo, yr + 3, { width: wCol, align: "right" });
          doc.fillColor(C.rose).text(formatMilhar(r.atrasados), xAtras, yr + 3, { width: wCol, align: "right" });
          doc.fillColor(corTaxa(r.taxaDentroPrazo, taxaMedia)).font("Helvetica-Bold")
            .text(taxaStr(r.taxaDentroPrazo), xTaxa, yr + 3, { width: R - xTaxa, align: "right" });
          doc.y = yr + 18;
          hr(doc.y - 2, "#f1f5f9", 0.5);
        });

        ensure(24);
        const yt = doc.y + 2;
        rrect(L, yt - 2, W, 18, 3, "#f8fafc");
        doc.fillColor(C.dark).font("Helvetica-Bold").fontSize(8.5);
        doc.text("Total", xNome, yt + 3, { width: wNome });
        doc.text(formatMilhar(somaResp.total), xTotal, yt + 3, { width: wCol, align: "right" });
        doc.fillColor(C.emerald).text(formatMilhar(somaResp.noPrazo), xPrazo, yt + 3, { width: wCol, align: "right" });
        doc.fillColor(C.rose).text(formatMilhar(somaResp.atrasados), xAtras, yt + 3, { width: wCol, align: "right" });
        doc.fillColor(C.dark).text(taxaStr(taxaMedia), xTaxa, yt + 3, { width: R - xTaxa, align: "right" });
        doc.y = yt + 24;
      }

      // ── Rodapé (paginação) ─────────────────────────────────────────────────
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        doc.page.margins.bottom = 0;
        doc.fillColor(C.faint).font("Helvetica").fontSize(7.5)
          .text("JuridFlow · Relatório de Produção", L, PH - 30, { width: W / 2, lineBreak: false });
        doc.text(`Página ${i + 1} de ${range.count}`, L + W / 2, PH - 30, { width: W / 2, align: "right", lineBreak: false });
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

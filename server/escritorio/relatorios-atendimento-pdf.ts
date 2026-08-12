/**
 * Gera o Relatório de Atendimento em PDF (pdfkit) — espelha a aba Atendimento
 * de Relatórios: KPIs de operação e desempenho com comparativo do período
 * anterior, volume diário, motivos de perda, distribuição por canal, tabela
 * por atendente e o bloco de ligações.
 *
 * Mesmo padrão do `relatorios-agenda-pdf.ts`: retorna Buffer (base64 na
 * camada tRPC).
 */

import PDFDocument from "pdfkit";
import {
  calcularDelta, calcularDeltaPontos, formatarDelta, type DeltaKpi,
} from "../../shared/relatorios-comparativo";

export type AtendimentoPdfData = {
  periodo: { dataInicio: string; dataFim: string };
  totalConversas: number;
  mensagensRecebidas: number;
  mensagensEnviadas: number;
  segMedioPriResp: number;
  taxaConversao: number | null;
  ticketMedio: number | null;
  conversaParaLead: number | null;
  leadsGanhos: number;
  leadsPerdidos: number;
  anterior: {
    totalConversas: number;
    mensagensRecebidas: number;
    mensagensEnviadas: number;
    segMedioPriResp: number;
    taxaConversao: number | null;
    ticketMedio: number | null;
    conversaParaLead: number | null;
  } | null;
  conversasPorDia: Array<{ dia: string; total: number }>;
  porCanal: Array<{ nome: string; total: number }>;
  motivosPerda: Array<{ motivo: string; total: number }>;
  tabelaAtendentes: Array<{
    nome: string;
    atendimentos: number;
    leadsTotal: number;
    ganhos: number;
    perdidos: number;
    emAberto: number;
    valorFechado: number;
    taxaConversao: number | null;
  }>;
  ligacoes: {
    feitas: number;
    recebidas: number;
    perdidas: number;
    taxaAtendimento: number | null;
  };
  ligacoesPorAtendente: Array<{
    nome: string;
    feitas: number;
    recebidas: number;
    perdidas: number;
    duracaoTotalSeg: number;
  }>;
};

// ── Formatação ──────────────────────────────────────────────────────────────

function formatData(v: string): string {
  return v.slice(0, 10).split("-").reverse().join("/");
}
function formatBRL(v: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}
function formatMilhar(v: number): string {
  return v.toLocaleString("pt-BR");
}
function formatTempo(seg: number): string {
  if (!seg || seg <= 0) return "—";
  if (seg < 60) return `${Math.round(seg)}s`;
  const min = Math.round(seg / 60);
  return min < 90 ? `${min} min` : `${(min / 60).toFixed(1).replace(".", ",")} h`;
}
function formatDuracao(seg: number): string {
  if (!seg || seg <= 0) return "0m";
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
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
  teal: "#0d9488",
} as const;

function corTaxa(p: number | null): string {
  if (p == null) return C.faint;
  if (p >= 30) return C.emerald;
  if (p >= 15) return C.amber;
  return C.rose;
}

/** Gera o Relatório de Atendimento como Buffer PDF. */
export async function gerarAtendimentoPdf(args: {
  data: AtendimentoPdfData;
  nomeEscritorio: string;
  setorLabel: string;
  atendenteLabel: string;
  canalLabel: string;
  /** UF que filtrou o relatório, ou "Todos". O papel tem que dizer o recorte
   *  que ele representa — PDF filtrado sem dizer que é filtrado vira número
   *  errado circulando fora da tela. */
  ufLabel?: string;
}): Promise<Buffer> {
  const { data, nomeEscritorio, setorLabel, atendenteLabel, canalLabel, ufLabel } = args;

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 40,
        bufferPages: true,
        info: {
          Title: `Relatório de Atendimento — ${nomeEscritorio}`,
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

      /**
       * Fileira de cards de KPI com valor grande e delta discreto abaixo.
       * O sinal do delta é sempre o real; quem decide a cor é `menorEhMelhor`
       * — inverter o número faria a seta contar o oposto do que aconteceu.
       */
      const kpiRow = (
        cards: Array<{
          label: string;
          value: string;
          delta: DeltaKpi | null;
          bd: string;
          color: string;
        }>,
      ) => {
        const gap = 7, n = cards.length, cw = (W - gap * (n - 1)) / n, ch = 58;
        ensure(ch + 12);
        const y0 = doc.y;
        cards.forEach((it, i) => {
          const x = L + i * (cw + gap);
          rrect(x, y0, cw, ch, 5, "#ffffff", it.bd, 1.1);
          doc.fillColor(it.color).font("Helvetica-Bold").fontSize(14)
            .text(it.value, x + 4, y0 + 8, { width: cw - 8, align: "center", lineBreak: false });
          doc.fillColor(C.muted).font("Helvetica").fontSize(6.6)
            .text(it.label, x + 4, y0 + 28, { width: cw - 8, align: "center" });
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

      /** Lista de barras horizontais rotuladas (motivos, canais). */
      const barras = (
        itens: Array<{ rotulo: string; total: number }>,
        cor: string,
        vazio: string,
      ) => {
        if (itens.length === 0) {
          doc.fillColor(C.muted).font("Helvetica-Oblique").fontSize(9).text(vazio, L, doc.y);
          doc.moveDown(0.8);
          return;
        }
        const max = Math.max(...itens.map((x) => x.total), 1);
        const labW = 150, valW = 40, barX = L + labW + 6, barW = W - labW - valW - 12;
        itens.forEach((x) => {
          ensure(20);
          const yr = doc.y;
          doc.fillColor(C.dark).font("Helvetica").fontSize(8.5)
            .text(x.rotulo, L, yr + 3, { width: labW, lineBreak: false, ellipsis: true });
          rrect(barX, yr, barW, 14, 7, "#eef2f6");
          rrect(barX, yr, Math.max(barW * (x.total / max), 10), 14, 7, cor);
          doc.fillColor(C.dark).font("Helvetica-Bold").fontSize(8.5)
            .text(formatMilhar(x.total), barX + barW + 4, yr + 3, { width: valW, align: "right", lineBreak: false });
          doc.y = yr + 18;
        });
        doc.y += 6;
      };

      const ant = data.anterior;

      // ── Cabeçalho ──────────────────────────────────────────────────────────
      doc.save().rect(0, 0, doc.page.width, 5).fill(C.violet).restore();
      doc.fillColor(C.dark).font("Helvetica-Bold").fontSize(20)
        .text("Relatório de Atendimento", L, 42);
      doc.fillColor(C.muted).font("Helvetica").fontSize(10.5)
        .text(nomeEscritorio, L, doc.y + 1);

      const emitido = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
      const yMeta = doc.y + 6;
      rrect(L, yMeta, W, 52, 5, "#f8fafc", C.line, 0.8);
      const colMeta = W / 3;
      const meta = (label: string, val: string, x: number, yy: number) => {
        doc.fillColor(C.faint).font("Helvetica").fontSize(7.5).text(label.toUpperCase(), x, yy);
        doc.fillColor(C.dark).font("Helvetica-Bold").fontSize(9)
          .text(val, x, yy + 9, { width: colMeta - 16, lineBreak: false, ellipsis: true });
      };
      meta("Período", `${formatData(data.periodo.dataInicio)} a ${formatData(data.periodo.dataFim)}`, L + 10, yMeta + 7);
      meta("Setor", setorLabel, L + colMeta, yMeta + 7);
      meta("Atendente", atendenteLabel, L + colMeta * 2, yMeta + 7);
      meta("Canal", canalLabel, L + 10, yMeta + 30);
      meta("Estado", ufLabel || "Todos", L + colMeta, yMeta + 30);
      meta("Emitido em", emitido, L + colMeta * 2, yMeta + 30);
      doc.y = yMeta + 62;

      // ── 1) OPERAÇÃO ────────────────────────────────────────────────────────
      sectionHeader(
        "Operação", C.violet,
        ant ? "Comparado com o período imediatamente anterior, de mesma duração." : undefined,
      );
      kpiRow([
        {
          label: "Atendimentos", value: formatMilhar(data.totalConversas),
          delta: calcularDelta(data.totalConversas, ant?.totalConversas), bd: C.violetBd, color: C.dark,
        },
        {
          label: "Tempo p/ 1ª resposta", value: formatTempo(data.segMedioPriResp),
          delta: calcularDelta(data.segMedioPriResp, ant?.segMedioPriResp, true),
          bd: C.amberBd, color: C.dark,
        },
      ]);

      // ── 2) DESEMPENHO ──────────────────────────────────────────────────────
      sectionHeader("Desempenho", C.emerald);
      kpiRow([
        {
          label: "Taxa de conversão", value: taxaStr(data.taxaConversao),
          delta: calcularDeltaPontos(data.taxaConversao, ant?.taxaConversao), bd: C.emeraldBd, color: C.emerald,
        },
        {
          label: "Ticket médio",
          value: data.ticketMedio != null ? formatBRL(data.ticketMedio) : "—",
          delta: calcularDelta(data.ticketMedio, ant?.ticketMedio), bd: C.line, color: C.dark,
        },
        {
          label: "Ganhos × perdidos",
          value: `${formatMilhar(data.leadsGanhos)} × ${formatMilhar(data.leadsPerdidos)}`,
          delta: null, bd: C.line, color: C.dark,
        },
      ]);

      // ── 3) VOLUME DIÁRIO ───────────────────────────────────────────────────
      sectionHeader("Volume diário", C.indigo, "Atendimentos iniciados por dia.");
      if (data.conversasPorDia.length === 0) {
        doc.fillColor(C.muted).font("Helvetica-Oblique").fontSize(9)
          .text("Sem atendimentos no período.", L, doc.y);
        doc.moveDown(0.8);
      } else {
        const chartH = 110, padL = 26, plotX = L + padL, plotW = W - padL;
        ensure(chartH + 28);
        const top = doc.y, base = top + chartH;
        const maxV = Math.max(...data.conversasPorDia.map((s) => s.total), 1);
        [0, 0.5, 1].forEach((f) => {
          const yy = base - chartH * f;
          hr(yy, "#eef2f6", 0.6);
          doc.fillColor(C.faint).font("Helvetica").fontSize(6.5)
            .text(String(Math.round(maxV * f)), L, yy - 3, { width: padL - 5, align: "right" });
        });
        const n = data.conversasPorDia.length;
        const slot = plotW / n;
        const bw = Math.min(24, slot * 0.66);
        const step = Math.max(1, Math.ceil(n / 12));
        data.conversasPorDia.forEach((s, i) => {
          const cx = plotX + slot * i + (slot - bw) / 2;
          const hh = chartH * (s.total / maxV);
          if (s.total > 0) rrect(cx, base - hh, bw, hh, 1, C.violet);
          if (i % step === 0 || i === n - 1) {
            doc.fillColor(C.faint).font("Helvetica").fontSize(6)
              .text(s.dia.slice(8, 10), cx - 8, base + 4, { width: bw + 16, align: "center", lineBreak: false });
          }
        });
        doc.y = base + 18;
      }

      // ── 4) MOTIVOS DE PERDA ────────────────────────────────────────────────
      ensure(60);
      sectionHeader(
        "Motivos de perda", C.rose,
        `${formatMilhar(data.leadsPerdidos)} leads perdidos no período.`,
      );
      barras(
        data.motivosPerda.slice(0, 8).map((m) => ({ rotulo: m.motivo, total: m.total })),
        C.rose,
        "Nenhum motivo registrado no período.",
      );

      // ── 5) POR CANAL ───────────────────────────────────────────────────────
      ensure(60);
      sectionHeader("Atendimentos por canal", C.teal);
      barras(
        data.porCanal.slice(0, 8).map((c) => ({ rotulo: c.nome, total: c.total })),
        C.teal,
        "Sem canal no período.",
      );

      // ── 6) POR ATENDENTE ───────────────────────────────────────────────────
      ensure(70);
      sectionHeader(
        "Detalhamento por atendente", C.amber,
        "Conv. = ganhos ÷ atendimentos. Ordenado por valor fechado.",
      );
      if (data.tabelaAtendentes.length === 0) {
        doc.fillColor(C.muted).font("Helvetica-Oblique").fontSize(9)
          .text("Nenhum atendente com movimento no período.", L, doc.y);
        doc.moveDown(0.8);
      } else {
        const xNome = L, wNome = 140,
          xAtend = L + 145, wCol = 42,
          xLeads = xAtend + 46, xGanhos = xLeads + 46,
          xPerd = xGanhos + 46, xConv = xPerd + 46,
          xValor = xConv + 50;
        const yh = doc.y;
        doc.fillColor(C.muted).font("Helvetica-Bold").fontSize(7.5);
        doc.text("Atendente", xNome, yh, { width: wNome });
        doc.text("Atend.", xAtend, yh, { width: wCol, align: "right" });
        doc.text("Oportun.", xLeads, yh, { width: wCol, align: "right" });
        doc.text("Ganhos", xGanhos, yh, { width: wCol, align: "right" });
        doc.text("Perd.", xPerd, yh, { width: wCol, align: "right" });
        doc.text("Conv.", xConv, yh, { width: wCol, align: "right" });
        doc.text("Valor fechado", xValor, yh, { width: R - xValor, align: "right" });
        doc.y = yh + 12;
        hr(doc.y, C.line, 0.7);
        doc.y += 4;

        const totais = data.tabelaAtendentes.reduce(
          (a, x) => ({
            atendimentos: a.atendimentos + x.atendimentos,
            leadsTotal: a.leadsTotal + x.leadsTotal,
            ganhos: a.ganhos + x.ganhos,
            perdidos: a.perdidos + x.perdidos,
            valorFechado: a.valorFechado + x.valorFechado,
          }),
          { atendimentos: 0, leadsTotal: 0, ganhos: 0, perdidos: 0, valorFechado: 0 },
        );

        data.tabelaAtendentes.forEach((a) => {
          ensure(20);
          const yr = doc.y;
          doc.fillColor(C.dark).font("Helvetica-Bold").fontSize(8.5)
            .text(a.nome, xNome, yr + 3, { width: wNome, lineBreak: false, ellipsis: true });
          doc.font("Helvetica").fontSize(8.5);
          doc.fillColor(C.dark).text(formatMilhar(a.atendimentos), xAtend, yr + 3, { width: wCol, align: "right" });
          doc.fillColor(C.muted).text(formatMilhar(a.leadsTotal), xLeads, yr + 3, { width: wCol, align: "right" });
          doc.fillColor(C.emerald).text(formatMilhar(a.ganhos), xGanhos, yr + 3, { width: wCol, align: "right" });
          doc.fillColor(C.rose).text(formatMilhar(a.perdidos), xPerd, yr + 3, { width: wCol, align: "right" });
          doc.fillColor(corTaxa(a.taxaConversao)).font("Helvetica-Bold")
            .text(taxaStr(a.taxaConversao), xConv, yr + 3, { width: wCol, align: "right" });
          doc.fillColor(C.dark).font("Helvetica-Bold")
            .text(formatBRL(a.valorFechado), xValor, yr + 3, { width: R - xValor, align: "right" });
          doc.y = yr + 18;
          hr(doc.y - 2, "#f1f5f9", 0.5);
        });

        ensure(22);
        const yt = doc.y + 2;
        rrect(L, yt - 2, W, 18, 3, "#f8fafc");
        doc.fillColor(C.dark).font("Helvetica-Bold").fontSize(8.5);
        doc.text("Total", xNome, yt + 3, { width: wNome });
        doc.text(formatMilhar(totais.atendimentos), xAtend, yt + 3, { width: wCol, align: "right" });
        doc.text(formatMilhar(totais.leadsTotal), xLeads, yt + 3, { width: wCol, align: "right" });
        doc.fillColor(C.emerald).text(formatMilhar(totais.ganhos), xGanhos, yt + 3, { width: wCol, align: "right" });
        doc.fillColor(C.rose).text(formatMilhar(totais.perdidos), xPerd, yt + 3, { width: wCol, align: "right" });
        const taxaTotal = totais.atendimentos > 0
          ? Math.round((totais.ganhos / totais.atendimentos) * 100)
          : null;
        doc.fillColor(corTaxa(taxaTotal)).text(taxaStr(taxaTotal), xConv, yt + 3, { width: wCol, align: "right" });
        doc.fillColor(C.dark).text(formatBRL(totais.valorFechado), xValor, yt + 3, { width: R - xValor, align: "right" });
        doc.y = yt + 24;
      }

      // ── 7) LIGAÇÕES ────────────────────────────────────────────────────────
      const temLigacoes =
        data.ligacoes.feitas > 0 || data.ligacoes.recebidas > 0 || data.ligacoes.perdidas > 0;
      if (temLigacoes) {
        ensure(80);
        sectionHeader(
          "Ligações", C.teal,
          "Taxa = recebidas ÷ (recebidas + perdidas + recusadas).",
        );
        kpiRow([
          { label: "Feitas", value: formatMilhar(data.ligacoes.feitas), delta: null, bd: C.line, color: C.dark },
          { label: "Recebidas", value: formatMilhar(data.ligacoes.recebidas), delta: null, bd: C.line, color: C.dark },
          { label: "Perdidas", value: formatMilhar(data.ligacoes.perdidas), delta: null, bd: C.roseBd, color: C.rose },
          {
            label: "Taxa de atendimento", value: taxaStr(data.ligacoes.taxaAtendimento),
            delta: null, bd: C.emeraldBd, color: C.emerald,
          },
        ]);

        if (data.ligacoesPorAtendente.length > 0) {
          ensure(60);
          const xNome = L, wNome = 190, wCol = 55;
          const xFeitas = L + 200, xReceb = xFeitas + 60, xPerd = xReceb + 60;
          const yh = doc.y;
          doc.fillColor(C.muted).font("Helvetica-Bold").fontSize(7.5);
          doc.text("Atendente", xNome, yh, { width: wNome });
          doc.text("Feitas", xFeitas, yh, { width: wCol, align: "right" });
          doc.text("Recebidas", xReceb, yh, { width: wCol, align: "right" });
          doc.text("Perdidas", xPerd, yh, { width: wCol, align: "right" });
          doc.text("Tempo total", xPerd + 60, yh, { width: R - xPerd - 60, align: "right" });
          doc.y = yh + 12;
          hr(doc.y, C.line, 0.7);
          doc.y += 4;

          data.ligacoesPorAtendente.forEach((a) => {
            ensure(20);
            const yr = doc.y;
            doc.fillColor(C.dark).font("Helvetica-Bold").fontSize(8.5)
              .text(a.nome, xNome, yr + 3, { width: wNome, lineBreak: false, ellipsis: true });
            doc.font("Helvetica").fontSize(8.5);
            doc.fillColor(C.dark).text(formatMilhar(a.feitas), xFeitas, yr + 3, { width: wCol, align: "right" });
            doc.text(formatMilhar(a.recebidas), xReceb, yr + 3, { width: wCol, align: "right" });
            doc.fillColor(C.rose).text(formatMilhar(a.perdidas), xPerd, yr + 3, { width: wCol, align: "right" });
            doc.fillColor(C.dark).font("Helvetica-Bold")
              .text(formatDuracao(a.duracaoTotalSeg), xPerd + 60, yr + 3, { width: R - xPerd - 60, align: "right" });
            doc.y = yr + 18;
            hr(doc.y - 2, "#f1f5f9", 0.5);
          });
          doc.y += 8;
        }
      }

      // ── Rodapé (paginação) ─────────────────────────────────────────────────
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        doc.page.margins.bottom = 0;
        doc.fillColor(C.faint).font("Helvetica").fontSize(7.5)
          .text("JuridFlow · Relatório de Atendimento", L, PH - 30, { width: W / 2, lineBreak: false });
        doc.text(`Página ${i + 1} de ${range.count}`, L + W / 2, PH - 30, { width: W / 2, align: "right", lineBreak: false });
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

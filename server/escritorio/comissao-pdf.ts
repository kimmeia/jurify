/**
 * Gera o "Relatório de Comissão" em PDF (pdfkit) — espelha o modal
 * "Calcular comissão": cabeçalho (atendente/período/regra), KPIs
 * (bruto/comissionável/não comissionável/comissão), faixa atingida, tabela
 * das cobranças que entram e das que NÃO entram (com motivo) e uma área de
 * conferência pra assinatura antes de fechar o período com o atendente.
 *
 * Mesmo padrão do `relatorios-comercial-pdf.ts`: retorna Buffer (base64 na
 * camada tRPC). Nomes/descrições/categorias longos são truncados com `fit()`
 * pra nunca quebrar linha nem invadir a coluna vizinha.
 */

import PDFDocument from "pdfkit";

export type ComissaoPdfItem = {
  dataPagamento: string; // YYYY-MM-DD
  contatoNome: string | null;
  descricao: string | null;
  categoriaNome: string | null;
  valor: number;
  motivoExclusao?: string | null;
};

export type ComissaoPdfData = {
  nomeEscritorio: string;
  atendenteNome: string;
  atendenteCargo: string;
  periodoInicio: string;
  periodoFim: string;
  emitidoEm: string;
  aliquotaAplicada: number;
  totais: { bruto: number; comissionavel: number; naoComissionavel: number; valorComissao: number };
  regra: { modo: string; valorMinimo: number; baseFaixa: string };
  faixaAplicada: { valorBaseClassificacao: number; limiteAte: number | null; aliquotaPercent: number } | null;
  comissionaveis: ComissaoPdfItem[];
  naoComissionaveis: ComissaoPdfItem[];
};

const C = {
  dark: "#0f172a", muted: "#64748b", faint: "#94a3b8", line: "#e2e8f0",
  blue: "#2563eb", blueBd: "#bfdbfe", emerald: "#059669", emeraldBd: "#a7f3d0",
  slate: "#475569", slateBg: "#f8fafc", amber: "#d97706",
} as const;

const MOTIVO_LABEL: Record<string, string> = {
  override_manual: "Desmarcada manualmente",
  categoria_nao_comissionavel: "Categoria não comissionável",
  abaixo_minimo: "Abaixo do valor mínimo",
  atendente_diferente: "Atendente diferente",
  ja_fechada: "Já em outro fechamento",
};

function formatBRL(n: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
}
function formatData(iso: string): string {
  return iso.slice(0, 10).split("-").reverse().join("/");
}

export async function gerarComissaoPdf(data: ComissaoPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4", margin: 40, bufferPages: true,
        info: { Title: `Relatório de Comissão — ${data.atendenteNome}`, Author: "JuridFlow", Creator: "JuridFlow" },
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
        if (doc.y + space > BOTTOM) { doc.addPage(); doc.y = doc.page.margins.top; }
      };
      const hr = (y: number, color: string = C.line, w = 0.7) =>
        doc.save().strokeColor(color).lineWidth(w).moveTo(L, y).lineTo(R, y).stroke().restore();
      const rrect = (x: number, y: number, w: number, h: number, r: number, fill?: string, stroke?: string, sw = 1) => {
        doc.save();
        if (fill) doc.roundedRect(x, y, w, h, r).fill(fill);
        if (stroke) doc.roundedRect(x, y, w, h, r).lineWidth(sw).stroke(stroke);
        doc.restore();
      };
      // Trunca na fonte/tamanho atuais (pdfkit 0.17 ignora `ellipsis` sem
      // `height`, e `lineBreak:false` ainda quebra com `width`). Chamar
      // SEMPRE depois de fixar font()+fontSize().
      const fit = (texto: string, larguraMax: number): string => {
        if (!texto) return "";
        if (doc.widthOfString(texto) <= larguraMax) return texto;
        const ell = "…";
        let t = texto;
        while (t.length > 1 && doc.widthOfString(t + ell) > larguraMax) t = t.slice(0, -1);
        return t.replace(/\s+$/, "") + ell;
      };

      // ── Cabeçalho ──────────────────────────────────────────────────────────
      doc.save().rect(0, 0, doc.page.width, 5).fill(C.blue).restore();
      doc.fillColor(C.dark).font("Helvetica-Bold").fontSize(20).text("Relatório de Comissão", L, 42);
      doc.fillColor(C.muted).font("Helvetica").fontSize(10.5).text(data.nomeEscritorio, L, doc.y + 1);

      let y = doc.y + 6;
      rrect(L, y, W, 50, 5, C.slateBg, C.line, 0.8);
      const colMeta = W / 2;
      // 2 linhas de meta com folga vertical: label (7.5) em `yy`, valor (9) em
      // `yy+10`. Linhas em y+8 e y+30 pra o valor da 1ª não encostar no label
      // da 2ª (era o efeito de "fontes sobrepostas").
      const meta = (label: string, val: string, x: number, yy: number) => {
        doc.fillColor(C.faint).font("Helvetica").fontSize(7.5).text(label.toUpperCase(), x, yy, { width: colMeta - 16, lineBreak: false });
        doc.fillColor(C.dark).font("Helvetica-Bold").fontSize(9)
          .text(fit(val, colMeta - 16), x, yy + 10, { width: colMeta - 16, lineBreak: false });
      };
      const regraLabel = data.regra.modo === "faixas"
        ? `Faixas progressivas · mín. ${formatBRL(data.regra.valorMinimo)}`
        : `Alíquota fixa ${data.aliquotaAplicada}% · mín. ${formatBRL(data.regra.valorMinimo)}`;
      meta("Atendente", `${data.atendenteNome} (${data.atendenteCargo})`, L + 10, y + 8);
      meta("Período", `${formatData(data.periodoInicio)} a ${formatData(data.periodoFim)}`, L + colMeta, y + 8);
      meta("Regra", regraLabel, L + 10, y + 30);
      meta("Emitido em", data.emitidoEm, L + colMeta, y + 30);
      doc.y = y + 50 + 12;

      // ── KPIs ─────────────────────────────────────────────────────────────
      {
        const gap = 8, cw = (W - gap * 3) / 4, ch = 58, y0 = doc.y;
        const kpi = (i: number, label: string, val: number, cor: string, bd: string) => {
          const x = L + i * (cw + gap);
          rrect(x, y0, cw, ch, 5, "#ffffff", bd, 1.2);
          doc.fillColor(C.muted).font("Helvetica").fontSize(7.5)
            .text(label.toUpperCase(), x + 10, y0 + 10, { width: cw - 20, lineBreak: false });
          doc.fillColor(cor).font("Helvetica-Bold").fontSize(14)
            .text(formatBRL(val), x + 10, y0 + 26, { width: cw - 20, lineBreak: false });
        };
        kpi(0, "Bruto recebido", data.totais.bruto, C.dark, C.line);
        kpi(1, "Comissionável", data.totais.comissionavel, C.emerald, C.emeraldBd);
        kpi(2, "Não comissionável", data.totais.naoComissionavel, C.muted, C.line);
        kpi(3, `Comissão (${data.aliquotaAplicada}%)`, data.totais.valorComissao, C.blue, C.blueBd);
        doc.y = y0 + ch + 12;
      }

      // ── Faixa atingida (só em modo faixas) ───────────────────────────────
      if (data.regra.modo === "faixas" && data.faixaAplicada) {
        const f = data.faixaAplicada;
        const baseLabel = data.regra.baseFaixa === "bruto" ? "recebido bruto" : "recebido comissionável";
        const teto = f.limiteAte === null ? "sem teto" : `até ${formatBRL(Number(f.limiteAte))}`;
        const y0 = doc.y;
        rrect(L, y0, W, 30, 5, C.slateBg, C.line, 0.8);
        doc.fillColor(C.dark).font("Helvetica-Bold").fontSize(8)
          .text("Faixa atingida (cumulativo)", L + 10, y0 + 6);
        doc.fillColor(C.muted).font("Helvetica").fontSize(8)
          .text(`Base usada: ${formatBRL(f.valorBaseClassificacao)} (${baseLabel}) → faixa de ${teto} → alíquota ${f.aliquotaPercent}%`,
            L + 10, y0 + 17, { width: W - 20, lineBreak: false });
        doc.y = y0 + 30 + 12;
      }

      // ── Tabela reutilizável ──────────────────────────────────────────────
      const xData = L, wData = 58, xCli = L + 64, wCli = 250, xCat = L + 320, wCat = 104, xVal = R - 92, wVal = 92;
      const tabela = (titulo: string, cor: string, itens: ComissaoPdfItem[], comMotivo: boolean) => {
        ensure(50);
        const yh0 = doc.y;
        doc.save().roundedRect(L, yh0 + 1, 3.5, 13, 1.5).fill(cor).restore();
        doc.fillColor(C.dark).font("Helvetica-Bold").fontSize(12).text(titulo, L + 10, yh0);
        doc.fillColor(C.faint).font("Helvetica").fontSize(9)
          .text(`${itens.length} cobrança(s)`, L + 10, yh0, { width: W - 10, align: "right" });
        doc.y = yh0 + 18;

        if (itens.length === 0) {
          doc.fillColor(C.muted).font("Helvetica-Oblique").fontSize(8.5)
            .text("Nenhuma cobrança.", L, doc.y);
          doc.y += 16;
          return;
        }

        const yc = doc.y;
        doc.fillColor(C.muted).font("Helvetica-Bold").fontSize(7);
        doc.text("Pago em", xData, yc, { width: wData });
        doc.text("Cliente", xCli, yc, { width: wCli });
        doc.text(comMotivo ? "Motivo" : "Categoria", xCat, yc, { width: wCat });
        doc.text("Valor", xVal, yc, { width: wVal, align: "right" });
        doc.y = yc + 11;
        hr(doc.y, C.line, 0.6);
        doc.y += 3;

        let soma = 0;
        for (const it of itens) {
          ensure(20);
          const yr = doc.y;
          soma += it.valor;
          doc.fillColor(C.slate).font("Helvetica").fontSize(8)
            .text(formatData(it.dataPagamento), xData, yr + 2, { width: wData, lineBreak: false });
          // Cliente em negrito; sem nome, a descrição vira a linha principal.
          const principal = it.contatoNome || it.descricao || "—";
          doc.fillColor(C.dark).font("Helvetica-Bold").fontSize(8.5)
            .text(fit(principal, wCli), xCli, yr, { width: wCli, lineBreak: false });
          if (it.contatoNome && it.descricao) {
            doc.fillColor(C.faint).font("Helvetica").fontSize(6.8)
              .text(fit(it.descricao, wCli), xCli, yr + 10, { width: wCli, lineBreak: false });
          }
          if (comMotivo) {
            const m = it.motivoExclusao ? (MOTIVO_LABEL[it.motivoExclusao] ?? it.motivoExclusao) : "—";
            doc.fillColor(C.amber).font("Helvetica").fontSize(7.5)
              .text(fit(m, wCat), xCat, yr + 2, { width: wCat, lineBreak: false });
          } else {
            const cat = it.categoriaNome || "Sem categoria";
            doc.fillColor(it.categoriaNome ? C.slate : C.faint)
              .font(it.categoriaNome ? "Helvetica" : "Helvetica-Oblique").fontSize(8)
              .text(fit(cat, wCat), xCat, yr + 2, { width: wCat, lineBreak: false });
          }
          doc.fillColor(cor).font("Helvetica-Bold").fontSize(8.5)
            .text(formatBRL(it.valor), xVal, yr + 2, { width: wVal, align: "right", lineBreak: false });
          doc.y = yr + 18;
          hr(doc.y - 1, "#f1f5f9", 0.5);
        }
        // Total
        ensure(18);
        const yt = doc.y;
        doc.fillColor(C.dark).font("Helvetica-Bold").fontSize(8.5)
          .text(`Total (${itens.length})`, xCli, yt + 3, { width: wCli, lineBreak: false });
        doc.fillColor(cor).font("Helvetica-Bold").fontSize(9.5)
          .text(formatBRL(soma), xVal, yt + 2, { width: wVal, align: "right", lineBreak: false });
        doc.y = yt + 20;
      };

      tabela("Cobranças que entram na comissão", C.emerald, data.comissionaveis, false);
      doc.y += 6;
      tabela("Cobranças que NÃO entram na comissão", C.slate, data.naoComissionaveis, true);

      // ── Conferência (assinaturas) ────────────────────────────────────────
      ensure(70);
      doc.y += 6;
      hr(doc.y, C.line, 0.7);
      doc.y += 12;
      doc.fillColor(C.dark).font("Helvetica-Bold").fontSize(9).text("Conferência", L, doc.y);
      doc.y += 22;
      {
        const yl = doc.y + 18, colw = (W - 30) / 2;
        doc.save().strokeColor(C.faint).lineWidth(0.8).moveTo(L, yl).lineTo(L + colw, yl).stroke().restore();
        doc.save().strokeColor(C.faint).lineWidth(0.8).moveTo(L + colw + 30, yl).lineTo(R, yl).stroke().restore();
        doc.fillColor(C.muted).font("Helvetica").fontSize(7.5)
          .text(fit(`${data.atendenteNome} (atendente)`, colw), L, yl + 3, { width: colw, lineBreak: false });
        doc.fillColor(C.muted).font("Helvetica").fontSize(7.5)
          .text("Responsável / Financeiro", L + colw + 30, yl + 3, { width: colw });
        doc.y = yl + 24;
      }

      // ── Rodapé (paginação) ───────────────────────────────────────────────
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        doc.page.margins.bottom = 0;
        doc.fillColor(C.faint).font("Helvetica").fontSize(7.5)
          .text("JuridFlow · Relatório de Comissão", L, PH - 30, { width: W / 2, lineBreak: false });
        doc.text(`Página ${i + 1} de ${range.count}`, L + W / 2, PH - 30, { width: W / 2, align: "right", lineBreak: false });
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

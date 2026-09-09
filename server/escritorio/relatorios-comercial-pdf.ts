/**
 * Gera o Relatório Comercial em PDF usando pdfkit — espelha a aba Comercial
 * de Relatórios (mesmas seções/cores da tela): fechamento total (KPIs),
 * fechamento por atendente (ranking), fechado e recebido por cliente do
 * atendente (drill-down), funil, faturado por dia, contatos por canal e
 * fechamentos por origem.
 *
 * Mesmo padrão do `dre-pdf.ts`: retorna Buffer (base64 na camada tRPC).
 */

import PDFDocument from "pdfkit";

// ── Tipos do payload (subset do retorno de relatorios.comercialDashboard) ────

export type ComercialDashboardData = {
  periodo: { dataInicio: string; dataFim: string };
  periodoAnterior: { dataInicio: string; dataFim: string };
  kpis: {
    faturado: number;
    variacaoFaturado: number;
    clientesPagantes: number;
    variacaoClientesPagantes: number;
    clientesFechados: number;
    contratosFechados: number;
    variacaoContratosFechados: number;
    valorTotalFechado: number;
    ticketMedio: number;
    /** Contratos cancelados no período (pela data do cancelamento). */
    cancelados?: number;
    valorCancelados?: number;
    canceladosFecharamNoPeriodo?: number;
    variacaoCancelados?: number;
    contratosFechadosCanceladosDepois?: number;
    valorFechadosCanceladosDepois?: number;
  };
  ranking: Array<{
    atendenteId: number;
    nome: string;
    setorNome: string | null;
    valorFechado: number;
    contratosFechados: number;
    faturado: number;
    ticketMedio: number;
    meta: number | null;
    metaPeriodo: number | null;
    progressoMeta: number | null;
  }>;
  cobrancasPorDia: Array<{ dia: string; faturado: number }>;
  etapas: Record<string, { total: number; valor: number }>;
  /** Dois blocos do funil: quem entrou (createdAt) × quem foi decidido (fechadoEm). */
  funilResumo?: {
    entraram: { total: number; emAberto: number; jaDecididos: number };
    decididos: {
      total: number;
      fechado_ganho: { total: number; entraramNoPeriodo: number; entraramAntes: number };
      fechado_perdido: { total: number; entraramNoPeriodo: number; entraramAntes: number };
    };
    cancelados?: { total: number; valor: number; fecharamNoPeriodo: number; fecharamAntes: number };
  };
  contratosCancelados?: Array<{
    leadId: number;
    contatoId: number;
    cliente: string;
    fechadoEm: string | null;
    canceladoEm: string | null;
    valor: number;
    motivo: string | null;
    detalhe: string | null;
    responsavel: string | null;
    recebidoAntes: number;
  }>;
  leadsPorCanal: Array<{ canal: string; total: number }>;
  fechamentosPorOrigem: Array<{
    origem: string;
    total: number;
    valorTotal?: number;
    recebidoTotal?: number;
    pagaram?: number;
    fechamentos?: Array<{
      contatoId: number | null;
      cliente: string;
      fechadoEm: string | null;
      valor: number | null;
      recebido?: number;
      situacao?: string;
      responsavel: string | null;
      mesmoCliente?: number;
      foraDoFiltro?: boolean;
      canceladoEm?: string | null;
      motivoCancelamento?: string | null;
    }>;
  }>;
  filtros: { setorId: number | null; atendenteId: number | null };
};

export type DetalheAtendentePdf = {
  atendenteId: number;
  nome: string;
  setorNome: string | null;
  totalFechado: number;
  totalRecebido: number;
  itens: Array<{
    contatoId: number;
    nome: string;
    valorFechado: number;
    contratosFechados: number;
    valorRecebido: number;
    contratosPagos: number;
    status: "pago" | "parcial" | "aguardando" | "so_pago";
  }>;
};

// ── Formatação ────────────────────────────────────────────────────────────

function formatBRL(n: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(n);
}
function formatBRLk(n: number): string {
  return n >= 1000 ? `R$ ${Math.round(n / 1000)}k` : `R$ ${Math.round(n)}`;
}
function formatData(iso: string): string {
  return iso.slice(0, 10).split("-").reverse().join("/");
}
function formatDiaCurto(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}`;
}
function pct1(n: number): string {
  return `${n.toFixed(1).replace(".", ",")}%`;
}

// ── Paleta (espelha as cores da tela) ───────────────────────────────────────

const C = {
  dark: "#0f172a",
  muted: "#64748b",
  faint: "#94a3b8",
  line: "#e2e8f0",
  pos: "#059669",
  neg: "#dc2626",
  emerald: "#059669", emeraldBg: "#ecfdf5", emeraldBd: "#a7f3d0",
  blue: "#2563eb", blueBd: "#bfdbfe",
  indigo: "#4f46e5", indigoBg: "#eef2ff", indigoBd: "#c7d2fe",
  violet: "#7c3aed", violetBg: "#f5f3ff", violetBd: "#ddd6fe",
  amber: "#d97706", amberBg: "#fffbeb",
} as const;

const ETAPAS_FUNIL = [
  "novo", "qualificado", "proposta", "negociacao", "fechado_ganho", "fechado_perdido",
] as const;
const ETAPA_LABELS: Record<string, string> = {
  novo: "Novo", qualificado: "Qualificado", proposta: "Proposta",
  negociacao: "Negociação", fechado_ganho: "Ganho", fechado_perdido: "Perdido",
  cancelado: "Cancelado",
};
const ETAPA_COR: Record<string, string> = {
  novo: "#64748b", qualificado: "#3b82f6", proposta: "#8b5cf6",
  negociacao: "#f59e0b", fechado_ganho: "#10b981", fechado_perdido: "#ef4444",
  cancelado: "#b45309",
};
const ORIGEM_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp", instagram: "Instagram", facebook: "Facebook",
  telefone: "Telefone", manual: "Manual", site: "Site", asaas: "Asaas",
};
const SITUACAO_FECHAMENTO_LABEL: Record<string, string> = {
  pago: "Pago", parcial: "Parcial", nada: "Nada no período", fora_do_filtro: "Fora do filtro",
};
const MOTIVO_CANCELAMENTO_LABEL: Record<string, string> = {
  desistencia: "Desistência do cliente", inadimplencia: "Inadimplência", outro_escritorio: "Fechou com outro escritório",
  sem_retorno: "Sem retorno do cliente", engano: "Lançado por engano", outro: "Outro",
};
const STATUS_INFO: Record<string, { label: string; bg: string; fg: string }> = {
  pago: { label: "Pago integral", bg: "#d1fae5", fg: "#047857" },
  parcial: { label: "Parcial", bg: "#fef3c7", fg: "#b45309" },
  aguardando: { label: "Aguardando", bg: "#f1f5f9", fg: "#475569" },
  so_pago: { label: "Pago s/ oportun.", bg: "#dbeafe", fg: "#1d4ed8" },
};

function corMeta(p: number): string {
  if (p >= 100) return "#10b981";
  if (p >= 70) return "#3b82f6";
  if (p >= 40) return "#f59e0b";
  return "#ef4444";
}

/**
 * Gera o Relatório Comercial como Buffer PDF.
 */
export async function gerarComercialPdf(args: {
  data: ComercialDashboardData;
  detalhes: DetalheAtendentePdf[];
  nomeEscritorio: string;
}): Promise<Buffer> {
  const { data, detalhes, nomeEscritorio } = args;

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 40,
        bufferPages: true,
        info: {
          Title: `Relatório Comercial — ${nomeEscritorio}`,
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
      // pdfkit 0.17 ignora `ellipsis` sem `height`, e `lineBreak:false` ainda
      // quebra a linha quando há `width` — então truncamos na mão, medindo na
      // fonte/tamanho atuais. Chamar SEMPRE depois de fixar font()+fontSize().
      const fit = (texto: string, larguraMax: number): string => {
        if (!texto) return texto;
        if (doc.widthOfString(texto) <= larguraMax) return texto;
        const ell = "…";
        let t = texto;
        while (t.length > 1 && doc.widthOfString(t + ell) > larguraMax) {
          t = t.slice(0, -1);
        }
        return t.replace(/\s+$/, "") + ell;
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
      doc.save().rect(0, 0, doc.page.width, 5).fill(C.blue).restore();
      doc.fillColor(C.dark).font("Helvetica-Bold").fontSize(20)
        .text("Relatório Comercial", L, 42);
      doc.fillColor(C.muted).font("Helvetica").fontSize(10.5)
        .text(nomeEscritorio, L, doc.y + 1);

      // Nome do setor/atendente derivado do ranking (ids → labels).
      const setorNome = data.filtros.setorId != null
        ? (data.ranking[0]?.setorNome ?? "—")
        : "Todos os comerciais";
      const atendenteNome = data.filtros.atendenteId != null
        ? (data.ranking.find((r) => r.atendenteId === data.filtros.atendenteId)?.nome ?? "—")
        : "Todos";
      const emitido = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

      let y = doc.y + 6;
      // Duas linhas de rótulo (7.5pt) + valor (9pt): cada linha ocupa ~20pt,
      // então a segunda começa em +26 — antes começava em +17 e o rótulo
      // caía em cima do valor da primeira.
      rrect(L, y, W, 48, 5, "#f8fafc", C.line, 0.8);
      const colMeta = W / 2;
      const meta = (label: string, val: string, x: number, yy: number) => {
        doc.fillColor(C.faint).font("Helvetica").fontSize(7.5).text(label.toUpperCase(), x, yy);
        doc.fillColor(C.dark).font("Helvetica-Bold").fontSize(9)
          .text(fit(val, colMeta - 16), x, yy + 9, { width: colMeta - 16, lineBreak: false });
      };
      meta("Período", `${formatData(data.periodo.dataInicio)} a ${formatData(data.periodo.dataFim)}`, L + 10, y + 6);
      meta("Setor comercial", setorNome, L + colMeta, y + 6);
      meta("Atendente", atendenteNome, L + 10, y + 26);
      meta("Emitido em", emitido, L + colMeta, y + 26);
      doc.y = y + 58;

      // ── 1) FECHAMENTO TOTAL (KPIs) ───────────────────────────────────────────
      sectionHeader("Fechamento total", C.emerald, "Resumo consolidado do período.");
      {
        const k = data.kpis;
        const pctRecebidoFechado = k.valorTotalFechado > 0
          ? (k.faturado / k.valorTotalFechado) * 100 : null;
        const pctPagosFechados = k.clientesFechados > 0
          ? (k.clientesPagantes / k.clientesFechados) * 100 : null;
        const ticketFechado = k.contratosFechados > 0
          ? k.valorTotalFechado / k.contratosFechados : 0;

        const gap = 8;
        // Card "Cancelados" só entra quando o payload traz o número (5 colunas).
        const temCancelados = k.cancelados != null;
        const nCards = temCancelados ? 5 : 4;
        const cw = (W - gap * (nCards - 1)) / nCards;

        const deltaStr = (p: number) =>
          p === 0 ? "sem mudança" : `${p > 0 ? "+" : ""}${pct1(p)} vs anterior`;

        // Com 5 cartões cada um tem ~97pt: "R$ 84.350,00" a 14pt não cabe e
        // o pdfkit quebra a linha mesmo com lineBreak:false (o texto invade a
        // linha de baixo). Cada texto encolhe a fonte até `min`; as linhas
        // explicativas (sub2, rodapé) ainda podem quebrar em 2 linhas — a
        // altura do cartão é medida ANTES de desenhar, pra caber tudo; só no
        // limite corta com reticências.
        type Linha = { texto: string; tam: number; altura: number; quebra: boolean };
        const medir = (
          texto: string, larguraMax: number, base: number, min: number, fonte: string, maxLinhas: 1 | 2,
        ): Linha => {
          doc.font(fonte);
          let tam = base;
          doc.fontSize(tam);
          while (tam > min && doc.widthOfString(texto) > larguraMax) {
            tam = Math.max(min, tam - 0.5);
            doc.fontSize(tam);
          }
          // heightOfString conta o lineGap por linha — comparar com a mesma régua.
          const umaLinha = doc.currentLineHeight(true);
          if (doc.widthOfString(texto) <= larguraMax) return { texto, tam, altura: umaLinha, quebra: false };
          if (maxLinhas > 1) {
            const h = doc.heightOfString(texto, { width: larguraMax });
            if (h <= umaLinha * maxLinhas + 0.5) return { texto, tam, altura: h, quebra: true };
          }
          return { texto: fit(texto, larguraMax), tam, altura: umaLinha, quebra: false };
        };
        const escrever = (l: Linha, fonte: string, cor: string, x: number, y: number, larguraMax: number) => {
          doc.fillColor(cor).font(fonte).fontSize(l.tam)
            .text(l.texto, x, y, { width: larguraMax, lineBreak: l.quebra });
        };

        type Kpi = {
          label: string; value: string; color: string; bd: string;
          delta?: number; sub1?: string; sub2?: string;
          subBg?: string; subBd?: string; subFg?: string; foot?: string;
        };
        const medirCard = (o: Kpi) => {
          const label = medir(o.label, cw - 24, 7.5, 6, "Helvetica", 1);
          const value = medir(o.value, cw - 14, 14, 9.5, "Helvetica-Bold", 1);
          const delta = o.delta != null ? medir(deltaStr(o.delta), cw - 14, 7.5, 6, "Helvetica-Bold", 1) : null;
          const sub1 = o.sub1 ? medir(o.sub1, cw - 24, 7, 5.5, "Helvetica-Bold", 1) : null;
          const sub2 = o.sub1 && o.sub2 ? medir(o.sub2, cw - 24, 6.5, 5.5, "Helvetica", 2) : null;
          const foot = o.foot ? medir(o.foot, cw - 14, 6.3, 5.5, "Helvetica-Oblique", 2) : null;
          const subH = sub1 ? 3.5 + 9 + (sub2 ? sub2.altura + 1.5 : 0) + 2.5 : 0;
          // 8 (topo) + 14 (rótulo) + 19 (valor) + delta + caixa + rodapé + 7
          const altura = 8 + 14 + 19 + (delta ? 11 : 0) + subH + (foot ? foot.altura + 6 : 0) + 7;
          return { label, value, delta, sub1, sub2, foot, subH, altura };
        };
        const desenharCard = (i: number, o: Kpi, m: ReturnType<typeof medirCard>, y0: number, ch: number) => {
          const x = L + i * (cw + gap);
          rrect(x, y0, cw, ch, 5, "#ffffff", o.bd, 1.2);
          let yy = y0 + 8;
          doc.save().circle(x + 11, yy + 4, 2.4).fill(o.color).restore();
          escrever(m.label, "Helvetica", C.muted, x + 18, yy + 0.5, cw - 24);
          yy += 14;
          escrever(m.value, "Helvetica-Bold", o.color, x + 8, yy, cw - 14);
          yy += 19;
          if (m.delta && o.delta != null) {
            const cor = o.delta === 0 ? C.muted : o.delta > 0 ? C.pos : C.neg;
            escrever(m.delta, "Helvetica-Bold", cor, x + 8, yy, cw - 14);
            yy += 11;
          }
          if (m.sub1) {
            rrect(x + 8, yy, cw - 16, m.subH, 3, o.subBg, o.subBd, 0.8);
            escrever(m.sub1, "Helvetica-Bold", o.subFg || C.dark, x + 12, yy + 3.5, cw - 24);
            if (m.sub2) escrever(m.sub2, "Helvetica", C.muted, x + 12, yy + 12.5, cw - 24);
          }
          if (m.foot) {
            escrever(m.foot, "Helvetica-Oblique", C.faint, x + 8, y0 + ch - 6 - m.foot.altura, cw - 14);
          }
        };

        const canceladosDepois = k.contratosFechadosCanceladosDepois || 0;
        const cards: Kpi[] = [
          {
            label: "Recebido", value: formatBRL(k.faturado), color: C.emerald, bd: C.emeraldBd,
            delta: k.variacaoFaturado,
            sub1: pctRecebidoFechado != null ? `${pct1(pctRecebidoFechado)} do total fechado` : "sem fechado no período",
            sub2: pctRecebidoFechado != null ? `de ${formatBRL(k.valorTotalFechado)}` : undefined,
            subBg: C.emeraldBg, subBd: C.emeraldBd, subFg: "#047857",
            foot: "cobranças pagas no período",
          },
          {
            label: "Contratos fechados", value: String(k.contratosFechados), color: C.blue, bd: C.blueBd,
            delta: k.variacaoContratosFechados, foot: "oportunidades ganhas no período",
            ...(temCancelados && canceladosDepois > 0
              ? {
                sub1: `${canceladosDepois} cancelado(s) depois`,
                sub2: `${formatBRL(k.valorFechadosCanceladosDepois || 0)} cancelados`,
                subBg: "#fef2f2", subBd: "#fecaca", subFg: "#991b1b",
              }
              : {}),
          },
        ];
        if (temCancelados) {
          cards.push({
            label: "Cancelados", value: String(k.cancelados || 0), color: C.neg, bd: "#fecaca",
            delta: k.variacaoCancelados,
            sub1: `${formatBRL(k.valorCancelados || 0)} cancelados`,
            sub2: `${k.canceladosFecharamNoPeriodo || 0} fechou no período · ${Math.max(0, (k.cancelados || 0) - (k.canceladosFecharamNoPeriodo || 0))} antes`,
            subBg: "#fef2f2", subBd: "#fecaca", subFg: "#991b1b",
            foot: "pela data do cancelamento",
          });
        }
        cards.push(
          {
            label: "Clientes que pagaram", value: String(k.clientesPagantes), color: C.indigo, bd: C.indigoBd,
            delta: k.variacaoClientesPagantes,
            sub1: pctPagosFechados != null ? `${pct1(pctPagosFechados)} dos que fecharam` : "sem fechado no período",
            sub2: pctPagosFechados != null ? `${k.clientesPagantes} de ${k.clientesFechados} clientes` : undefined,
            subBg: C.indigoBg, subBd: C.indigoBd, subFg: "#4338ca",
            foot: "quantas cobranças ele pagou não muda",
          },
          {
            label: "Ticket médio", value: formatBRL(ticketFechado), color: C.violet, bd: C.violetBd,
            sub1: `${formatBRL(k.ticketMedio)} recebido`, sub2: "recebido ÷ clientes que pagaram",
            subBg: C.violetBg, subBd: C.violetBd, subFg: "#6d28d9",
            foot: "fechado ÷ contratos fechados",
          },
        );
        const medidas = cards.map(medirCard);
        const ch = Math.max(92, ...medidas.map((m) => m.altura));
        ensure(ch + 14);
        const y0 = doc.y;
        cards.forEach((o, i) => desenharCard(i, o, medidas[i], y0, ch));
        doc.y = y0 + ch + 14;
      }

      // ── 2) FECHAMENTO POR ATENDENTE (ranking) ────────────────────────────────
      sectionHeader("Fechamento por atendente", C.amber, "Ranking do período. Top 3 destacados.");
      if (data.ranking.length === 0) {
        doc.fillColor(C.muted).font("Helvetica-Oblique").fontSize(9)
          .text("Sem atendentes no setor comercial selecionado.", L, doc.y);
        doc.moveDown(0.8);
      } else {
        const xRank = L, xAtend = L + 22, xFech = L + 168, wFech = 76,
          xContr = L + 248, wContr = 44, xReceb = L + 296, wReceb = 80,
          xTicket = L + 380, wTicket = 64, xMeta = L + 450, wMeta = 65;
        const yh = doc.y;
        doc.fillColor(C.muted).font("Helvetica-Bold").fontSize(7.5);
        doc.text("#", xRank, yh, { width: 18 });
        doc.text("Atendente", xAtend, yh, { width: 140 });
        doc.text("Fechado", xFech, yh, { width: wFech, align: "right" });
        doc.text("Contr.", xContr, yh, { width: wContr, align: "right" });
        doc.text("Recebido", xReceb, yh, { width: wReceb, align: "right" });
        doc.text("Ticket méd.", xTicket, yh, { width: wTicket, align: "right" });
        doc.text("Meta", xMeta, yh, { width: wMeta, align: "right" });
        doc.y = yh + 12;
        hr(doc.y, C.line, 0.7);
        doc.y += 4;

        data.ranking.forEach((r, idx) => {
          ensure(26);
          const yr = doc.y;
          const top3 = idx < 3;
          if (top3) rrect(L - 2, yr - 2, W + 4, 22, 3, C.amberBg);
          doc.fillColor(top3 ? C.amber : C.muted).font(top3 ? "Helvetica-Bold" : "Helvetica")
            .fontSize(8.5).text(`${idx + 1}º`, xRank, yr + 3, { width: 18 });
          doc.fillColor(C.dark).font(top3 ? "Helvetica-Bold" : "Helvetica").fontSize(8.5)
            .text(fit(r.nome, 140), xAtend, yr, { width: 140, lineBreak: false });
          if (r.setorNome) {
            doc.fillColor(C.faint).font("Helvetica").fontSize(6.5)
              .text(fit(r.setorNome, 140), xAtend, yr + 10, { width: 140, lineBreak: false });
          }
          doc.fillColor(C.blue).font("Helvetica-Bold").fontSize(8.5)
            .text(formatBRL(r.valorFechado), xFech, yr + 3, { width: wFech, align: "right", lineBreak: false });
          doc.fillColor(C.muted).font("Helvetica").fontSize(8.5)
            .text(String(r.contratosFechados), xContr, yr + 3, { width: wContr, align: "right" });
          doc.fillColor(C.emerald).font("Helvetica-Bold").fontSize(8.5)
            .text(formatBRL(r.faturado), xReceb, yr + 3, { width: wReceb, align: "right", lineBreak: false });
          doc.fillColor(C.muted).font("Helvetica").fontSize(8.5)
            .text(formatBRL(r.ticketMedio), xTicket, yr + 3, { width: wTicket, align: "right", lineBreak: false });
          if (r.progressoMeta != null) {
            const bw = 34, bx = xMeta, by = yr + 6;
            rrect(bx, by, bw, 5, 2.5, "#e5e7eb");
            rrect(bx, by, bw * Math.min(1, r.progressoMeta / 100), 5, 2.5, corMeta(r.progressoMeta));
            doc.fillColor(C.dark).font("Helvetica-Bold").fontSize(7.5)
              .text(`${Math.round(r.progressoMeta)}%`, bx + bw + 3, yr + 3, { width: wMeta - bw - 3, align: "right" });
          } else {
            doc.fillColor(C.faint).font("Helvetica").fontSize(8)
              .text("—", xMeta, yr + 3, { width: wMeta, align: "right" });
          }
          doc.y = yr + 22;
        });
        doc.y += 8;
      }

      // ── 3) FECHADO E RECEBIDO POR CLIENTE DO ATENDENTE ───────────────────────
      sectionHeader(
        "Fechado e recebido por cliente do atendente",
        C.blue,
        "Detalhamento dos clientes fechados e cobranças recebidas por atendente no período.",
      );
      if (detalhes.length === 0) {
        doc.fillColor(C.muted).font("Helvetica-Oblique").fontSize(9)
          .text("Nenhum cliente fechado ou pagamento registrado no período.", L, doc.y);
        doc.moveDown(0.8);
      } else {
        detalhes.forEach((at) => {
          ensure(60);
          const yh = doc.y;
          rrect(L, yh, W, 22, 4, "#f8fafc", C.line, 0.8);
          doc.fillColor(C.dark).font("Helvetica-Bold").fontSize(9.5)
            .text(fit(at.nome, 200), L + 8, yh + 5, { width: 200, lineBreak: false });
          if (at.setorNome) {
            doc.fillColor(C.faint).font("Helvetica").fontSize(6.8)
              .text(fit(at.setorNome, 200), L + 8, yh + 15, { width: 200, lineBreak: false });
          }
          doc.fillColor(C.muted).font("Helvetica").fontSize(7.5)
            .text("Total fechado", L + W - 250, yh + 4, { width: 110, align: "right" });
          doc.fillColor(C.blue).font("Helvetica-Bold").fontSize(9)
            .text(formatBRL(at.totalFechado), L + W - 250, yh + 12, { width: 110, align: "right", lineBreak: false });
          doc.fillColor(C.muted).font("Helvetica").fontSize(7.5)
            .text("Total recebido", L + W - 130, yh + 4, { width: 122, align: "right" });
          doc.fillColor(C.emerald).font("Helvetica-Bold").fontSize(9)
            .text(formatBRL(at.totalRecebido), L + W - 130, yh + 12, { width: 122, align: "right", lineBreak: false });
          doc.y = yh + 26;

          const xCli = L + 6, xF = L + 178, wF = 72, xC = L + 252, wC = 32,
            xRcv = L + 290, wRcv = 72, xP = L + 364, wP = 32, xS = L + 404;
          const yc = doc.y;
          doc.fillColor(C.faint).font("Helvetica-Bold").fontSize(6.8);
          doc.text("Cliente", xCli, yc, { width: 160 });
          doc.text("Fechado", xF, yc, { width: wF, align: "right" });
          doc.text("Contr.", xC, yc, { width: wC, align: "right" });
          doc.text("Recebido", xRcv, yc, { width: wRcv, align: "right" });
          doc.text("Pagos", xP, yc, { width: wP, align: "right" });
          doc.text("Status", xS, yc, { width: R - xS });
          doc.y = yc + 11;

          at.itens.forEach((cl) => {
            ensure(18);
            const yr = doc.y;
            doc.fillColor(C.dark).font("Helvetica").fontSize(8)
              .text(fit(cl.nome, 165), xCli, yr + 2, { width: 165, lineBreak: false });
            doc.fillColor(C.blue).font("Helvetica-Bold").fontSize(8)
              .text(formatBRL(cl.valorFechado), xF, yr + 2, { width: wF, align: "right", lineBreak: false });
            doc.fillColor(C.muted).font("Helvetica").fontSize(8)
              .text(String(cl.contratosFechados), xC, yr + 2, { width: wC, align: "right" });
            doc.fillColor(C.emerald).font("Helvetica-Bold").fontSize(8)
              .text(formatBRL(cl.valorRecebido), xRcv, yr + 2, { width: wRcv, align: "right", lineBreak: false });
            doc.fillColor(C.muted).font("Helvetica").fontSize(8)
              .text(String(cl.contratosPagos), xP, yr + 2, { width: wP, align: "right" });
            const st = STATUS_INFO[cl.status] || STATUS_INFO.aguardando;
            const pw = doc.font("Helvetica-Bold").fontSize(6.5).widthOfString(st.label) + 10;
            rrect(xS, yr + 1, pw, 11, 5.5, st.bg);
            doc.fillColor(st.fg).font("Helvetica-Bold").fontSize(6.5)
              .text(st.label, xS + 5, yr + 4, { lineBreak: false });
            doc.y = yr + 15;
            hr(doc.y - 1, "#f1f5f9", 0.5);
          });
          doc.y += 10;
        });
      }

      // ── 4) FUNIL DE VENDAS ───────────────────────────────────────────────────
      // Dois blocos: etapas abertas por quem ENTROU no período; Ganho/Perdido
      // por quem foi DECIDIDO no período (a mesma data do card de fechados).
      ensure(200);
      {
        const fr = data.funilResumo;
        sectionHeader(
          "Funil de Vendas", C.violet,
          fr
            ? `${fr.entraram.total} entraram no período (${fr.entraram.emAberto} em aberto + ${fr.entraram.jaDecididos} já decididos) · ${fr.decididos.total} decididos no período`
            : undefined,
        );
        const maxTotal = Math.max(...ETAPAS_FUNIL.map((e) => data.etapas?.[e]?.total ?? 0), 1);
        const labW = 70, valW = 88, barX = L + labW + 6, barW = W - labW - valW - 12;
        const grupo = (texto: string) => {
          ensure(16);
          doc.fillColor(C.faint).font("Helvetica-Bold").fontSize(6.5)
            .text(texto.toUpperCase(), L, doc.y + 2, { width: W, lineBreak: false, characterSpacing: 0.4 });
          doc.y += 12;
        };
        const barra = (e: string) => {
          ensure(22);
          const info = data.etapas?.[e] ?? { total: 0, valor: 0 };
          const yr = doc.y;
          doc.fillColor(C.dark).font("Helvetica-Bold").fontSize(8)
            .text(ETAPA_LABELS[e] || e, L, yr + 4, { width: labW, lineBreak: false });
          rrect(barX, yr, barW, 16, 8, "#eef2f6");
          if (info.total > 0) {
            const w = Math.max(barW * (info.total / maxTotal), 14);
            rrect(barX, yr, w, 16, 8, ETAPA_COR[e]);
          }
          doc.fillColor(C.dark).font("Helvetica-Bold").fontSize(8)
            .text(String(info.total), barX, yr + 4, { width: barW, align: "center", lineBreak: false });
          doc.fillColor(C.muted).font("Helvetica").fontSize(8)
            .text(formatBRL(info.valor), barX + barW + 6, yr + 4, { width: valW - 6, align: "right", lineBreak: false });
          doc.y = yr + 20;
        };
        const subLinha = (e: "fechado_ganho" | "fechado_perdido") => {
          const d = fr?.decididos?.[e];
          if (!d) return;
          ensure(12);
          doc.fillColor(C.muted).font("Helvetica").fontSize(6.5)
            .text(`${d.entraramNoPeriodo} entraram no período · ${d.entraramAntes} entraram antes`, barX, doc.y - 3, { width: barW, lineBreak: false });
          doc.y += 8;
        };
        grupo("Entraram no período · etapa em que estão hoje");
        (["novo", "qualificado", "proposta", "negociacao"] as const).forEach(barra);
        grupo("Decididos no período · pela data do fechamento");
        barra("fechado_ganho");
        subLinha("fechado_ganho");
        barra("fechado_perdido");
        subLinha("fechado_perdido");
        if (fr?.cancelados) {
          grupo("Cancelados no período · pela data do cancelamento");
          barra("cancelado");
          ensure(12);
          doc.fillColor(C.muted).font("Helvetica").fontSize(6.5)
            .text(`${fr.cancelados.fecharamNoPeriodo} fechou neste período · ${fr.cancelados.fecharamAntes} fechou antes`, barX, doc.y - 3, { width: barW, lineBreak: false });
          doc.y += 8;
        }
        doc.y += 8;
      }

      // ── 5) FATURADO POR DIA ──────────────────────────────────────────────────
      ensure(160);
      sectionHeader("Faturado por dia", C.emerald);
      if (data.cobrancasPorDia.length === 0) {
        doc.fillColor(C.muted).font("Helvetica-Oblique").fontSize(9)
          .text("Sem faturamento no período.", L, doc.y);
        doc.moveDown(0.8);
      } else {
        const dias = data.cobrancasPorDia;
        const chartH = 110, padL = 42, plotX = L + padL, plotW = W - padL,
          top = doc.y, base = top + chartH;
        const maxV = Math.max(...dias.map((p) => p.faturado), 1);
        [0, 0.5, 1].forEach((f) => {
          const yy = base - chartH * f;
          hr(yy, "#eef2f6", 0.6);
          doc.fillColor(C.faint).font("Helvetica").fontSize(6.5)
            .text(formatBRLk(maxV * f), L, yy - 3, { width: padL - 6, align: "right" });
        });
        const n = dias.length;
        const px = (i: number) => (n === 1 ? plotX + plotW / 2 : plotX + (plotW * i) / (n - 1));
        const py = (v: number) => base - chartH * (v / maxV);
        if (n === 1) {
          const bw = 24, bx = px(0) - bw / 2;
          rrect(bx, py(dias[0].faturado), bw, base - py(dias[0].faturado), 0, C.emerald);
        } else {
          doc.save();
          doc.moveTo(px(0), base);
          dias.forEach((p, i) => doc.lineTo(px(i), py(p.faturado)));
          doc.lineTo(px(n - 1), base).closePath().fillOpacity(0.16).fill(C.emerald);
          doc.restore();
          doc.save().strokeColor("#10b981").lineWidth(1.5);
          dias.forEach((p, i) => (i === 0 ? doc.moveTo(px(i), py(p.faturado)) : doc.lineTo(px(i), py(p.faturado))));
          doc.stroke().restore();
        }
        const step = Math.max(1, Math.ceil(n / 8));
        dias.forEach((p, i) => {
          if (i % step === 0 || i === n - 1) {
            doc.fillColor(C.faint).font("Helvetica").fontSize(6)
              .text(formatDiaCurto(p.dia), px(i) - 12, base + 4, { width: 24, align: "center" });
          }
        });
        doc.y = base + 18;
      }

      // Grade de caixas (contagem + label), com quebra de linha automática.
      const gridDeCaixas = (
        items: Array<{ valor: number; label: string }>,
        opts: { cols: number; corNumero: string; corBorda: string },
      ) => {
        const { cols, corNumero, corBorda } = opts;
        const gap = 8, bw = (W - gap * (cols - 1)) / cols, bh = 44;
        items.forEach((it, i) => {
          const col = i % cols;
          if (col === 0) ensure(bh + 8);
          const x = L + col * (bw + gap);
          const y0 = doc.y;
          rrect(x, y0, bw, bh, 5, "#ffffff", corBorda, 1);
          doc.fillColor(corNumero).font("Helvetica-Bold").fontSize(15)
            .text(String(it.valor), x, y0 + 8, { width: bw, align: "center" });
          doc.fillColor(C.muted).font("Helvetica").fontSize(7)
            .text(fit(it.label, bw - 8), x + 4, y0 + 29, { width: bw - 8, align: "center", lineBreak: false });
          // Avança a linha só na última coluna (ou no último item).
          if (col === cols - 1 || i === items.length - 1) doc.y = y0 + bh + 8;
          else doc.y = y0;
        });
        doc.y += 8;
      };

      // ── 6) LEADS POR CANAL DE CAPTAÇÃO ───────────────────────────────────────
      // Os mesmos leads do bloco "Entraram no período", pelo canal da ficha.
      ensure(95);
      {
        const canais = data.leadsPorCanal || [];
        const totalCanal = canais.reduce((s, c) => s + c.total, 0);
        sectionHeader(
          "Leads por canal de captação", C.blue,
          `${totalCanal} leads que entraram no período, pelo canal da ficha. Manual = cadastrado à mão.`,
        );
        if (canais.length === 0) {
          doc.fillColor(C.muted).font("Helvetica-Oblique").fontSize(9)
            .text("Sem leads no período.", L, doc.y);
          doc.moveDown(0.8);
        } else {
          const xCanal = L + 4, wCanal = 220, xQtd = L + 230, wQtd = 80, xPct = L + 316, wPct = 80;
          const yc = doc.y;
          doc.fillColor(C.muted).font("Helvetica-Bold").fontSize(7);
          doc.text("Canal", xCanal, yc, { width: wCanal });
          doc.text("Leads", xQtd, yc, { width: wQtd, align: "right" });
          doc.text("%", xPct, yc, { width: wPct, align: "right" });
          doc.y = yc + 10;
          hr(doc.y, C.line, 0.5);
          doc.y += 3;
          for (const c of canais) {
            ensure(14);
            const yr = doc.y;
            doc.fillColor(C.dark).font("Helvetica").fontSize(8)
              .text(ORIGEM_LABELS[c.canal] || c.canal, xCanal, yr, { width: wCanal, lineBreak: false });
            doc.fillColor(C.dark).font("Helvetica-Bold").fontSize(8)
              .text(String(c.total), xQtd, yr, { width: wQtd, align: "right", lineBreak: false });
            doc.fillColor(C.muted).font("Helvetica").fontSize(8)
              .text(totalCanal > 0 ? pct1((c.total / totalCanal) * 100) : "—", xPct, yr, { width: wPct, align: "right", lineBreak: false });
            doc.y = yr + 12;
          }
          doc.y += 8;
        }
      }

      // ── 7) FECHAMENTOS POR ORIGEM ────────────────────────────────────────────
      ensure(95);
      {
        const grupos = data.fechamentosPorOrigem;
        const totFech = grupos.reduce((s, o) => s + (o.total || 0), 0);
        const totFechado = grupos.reduce((s, o) => s + (o.valorTotal || 0), 0);
        const totRecebido = grupos.reduce((s, o) => s + (o.recebidoTotal || 0), 0);
        sectionHeader(
          "Fechamentos por origem", C.emerald,
          grupos.length
            ? `${totFech} fechamentos · ${formatBRL(totFechado)} fechado · ${formatBRL(totRecebido)} recebido no período. ` +
              "Recebido = cobranças pagas no período dos clientes de cada origem (mesma conta do card Recebido)."
            : "Origem registrada no cadastro do fechamento (Google revisional, Meta leilão, BNI, etc.).",
        );
      }
      if (data.fechamentosPorOrigem.length === 0) {
        doc.fillColor(C.muted).font("Helvetica-Oblique").fontSize(9)
          .text("Sem fechamentos no período.", L, doc.y);
        doc.moveDown(0.8);
      } else {
        gridDeCaixas(
          data.fechamentosPorOrigem.map((o) => ({ valor: o.total, label: o.origem })),
          { cols: 4, corNumero: "#047857", corBorda: C.emeraldBd },
        );

        // Subtabela por origem: clientes de cada fechamento (mesma ordem
        // dos cards), com o recebido no período e a situação de cada um.
        for (const o of data.fechamentosPorOrigem) {
          if (!o.fechamentos || o.fechamentos.length === 0) continue;
          ensure(46);
          const yh = doc.y;
          rrect(L, yh, W, 18, 4, "#f6fdf9", C.emeraldBd, 0.8);
          doc.fillColor("#065f46").font("Helvetica-Bold").fontSize(8.5)
            .text(fit(o.origem, W - 300), L + 8, yh + 5, { width: W - 300, lineBreak: false });
          doc.fillColor("#047857").font("Helvetica-Bold").fontSize(7.5)
            .text(`${o.total} fechamento(s) · ${formatBRL(o.valorTotal || 0)} fechado · ${formatBRL(o.recebidoTotal || 0)} recebido no período`,
              L + W - 288, yh + 5, { width: 280, align: "right", lineBreak: false });
          doc.y = yh + 24;

          const xCli = L + 4, wCli = 150, xData = L + 158, wData = 56,
            xVal = L + 216, wVal = 72, xRec = L + 292, wRec = 72,
            xSit = L + 368, wSit = 64, xResp = L + 436, wResp = W - 440;
          const yc = doc.y;
          doc.fillColor(C.muted).font("Helvetica-Bold").fontSize(7);
          doc.text("Cliente", xCli, yc, { width: wCli });
          doc.text("Fechado em", xData, yc, { width: wData });
          doc.text("Valor", xVal, yc, { width: wVal, align: "right" });
          doc.text("Recebido", xRec, yc, { width: wRec, align: "right" });
          doc.text("Situação", xSit, yc, { width: wSit });
          doc.text("Responsável", xResp, yc, { width: wResp });
          doc.y = yc + 10;
          hr(doc.y, C.line, 0.5);
          doc.y += 3;

          for (const f of o.fechamentos) {
            ensure(14);
            const yr = doc.y;
            const nomeCliente = f.mesmoCliente && f.mesmoCliente > 1
              ? `${f.cliente} (mesmo cliente · ${f.mesmoCliente} fech.)`
              : f.cliente;
            doc.fillColor(C.dark).font("Helvetica").fontSize(8)
              .text(fit(nomeCliente, wCli), xCli, yr, { width: wCli, lineBreak: false });
            doc.fillColor(C.muted).font("Helvetica").fontSize(8)
              .text(f.fechadoEm ? new Date(f.fechadoEm).toLocaleDateString("pt-BR") : "—",
                xData, yr, { width: wData, lineBreak: false });
            doc.fillColor(C.emerald).font("Helvetica-Bold").fontSize(8)
              .text(f.valor == null ? "—" : formatBRL(f.valor || 0), xVal, yr, { width: wVal, align: "right", lineBreak: false });
            const recebido = f.recebido || 0;
            doc.fillColor(recebido > 0 ? C.emerald : C.muted).font(recebido > 0 ? "Helvetica-Bold" : "Helvetica").fontSize(8)
              .text(formatBRL(recebido), xRec, yr, { width: wRec, align: "right", lineBreak: false });
            if (f.canceladoEm) {
              doc.fillColor(C.neg).font("Helvetica-Bold").fontSize(7.5)
                .text("Cancelado", xSit, yr, { width: wSit, lineBreak: false });
            } else {
              doc.fillColor(C.muted).font("Helvetica").fontSize(7.5)
                .text(SITUACAO_FECHAMENTO_LABEL[f.situacao || "nada"] || "—", xSit, yr, { width: wSit, lineBreak: false });
            }
            doc.fillColor(C.muted).font("Helvetica").fontSize(8)
              .text(fit(f.responsavel || "—", wResp), xResp, yr, { width: wResp, lineBreak: false });
            doc.y = yr + 12;
          }
          doc.y += 8;
        }
      }

      // ── 8) CONTRATOS CANCELADOS NO PERÍODO ───────────────────────────────────
      if (data.contratosCancelados && data.contratosCancelados.length > 0) {
        const lista = data.contratosCancelados;
        const totValor = lista.reduce((s, c) => s + (c.valor || 0), 0);
        const totAntes = lista.reduce((s, c) => s + (c.recebidoAntes || 0), 0);
        ensure(70);
        sectionHeader(
          "Contratos cancelados no período", C.neg,
          `${lista.length} contrato(s) · valiam ${formatBRL(totValor)} · ${formatBRL(totAntes)} recebido antes de cancelar. ` +
            "Pela data do cancelamento; o fechamento continua contando no mês em que fechou.",
        );
        const xCli = L + 4, wCli = 130, xFech = L + 138, wFech = 54, xCanc = L + 196, wCanc = 54,
          xVal = L + 254, wVal = 66, xAntes = L + 324, wAntes = 66, xMot = L + 394, wMot = W - 398;
        const yc = doc.y;
        doc.fillColor(C.muted).font("Helvetica-Bold").fontSize(7);
        doc.text("Cliente", xCli, yc, { width: wCli });
        doc.text("Fechado em", xFech, yc, { width: wFech });
        doc.text("Cancelado em", xCanc, yc, { width: wCanc });
        doc.text("Valor", xVal, yc, { width: wVal, align: "right" });
        doc.text("Recebido antes", xAntes, yc, { width: wAntes, align: "right" });
        doc.text("Motivo · responsável", xMot, yc, { width: wMot });
        doc.y = yc + 10;
        hr(doc.y, C.line, 0.5);
        doc.y += 3;
        for (const c of lista) {
          ensure(14);
          const yr = doc.y;
          doc.fillColor(C.dark).font("Helvetica").fontSize(8)
            .text(fit(c.cliente, wCli), xCli, yr, { width: wCli, lineBreak: false });
          doc.fillColor(C.muted).font("Helvetica").fontSize(8)
            .text(c.fechadoEm ? new Date(c.fechadoEm).toLocaleDateString("pt-BR") : "—", xFech, yr, { width: wFech, lineBreak: false });
          doc.fillColor(C.neg).font("Helvetica-Bold").fontSize(8)
            .text(c.canceladoEm ? new Date(c.canceladoEm).toLocaleDateString("pt-BR") : "—", xCanc, yr, { width: wCanc, lineBreak: false });
          doc.fillColor(C.dark).font("Helvetica-Bold").fontSize(8)
            .text(formatBRL(c.valor || 0), xVal, yr, { width: wVal, align: "right", lineBreak: false });
          doc.fillColor(c.recebidoAntes > 0 ? C.emerald : C.muted).font("Helvetica").fontSize(8)
            .text(formatBRL(c.recebidoAntes || 0), xAntes, yr, { width: wAntes, align: "right", lineBreak: false });
          const motivo = (MOTIVO_CANCELAMENTO_LABEL[c.motivo || ""] || c.motivo || "—") + (c.detalhe ? ` — ${c.detalhe}` : "") + (c.responsavel ? ` · ${c.responsavel}` : "");
          doc.fillColor(C.muted).font("Helvetica").fontSize(7.5)
            .text(fit(motivo, wMot), xMot, yr, { width: wMot, lineBreak: false });
          doc.y = yr + 12;
        }
        doc.y += 8;
      }

      // ── Nota de metodologia ──────────────────────────────────────────────────
      ensure(40);
      hr(doc.y, C.line, 0.7);
      doc.y += 6;
      doc.fillColor(C.faint).font("Helvetica-Oblique").fontSize(7).text(
        "Recebido: cobranças pagas comissionáveis no período de clientes fechados no mesmo período. " +
          "Contratos fechados: oportunidades movidas para a etapa Ganho. Clientes que pagaram: clientes " +
          "distintos com cobrança paga no período — quantas cobranças ou parcelas cada um pagou " +
          "não altera a contagem. Ticket médio fechado = total fechado ÷ contratos fechados. " +
          "Funil: etapas abertas contam leads criados no período; Ganho e Perdido contam pela data da decisão. " +
          "Recebido por origem: os mesmos pagamentos do card Recebido, cada um no fechamento mais recente do cliente " +
          "antes da data do pagamento; o que não encaixa em origem nenhuma vai para \"Sem origem / fora do filtro\". " +
          "Cancelados: contratos fechados que o cliente desfez, pela data do cancelamento; o fechamento continua " +
          "contando no mês em que fechou e o que já foi recebido não muda. \"Lançado por engano\" não entra na conta.",
        L, doc.y, { width: W, align: "left" },
      );

      // ── Rodapé (paginação) ───────────────────────────────────────────────────
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        doc.page.margins.bottom = 0; // evita page-break automático ao escrever no rodapé
        doc.fillColor(C.faint).font("Helvetica").fontSize(7.5)
          .text("JuridFlow · Relatório Comercial", L, PH - 30, { width: W / 2, lineBreak: false });
        doc.text(`Página ${i + 1} de ${range.count}`, L + W / 2, PH - 30, { width: W / 2, align: "right", lineBreak: false });
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

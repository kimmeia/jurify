/**
 * Gera a listagem "Cards do Kanban" em PDF (pdfkit).
 *
 * É uma listagem, não um painel: uma linha por card, do cadastro mais recente
 * para o mais antigo. A4 paisagem porque em retrato o nome do cliente — a
 * primeira coisa que se procura na lista — teria que ser cortado.
 *
 * Mesmo padrão dos outros geradores: retorna Buffer (base64 na camada tRPC).
 */

import PDFDocument from "pdfkit";

export type CardPdf = {
  clienteNome: string | null;
  titulo: string;
  funilNome: string;
  colunaNome: string;
  responsavelNome: string | null;
  /** ISO — data de criação do card. */
  criadoEm: string;
  /** ISO ou null. */
  prazo: string | null;
  valorEstimado: number | null;
  prioridade: "alta" | "media" | "baixa";
  arquivado: boolean;
};

export type KanbanCardsPdfData = {
  cards: CardPdf[];
  funilLabel: string;
  /** "Todas" ou os nomes das colunas escolhidas, na ordem do quadro. */
  colunasLabel: string;
  responsavelLabel: string;
  periodoLabel: string;
};

// ── Formatação ──────────────────────────────────────────────────────────────

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
const fmtData = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
/** dd/mm — o ano do prazo raramente importa e a coluna é estreita. */
const fmtDiaMes = (iso: string) => fmtData(iso).slice(0, 5);

export function diasDesde(iso: string, agora: Date): number {
  const t = Date.parse(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.round((agora.getTime() - t) / 86_400_000));
}

/** "24 d", "3 m", "1 a 2 m" — a idade na unidade que cabe na coluna. */
export function idadeCurta(dias: number): string {
  if (dias < 60) return `${dias} d`;
  const meses = Math.round(dias / 30);
  if (meses < 12) return `${meses} m`;
  const anos = Math.floor(meses / 12);
  const resto = meses % 12;
  return resto === 0 ? `${anos} a` : `${anos} a ${resto} m`;
}

/** "Francisco Wesley Freitas" → "Francisco W. Freitas". */
export function abreviarNome(nome: string): string {
  const p = nome.trim().split(/\s+/).filter(Boolean);
  if (p.length <= 2) return nome.trim();
  const meio = p.slice(1, -1).map((m) => (m.length <= 3 ? m : `${m[0]}.`));
  return [p[0], ...meio, p[p.length - 1]].join(" ");
}

// ── Paleta (espelha as cores da tela) ───────────────────────────────────────

const C = {
  dark: "#0f172a", tinta2: "#1e293b", muted: "#64748b", faint: "#94a3b8",
  line: "#e2e8f0", hair: "#f1f5f9",
  rose: "#e11d48", amber: "#d97706", violet: "#7c3aed",
} as const;

const COR_PRIORIDADE: Record<CardPdf["prioridade"], string> = {
  alta: C.rose,
  media: C.amber,
  baixa: C.faint,
};

// Larguras somam 768pt — A4 paisagem com margem 36 deixa 769,89 úteis.
const COLS = [
  { k: "cliente", t: "Cliente", w: 138, a: "left" as const },
  { k: "card", t: "Card", w: 138, a: "left" as const },
  { k: "funil", t: "Funil", w: 84, a: "left" as const },
  // "Aguardando decisão" é o nome de coluna mais longo que aparece na prática.
  { k: "etapa", t: "Etapa", w: 96, a: "left" as const },
  { k: "resp", t: "Responsável", w: 92, a: "left" as const },
  { k: "cad", t: "Cadastrado", w: 66, a: "right" as const },
  { k: "idade", t: "Tempo", w: 40, a: "right" as const },
  { k: "prazo", t: "Prazo", w: 46, a: "right" as const },
  { k: "valor", t: "Valor", w: 68, a: "right" as const },
];

/** Gera a listagem de cards do Kanban como Buffer PDF. */
export async function gerarKanbanCardsPdf(args: {
  data: KanbanCardsPdfData;
  nomeEscritorio: string;
  agora?: Date;
}): Promise<Buffer> {
  const { data, nomeEscritorio } = args;
  const agora = args.agora ?? new Date();

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        layout: "landscape",
        margin: 36,
        bufferPages: true,
        info: {
          Title: `Cards do Kanban — ${nomeEscritorio}`,
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
      const BOTTOM = PH - 42;

      const X: Record<string, number> = {};
      {
        let x = L;
        for (const c of COLS) { X[c.k] = x; x += c.w; }
      }

      const rrect = (
        x: number, y: number, w: number, h: number, r: number,
        fill?: string, stroke?: string, sw = 1,
      ) => {
        doc.save();
        if (fill) doc.roundedRect(x, y, w, h, r).fill(fill);
        if (stroke) doc.roundedRect(x, y, w, h, r).lineWidth(sw).stroke(stroke);
        doc.restore();
      };
      const hr = (y: number, color: string = C.hair, w = 0.6) => {
        doc.save().strokeColor(color).lineWidth(w).moveTo(L, y).lineTo(R, y).stroke().restore();
      };

      /**
       * Corta o texto pra caber na largura, medindo de verdade. O `ellipsis`
       * do pdfkit deixa nome de responsável quebrar em duas linhas, o que
       * desalinha a tabela inteira; truncar aqui é determinístico.
       */
      const caber = (texto: string, largura: number, fonte: string, tamanho: number) => {
        doc.font(fonte).fontSize(tamanho);
        if (doc.widthOfString(texto) <= largura) return texto;
        let t = texto;
        while (t.length > 1 && doc.widthOfString(`${t}…`) > largura) t = t.slice(0, -1);
        return `${t.trimEnd()}…`;
      };

      const cabecalhoTabela = (y: number) => {
        doc.fillColor(C.faint).font("Helvetica-Bold").fontSize(7.2);
        for (const c of COLS) {
          const recuo = c.k === "cliente" ? 9 : 0;
          doc.text(c.t.toUpperCase(), X[c.k] + recuo, y, {
            width: c.w - recuo - (c.a === "right" ? 0 : 6),
            align: c.a,
            lineBreak: false,
          });
        }
        hr(y + 11, C.line, 0.8);
        return y + 16;
      };

      // ── Cabeçalho ────────────────────────────────────────────────────────
      doc.save().rect(0, 0, doc.page.width, 4).fill(C.violet).restore();
      doc.fillColor(C.dark).font("Helvetica-Bold").fontSize(18).text("Cards do Kanban", L, 36);
      doc.fillColor(C.muted).font("Helvetica").fontSize(10).text(nomeEscritorio, L, doc.y + 1);

      const totalValor = data.cards.reduce((a, c) => a + (c.valorEstimado ?? 0), 0);
      const vencidos = data.cards.filter(
        (c) => c.prazo && Date.parse(`${c.prazo.slice(0, 10)}T12:00:00Z`) < agora.getTime(),
      ).length;
      const maisAntigo = data.cards.length > 0
        ? Math.max(...data.cards.map((c) => diasDesde(c.criadoEm, agora)))
        : 0;

      const yMeta = doc.y + 7;
      rrect(L, yMeta, W, 77, 5, "#f8fafc", C.line, 0.8);
      const colW = W / 4;
      const meta = (label: string, val: string, i: number, linha: 0 | 1) => {
        const x = L + 11 + colW * i;
        const y = yMeta + (linha === 0 ? 7 : 30);
        doc.fillColor(C.faint).font("Helvetica").fontSize(6.8).text(label.toUpperCase(), x, y);
        doc.fillColor(C.dark).font("Helvetica-Bold").fontSize(8.6)
          .text(val, x, y + 8, { width: colW - 20, lineBreak: false, ellipsis: true });
      };
      meta("Funil", data.funilLabel, 0, 0);
      meta("Responsável", data.responsavelLabel, 1, 0);
      meta("Cadastrados em", data.periodoLabel, 2, 0);
      // Sem segundos: a precisão não ajuda ninguém e come espaço da célula.
      meta(
        "Emitido em",
        agora.toLocaleString("pt-BR", {
          timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short",
        }),
        3, 0,
      );
      meta("Cards na lista", String(data.cards.length), 0, 1);
      meta("Valor estimado", fmtBRL(totalValor), 1, 1);
      meta("Com prazo vencido", String(vencidos), 2, 1);
      meta(
        "Card mais antigo",
        data.cards.length > 0 ? `${idadeCurta(maisAntigo)} de cadastro` : "—",
        3, 1,
      );

      // Linha inteira: a lista de colunas escolhidas não cabe numa célula de
      // um quarto da largura, e truncá-la anularia o motivo de ela existir.
      {
        const y = yMeta + 53;
        doc.fillColor(C.faint).font("Helvetica").fontSize(6.8).text("COLUNAS", L + 11, y);
        doc.fillColor(C.dark).font("Helvetica-Bold").fontSize(8.6)
          .text(data.colunasLabel, L + 11, y + 8, { width: W - 22, lineBreak: false, ellipsis: true });
      }
      doc.y = yMeta + 87;

      doc.fillColor(C.muted).font("Helvetica").fontSize(7.6).text(
        "Do cadastro mais recente para o mais antigo.  Barra à esquerda = prioridade "
        + "(vermelho alta, âmbar média, cinza baixa).  Prazo em vermelho está vencido.",
        L, doc.y,
      );
      doc.y += 9;

      if (data.cards.length === 0) {
        doc.fillColor(C.muted).font("Helvetica-Oblique").fontSize(10)
          .text("Nenhum card com os filtros aplicados.", L, doc.y + 12);
      } else {
        let y = cabecalhoTabela(doc.y);
        const LINHA = 19;

        for (const c of data.cards) {
          if (y + LINHA > BOTTOM) {
            doc.addPage({ size: "A4", layout: "landscape", margin: 36 });
            doc.save().rect(0, 0, doc.page.width, 4).fill(C.violet).restore();
            y = cabecalhoTabela(46);
          }

          // Barra de prioridade — evita uma coluna inteira pra três valores.
          rrect(L, y - 1, 3, LINHA - 5, 1.5, COR_PRIORIDADE[c.prioridade]);

          const celula = (
            texto: string, idx: number, cor: string, negrito = false, recuo = 0,
          ) => {
            const col = COLS[idx];
            const fonte = negrito ? "Helvetica-Bold" : "Helvetica";
            const largura = col.w - 6 - recuo;
            doc.fillColor(cor).font(fonte).fontSize(8.4)
              .text(caber(texto, largura, fonte, 8.4), X[col.k] + recuo, y, {
                width: largura, align: col.a, lineBreak: false,
              });
          };

          const nomeCliente = c.clienteNome?.trim() || "— sem cliente —";
          celula(nomeCliente, 0, c.clienteNome ? C.dark : C.faint, !!c.clienteNome, 9);
          celula(c.titulo, 1, C.tinta2);
          celula(c.funilNome, 2, C.muted);
          celula(c.colunaNome, 3, C.tinta2);
          celula(c.responsavelNome ? abreviarNome(c.responsavelNome) : "—", 4, C.muted);
          celula(fmtData(c.criadoEm), 5, C.tinta2);

          const d = diasDesde(c.criadoEm, agora);
          doc.fillColor(d >= 60 ? C.amber : C.muted).font("Helvetica-Bold").fontSize(8.4)
            .text(idadeCurta(d), X.idade, y, { width: COLS[6].w - 6, align: "right", lineBreak: false });

          const vencido = !!c.prazo
            && Date.parse(`${c.prazo.slice(0, 10)}T12:00:00Z`) < agora.getTime();
          doc.fillColor(c.prazo ? (vencido ? C.rose : C.tinta2) : C.faint)
            .font(vencido ? "Helvetica-Bold" : "Helvetica").fontSize(8.4)
            .text(c.prazo ? fmtDiaMes(c.prazo) : "—", X.prazo, y, {
              width: COLS[7].w - 6, align: "right", lineBreak: false,
            });

          doc.fillColor(C.dark).font("Helvetica-Bold").fontSize(8.4)
            .text(c.valorEstimado != null ? fmtBRL(c.valorEstimado) : "—", X.valor, y, {
              width: COLS[8].w, align: "right", lineBreak: false,
            });

          y += LINHA;
          hr(y - 5);
        }

        if (y + 20 > BOTTOM) {
          doc.addPage({ size: "A4", layout: "landscape", margin: 36 });
          doc.save().rect(0, 0, doc.page.width, 4).fill(C.violet).restore();
          y = 46;
        }
        rrect(L, y - 3, W, 17, 3, "#f8fafc");
        doc.fillColor(C.dark).font("Helvetica-Bold").fontSize(8.6);
        doc.text(`Total — ${data.cards.length} cards`, X.cliente + 9, y + 1, {
          width: 240, lineBreak: false,
        });
        doc.text(fmtBRL(totalValor), X.valor, y + 1, {
          width: COLS[8].w, align: "right", lineBreak: false,
        });
      }

      // ── Rodapé (paginação) ───────────────────────────────────────────────
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        doc.page.margins.bottom = 0;
        doc.fillColor(C.faint).font("Helvetica").fontSize(7.2)
          .text("JuridFlow · Cards do Kanban", L, PH - 26, { width: W / 2, lineBreak: false });
        doc.text(`Página ${i + 1} de ${range.count}`, L + W / 2, PH - 26, {
          width: W / 2, align: "right", lineBreak: false,
        });
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

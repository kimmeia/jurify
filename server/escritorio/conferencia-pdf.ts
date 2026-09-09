/**
 * PDF da Conferência de cadastros — pra ler e anotar. Resumo na primeira
 * página, um bloco por grupo com as fichas em tabela e a célula que diverge
 * sombreada, e a tabela de faltas no fim. Lê a MESMA `Conferencia` da tela.
 *
 * Só Helvetica (WinAnsi): nada de emoji ou seta unicode aqui — o pdfkit
 * imprime lixo no lugar.
 */

import PDFDocument from "pdfkit";
import type { Conferencia, FichaConf, GrupoConf } from "./conferencia-cadastros";
import { gruposFiltrados } from "./conferencia-cadastros";
import {
  type Divergencia, type FiltroGrupo,
  FALTA_TIPOS, ROTULO_DIVERGENCIA, ROTULO_FALTA, ROTULO_FILTRO, COMO_DECIDE_FALTA,
  mascararCpfCnpj,
} from "../../shared/conferencia-cadastros";

const ORIGEM: Record<string, string> = {
  whatsapp: "WhatsApp", manual: "Clientes", asaas: "Asaas", site: "Site",
  instagram: "Instagram", facebook: "Facebook", telefone: "Telefone",
};

const COR_TEXTO = "#0f172a";
const COR_MUDO = "#475569";
const COR_LINHA = "#cbd5e1";
const COR_AMBAR = "#fef3c7";
const COR_VERMELHO = "#fee2e2";

function dataBR(iso: string | null, fuso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { timeZone: fuso });
}

function plural(n: number, um: string, varios: string): string | null {
  return n > 0 ? `${n} ${n === 1 ? um : varios}` : null;
}

function vinculos(f: FichaConf): string {
  return [
    plural(f.processos, "processo", "processos"),
    plural(f.cobrancas, "cobrança", "cobranças"),
    plural(f.conversas, "conversa", "conversas"),
  ].filter(Boolean).join(" · ") || "—";
}

type Coluna = { titulo: string; largura: number; valor: (f: FichaConf, g: GrupoConf) => string; divergencia?: Divergencia };

export async function gerarConferenciaPDF(
  conf: Conferencia,
  opts: { nomeEscritorio: string; filtro: FiltroGrupo; fuso: string },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 40,
        info: {
          Title: `Conferência de cadastros — ${opts.nomeEscritorio}`,
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
      const fimPagina = () => doc.page.height - doc.page.margins.bottom;
      const garantir = (altura: number) => { if (doc.y + altura > fimPagina()) doc.addPage(); };

      // ── Cabeçalho ──
      doc.fillColor(COR_TEXTO).font("Helvetica-Bold").fontSize(16).text("Conferência de cadastros", left, 40);
      doc.fillColor(COR_MUDO).font("Helvetica").fontSize(9).text(
        `${opts.nomeEscritorio}  •  Gerado em ${new Date().toLocaleString("pt-BR", { timeZone: opts.fuso })}  •  filtro: ${ROTULO_FILTRO[opts.filtro]}`,
        left, doc.y + 3, { width: usable },
      );
      doc.moveDown(0.8);

      // ── Resumo ──
      const r = conf.resumo;
      doc.fillColor("#1e40af").font("Helvetica-Bold").fontSize(11).text("Resumo", left, doc.y);
      doc.fillColor(COR_TEXTO).font("Helvetica").fontSize(9);
      const resumoLinhas = [
        `Fichas: ${conf.fichas.total} (${conf.fichas.clientes} clientes · ${conf.fichas.leads} leads)`,
        `Mesmo telefone: ${r.telefone.grupos} números · ${r.telefone.fichas} fichas · ${r.telefone.comDivergencia} com divergência (${r.telefone.cpfsDiferentes} com CPFs diferentes) · ${r.telefone.soFalta} só falta preencher`,
        `Mesmo CPF/CNPJ: ${r.cpf.grupos} documentos · ${r.cpf.fichas} fichas · ${r.cpf.tambemNoTelefone} também aparecem no telefone`,
        `Sem telefone ${conf.faltas.sem_telefone.ids.length} · telefone inválido ${conf.faltas.telefone_invalido.ids.length} · cliente sem CPF ${conf.faltas.cliente_sem_cpf.ids.length} · CPF inválido ${conf.faltas.cpf_invalido.ids.length} · e-mail inválido ${conf.faltas.email_invalido.ids.length} · só o nome do perfil ${conf.faltas.so_nome_perfil.ids.length}`,
        r.ignorados > 0 ? `Marcados como "não é duplicado": ${r.ignorados} (fora da conta acima)` : null,
      ].filter((l): l is string => !!l);
      for (const linha of resumoLinhas) doc.text(linha, left, doc.y + 2, { width: usable });
      doc.moveDown(1);

      // ── Grupos ──
      const colunas: Coluna[] = [
        { titulo: "ID", largura: 28, valor: (f) => String(f.id) },
        { titulo: "Nome", largura: 118, valor: (f, g) => (f.id === g.sobreviventeId ? `${f.nome} (sobrevive)` : f.nome), divergencia: "nome" },
        { titulo: "Estágio", largura: 38, valor: (f) => (f.estagio === "cliente" ? "Cliente" : "Lead") },
        { titulo: "Origem · data", largura: 72, valor: (f) => `${ORIGEM[f.origem] ?? f.origem} ${dataBR(f.createdAt, opts.fuso)}` },
        { titulo: "CPF/CNPJ", largura: 74, valor: (f) => (f.cpfCnpj ? mascararCpfCnpj(f.cpfCnpj) : "—"), divergencia: "cpf" },
        { titulo: "E-mail", largura: 92, valor: (f) => f.email || "—", divergencia: "email" },
        { titulo: "Responsável", largura: 50, valor: (f) => f.responsavelNome || (f.responsavelId != null ? `#${f.responsavelId}` : "—"), divergencia: "responsavel" },
        { titulo: "Vínculos", largura: 43, valor: (f) => vinculos(f) },
      ];
      const ALTURA_LINHA = 11;

      const blocoGrupo = (g: GrupoConf) => {
        garantir(30 + ALTURA_LINHA * (g.fichas.length + 2));
        const divs = g.divergencias.map((d) => ROTULO_DIVERGENCIA[d]).join(", ");
        const titulo = `${g.tipo === "telefone" ? "Mesmo telefone" : "Mesmo CPF/CNPJ"} · ${g.rotulo} · ${g.fichas.length} fichas · ${
          g.classe === "cpfs_diferentes" ? `ATENÇÃO: ${divs}` : divs || "só falta preencher"
        }${g.nomeIncompleto ? " · nome incompleto" : ""}`;
        doc.fillColor(COR_TEXTO).font("Helvetica-Bold").fontSize(9.5).text(titulo, left, doc.y, { width: usable });
        doc.moveTo(left, doc.y + 2).lineTo(right, doc.y + 2).strokeColor(COR_LINHA).stroke();
        doc.moveDown(0.4);

        let x = left;
        const yCab = doc.y;
        doc.fillColor(COR_MUDO).font("Helvetica-Bold").fontSize(7);
        for (const c of colunas) {
          doc.text(c.titulo, x + 2, yCab, { width: c.largura - 4, lineBreak: false, ellipsis: true });
          x += c.largura;
        }
        doc.y = yCab + ALTURA_LINHA;

        doc.font("Helvetica").fontSize(7.5);
        for (const f of g.fichas) {
          if (doc.y + ALTURA_LINHA > fimPagina()) doc.addPage();
          const y = doc.y;
          x = left;
          for (const c of colunas) {
            const sombreia = c.divergencia && g.divergencias.includes(c.divergencia);
            if (sombreia) {
              doc.save();
              doc.rect(x, y - 1, c.largura, ALTURA_LINHA).fill(c.divergencia === "cpf" ? COR_VERMELHO : COR_AMBAR);
              doc.restore();
            }
            doc.fillColor(COR_TEXTO).text(c.valor(f, g), x + 2, y, { width: c.largura - 4, lineBreak: false, ellipsis: true });
            x += c.largura;
          }
          doc.y = y + ALTURA_LINHA;
        }
        doc.moveDown(0.7);
      };

      const secao = (titulo: string, grupos: GrupoConf[]) => {
        garantir(40);
        doc.fillColor("#1e40af").font("Helvetica-Bold").fontSize(11).text(`${titulo} (${grupos.length})`, left, doc.y);
        doc.moveDown(0.4);
        if (grupos.length === 0) {
          doc.fillColor("#059669").font("Helvetica").fontSize(9).text("Nenhum grupo com esse filtro.", left, doc.y);
          doc.moveDown(0.8);
          return;
        }
        for (const g of grupos) blocoGrupo(g);
      };

      const { telefone, cpf } = gruposFiltrados(conf, opts.filtro);
      secao("Mesmo telefone", telefone);
      secao("Mesmo CPF/CNPJ", cpf);

      // ── Faltas ──
      garantir(60);
      doc.fillColor("#1e40af").font("Helvetica-Bold").fontSize(11).text("Faltando ou inválido", left, doc.y);
      doc.moveDown(0.4);
      const colFaltas = [
        { titulo: "O que", largura: 120 },
        { titulo: "Quantas", largura: 50 },
        { titulo: "Clientes", largura: 45 },
        { titulo: "Leads", largura: 45 },
        { titulo: "Como o sistema decide", largura: usable - 260 },
      ];
      let xf = left;
      const yf = doc.y;
      doc.fillColor(COR_MUDO).font("Helvetica-Bold").fontSize(7);
      for (const c of colFaltas) { doc.text(c.titulo, xf + 2, yf, { width: c.largura - 4, lineBreak: false }); xf += c.largura; }
      doc.y = yf + ALTURA_LINHA;
      doc.font("Helvetica").fontSize(7.5).fillColor(COR_TEXTO);
      for (const tipo of FALTA_TIPOS) {
        const f = conf.faltas[tipo];
        const como = COMO_DECIDE_FALTA[tipo];
        const alturaComo = doc.heightOfString(como, { width: colFaltas[4].largura - 4 }) + 3;
        garantir(alturaComo);
        const y = doc.y;
        xf = left;
        const valores = [ROTULO_FALTA[tipo], String(f.ids.length), String(f.clientes), String(f.leads), como];
        colFaltas.forEach((c, i) => {
          doc.text(valores[i], xf + 2, y, { width: c.largura - 4, lineBreak: i === 4 });
          xf += c.largura;
        });
        doc.y = y + Math.max(ALTURA_LINHA, alturaComo);
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

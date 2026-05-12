import PDFDocument from "pdfkit";

export type GrupoDuplicata = {
  cpfLimpo: string;
  qtd: number;
  clientes: Array<{
    id: number;
    nome: string;
    cpfCnpj: string;
    createdAt: Date | string | null;
  }>;
};

function formatCpfCnpj(cpf: string): string {
  const n = cpf.replace(/\D/g, "");
  if (n.length === 11) return n.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (n.length === 14) return n.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return cpf;
}

function formatData(d: Date | string | null): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("pt-BR");
}

export async function gerarDuplicatasPDF(
  grupos: GrupoDuplicata[],
  nomeEscritorio: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 50,
        info: {
          Title: `Duplicatas de CPF/CNPJ — ${nomeEscritorio}`,
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

      doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(18).text("Relatório de duplicatas", left, 50);
      doc.fillColor("#475569").font("Helvetica").fontSize(10).text(
        `${nomeEscritorio}  •  Gerado em ${new Date().toLocaleString("pt-BR")}`,
        left,
        doc.y + 4,
      );
      doc.moveDown(0.5);
      doc.fillColor("#475569").fontSize(10).text(
        "Clientes com mesmo CPF/CNPJ dentro do escritório. Use a UI normal pra editar/excluir e consolidar duplicatas.",
        left,
        doc.y,
        { width: usableWidth },
      );
      doc.moveDown(1);

      doc.fillColor("#1e40af").font("Helvetica-Bold").fontSize(12).text(
        `Total de grupos duplicados: ${grupos.length}`,
        left,
        doc.y,
      );
      doc.fillColor("#475569").font("Helvetica").fontSize(10).text(
        `Total de clientes envolvidos: ${grupos.reduce((acc, g) => acc + g.qtd, 0)}`,
        left,
        doc.y + 2,
      );
      doc.moveDown(1);

      if (grupos.length === 0) {
        doc.fillColor("#059669").font("Helvetica-Bold").fontSize(11).text(
          "Nenhuma duplicata encontrada — base limpa.",
          left,
          doc.y,
        );
        doc.end();
        return;
      }

      for (const grupo of grupos) {
        if (doc.y > doc.page.height - 150) doc.addPage();

        doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(11).text(
          `CPF/CNPJ: ${formatCpfCnpj(grupo.cpfLimpo)}  •  ${grupo.qtd} cadastros`,
          left,
          doc.y,
        );
        doc.moveTo(left, doc.y + 2).lineTo(right, doc.y + 2).strokeColor("#cbd5e1").stroke();
        doc.moveDown(0.4);

        const colId = left;
        const colNome = left + 50;
        const colCpf = left + 280;
        const colData = left + 420;

        doc.fillColor("#475569").font("Helvetica-Bold").fontSize(9);
        doc.text("ID", colId, doc.y);
        doc.text("Nome", colNome, doc.y - 11);
        doc.text("CPF/CNPJ", colCpf, doc.y - 11);
        doc.text("Cadastrado em", colData, doc.y - 11);
        doc.moveDown(0.3);

        doc.fillColor("#0f172a").font("Helvetica").fontSize(9);
        for (const c of grupo.clientes) {
          if (doc.y > doc.page.height - 60) doc.addPage();
          const y = doc.y;
          doc.text(String(c.id), colId, y, { width: 45 });
          doc.text(c.nome, colNome, y, { width: 220, ellipsis: true });
          doc.text(c.cpfCnpj || "—", colCpf, y, { width: 130 });
          doc.text(formatData(c.createdAt), colData, y);
          doc.moveDown(0.35);
        }
        doc.moveDown(0.6);
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

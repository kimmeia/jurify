/**
 * Testes — geração do PDF "Relatório de Clientes".
 *
 * Invoca o gerador real (PDFKit) e verifica: Buffer válido, magic header %PDF-,
 * cobre o caminho vazio e a paginação (lista grande). Não valida layout visual.
 */

import { describe, it, expect } from "vitest";
import { gerarClientesPDF, type ClienteLinhaPDF } from "../escritorio/clientes-pdf";

const PDF_MAGIC = Buffer.from("%PDF-");

function linha(p: Partial<ClienteLinhaPDF> & { contatoNome: string }): ClienteLinhaPDF {
  return {
    contatoNome: p.contatoNome,
    cpfCnpj: p.cpfCnpj ?? "12345678901",
    contatoTelefone: p.contatoTelefone ?? "85999998888",
    contatoEmail: p.contatoEmail ?? null,
    totalCobrancas: p.totalCobrancas ?? 1,
    pendente: p.pendente ?? 0,
    vencido: p.vencido ?? 0,
    pago: p.pago ?? 0,
    diasAtrasoMax: p.diasAtrasoMax ?? null,
  };
}

const meta = {
  nomeEscritorio: "Escritório Teste",
  filtros: ["Inadimplentes (com valor vencido)", "Atraso > 30 dias", "Ordenado por Atraso (maior → menor)"],
  geradoPor: "teste@exemplo.com",
};

describe("gerarClientesPDF", () => {
  it("retorna Buffer com magic header de PDF", async () => {
    const buf = await gerarClientesPDF(
      [
        linha({ contatoNome: "Alan", cpfCnpj: "00280995326", vencido: 900, pendente: 50, diasAtrasoMax: 522 }),
        linha({ contatoNome: "Abimael", cpfCnpj: "05318032362", vencido: 650, pago: 233.77, diasAtrasoMax: 371 }),
      ],
      meta,
    );
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)).toBe(true);
  });

  it("gera PDF válido mesmo com lista vazia", async () => {
    const buf = await gerarClientesPDF([], meta);
    expect(buf.subarray(0, 5).toString("utf8")).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(500);
  });

  it("pagina lista grande sem quebrar", async () => {
    const muitos: ClienteLinhaPDF[] = Array.from({ length: 120 }, (_, i) =>
      linha({
        contatoNome: `Cliente Número ${i + 1} com Nome Razoavelmente Longo`,
        cpfCnpj: String(10000000000 + i),
        pendente: i * 10,
        vencido: i % 3 === 0 ? i * 5 : 0,
        pago: i * 7,
        diasAtrasoMax: i % 3 === 0 ? i : null,
      }),
    );
    const buf = await gerarClientesPDF(muitos, meta);
    expect(buf.subarray(0, 5).toString("utf8")).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(3000);
  });

  it("aceita CNPJ (14 dígitos) e contato por e-mail", async () => {
    const buf = await gerarClientesPDF(
      [
        linha({ contatoNome: "Empresa LTDA", cpfCnpj: "12345678000199", contatoTelefone: null, contatoEmail: "fin@empresa.com", pago: 6200 }),
      ],
      meta,
    );
    expect(buf.subarray(0, 5).toString("utf8")).toBe("%PDF-");
  });
});

/**
 * Regressão dos bugs reportados: páginas em branco no fim do documento
 * (footer disparava auto-paginação) e nomes longos sobrepostos (quebra em 2
 * linhas). Renderiza o PDF e inspeciona páginas + posições de texto.
 */
describe("gerarClientesPDF — sem páginas em branco / sem sobreposição", () => {
  async function analisar(buf: Buffer) {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const docu = await getDocument({ data: new Uint8Array(buf) }).promise;
    let blankPages = 0;
    let minNameGap = Infinity;
    for (let p = 1; p <= docu.numPages; p++) {
      const page = await docu.getPage(p);
      const items = (await page.getTextContent()).items
        .filter((i: any) => i.str && i.str.trim() !== "")
        .map((i: any) => ({ x: Math.round(i.transform[4]), y: Math.round(i.transform[5]) }));
      if (items.length === 0) blankPages++;
      // Gap entre nomes só nas páginas 2+ (a pág. 1 tem cabeçalho/KPIs com
      // espaçamentos próprios que não são linhas da tabela). Coluna NOME
      // isolada (x≈36); a coluna CPF começa em x≈172.
      if (p >= 2) {
        const nameYs = items
          .filter((i) => i.x >= 30 && i.x <= 160)
          .map((i) => i.y)
          .sort((a, b) => b - a);
        for (let k = 1; k < nameYs.length; k++) {
          const gap = nameYs[k - 1] - nameYs[k];
          if (gap > 0) minNameGap = Math.min(minNameGap, gap);
        }
      }
    }
    return { numPages: docu.numPages, blankPages, minNameGap };
  }

  const nomesLongos = [
    "ANTONIO GESILANE SOUSA MARQUES (EXECUTADO)",
    "ANA PAULA DA COSTA BARROS DE OLIVEIRA SALES MORAES (EXECUTADO)",
    "FRANCISCO DAS CHAGAS SOUSA BRITO (EXECUTADO)",
    "MARIA DAS GRAÇAS RODRIGUES DELMONDES SANTANA",
  ];

  it("200 clientes com nomes longos: nenhuma página em branco e paginação proporcional", async () => {
    const lista: ClienteLinhaPDF[] = Array.from({ length: 200 }, (_, i) =>
      linha({
        contatoNome: `${nomesLongos[i % nomesLongos.length]} ${i + 1}`,
        cpfCnpj: String(10000000000 + i),
        pendente: i % 3 === 0 ? i * 10 : 0,
        vencido: 100 + (i % 40) * 500,
        pago: i % 4 === 0 ? i * 137.77 : 0,
        diasAtrasoMax: 92 + (i % 400),
      }),
    );
    const buf = await gerarClientesPDF(lista, meta);
    const { numPages, blankPages, minNameGap } = await analisar(buf);

    expect(blankPages).toBe(0);
    // 200 linhas ~ 4-5 páginas; o bug do footer inflava pra ~3x. Trava < 8.
    expect(numPages).toBeGreaterThanOrEqual(3);
    expect(numPages).toBeLessThanOrEqual(8);
    // Linhas espaçadas por ROW_H=15; nome quebrado em 2 linhas geraria gap ~6-9.
    expect(minNameGap).toBeGreaterThanOrEqual(12);
  });
});

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

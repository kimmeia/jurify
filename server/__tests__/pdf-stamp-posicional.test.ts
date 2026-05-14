/**
 * Testes — estamparAssinatura nos 2 modos (legado / posicional).
 *
 * Não tenta inspecionar o PDF gerado byte a byte (testar pdf-lib é trabalho
 * deles). Foco: garantir que a função roda sem erro nos cenários práticos,
 * compatibilidade legada é preservada, e a página de certificação é sempre
 * adicionada.
 */

import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { estamparAssinatura, type CampoPosicional } from "../escritorio/pdf-stamp-assinatura";

/** Gera um PDF de N páginas pra usar como input. */
async function gerarPdfTeste(numPaginas: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < numPaginas; i++) {
    doc.addPage([595, 842]); // A4 portrait em pontos
  }
  return Buffer.from(await doc.save());
}

/** PNG 1x1 transparente — mínimo válido pra embedPng. */
const PNG_VAZIO = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

describe("estamparAssinatura — modo LEGADO (sem campos)", () => {
  it("preserva comportamento antigo: assinatura central + página de certificação", async () => {
    const pdfOriginal = await gerarPdfTeste(2);
    const resultado = await estamparAssinatura({
      pdfOriginal,
      assinaturaImagem: PNG_VAZIO,
      nomeCompleto: "João Silva",
      cpf: "111.222.333-44",
      ip: "127.0.0.1",
      assinadoAt: new Date("2026-05-13T14:00:00Z"),
    });
    const docResult = await PDFDocument.load(resultado);
    // 2 páginas originais + 1 certificação = 3
    expect(docResult.getPages()).toHaveLength(3);
  });

  it("aceita campos: undefined explicitamente", async () => {
    const pdfOriginal = await gerarPdfTeste(1);
    const resultado = await estamparAssinatura({
      pdfOriginal,
      assinaturaImagem: PNG_VAZIO,
      nomeCompleto: "Teste",
      assinadoAt: new Date(),
      campos: undefined,
    });
    const docResult = await PDFDocument.load(resultado);
    expect(docResult.getPages()).toHaveLength(2);
  });

  it("aceita campos: [] (vazio) também usa fluxo legado", async () => {
    const pdfOriginal = await gerarPdfTeste(1);
    const resultado = await estamparAssinatura({
      pdfOriginal,
      assinaturaImagem: PNG_VAZIO,
      nomeCompleto: "Teste",
      assinadoAt: new Date(),
      campos: [],
    });
    const docResult = await PDFDocument.load(resultado);
    expect(docResult.getPages()).toHaveLength(2);
  });
});

describe("estamparAssinatura — modo POSICIONAL (com campos)", () => {
  it("aceita 1 campo de ASSINATURA na página 1", async () => {
    const pdfOriginal = await gerarPdfTeste(2);
    const campos: CampoPosicional[] = [{
      tipo: "ASSINATURA",
      pagina: 1,
      x: 100, y: 200, largura: 150, altura: 50,
    }];
    const resultado = await estamparAssinatura({
      pdfOriginal,
      assinaturaImagem: PNG_VAZIO,
      nomeCompleto: "Maria",
      assinadoAt: new Date(),
      campos,
    });
    const docResult = await PDFDocument.load(resultado);
    expect(docResult.getPages()).toHaveLength(3); // +1 cert
  });

  it("aceita campos de DATA, NOME, CPF em páginas diferentes", async () => {
    const pdfOriginal = await gerarPdfTeste(3);
    const campos: CampoPosicional[] = [
      { tipo: "ASSINATURA", pagina: 3, x: 100, y: 100, largura: 150, altura: 50 },
      { tipo: "DATA",       pagina: 3, x: 300, y: 100, largura: 100, altura: 20 },
      { tipo: "NOME",       pagina: 1, x: 100, y: 500, largura: 200, altura: 20 },
      { tipo: "CPF",        pagina: 1, x: 100, y: 470, largura: 200, altura: 20 },
    ];
    const resultado = await estamparAssinatura({
      pdfOriginal,
      assinaturaImagem: PNG_VAZIO,
      nomeCompleto: "Carlos Souza",
      cpf: "987.654.321-00",
      assinadoAt: new Date("2026-05-13T10:00:00Z"),
      campos,
    });
    const docResult = await PDFDocument.load(resultado);
    expect(docResult.getPages()).toHaveLength(4); // 3 + cert
  });

  it("ignora silenciosamente página fora do range", async () => {
    const pdfOriginal = await gerarPdfTeste(2);
    const campos: CampoPosicional[] = [
      { tipo: "ASSINATURA", pagina: 99, x: 100, y: 100, largura: 150, altura: 50 },
    ];
    // Não deve lançar erro — só ignora a página inválida
    await expect(estamparAssinatura({
      pdfOriginal,
      assinaturaImagem: PNG_VAZIO,
      nomeCompleto: "Teste",
      assinadoAt: new Date(),
      campos,
    })).resolves.toBeInstanceOf(Buffer);
  });

  it("aceita CPF vazio em campo CPF (não quebra)", async () => {
    const pdfOriginal = await gerarPdfTeste(1);
    const campos: CampoPosicional[] = [
      { tipo: "CPF", pagina: 1, x: 100, y: 100, largura: 150, altura: 20 },
    ];
    const resultado = await estamparAssinatura({
      pdfOriginal,
      assinaturaImagem: PNG_VAZIO,
      nomeCompleto: "Sem CPF",
      cpf: null,
      assinadoAt: new Date(),
      campos,
    });
    expect(resultado).toBeInstanceOf(Buffer);
  });

  it("certificação é adicionada nos dois modos", async () => {
    const pdfOriginal = await gerarPdfTeste(1);
    // Modo legado
    const resultadoLegado = await estamparAssinatura({
      pdfOriginal, assinaturaImagem: PNG_VAZIO,
      nomeCompleto: "Teste", assinadoAt: new Date(),
    });
    const docLegado = await PDFDocument.load(resultadoLegado);
    // Modo posicional
    const resultadoPos = await estamparAssinatura({
      pdfOriginal, assinaturaImagem: PNG_VAZIO,
      nomeCompleto: "Teste", assinadoAt: new Date(),
      campos: [{ tipo: "ASSINATURA", pagina: 1, x: 100, y: 100, largura: 100, altura: 50 }],
    });
    const docPos = await PDFDocument.load(resultadoPos);
    // Ambos têm 2 páginas (original + cert)
    expect(docLegado.getPages()).toHaveLength(2);
    expect(docPos.getPages()).toHaveLength(2);
  });
});

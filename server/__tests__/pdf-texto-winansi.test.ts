/**
 * "WinAnsi cannot encode Ş (0x015e)": o comprovante da assinatura não saía.
 *
 * O cliente assinou (desenho e data guardados), mas o PDF carimbado explodia
 * na hora de escrever o nome dele — "Alexandre Yirtici Şahin" — porque as
 * fontes padrão do PDF só escrevem WinAnsi. Resultado: quatro documentos
 * assinados e nenhum comprovante para entregar.
 *
 * O teste carimba um PDF de verdade com nomes que quebravam antes.
 */

import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { textoParaPdfWinAnsi, precisaFonteUnicode } from "../../shared/texto-pdf-winansi";
import { estamparAssinatura } from "../escritorio/pdf-stamp-assinatura";

/** PNG 1x1 transparente — o desenho da assinatura não importa aqui. */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

async function pdfDeUmaPagina(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  return Buffer.from(await doc.save());
}

describe("texto que cabe na fonte padrão do PDF", () => {
  it("troca a letra impossível pela mais próxima em vez de derrubar", () => {
    expect(textoParaPdfWinAnsi("Alexandre Yirtici Şahin")).toBe("Alexandre Yirtici Sahin");
    expect(textoParaPdfWinAnsi("Ayşe Gülşen Ilıcalı")).toBe("Ayse Gülsen Ilicali");
    expect(textoParaPdfWinAnsi("Łukasz Dvořák")).toBe("Lukasz Dvorák");
  });

  it("português passa inteiro, sem perder acento", () => {
    const nome = "José da Conceição Gonçalves Júnior";
    expect(textoParaPdfWinAnsi(nome)).toBe(nome);
    expect(textoParaPdfWinAnsi("Ação · R$ 1.234,56 — 90% à vista")).toBe(
      "Ação · R$ 1.234,56 — 90% à vista",
    );
    expect(precisaFonteUnicode(nome)).toBe(false);
  });

  it("escrita sem equivalente latino vira ? e se declara", () => {
    expect(textoParaPdfWinAnsi("Иван")).toBe("????");
    expect(precisaFonteUnicode("Иван Петров")).toBe(true);
    expect(precisaFonteUnicode("Şahin")).toBe(false);
  });

  it("vazio e nulo não viram texto nenhum", () => {
    expect(textoParaPdfWinAnsi(null)).toBe("");
    expect(textoParaPdfWinAnsi(undefined)).toBe("");
    expect(textoParaPdfWinAnsi("")).toBe("");
  });
});

describe("o carimbo da assinatura sai com nome estrangeiro", () => {
  it("nome turco não derruba mais a geração", async () => {
    const pdf = await estamparAssinatura({
      pdfOriginal: await pdfDeUmaPagina(),
      assinaturaImagem: PNG_1X1,
      nomeCompleto: "Alexandre Yirtici Şahin",
      cpf: "034.128.236-78",
      ip: "189.45.12.7",
      assinadoAt: new Date("2026-09-10T23:48:08Z"),
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it("o mesmo vale nos campos posicionais (nome e CPF carimbados no corpo)", async () => {
    const pdf = await estamparAssinatura({
      pdfOriginal: await pdfDeUmaPagina(),
      assinaturaImagem: PNG_1X1,
      nomeCompleto: "Ayşe Gülşen Ilıcalı",
      cpf: "034.128.236-78",
      assinadoAt: new Date("2026-09-10T23:48:08Z"),
      campos: [
        { tipo: "ASSINATURA", pagina: 1, x: 50, y: 100, largura: 180, altura: 60 },
        { tipo: "NOME", pagina: 1, x: 50, y: 80, largura: 200, altura: 14 },
        { tipo: "CPF", pagina: 1, x: 50, y: 60, largura: 200, altura: 14 },
        { tipo: "DATA", pagina: 1, x: 50, y: 40, largura: 200, altura: 14 },
      ],
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("nome brasileiro continua saindo como sempre saiu", async () => {
    const pdf = await estamparAssinatura({
      pdfOriginal: await pdfDeUmaPagina(),
      assinaturaImagem: PNG_1X1,
      nomeCompleto: "José da Conceição Gonçalves",
      assinadoAt: new Date("2026-09-10T23:48:08Z"),
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("todo texto de fora passa pelo filtro antes de virar PDF", () => {
    const fonte = require("node:fs").readFileSync(
      require("node:path").join(process.cwd(), "server/escritorio/pdf-stamp-assinatura.ts"),
      "utf-8",
    ) as string;
    expect(fonte).toContain("escrever(dados.nomeCompleto)");
    expect(fonte).toContain("escrever(dados.cpf)");
    expect(fonte).toContain("${escrever(dados.cpf)}");
    expect(fonte).toContain("escrever(`Endereço IP: ${dados.ip}`)");
  });
});

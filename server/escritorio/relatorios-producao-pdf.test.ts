/**
 * Smoke test do gerador de PDF do Relatório de Produção.
 *
 * O layout é posicionado à mão (pdfkit) — fácil regredir (page-break no
 * rodapé, divisão por zero com funil vazio, tabela longa demais). Aqui
 * exercitamos o caminho rico + as bordas e validamos que sai um PDF
 * não-trivial sem lançar.
 *
 * Setar DUMP_PDF=1 grava o resultado em /tmp/relatorio-producao-real.pdf
 * pra inspeção visual manual.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import { gerarProducaoPdf, type ProducaoPdfData } from "./relatorios-producao-pdf";

function dadosCompletos(): ProducaoPdfData {
  return {
    periodo: { dataInicio: "2026-07-01", dataFim: "2026-07-30" },
    cardsTotal: 459,
    cardsDentroPrazo: 382,
    cardsAtrasados: 77,
    taxaDentroPrazo: 83,
    anterior: {
      cardsTotal: 429,
      cardsDentroPrazo: 341,
      cardsAtrasados: 88,
      taxaDentroPrazo: 79,
    },
    movimentacaoDetalhe: {
      entraram: 459,
      avancaram: 1128,
      voltaram: 34,
      concluidos: 118,
      total: 1739,
    },
    cardsPorColuna: [
      { coluna: "Triagem", total: 62, conclusao: false },
      { coluna: "Documentação", total: 48, conclusao: false },
      { coluna: "Petição inicial", total: 39, conclusao: false },
      { coluna: "Protocolado", total: 71, conclusao: false },
      { coluna: "Aguardando decisão", total: 94, conclusao: false },
      { coluna: "Recurso", total: 27, conclusao: false },
      { coluna: "Concluído", total: 118, conclusao: true },
    ],
    porResponsavel: [
      { nome: "Pablo Sousa Silva", total: 132, noPrazo: 118, atrasados: 14, taxaDentroPrazo: 89 },
      { nome: "Isaac Luca Cavalcante", total: 121, noPrazo: 97, atrasados: 24, taxaDentroPrazo: 80 },
      { nome: "Milena Mello Mansur", total: 108, noPrazo: 96, atrasados: 12, taxaDentroPrazo: 89 },
      { nome: "Francisco Wesley Freitas", total: 98, noPrazo: 71, atrasados: 27, taxaDentroPrazo: 72 },
    ],
  };
}

function ehPdfValido(buf: Buffer) {
  expect(Buffer.isBuffer(buf)).toBe(true);
  expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  expect(buf.length).toBeGreaterThan(2000);
}

const CABECALHO = {
  nomeEscritorio: "Rocha & Associados Advocacia",
  funilLabel: "Todos",
  responsavelLabel: "Todos",
};

describe("gerarProducaoPdf", () => {
  it("gera PDF não-trivial com payload completo", async () => {
    const buf = await gerarProducaoPdf({ data: dadosCompletos(), ...CABECALHO });
    ehPdfValido(buf);
    if (process.env.DUMP_PDF) {
      fs.writeFileSync("/tmp/relatorio-producao-real.pdf", buf);
    }
  });

  it("não quebra sem período anterior (comparativo desligado)", async () => {
    const data = dadosCompletos();
    data.anterior = null;
    ehPdfValido(await gerarProducaoPdf({ data, ...CABECALHO }));
  });

  it("não quebra com funil vazio", async () => {
    const data = dadosCompletos();
    data.cardsTotal = 0;
    data.cardsDentroPrazo = 0;
    data.cardsAtrasados = 0;
    data.taxaDentroPrazo = 100;
    data.anterior = null;
    data.cardsPorColuna = [];
    data.porResponsavel = [];
    data.movimentacaoDetalhe = { entraram: 0, avancaram: 0, voltaram: 0, concluidos: 0, total: 0 };
    ehPdfValido(await gerarProducaoPdf({ data, ...CABECALHO }));
  });

  it("não divide por zero com uma etapa só", async () => {
    const data = dadosCompletos();
    data.cardsPorColuna = [{ coluna: "Triagem", total: 12, conclusao: false }];
    ehPdfValido(await gerarProducaoPdf({ data, ...CABECALHO }));
  });

  it("pagina quando a tabela de responsáveis é longa", async () => {
    const data = dadosCompletos();
    data.porResponsavel = Array.from({ length: 40 }, (_, i) => ({
      nome: `Colaborador de Nome Bastante Longo ${i + 1}`,
      total: 100 - i,
      noPrazo: 80 - i,
      atrasados: 20,
      taxaDentroPrazo: 90 - i,
    }));
    ehPdfValido(await gerarProducaoPdf({ data, ...CABECALHO }));
  });

  it("aceita filtros específicos no cabeçalho", async () => {
    ehPdfValido(
      await gerarProducaoPdf({
        data: dadosCompletos(),
        nomeEscritorio: "Escritório Teste",
        funilLabel: "Cível — Revisional",
        responsavelLabel: "Milena Mello Mansur",
      }),
    );
  });
});

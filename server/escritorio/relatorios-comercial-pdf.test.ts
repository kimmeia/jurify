/**
 * Smoke test do gerador de PDF do Relatório Comercial.
 *
 * O layout é posicionado à mão (pdfkit) — fácil regredir (page-break no
 * rodapé, divisão por zero no gráfico de 1 dia, etapa do funil ausente).
 * Aqui exercitamos o caminho rico + casos de borda e validamos que sai um
 * PDF não-trivial sem lançar.
 *
 * Setar DUMP_PDF=1 grava o resultado em /tmp/relatorio-comercial-real.pdf
 * pra inspeção visual manual.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import {
  gerarComercialPdf,
  type ComercialDashboardData,
  type DetalheAtendentePdf,
} from "./relatorios-comercial-pdf";

function dadosCompletos(): ComercialDashboardData {
  return {
    periodo: { dataInicio: "2026-05-01", dataFim: "2026-05-31" },
    periodoAnterior: { dataInicio: "2026-04-01", dataFim: "2026-04-30" },
    kpis: {
      faturado: 84350,
      variacaoFaturado: 12.4,
      contratos: 12,
      variacaoContratos: 20,
      contratosFechados: 18,
      variacaoContratosFechados: 5.9,
      valorTotalFechado: 133500,
      ticketMedio: 7029.17,
    },
    ranking: [
      { atendenteId: 1, nome: "Mariana Lopes", setorNome: "Comercial Cível", valorFechado: 52000, contratosFechados: 7, faturado: 36800, ticketMedio: 5257.14, meta: 40000, metaPeriodo: 40000, progressoMeta: 92 },
      { atendenteId: 2, nome: "Carlos Eduardo Pinto", setorNome: "Comercial Cível", valorFechado: 41500, contratosFechados: 5, faturado: 28050, ticketMedio: 5610, meta: 35000, metaPeriodo: 35000, progressoMeta: 80.1 },
      { atendenteId: 3, nome: "Júlia Fernandes", setorNome: "Comercial Cível", valorFechado: 24000, contratosFechados: 3, faturado: 12500, ticketMedio: 4166.67, meta: 30000, metaPeriodo: 30000, progressoMeta: 41.7 },
      { atendenteId: 4, nome: "Rafael Souza", setorNome: "Comercial Cível", valorFechado: 16000, contratosFechados: 3, faturado: 7000, ticketMedio: 2333.33, meta: null, metaPeriodo: null, progressoMeta: null },
    ],
    cobrancasPorDia: [
      { dia: "2026-05-02", faturado: 3200 }, { dia: "2026-05-05", faturado: 5400 },
      { dia: "2026-05-09", faturado: 7200 }, { dia: "2026-05-14", faturado: 9800 },
      { dia: "2026-05-19", faturado: 6300 }, { dia: "2026-05-23", faturado: 11200 },
      { dia: "2026-05-28", faturado: 8100 }, { dia: "2026-05-30", faturado: 6050 },
    ],
    etapas: {
      novo: { total: 34, valor: 210000 },
      qualificado: { total: 22, valor: 168000 },
      proposta: { total: 15, valor: 142500 },
      negociacao: { total: 9, valor: 96000 },
      fechado_ganho: { total: 18, valor: 133500 },
      fechado_perdido: { total: 11, valor: 71000 },
    },
    contatosPorOrigem: [
      { origem: "whatsapp", total: 48 }, { origem: "instagram", total: 22 },
      { origem: "facebook", total: 9 }, { origem: "manual", total: 14 },
    ],
    fechamentosPorOrigem: [
      { origem: "Google revisional", total: 6 }, { origem: "Meta leilão", total: 4 },
      { origem: "BNI", total: 3 }, { origem: "Indicação", total: 5 },
    ],
    filtros: { setorId: null, atendenteId: null },
  };
}

function detalhesCompletos(): DetalheAtendentePdf[] {
  return [
    {
      atendenteId: 1, nome: "Mariana Lopes", setorNome: "Comercial Cível",
      totalFechado: 52000, totalRecebido: 36800,
      itens: [
        { contatoId: 10, nome: "Construtora Vale Verde Ltda", valorFechado: 18000, contratosFechados: 2, valorRecebido: 18000, contratosPagos: 3, status: "pago" },
        { contatoId: 11, nome: "Supermercado Bom Preço", valorFechado: 14000, contratosFechados: 2, valorRecebido: 9800, contratosPagos: 2, status: "parcial" },
        { contatoId: 12, nome: "João Pereira Mendes", valorFechado: 12000, contratosFechados: 1, valorRecebido: 6000, contratosPagos: 1, status: "parcial" },
        { contatoId: 13, nome: "Marcos Antônio Silva", valorFechado: 8000, contratosFechados: 2, valorRecebido: 3000, contratosPagos: 1, status: "parcial" },
      ],
    },
    {
      atendenteId: 2, nome: "Carlos Eduardo Pinto", setorNome: "Comercial Cível",
      totalFechado: 41500, totalRecebido: 28050,
      itens: [
        { contatoId: 20, nome: "Transportadora Norte Sul", valorFechado: 22000, contratosFechados: 2, valorRecebido: 16500, contratosPagos: 2, status: "parcial" },
        { contatoId: 21, nome: "Ana Paula Rocha", valorFechado: 11500, contratosFechados: 1, valorRecebido: 11550, contratosPagos: 2, status: "pago" },
        { contatoId: 22, nome: "Indústria Metalúrgica Sul", valorFechado: 8000, contratosFechados: 2, valorRecebido: 0, contratosPagos: 0, status: "aguardando" },
      ],
    },
  ];
}

function ehPdfValido(buf: Buffer) {
  expect(Buffer.isBuffer(buf)).toBe(true);
  expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  expect(buf.length).toBeGreaterThan(2000);
}

describe("gerarComercialPdf", () => {
  it("gera PDF não-trivial com payload completo", async () => {
    const buf = await gerarComercialPdf({
      data: dadosCompletos(),
      detalhes: detalhesCompletos(),
      nomeEscritorio: "Rocha & Associados Advocacia",
    });
    ehPdfValido(buf);
    if (process.env.DUMP_PDF) {
      fs.writeFileSync("/tmp/relatorio-comercial-real.pdf", buf);
    }
  });

  it("não quebra com ranking vazio / sem dados", async () => {
    const data = dadosCompletos();
    data.ranking = [];
    data.cobrancasPorDia = [];
    data.contatosPorOrigem = [];
    data.fechamentosPorOrigem = [];
    data.etapas = {};
    const buf = await gerarComercialPdf({ data, detalhes: [], nomeEscritorio: "Escritório Teste" });
    ehPdfValido(buf);
  });

  it("não divide por zero com gráfico de um único dia", async () => {
    const data = dadosCompletos();
    data.cobrancasPorDia = [{ dia: "2026-05-15", faturado: 4200 }];
    const buf = await gerarComercialPdf({ data, detalhes: detalhesCompletos(), nomeEscritorio: "Escritório Teste" });
    ehPdfValido(buf);
  });

  it("lida com filtro de setor/atendente específico", async () => {
    const data = dadosCompletos();
    data.filtros = { setorId: 7, atendenteId: 2 };
    const buf = await gerarComercialPdf({ data, detalhes: detalhesCompletos(), nomeEscritorio: "Escritório Teste" });
    ehPdfValido(buf);
  });
});

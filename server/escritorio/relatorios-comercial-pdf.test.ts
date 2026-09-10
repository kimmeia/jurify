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
      clientesPagantes: 9,
      variacaoClientesPagantes: 20,
      clientesFechados: 14,
      contratosFechados: 18,
      variacaoContratosFechados: 5.9,
      valorTotalFechado: 133500,
      ticketMedio: 7029.17,
      cancelados: 2,
      valorCancelados: 6500,
      canceladosFecharamNoPeriodo: 1,
      variacaoCancelados: 100,
      contratosFechadosCanceladosDepois: 1,
      valorFechadosCanceladosDepois: 2500,
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
      cancelado: { total: 2, valor: 6500 },
    },
    funilResumo: {
      entraram: { total: 109, emAberto: 80, jaDecididos: 29 },
      decididos: {
        total: 29,
        fechado_ganho: { total: 18, entraramNoPeriodo: 16, entraramAntes: 2 },
        fechado_perdido: { total: 11, entraramNoPeriodo: 11, entraramAntes: 0 },
      },
      cancelados: { total: 2, valor: 6500, fecharamNoPeriodo: 1, fecharamAntes: 1 },
    },
    contratosCancelados: [
      { leadId: 41, contatoId: 3, cliente: "Santiago Ribeiro", fechadoEm: "2026-05-08T12:00:00.000Z", canceladoEm: "2026-05-20T12:00:00.000Z", valor: 2500, motivo: "inadimplencia", detalhe: null, responsavel: "Mariana Lopes", recebidoAntes: 1250 },
      { leadId: 42, contatoId: 8, cliente: "Márcia Teles", fechadoEm: "2026-04-22T12:00:00.000Z", canceladoEm: "2026-05-05T12:00:00.000Z", valor: 4000, motivo: "desistencia", detalhe: "pediu o distrato por telefone", responsavel: "Carlos Eduardo Pinto", recebidoAntes: 0 },
    ],
    leadsPorCanal: [
      { canal: "whatsapp", total: 48 }, { canal: "manual", total: 22 },
      { canal: "telefone", total: 9 }, { canal: "asaas", total: 14 },
    ],
    fechamentosPorOrigem: [
      {
        origem: "Google revisional", total: 6, valorTotal: 41350, recebidoTotal: 12000, pagaram: 2,
        fechamentos: [
          { contatoId: 1, cliente: "Francisco Antonio", fechadoEm: "2026-05-09T12:00:00.000Z", valor: 7250, recebido: 7250, situacao: "pago", responsavel: "Mariana Lopes", mesmoCliente: 1, foraDoFiltro: false },
          { contatoId: 2, cliente: "Marly Souza", fechadoEm: "2026-05-08T12:00:00.000Z", valor: 6000, recebido: 4750, situacao: "parcial", responsavel: "Carlos Eduardo Pinto", mesmoCliente: 2, foraDoFiltro: false },
          { contatoId: 3, cliente: "Santiago Ribeiro", fechadoEm: "2026-05-08T12:00:00.000Z", valor: 4800, recebido: 0, situacao: "nada", responsavel: "Mariana Lopes", mesmoCliente: 1, foraDoFiltro: false, canceladoEm: "2026-05-20T12:00:00.000Z", motivoCancelamento: "inadimplencia" },
        ],
      },
      { origem: "Meta leilão", total: 4 }, { origem: "BNI", total: 3 }, { origem: "Indicação", total: 5 },
      {
        origem: "Sem origem / fora do filtro", total: 0, valorTotal: 0, recebidoTotal: 900, pagaram: 1,
        fechamentos: [
          { contatoId: 9, cliente: "Cliente de outro setor", fechadoEm: null, valor: null, recebido: 900, situacao: "fora_do_filtro", responsavel: null, mesmoCliente: 1, foraDoFiltro: true },
        ],
      },
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
    data.leadsPorCanal = [];
    data.fechamentosPorOrigem = [];
    data.etapas = {};
    data.funilResumo = undefined;
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

describe("KPI de clientes que pagaram", () => {
  it("um cliente pagando várias cobranças não vira vários", async () => {
    // O caso que originou a mudança: o escritório recebeu duas cobranças de
    // R$ 1.250 do MESMO cliente e o card dizia "2 contratos pagos". A
    // contagem passou a ser por cliente, então aqui o PDF precisa sair com
    // 1 sobre 8 — e não estourar por causa da razão < 1.
    const d = dadosCompletos();
    d.kpis.faturado = 2500;
    d.kpis.clientesPagantes = 1;
    d.kpis.clientesFechados = 8;
    d.kpis.contratosFechados = 8;
    d.kpis.ticketMedio = 2500;

    const pdf = await gerarComercialPdf({ data: d, detalhes: [], nomeEscritorio: "Escritório Teste" });
    expect(pdf.length).toBeGreaterThan(3000);
  });

  it("sem ninguém fechando no período, a razão não divide por zero", async () => {
    const d = dadosCompletos();
    d.kpis.clientesPagantes = 0;
    d.kpis.clientesFechados = 0;
    d.kpis.contratosFechados = 0;
    d.kpis.valorTotalFechado = 0;

    const pdf = await gerarComercialPdf({ data: d, detalhes: [], nomeEscritorio: "Escritório Teste" });
    expect(pdf.length).toBeGreaterThan(3000);
  });
});

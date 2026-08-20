/**
 * Smoke test do gerador de PDF do Relatório de Atendimento.
 *
 * O layout é posicionado à mão (pdfkit) — fácil regredir (page-break no
 * rodapé, divisão por zero no gráfico de um dia só, seção de ligações vazia).
 * Aqui exercitamos o caminho rico + as bordas e validamos que sai um PDF
 * não-trivial sem lançar.
 *
 * Setar DUMP_PDF=1 grava o resultado em /tmp/relatorio-atendimento-real.pdf
 * pra inspeção visual manual.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import { gerarAtendimentoPdf, type AtendimentoPdfData } from "./relatorios-atendimento-pdf";

function dadosCompletos(): AtendimentoPdfData {
  return {
    periodo: { dataInicio: "2026-07-01", dataFim: "2026-07-30" },
    totalConversas: 1284,
    // Maior que as conversas novas de propósito: cliente que volta abre
    // atendimento sem abrir conversa.
    atendimentosIniciados: 1409,
    atendimentosResolvidos: 1203,
    atendimentosEmAndamento: 141,
    tabelaAtendimento: [
      { nome: "Isaac Luca Cavalcante", iniciados: 480, resolvidos: 420, emAndamento: 44, segPriResp: 95 },
      { nome: "Francisco Wesley Freitas", iniciados: 402, resolvidos: 344, emAndamento: 39, segPriResp: 140 },
      { nome: "Milena Mello Mansur", iniciados: 315, resolvidos: 262, emAndamento: 35, segPriResp: 210 },
      { nome: "Pablo Sousa Silva", iniciados: 180, resolvidos: 152, emAndamento: 18, segPriResp: 330 },
      { nome: "Sem atendente (robô)", iniciados: 32, resolvidos: 25, emAndamento: 5, segPriResp: null },
    ],
    estoqueConversas: { todas: 2913, emAtendimento: 554, resolvidas: 1359 },
    mensagensRecebidas: 9417,
    mensagensEnviadas: 7902,
    segMedioPriResp: 840,
    taxaConversao: 27,
    ticketMedio: 3180,
    conversaParaLead: 41,
    leadsGanhos: 90,
    leadsPerdidos: 183,
    anterior: {
      totalConversas: 1147,
      atendimentosIniciados: 1262,
      mensagensRecebidas: 8720,
      mensagensEnviadas: 8140,
      segMedioPriResp: 1080,
      taxaConversao: 23,
      ticketMedio: 2910,
      conversaParaLead: 43,
    },
    conversasPorDia: Array.from({ length: 30 }, (_, i) => ({
      dia: `2026-07-${String(i + 1).padStart(2, "0")}`,
      total: 20 + ((i * 7) % 35),
    })),
    atendimentosPorDia: Array.from({ length: 30 }, (_, i) => ({
      dia: `2026-07-${String(i + 1).padStart(2, "0")}`,
      total: 24 + ((i * 5) % 38),
    })),
    porCanal: [
      { nome: "WhatsApp — Comercial", total: 742 },
      { nome: "WhatsApp — Suporte", total: 361 },
      { nome: "Instagram Direct", total: 128 },
      { nome: "Site (formulário)", total: 53 },
    ],
    motivosPerda: [
      { motivo: "Preço acima do esperado", total: 61 },
      { motivo: "Contratou outro escritório", total: 44 },
      { motivo: "Sumiu / parou de responder", total: 38 },
      { motivo: "Caso fora da nossa área", total: 24 },
      { motivo: "Sem documentação", total: 16 },
    ],
    tabelaAtendentes: [
      { nome: "Isaac Luca Cavalcante", atendimentos: 412, leadsTotal: 128, ganhos: 41, perdidos: 52, emAberto: 35, valorFechado: 131200, taxaConversao: 10 },
      { nome: "Francisco Wesley Freitas", atendimentos: 356, leadsTotal: 104, ganhos: 27, perdidos: 49, emAberto: 28, valorFechado: 84600, taxaConversao: 8 },
      { nome: "Milena Mello Mansur", atendimentos: 289, leadsTotal: 87, ganhos: 15, perdidos: 44, emAberto: 28, valorFechado: 46300, taxaConversao: 5 },
      { nome: "Pablo Sousa Silva", atendimentos: 227, leadsTotal: 61, ganhos: 7, perdidos: 38, emAberto: 16, valorFechado: 21900, taxaConversao: 3 },
    ],
    ligacoes: { feitas: 620, recebidas: 284, perdidas: 74, taxaAtendimento: 79 },
    ligacoesPorAtendente: [
      { nome: "Isaac Luca Cavalcante", feitas: 214, recebidas: 96, perdidas: 18, duracaoTotalSeg: 33120 },
      { nome: "Francisco Wesley Freitas", feitas: 176, recebidas: 81, perdidas: 24, duracaoTotalSeg: 27660 },
      { nome: "Milena Mello Mansur", feitas: 132, recebidas: 64, perdidas: 11, duracaoTotalSeg: 21480 },
      { nome: "Pablo Sousa Silva", feitas: 98, recebidas: 43, perdidas: 21, duracaoTotalSeg: 12360 },
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
  setorLabel: "Todos",
  atendenteLabel: "Todos",
  canalLabel: "Todos",
};

describe("gerarAtendimentoPdf", () => {
  it("gera PDF não-trivial com payload completo", async () => {
    const buf = await gerarAtendimentoPdf({ data: dadosCompletos(), ...CABECALHO });
    ehPdfValido(buf);
    if (process.env.DUMP_PDF) {
      fs.writeFileSync("/tmp/relatorio-atendimento-real.pdf", buf);
    }
  });

  it("não quebra sem período anterior (comparativo desligado)", async () => {
    const data = dadosCompletos();
    data.anterior = null;
    ehPdfValido(await gerarAtendimentoPdf({ data, ...CABECALHO }));
  });

  it("não quebra com escritório zerado", async () => {
    const data = dadosCompletos();
    data.totalConversas = 0;
    data.atendimentosIniciados = 0;
    data.mensagensRecebidas = 0;
    data.mensagensEnviadas = 0;
    data.segMedioPriResp = 0;
    data.taxaConversao = null;
    data.ticketMedio = null;
    data.conversaParaLead = null;
    data.leadsGanhos = 0;
    data.leadsPerdidos = 0;
    data.anterior = null;
    data.conversasPorDia = [];
    data.atendimentosPorDia = [];
    data.porCanal = [];
    data.motivosPerda = [];
    data.tabelaAtendentes = [];
    data.ligacoes = { feitas: 0, recebidas: 0, perdidas: 0, taxaAtendimento: null };
    data.ligacoesPorAtendente = [];
    ehPdfValido(await gerarAtendimentoPdf({ data, ...CABECALHO }));
  });

  it("não divide por zero com um único dia no gráfico", async () => {
    const data = dadosCompletos();
    data.conversasPorDia = [{ dia: "2026-07-15", total: 42 }];
    data.atendimentosPorDia = [{ dia: "2026-07-15", total: 47 }];
    ehPdfValido(await gerarAtendimentoPdf({ data, ...CABECALHO }));
  });

  it("omite a seção de ligações quando não houve chamada", async () => {
    const data = dadosCompletos();
    data.ligacoes = { feitas: 0, recebidas: 0, perdidas: 0, taxaAtendimento: null };
    data.ligacoesPorAtendente = [];
    const comLigacoes = await gerarAtendimentoPdf({ data: dadosCompletos(), ...CABECALHO });
    const semLigacoes = await gerarAtendimentoPdf({ data, ...CABECALHO });
    ehPdfValido(semLigacoes);
    expect(semLigacoes.length).toBeLessThan(comLigacoes.length);
  });

  it("pagina quando a tabela de atendentes é longa", async () => {
    const data = dadosCompletos();
    data.tabelaAtendentes = Array.from({ length: 40 }, (_, i) => ({
      nome: `Colaborador de Nome Bastante Longo ${i + 1}`,
      atendimentos: 100 - i,
      leadsTotal: 40 - Math.floor(i / 2),
      ganhos: 12 - Math.floor(i / 4),
      perdidos: 8,
      emAberto: 5,
      valorFechado: 50000 - i * 900,
      taxaConversao: 30 - Math.floor(i / 3),
    }));
    ehPdfValido(await gerarAtendimentoPdf({ data, ...CABECALHO }));
  });

  it("aceita filtros específicos no cabeçalho", async () => {
    ehPdfValido(
      await gerarAtendimentoPdf({
        data: dadosCompletos(),
        nomeEscritorio: "Escritório Teste",
        setorLabel: "Comercial Cível",
        atendenteLabel: "Milena Mello Mansur",
        canalLabel: "WhatsApp — Comercial · (85) 99999-0000",
      }),
    );
  });
});

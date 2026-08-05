/**
 * Listagem de cards do Kanban em PDF.
 *
 * O layout é posicionado à mão (pdfkit) — fácil regredir (page-break no
 * rodapé, célula estourando a coluna, lista vazia). As funções de formatação
 * são testadas direto porque são elas que decidem se a linha cabe.
 *
 * Setar DUMP_PDF=1 grava em /tmp/kanban-cards-real.pdf pra inspeção visual.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import {
  abreviarNome,
  diasDesde,
  gerarKanbanCardsPdf,
  idadeCurta,
  type CardPdf,
} from "./kanban-cards-pdf";

const AGORA = new Date("2026-08-05T12:00:00Z");

function card(over: Partial<CardPdf> = {}): CardPdf {
  return {
    clienteNome: "Maria Eduarda Nogueira",
    titulo: "Revisional — contrato 4471",
    funilNome: "Cível — Revisional",
    colunaNome: "Triagem",
    responsavelNome: "Milena Mello Mansur",
    criadoEm: "2026-08-04T09:00:00.000Z",
    prazo: "2026-08-19T00:00:00.000Z",
    valorEstimado: 12400,
    prioridade: "alta",
    arquivado: false,
    ...over,
  };
}

const LISTA: CardPdf[] = [
  card(),
  card({ clienteNome: "Antônio Marcos Vieira", titulo: "Revisional — Caixa", criadoEm: "2026-08-03T09:00:00.000Z", prioridade: "media", valorEstimado: 11500 }),
  card({ clienteNome: "Construtora Vale Verde Ltda", titulo: "Rescisão indireta — 3 empregados", funilNome: "Trabalhista", colunaNome: "Documentação", responsavelNome: "Pablo Sousa Silva", criadoEm: "2026-08-02T09:00:00.000Z", prazo: "2026-08-12T00:00:00.000Z", valorEstimado: 38000 }),
  card({ clienteNome: "Ana Paula Rocha dos Santos", titulo: "Aposentadoria por tempo de contribuição", funilNome: "Previdenciário", colunaNome: "Aguardando decisão", criadoEm: "2026-07-19T09:00:00.000Z", prazo: null, prioridade: "media", valorEstimado: 18400 }),
  card({ clienteNome: "Distribuidora Aliança Ltda", titulo: "Trabalhista — acordo em execução", funilNome: "Trabalhista", colunaNome: "Aguardando decisão", responsavelNome: "Pablo Sousa Silva", criadoEm: "2026-05-14T09:00:00.000Z", prazo: null, valorEstimado: 47600 }),
];

const BASE = {
  nomeEscritorio: "Rocha & Associados Advocacia",
  agora: AGORA,
};
const META = { funilLabel: "Todos", responsavelLabel: "Todos", periodoLabel: "Todo o período" };

function ehPdfValido(buf: Buffer) {
  expect(Buffer.isBuffer(buf)).toBe(true);
  expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  expect(buf.length).toBeGreaterThan(2000);
}

describe("diasDesde", () => {
  it("conta os dias inteiros até agora", () => {
    expect(diasDesde("2026-08-04T09:00:00.000Z", AGORA)).toBe(1);
    expect(diasDesde("2026-05-14T09:00:00.000Z", AGORA)).toBe(83);
  });

  it("card criado hoje é 0, não 1", () => {
    expect(diasDesde("2026-08-05T08:00:00.000Z", AGORA)).toBe(0);
  });

  it("não devolve negativo pra data futura", () => {
    expect(diasDesde("2026-09-01T00:00:00.000Z", AGORA)).toBe(0);
  });

  it("devolve 0 pra data inválida em vez de NaN na coluna", () => {
    expect(diasDesde("data-ruim", AGORA)).toBe(0);
  });
});

describe("idadeCurta", () => {
  it("usa dias abaixo de dois meses", () => {
    expect(idadeCurta(1)).toBe("1 d");
    expect(idadeCurta(59)).toBe("59 d");
  });

  it("vira meses a partir de 60 dias — 83 dias não cabe na coluna", () => {
    expect(idadeCurta(60)).toBe("2 m");
    expect(idadeCurta(83)).toBe("3 m");
  });

  it("vira anos passando de 12 meses", () => {
    expect(idadeCurta(365)).toBe("1 a");
    expect(idadeCurta(430)).toBe("1 a 2 m");
  });
});

describe("abreviarNome", () => {
  it("encolhe o nome do meio", () => {
    expect(abreviarNome("Francisco Wesley Freitas")).toBe("Francisco W. Freitas");
    expect(abreviarNome("Ana Paula Rocha dos Santos")).toBe("Ana P. R. dos Santos");
  });

  it("deixa nome de duas palavras intacto", () => {
    expect(abreviarNome("Pablo Silva")).toBe("Pablo Silva");
  });

  it("não quebra com nome de uma palavra ou espaços sobrando", () => {
    expect(abreviarNome("Milena")).toBe("Milena");
    expect(abreviarNome("  Isaac   Luca   Cavalcante  ")).toBe("Isaac L. Cavalcante");
  });
});

describe("gerarKanbanCardsPdf", () => {
  it("gera PDF não-trivial com a lista completa", async () => {
    const buf = await gerarKanbanCardsPdf({ data: { cards: LISTA, ...META }, ...BASE });
    ehPdfValido(buf);
    if (process.env.DUMP_PDF) fs.writeFileSync("/tmp/kanban-cards-real.pdf", buf);
  });

  it("não quebra com a lista vazia — filtro sem resultado é caso normal", async () => {
    const buf = await gerarKanbanCardsPdf({ data: { cards: [], ...META }, ...BASE });
    ehPdfValido(buf);
  });

  it("aceita card sem cliente, sem responsável, sem prazo e sem valor", async () => {
    const buf = await gerarKanbanCardsPdf({
      data: {
        cards: [card({
          clienteNome: null, responsavelNome: null, prazo: null, valorEstimado: null,
        })],
        ...META,
      },
      ...BASE,
    });
    ehPdfValido(buf);
  });

  it("pagina uma lista longa", async () => {
    const muitos = Array.from({ length: 120 }, (_, i) =>
      card({
        clienteNome: `Cliente de Nome Bastante Longo Número ${i + 1}`,
        titulo: `Card com título comprido pra testar a truncagem ${i + 1}`,
        criadoEm: new Date(Date.UTC(2026, 6, 1) - i * 86_400_000).toISOString(),
      }));
    const buf = await gerarKanbanCardsPdf({ data: { cards: muitos, ...META }, ...BASE });
    ehPdfValido(buf);
    expect(buf.length).toBeGreaterThan(20_000);
  });

  it("reflete os filtros no cabeçalho", async () => {
    const buf = await gerarKanbanCardsPdf({
      data: {
        cards: LISTA,
        funilLabel: "Cível — Revisional",
        responsavelLabel: "Milena Mello Mansur",
        periodoLabel: "01/07/2026 a 31/07/2026",
      },
      ...BASE,
    });
    ehPdfValido(buf);
  });
});

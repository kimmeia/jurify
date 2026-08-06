/**
 * Filtros dos cards do Kanban.
 *
 * O quadro e o PDF filtram pelo mesmo código justamente pra não divergirem —
 * ver 22 cards na tela e exportar 30 destrói a confiança no arquivo. Aqui
 * travamos as regras que não são óbvias: a busca textual, o filtro de tag e
 * a precedência do verProprios sobre o filtro escolhido.
 */

import { describe, it, expect } from "vitest";
import {
  boundsPrazo,
  casaBusca,
  casaTag,
  condicoesCards,
  recortarColunas,
  rotuloColunas,
} from "./kanban-filtros";

describe("casaBusca", () => {
  const card = {
    titulo: "Revisional — contrato 4471",
    clienteNome: "Maria Eduarda Nogueira",
    tags: "urgente,revisional",
  };

  it("sem busca, tudo passa", () => {
    expect(casaBusca(card, undefined)).toBe(true);
    expect(casaBusca(card, "   ")).toBe(true);
  });

  it("acha por título, cliente ou tag", () => {
    expect(casaBusca(card, "contrato")).toBe(true);
    expect(casaBusca(card, "eduarda")).toBe(true);
    expect(casaBusca(card, "urgente")).toBe(true);
  });

  it("ignora caixa", () => {
    expect(casaBusca(card, "MARIA")).toBe(true);
    expect(casaBusca(card, "ReViSiOnAl")).toBe(true);
  });

  it("não casa o que não existe", () => {
    expect(casaBusca(card, "trabalhista")).toBe(false);
  });

  it("não quebra com campos nulos", () => {
    expect(casaBusca({ titulo: null, clienteNome: null, tags: null }, "x")).toBe(false);
    expect(casaBusca({}, undefined)).toBe(true);
  });
});

describe("casaTag", () => {
  it("exige a tag inteira, não pedaço dela", () => {
    const card = { tags: "urgente,revisional" };
    expect(casaTag(card, "urgente")).toBe(true);
    // "urg" é prefixo de "urgente" mas não é a tag — não pode casar.
    expect(casaTag(card, "urg")).toBe(false);
  });

  it("apara espaços da lista e da busca", () => {
    expect(casaTag({ tags: " urgente , revisional " }, "  Revisional ")).toBe(true);
  });

  it("sem filtro, tudo passa", () => {
    expect(casaTag({ tags: null }, undefined)).toBe(true);
    expect(casaTag({ tags: "x" }, "")).toBe(true);
  });

  it("card sem tag não casa filtro de tag", () => {
    expect(casaTag({ tags: null }, "urgente")).toBe(false);
  });
});

describe("boundsPrazo", () => {
  it("hoje começa à meia-noite e termina no último milissegundo", () => {
    const { hoje, fimHoje, fim7 } = boundsPrazo(new Date("2026-08-05T15:30:00"));
    expect(hoje.getHours()).toBe(0);
    expect(hoje.getMinutes()).toBe(0);
    expect(fimHoje.getHours()).toBe(23);
    expect(fimHoje.getMilliseconds()).toBe(999);
    // "7 dias" inclui hoje + 7, não hoje + 6.
    expect(Math.round((fim7.getTime() - hoje.getTime()) / 86_400_000)).toBe(8);
  });
});

describe("condicoesCards", () => {
  const base = { escritorioId: 7, filtros: {} };

  it("sempre trava no escritório", () => {
    expect(condicoesCards(base).length).toBeGreaterThan(0);
  });

  it("esconde arquivados por padrão e mostra quando pedido", () => {
    const semArquivados = condicoesCards(base).length;
    const comArquivados = condicoesCards({
      ...base, filtros: { mostrarArquivados: true },
    }).length;
    expect(comArquivados).toBe(semArquivados - 1);
  });

  it("verProprios sobrepõe o responsável escolhido — não soma dois filtros", () => {
    const travado = condicoesCards({
      ...base,
      filtros: { responsavelId: 99 },
      travarNoColaborador: 3,
    });
    const soFiltro = condicoesCards({ ...base, filtros: { responsavelId: 99 } });
    // Mesmo número de condições: a do colaborador substitui a do filtro.
    expect(travado.length).toBe(soFiltro.length);
  });

  it("cada filtro adiciona uma condição", () => {
    const vazio = condicoesCards(base).length;
    expect(condicoesCards({ ...base, filtros: { prioridade: "alta" } }).length).toBe(vazio + 1);
    expect(condicoesCards({ ...base, filtros: { prazoFiltro: "vencidos" } }).length).toBe(vazio + 1);
    expect(
      condicoesCards({ ...base, filtros: { dataInicio: "2026-07-01", dataFim: "2026-07-31" } }).length,
    ).toBe(vazio + 2);
  });

  it("restringe às colunas do funil quando elas vêm", () => {
    const todos = condicoesCards(base).length;
    expect(condicoesCards({ ...base, colunasIds: [1, 2, 3] }).length).toBe(todos + 1);
  });
});

describe("recortarColunas", () => {
  const colunas = [
    { id: 10, nome: "Triagem" },
    { id: 11, nome: "Documentação" },
    { id: 12, nome: "Encerrado" },
  ];

  it("sem lista, exporta o funil inteiro", () => {
    // É o comportamento de antes do seletor: quem não escolhe, leva tudo.
    expect(recortarColunas(colunas, undefined)).toHaveLength(3);
    expect(recortarColunas(colunas, [])).toHaveLength(3);
  });

  it("fica só com o que foi escolhido, na ordem do quadro", () => {
    expect(recortarColunas(colunas, [12, 10]).map((c) => c.nome)).toEqual([
      "Triagem",
      "Encerrado",
    ]);
  });

  it("id de coluna de outro escritório não entra", () => {
    // A lista de entrada já veio filtrada por escritorioId. Chutar um id
    // qualquer não pode trazer nada — por isso o recorte é interseção, e não
    // um WHERE IN com o que o cliente mandou.
    expect(recortarColunas(colunas, [999])).toEqual([]);
    expect(recortarColunas(colunas, [10, 999]).map((c) => c.id)).toEqual([10]);
  });
});

describe("rotuloColunas", () => {
  const colunas = [{ nome: "Triagem" }, { nome: "Documentação" }, { nome: "Encerrado" }];

  it("tudo marcado vira 'Todas' em vez de listar o funil inteiro", () => {
    expect(rotuloColunas(colunas, colunas)).toBe("Todas");
  });

  it("recorte lista os nomes, que é o que distingue dois PDFs impressos", () => {
    expect(rotuloColunas(colunas, [{ nome: "Triagem" }, { nome: "Documentação" }])).toBe(
      "Triagem, Documentação",
    );
  });

  it("nada marcado não vira 'Todas' por acidente", () => {
    // Com length 0 === length 0 num funil sem colunas, a comparação ingênua
    // diria "Todas" pra um PDF vazio.
    expect(rotuloColunas([], [])).toBe("Nenhuma");
    expect(rotuloColunas(colunas, [])).toBe("Nenhuma");
  });
});

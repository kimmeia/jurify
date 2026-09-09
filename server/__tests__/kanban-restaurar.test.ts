/**
 * Ler de volta o relatório que este mesmo sistema emite.
 *
 * Existe porque excluir uma coluna leva os cards junto e não deixa nada no
 * banco além de histórico órfão, que não guarda o nome. Depois de um estrago
 * desses o PDF emitido antes vira o único lugar onde aqueles nomes ainda
 * existem — então o leitor precisa funcionar em arquivo VELHO, emitido por
 * uma versão anterior do gerador. É o oposto do normal: quem tem que se
 * adaptar é o código novo.
 *
 * Por isso o teste é de ida e volta pelo gerador de verdade, e não contra um
 * PDF fixo: gerar, ler, e exigir os mesmos dados. Fixture de PDF real
 * carregaria nome de cliente pro repositório, o que não se faz.
 */

import { describe, expect, it } from "vitest";
import { gerarKanbanCardsPdf, type CardPdf } from "../escritorio/kanban-cards-pdf";
import { lerRelatorioDeCards } from "../escritorio/kanban-relatorio-parser";
import { lerDataBR, lerPrazoBR, montarPlano, normalizar } from "../escritorio/kanban-restaurar";

const COLUNAS = [
  { id: 1, nome: "DAR ENTRADA", funilNome: "Produção Operacional" },
  { id: 2, nome: "EM ANDAMENTO", funilNome: "Produção Operacional" },
];

function card(p: Partial<CardPdf> & { titulo: string; criadoEm: string }): CardPdf {
  return {
    clienteNome: p.clienteNome ?? null,
    titulo: p.titulo,
    funilNome: "Produção Operacional",
    colunaId: p.colunaId ?? 1,
    colunaNome: p.colunaNome ?? "DAR ENTRADA",
    responsavelNome: p.responsavelNome ?? null,
    criadoEm: p.criadoEm,
    prazo: p.prazo ?? null,
    valorEstimado: p.valorEstimado ?? null,
    prioridade: p.prioridade ?? "media",
    arquivado: false,
  };
}

const CARDS: CardPdf[] = [
  card({
    titulo: "Joaquim Ferreira de Andrade",
    clienteNome: "Joaquim Ferreira de Andrade",
    responsavelNome: "Mariana Alexandre",
    criadoEm: "2026-08-05T10:00:00.000Z",
    prazo: "2026-08-20T10:00:00.000Z",
  }),
  card({
    titulo: "Sebastiana Rocha Vilanova",
    responsavelNome: "Eduardo Braga",
    criadoEm: "2026-07-30T10:00:00.000Z",
  }),
  card({
    titulo: "Construtora Panorama Norte LTDA",
    clienteNome: "Construtora Panorama Norte LTDA",
    criadoEm: "2026-06-11T10:00:00.000Z",
    colunaId: 2,
    colunaNome: "EM ANDAMENTO",
    valorEstimado: 1300,
  }),
];

async function pdfDeTeste(cards = CARDS) {
  return gerarKanbanCardsPdf({
    data: {
      cards,
      grupos: COLUNAS,
      funilLabel: "PRODUÇÃO OPERACIONAL",
      colunasLabel: "Todas",
      responsavelLabel: "Todos",
      periodoLabel: "Todo o período",
    },
    nomeEscritorio: "Escritório de Teste",
    agora: new Date("2026-08-18T12:00:00.000Z"),
  });
}

describe("ler de volta o próprio relatório", () => {
  it("acha todas as linhas e nenhuma a mais", async () => {
    const r = await lerRelatorioDeCards(await pdfDeTeste());
    expect(r.linhas).toHaveLength(CARDS.length);
    // O rodapé declara o total; divergir dele é sinal de linha perdida.
    expect(r.totalDeclarado).toBe(CARDS.length);
  });

  it("cada campo volta na coluna certa", async () => {
    const r = await lerRelatorioDeCards(await pdfDeTeste());
    const joaquim = r.linhas.find((l) => l.card.startsWith("Joaquim"));
    expect(joaquim).toBeDefined();
    expect(joaquim!.cliente).toContain("Joaquim");
    expect(joaquim!.responsavel).toBe("Mariana Alexandre");
    expect(joaquim!.cadastrado).toBe("05/08/2026");
    expect(joaquim!.prazo).toBe("20/08");
  });

  it("não confunde cabeçalho de grupo com card", async () => {
    // "DAR ENTRADA 2 cards" é uma linha do PDF, e sem âncora viraria um card
    // fantasma chamado "DAR ENTRADA".
    const r = await lerRelatorioDeCards(await pdfDeTeste());
    expect(r.linhas.map((l) => l.card)).not.toContain("DAR ENTRADA");
  });

  it("card sem cliente e sem responsável não vira lixo", async () => {
    const r = await lerRelatorioDeCards(await pdfDeTeste());
    const sebastiana = r.linhas.find((l) => l.card.startsWith("Sebastiana"));
    expect(sebastiana!.responsavel).toBe("Eduardo Braga");
    expect(sebastiana!.cadastrado).toBe("30/07/2026");
  });
});

describe("o plano de restauração", () => {
  const linhas = [
    { cliente: "", card: "Joaquim Ferreira de Andrade", etapa: "DAR ENTRADA", responsavel: "Mariana Alexandre", cadastrado: "05/08/2026", prazo: "20/08", valor: "—" },
    { cliente: "", card: "Sebastiana Rocha Vilanova", etapa: "DAR ENTRADA", responsavel: "Eduardo Braga", cadastrado: "30/07/2026", prazo: "", valor: "—" },
    { cliente: "", card: "Raimundo Nonato de Alencar", etapa: "DAR ENTRADA", responsavel: "Ninguém Aqui", cadastrado: "22/07/2026", prazo: "06/08", valor: "—" },
  ];
  const colunas = [{ id: 1, nome: "DAR ENTRADA" }];
  const time = [{ id: 10, nome: "Mariana Alexandre" }, { id: 11, nome: "Eduardo Braga" }];

  const emD = (br: string) => lerDataBR(br)!;

  it("card ainda no quadro não é recriado", () => {
    const p = montarPlano({
      linhas,
      cards: [{ id: 1, titulo: "Joaquim Ferreira de Andrade", colunaId: 1, criadoEm: emD("05/08/2026") }],
      colunas,
      colaboradores: time,
      clientes: [],
    });
    expect(p.itens[0].situacao).toBe("esta_no_quadro");
    expect(p.aRecriar).toBe(2);
  });

  it("card que alguém refez na mão é pulado, não duplicado", () => {
    // O nome está lá, mas cadastrado depois: é a assinatura de quem percebeu
    // a falta e recadastrou. Recriar de novo daria dois.
    const p = montarPlano({
      linhas,
      cards: [{ id: 1, titulo: "Joaquim Ferreira de Andrade", colunaId: 1, criadoEm: emD("14/08/2026") }],
      colunas,
      colaboradores: time,
      clientes: [],
    });
    expect(p.itens[0].situacao).toBe("refeito");
    expect(p.itens[0].refeitoEm).toBe("14/08/2026");
  });

  it("dois cards do mesmo nome no mesmo dia são dois cards", () => {
    // Um card do banco só pode casar uma vez, senão a segunda linha some do
    // relatório de perdas sem ter voltado.
    const duas = [linhas[0], { ...linhas[0] }];
    const p = montarPlano({
      linhas: duas,
      cards: [{ id: 1, titulo: "Joaquim Ferreira de Andrade", colunaId: 1, criadoEm: emD("05/08/2026") }],
      colunas,
      colaboradores: time,
      clientes: [],
    });
    expect(p.itens[0].situacao).toBe("esta_no_quadro");
    expect(p.itens[1].situacao).toBe("recriar");
  });

  it("nome truncado no PDF casa com o nome inteiro do banco", () => {
    // O relatório corta com reticências quando não cabe; o banco tem inteiro.
    const p = montarPlano({
      linhas: [{ ...linhas[0], card: "Joaquim Ferreira de And…" }],
      cards: [{ id: 1, titulo: "Joaquim Ferreira de Andrade", colunaId: 1, criadoEm: emD("05/08/2026") }],
      colunas,
      colaboradores: time,
      clientes: [],
    });
    expect(p.itens[0].situacao).toBe("esta_no_quadro");
  });

  it("responsável que não existe no time vira pendência, não chute", () => {
    const p = montarPlano({ linhas, cards: [], colunas, colaboradores: time, clientes: [] });
    const raimundo = p.itens[2];
    expect(raimundo.responsavelId).toBeNull();
    expect(p.responsaveisNaoEncontrados).toContain("Ninguém Aqui");
  });

  it("etapa que não existe mais não inventa coluna", () => {
    const p = montarPlano({
      linhas,
      cards: [],
      colunas: [{ id: 9, nome: "OUTRA COISA" }],
      colaboradores: time,
      clientes: [],
    });
    expect(p.itens.every((i) => i.situacao === "sem_coluna")).toBe(true);
    expect(p.aRecriar).toBe(0);
  });
});

describe("datas", () => {
  it("prazo impresso sem ano se ancora no cadastro", () => {
    const cad = lerDataBR("30/12/2026")!;
    // "05/01" depois de um cadastro de 30/12 é janeiro do ano seguinte.
    expect(lerPrazoBR("05/01", cad)?.getFullYear()).toBe(2027);
    expect(lerPrazoBR("31/12", cad)?.getFullYear()).toBe(2026);
  });

  it("normalizar tira acento, reticências e caixa", () => {
    expect(normalizar("José da Conceição…")).toBe("JOSE DA CONCEICAO");
  });
});

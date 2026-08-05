import { describe, it, expect } from "vitest";
import { classificarGrupo, parseAnaliseJson, triar } from "./router-movimentacoes";
import type { AnaliseMovimentacao } from "./resumir-movimentacao";

const analise = (exigida: boolean, relevancia: "relevante" | "rotina" = "relevante"): AnaliseMovimentacao => ({
  titulo: "t",
  pontos: [],
  ato: "decisao",
  desfecho: null,
  relevancia,
  providencia: {
    exigida,
    descricao: exigida ? "fazer algo" : null,
    prazoDias: exigida ? 15 : null,
    prazoUteis: true,
    dataExplicita: null,
    consequencia: null,
    citacao: null,
  },
});

describe("classificarGrupo", () => {
  it("prazo pendente sempre cai em 'exigem ação'", () => {
    expect(
      classificarGrupo({ relevancia: "rotina", temPrazoPendente: true, analise: analise(false, "rotina") }),
    ).toBe("exigem_acao");
  });

  it("providência da IA leva a 'exigem ação' mesmo sem prazo gravado", () => {
    // Caso real: audiência designada sem sugestão criada ainda.
    expect(
      classificarGrupo({ relevancia: "relevante", temPrazoPendente: false, analise: analise(true) }),
    ).toBe("exigem_acao");
  });

  it("prazo já resolvido não segura a movimentação em 'exigem ação'", () => {
    // O advogado aprovou ou descartou → temPrazoPendente false.
    expect(
      classificarGrupo({ relevancia: "relevante", temPrazoPendente: false, analise: analise(false) }),
    ).toBe("relevante");
  });

  it("rotina classificada pela IA vai pra rotina", () => {
    expect(
      classificarGrupo({ relevancia: "rotina", temPrazoPendente: false, analise: analise(false, "rotina") }),
    ).toBe("rotina");
  });

  it("sem análise cai em 'relevante', não em 'rotina'", () => {
    // Movimentação antiga ou IA fora: esconder algo não lido é pior que
    // mostrar demais.
    expect(classificarGrupo({ relevancia: null, temPrazoPendente: false, analise: null })).toBe(
      "relevante",
    );
  });

  it("relevância no banco decide quando não há análise estruturada", () => {
    expect(classificarGrupo({ relevancia: "rotina", temPrazoPendente: false, analise: null })).toBe(
      "rotina",
    );
  });
});

describe("triar", () => {
  const universo = [
    { id: 1, grupo: "exigem_acao" as const, lido: false },
    { id: 2, grupo: "exigem_acao" as const, lido: true },
    { id: 3, grupo: "relevante" as const, lido: false },
    { id: 4, grupo: "relevante" as const, lido: false },
    { id: 5, grupo: "relevante" as const, lido: true },
    { id: 6, grupo: "rotina" as const, lido: true },
  ];

  it("abre em 'a resolver' quando ninguém escolheu estado", () => {
    // É o estado que a tela precisa mostrar sem ninguém descobrir por
    // tentativa onde mora o trabalho do dia.
    expect(triar(universo, {}).itens.map((i) => i.id)).toEqual([1, 3, 4]);
  });

  it("'resolvidas' devolve exatamente o complemento", () => {
    expect(triar(universo, { estado: "resolvidas" }).itens.map((i) => i.id)).toEqual([2, 5, 6]);
  });

  it("'todas' não filtra nada", () => {
    expect(triar(universo, { estado: "todas" }).itens).toHaveLength(6);
  });

  it("as três abas são uma partição: a resolver + resolvidas = total", () => {
    const r = triar(universo, { estado: "todas" });
    expect(r.contagem.aResolver + r.contagem.resolvidas).toBe(r.total);
    expect(r.total).toBe(6);
  });

  it("o filtro de tipo encolhe as contagens de estado junto", () => {
    // Se os números das abas ignorassem o tipo escolhido, clicar em
    // "a resolver 3" mostraria 2 itens — e o número viraria decoração.
    const r = triar(universo, { grupos: ["relevante"], estado: "a_resolver" });
    expect(r.itens.map((i) => i.id)).toEqual([3, 4]);
    expect(r.contagem.aResolver).toBe(2);
    expect(r.contagem.resolvidas).toBe(1);
    expect(r.total).toBe(3);
  });

  it("a contagem por grupo ignora o filtro de tipo", () => {
    // Ela rotula as opções do próprio seletor: se encolhesse junto, escolher
    // um tipo zeraria os outros e não daria pra voltar sabendo o que tem lá.
    const r = triar(universo, { grupos: ["rotina"], estado: "todas" });
    expect(r.contagem.exigem_acao).toBe(2);
    expect(r.contagem.relevante).toBe(3);
    expect(r.contagem.rotina).toBe(1);
  });

  it("lista vazia não quebra as contagens", () => {
    const r = triar([], { estado: "a_resolver" });
    expect(r).toEqual({
      itens: [],
      contagem: { exigem_acao: 0, relevante: 0, rotina: 0, aResolver: 0, resolvidas: 0 },
      total: 0,
    });
  });

  it("grupos vazio equivale a não filtrar", () => {
    expect(triar(universo, { grupos: [], estado: "todas" }).total).toBe(6);
  });
});

describe("parseAnaliseJson", () => {
  const gravada = (pontos: string[]) =>
    JSON.stringify({
      titulo: "Sentença procedente em parte",
      pontos,
      ato: "sentenca",
      desfecho: "parcial",
      relevancia: "relevante",
      providencia: {
        exigida: false,
        descricao: null,
        prazoDias: null,
        prazoUteis: true,
        dataExplicita: null,
        consequencia: null,
        citacao: null,
      },
    });

  it("limpa o enchimento que já estava gravado no banco", () => {
    // O filtro nasceu só na escrita, então toda movimentação analisada antes
    // dele continuava mostrando a frase vazia pra quem abrisse o painel.
    const a = parseAnaliseJson(
      gravada([
        "Não há informações adicionais disponíveis no rótulo do tribunal.",
        "Devolução em dobro das parcelas do seguro não contratado foi deferida.",
        "Recomenda-se a consulta aos autos para mais detalhes.",
      ]),
    );
    expect(a?.pontos).toEqual([
      "Devolução em dobro das parcelas do seguro não contratado foi deferida.",
    ]);
  });

  it("não mexe no resto da análise gravada", () => {
    const a = parseAnaliseJson(gravada(["Honorários fixados em 10% sobre o valor da condenação."]));
    expect(a?.titulo).toBe("Sentença procedente em parte");
    expect(a?.desfecho).toBe("parcial");
    expect(a?.providencia.exigida).toBe(false);
  });

  it("análise antiga sem o campo de pontos não quebra a leitura", () => {
    const a = parseAnaliseJson('{"titulo":"x","providencia":{"exigida":false}}');
    expect(a?.pontos).toEqual([]);
  });

  it("json corrompido vira null em vez de derrubar a listagem", () => {
    expect(parseAnaliseJson("{nao é json")).toBeNull();
    expect(parseAnaliseJson(null)).toBeNull();
  });
});

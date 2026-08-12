/**
 * A conversa única do JurisIA.
 *
 * O bug que motivou a fusão: perguntar sobre o caso do cliente devolvia
 * "Preciso de um recorte pra pesquisar: diga pelo menos o tribunal e o tipo de
 * ação". Não era falta de dado — o processo estava no banco, com tribunal e
 * classe. Era o modo errado. Os dois primeiros blocos aqui existem pra que a
 * recusa não volte por nenhum dos dois lados: com caso escolhido o recorte sai
 * do processo, e sem caso a conversa segue respondendo em vez de exigir um.
 *
 * Os outros três blocos guardam as invariantes que a fusão herdou da Pesquisa
 * e não pode perder: o número do acervo vem do banco, o modelo não mede, e
 * processo que ele cita tem que existir no contexto.
 */

import { describe, expect, it } from "vitest";
import {
  cnjsForaDoContexto,
  escolherRecorte,
  formatarAcervoParaPrompt,
  montarMensagens,
  percentualSobreAcervo,
  type RecorteMedido,
} from "../jurisia/conversa-una";
import { montarSystemPromptAgente } from "../juridico/agente-conversa";
import type { FiltroRecorte } from "../../shared/jurisia-recorte";

const VAZIO: FiltroRecorte = {
  tribunal: null,
  classeTermo: null,
  assuntoTermo: null,
  orgaoTermo: null,
  desdeAno: null,
};

const filtro = (over: Partial<FiltroRecorte> = {}): FiltroRecorte => ({ ...VAZIO, ...over });

describe("escolherRecorte", () => {
  it("pergunta sobre o caso usa o recorte do processo — não vira recusa", () => {
    // "Como prosseguir nesse caso?" não nomeia tribunal nem classe: o
    // interpretador devolve tudo null. Antes isso caía em "preciso de um
    // recorte"; agora o processo do cliente responde por ele.
    const r = escolherRecorte(VAZIO, filtro({ tribunal: "tjce", classeTermo: "Usucapião" }));
    expect(r).toEqual(filtro({ tribunal: "tjce", classeTermo: "Usucapião" }));
  });

  it("sem caso e sem recorte na pergunta, devolve null — e null não é recusa", () => {
    // A conversa segue: quem responde é o dossiê, a base do escritório e o
    // direito aplicável. O acervo é que fica de fora deste turno.
    expect(escolherRecorte(VAZIO, null)).toBeNull();
  });

  it("a pergunta ganha da ficha do processo", () => {
    // "Como o STJ decide isso?" é pergunta sobre o STJ mesmo com um caso do
    // TJCE aberto.
    const r = escolherRecorte(
      filtro({ tribunal: "STJ", assuntoTermo: "usucapião" }),
      filtro({ tribunal: "tjce", classeTermo: "Apelação" }),
    );
    expect(r?.tribunal).toBe("STJ");
    expect(r?.classeTermo).toBeNull();
  });

  it("herda só o tribunal quando a pergunta não o nomeia", () => {
    // Herdar classe/assunto do caso por cima de um recorte já montado produz
    // interseção vazia com mais frequência do que acerta.
    const r = escolherRecorte(
      filtro({ assuntoTermo: "revisão" }),
      filtro({ tribunal: "tjce", classeTermo: "Busca e Apreensão" }),
    );
    expect(r).toEqual(filtro({ tribunal: "tjce", assuntoTermo: "revisão" }));
  });

  it("pergunta ao acervo sem caso nenhum continua funcionando", () => {
    const r = escolherRecorte(filtro({ tribunal: "TJCE", classeTermo: "Execução Fiscal" }), null);
    expect(r?.tribunal).toBe("TJCE");
  });
});

describe("percentualSobreAcervo", () => {
  it("pega o percentual numa afirmação marcada como acervo", () => {
    expect(percentualSobreAcervo("Em 81% dos casos o pedido é acolhido [A].")).toBe("81%");
  });

  it("não confunde juro contratual com estatística do acervo", () => {
    // O detector da Pesquisa é genérico porque lá a resposta INTEIRA falava do
    // acervo. Aqui a mesma resposta é uma peça, e "1% ao mês" é cláusula.
    expect(percentualSobreAcervo("O contrato prevê juros de 1% ao mês [D].")).toBeNull();
  });

  it("não confunde prazo nem folha dos autos com contagem", () => {
    expect(percentualSobreAcervo("O prazo é de 15 dias do art. 1.003, §5º do CPC [F].")).toBeNull();
    expect(percentualSobreAcervo("A escritura está às fls. 12 de 40 [D].")).toBeNull();
  });

  it("varre todas as frases, não só a primeira", () => {
    const t = "A posse está provada [D].\nO recorte confirma isso em 7 de 10 vezes [A].";
    expect(percentualSobreAcervo(t)).toBe("7 de 10");
  });

  it("texto sem marca de acervo nunca acusa", () => {
    expect(percentualSobreAcervo("Foram 12 processos conexos distribuídos à mesma vara.")).toBeNull();
  });
});

describe("cnjsForaDoContexto", () => {
  const doAcervo = "08123456720238060001";

  it("acusa processo que não veio de fonte nenhuma", () => {
    const t = "Conforme o processo 0999999-88.2020.8.06.0100, a tese é firme.";
    expect(cnjsForaDoContexto(t, [doAcervo])).toEqual(["0999999-88.2020.8.06.0100"]);
  });

  it("aceita o processo do acervo mesmo formatado diferente", () => {
    const t = "O processo 0812345-67.2023.8.06.0001 mostra o padrão.";
    expect(cnjsForaDoContexto(t, [doAcervo])).toEqual([]);
  });

  it("aceita o processo do próprio cliente", () => {
    const meu = "0700111-22.2024.8.06.0001";
    expect(cnjsForaDoContexto(`Nos autos ${meu}, a intimação saiu dia 04.`, [meu])).toEqual([]);
  });

  it("não repete o mesmo número citado duas vezes", () => {
    const t = "Ver 0999999-88.2020.8.06.0100 e também 0999999-88.2020.8.06.0100.";
    expect(cnjsForaDoContexto(t, [])).toHaveLength(1);
  });
});

describe("montarMensagens", () => {
  const longo = "x".repeat(4000);

  it("mantém a última resposta INTEIRA — 'deixa mais enxuto' reescreve ela", () => {
    const msgs = montarMensagens(
      [
        { papel: "usuario", texto: "Redija a apelação" },
        { papel: "assistente", texto: longo },
      ],
      "deixa mais enxuto",
    );
    expect(msgs.at(-2)?.content).toBe(longo);
    expect(msgs.at(-1)).toEqual({ role: "user", content: "deixa mais enxuto" });
  });

  it("abrevia as respostas antigas — elas mantêm o fio, não são reescritas", () => {
    const msgs = montarMensagens(
      [
        { papel: "usuario", texto: "Analise o caso" },
        { papel: "assistente", texto: longo },
        { papel: "usuario", texto: "Redija a apelação" },
        { papel: "assistente", texto: "peça curta" },
      ],
      "revise",
    );
    expect(msgs[1]?.content).toContain("turno anterior abreviado");
    expect(msgs[1]?.content.length).toBeLessThan(longo.length);
    expect(msgs[3]?.content).toBe("peça curta");
  });

  it("conversa nova manda só a pergunta", () => {
    expect(montarMensagens([], "como o TJCE decide usucapião?")).toEqual([
      { role: "user", content: "como o TJCE decide usucapião?" },
    ]);
  });

  it("descarta turno vazio — resposta que falhou ficou gravada com texto vazio", () => {
    const msgs = montarMensagens(
      [{ papel: "usuario", texto: "oi" }, { papel: "assistente", texto: "" }],
      "e agora?",
    );
    expect(msgs).toHaveLength(2);
  });
});

describe("formatarAcervoParaPrompt", () => {
  const medido: RecorteMedido = {
    filtro: filtro({ tribunal: "tjce", classeTermo: "Usucapião" }),
    estatistica: {
      total: 1284,
      comResultado: 1107,
      emAndamento: 177,
      fatias: [],
      amostraPequena: false,
    },
    fraseTendencia: null,
    prova: {
      rotulo: "TJCE · Usucapião",
      descricaoFiltro: "Usucapião · TJCE",
      total: 1284,
      comResultado: 1107,
      fatias: [
        { resultado: "procedente", rotulo: "Procedente", quantidade: 565, percentual: 51 },
        { resultado: "acordo", rotulo: "Acordo", quantidade: 0, percentual: 0 },
      ],
      jurisprudencia: 900,
      amostraPequena: false,
    },
    texto: "[FONTE 1] 0812345-67.2023.8.06.0001 (TJCE)",
    fontes: [],
    cnjs: ["08123456720238060001"],
  };

  const txt = formatarAcervoParaPrompt(medido);

  it("entrega a distribuição em contagem absoluta, nunca em percentual", () => {
    expect(txt).toContain("Procedente: 565 de 1107");
    // 51% existe no objeto e não pode chegar ao modelo: é o número que ele
    // reescreveria no corpo da peça.
    expect(txt).not.toMatch(/\d+\s*%/);
  });

  it("omite fatia zerada — 'Acordo: 0 de 1107' é ruído no prompt", () => {
    expect(txt).not.toContain("Acordo:");
  });

  it("proíbe medir, citar como precedente e confundir instância", () => {
    expect(txt).toContain("NUNCA escreva percentual");
    expect(txt).toContain("ESTATÍSTICA, não precedente citável");
    expect(txt).toContain("RESPEITE A INSTÂNCIA");
  });

  it("separa os dois eixos de desfecho", () => {
    // Réu que recorre e ganha teve o RECURSO provido e o pedido do autor
    // rejeitado — chamar isso de "procedente" inverte o caso.
    expect(txt).toContain("DOIS EIXOS DE DESFECHO");
    expect(txt).toContain("Não conhecido");
  });

  it("o histórico do escritório entra em palavras, não em pontos percentuais", () => {
    const comCasa = formatarAcervoParaPrompt(medido, {
      escritorioTotal: 14,
      escritorioDecididos: 11,
      acervoDecididos: 1107,
      amostraPequena: false,
      linhas: [],
      destaque: { resultado: "procedente", diferencaPp: 12, acervoPct: 51, escritorioPct: 63 },
    });
    expect(comCasa).toContain("HISTÓRICO DESTE ESCRITÓRIO");
    expect(comCasa).toContain("acima do tribunal");
    expect(comCasa).not.toMatch(/\d+\s*%/);
  });
});

describe("prompt sem caso escolhido", () => {
  it("manda responder em vez de exigir um caso", () => {
    const p = montarSystemPromptAgente({ semCaso: true });
    expect(p).toContain("NENHUM CASO FOI ESCOLHIDO");
    expect(p).toContain("Responda com o que você tem");
    expect(p).toContain("não peça pro advogado \"selecionar um caso\" como condição");
  });

  it("com caso, a ressalva não aparece", () => {
    const p = montarSystemPromptAgente({ dossie: { qualificacao: "Nome: Fulano" } });
    expect(p).not.toContain("NENHUM CASO FOI ESCOLHIDO");
  });
});

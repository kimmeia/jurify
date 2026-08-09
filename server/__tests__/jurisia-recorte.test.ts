import { describe, expect, it } from "vitest";
import {
  ORDEM_RESULTADO,
  contemNumeroInventado,
  descreverFiltro,
  filtroVazio,
  formatarCnj,
  montarContextoRecorte,
  montarEstatistica,
  normalizarFiltro,
  numeroInventadoNaResposta,
  type ProcessoAcervo,
} from "../../shared/jurisia-recorte";
import type { ResultadoProcesso } from "../../shared/datajud-desfecho";

const contagem = (p: Partial<Record<ResultadoProcesso, number>>) => ({
  procedente: 0,
  parcial: 0,
  improcedente: 0,
  acordo: 0,
  extinto_sem_merito: 0,
  ...p,
});

const pct = (r: ReturnType<typeof montarEstatistica>) => r.fatias.map((f) => f.percentual);

describe("montarEstatistica", () => {
  it("mantém as cinco fatias na ordem canônica, mesmo zeradas", () => {
    const e = montarEstatistica(3, contagem({ procedente: 3 }));
    expect(e.fatias.map((f) => f.resultado)).toEqual(ORDEM_RESULTADO);
  });

  it("distribui o resto pra somar exatamente 100", () => {
    const e = montarEstatistica(3, contagem({ procedente: 1, parcial: 1, improcedente: 1 }));
    expect(pct(e)).toEqual([34, 33, 33, 0, 0]);
    expect(pct(e).reduce((s, n) => s + n, 0)).toBe(100);
  });

  it("dá o resto ao maior, não ao primeiro", () => {
    const e = montarEstatistica(3, contagem({ procedente: 2, improcedente: 1 }));
    expect(pct(e)).toEqual([67, 0, 33, 0, 0]);
  });

  // A regressão que interessa: fatia com zero processo não pode ganhar 1% do
  // arredondamento e aparecer como se existisse.
  it("nunca dá sobra a uma fatia zerada", () => {
    const e = montarEstatistica(
      3,
      contagem({ procedente: 1, improcedente: 1, extinto_sem_merito: 1 }),
    );
    expect(pct(e)).toEqual([34, 0, 33, 0, 33]);
    expect(e.fatias[1].quantidade).toBe(0);
    expect(e.fatias[3].percentual).toBe(0);
  });

  it("separa em andamento de decidido", () => {
    const e = montarEstatistica(100, contagem({ procedente: 30, improcedente: 10 }));
    expect(e.total).toBe(100);
    expect(e.comResultado).toBe(40);
    expect(e.emAndamento).toBe(60);
    expect(pct(e)).toEqual([75, 0, 25, 0, 0]);
  });

  it("recorte sem nenhum desfecho não gera percentual nenhum", () => {
    const e = montarEstatistica(12, contagem({}));
    expect(e.comResultado).toBe(0);
    expect(pct(e)).toEqual([0, 0, 0, 0, 0]);
    expect(e.amostraPequena).toBe(true);
  });

  it("marca amostra pequena abaixo do mínimo e solta acima", () => {
    expect(montarEstatistica(9, contagem({ procedente: 9 })).amostraPequena).toBe(true);
    expect(montarEstatistica(10, contagem({ procedente: 10 })).amostraPequena).toBe(false);
  });

  it("não inventa emAndamento negativo quando o total vem inconsistente", () => {
    const e = montarEstatistica(1, contagem({ procedente: 5 }));
    expect(e.emAndamento).toBe(0);
  });
});

describe("normalizarFiltro", () => {
  it("limpa a sigla do tribunal", () => {
    expect(normalizarFiltro({ tribunal: " tj-ce " }).tribunal).toBe("TJCE");
  });

  it("descarta termo curto demais pra discriminar", () => {
    const f = normalizarFiltro({ classeTermo: "ab", assuntoTermo: "revisão" });
    expect(f.classeTermo).toBeNull();
    expect(f.assuntoTermo).toBe("revisão");
  });

  it("aceita string JSON e lixo sem quebrar", () => {
    expect(normalizarFiltro('{"tribunal":"tjsp"}').tribunal).toBe("TJSP");
    expect(normalizarFiltro("não é json").tribunal).toBeNull();
    expect(normalizarFiltro(null).assuntoTermo).toBeNull();
    expect(normalizarFiltro(42).orgaoTermo).toBeNull();
  });

  it("recusa ano fora de faixa e não-inteiro", () => {
    expect(normalizarFiltro({ desdeAno: 2020 }).desdeAno).toBe(2020);
    expect(normalizarFiltro({ desdeAno: 1500 }).desdeAno).toBeNull();
    expect(normalizarFiltro({ desdeAno: 2020.5 }).desdeAno).toBeNull();
    expect(normalizarFiltro({ desdeAno: "ontem" }).desdeAno).toBeNull();
  });

  it("colapsa espaço e corta termo gigante", () => {
    const f = normalizarFiltro({ classeTermo: `  procedimento    comum ${"x".repeat(400)}` });
    expect(f.classeTermo?.startsWith("procedimento comum")).toBe(true);
    expect(f.classeTermo!.length).toBeLessThanOrEqual(120);
  });
});

describe("filtroVazio", () => {
  it("é vazio quando só tem ano — ano sozinho pegaria o Brasil inteiro", () => {
    expect(filtroVazio(normalizarFiltro({ desdeAno: 2020 }))).toBe(true);
  });

  it("não é vazio com qualquer critério de recorte", () => {
    expect(filtroVazio(normalizarFiltro({ tribunal: "TJCE" }))).toBe(false);
    expect(filtroVazio(normalizarFiltro({ assuntoTermo: "revisão" }))).toBe(false);
  });
});

describe("descreverFiltro", () => {
  it("descreve na ordem em que o advogado leria", () => {
    const f = normalizarFiltro({
      tribunal: "TJCE",
      classeTermo: "Procedimento Comum",
      assuntoTermo: "Contratos Bancários",
      desdeAno: 2022,
    });
    expect(descreverFiltro(f)).toBe(
      "Procedimento Comum · Contratos Bancários · TJCE · desde 2022",
    );
  });
});

describe("formatarCnj", () => {
  it("formata os 20 dígitos", () => {
    expect(formatarCnj("08001234520238060001")).toBe("0800123-45.2023.8.06.0001");
  });

  it("devolve como veio quando não são 20 dígitos", () => {
    expect(formatarCnj("123")).toBe("123");
  });
});

describe("montarContextoRecorte", () => {
  const proc = (id: number, over: Partial<ProcessoAcervo> = {}): ProcessoAcervo => ({
    id,
    cnj: "08001234520238060001",
    tribunal: "TJCE",
    grau: "G1",
    classeNome: "Procedimento Comum Cível",
    assuntoNome: "Contratos Bancários",
    orgaoNome: "3ª Vara Cível",
    resultado: "procedente",
    resultadoEm: "2024-03-15T00:00:00.000Z",
    resultadoMovimento: "Julgado procedente o pedido",
    ajuizamentoEm: "2023-01-10T00:00:00.000Z",
    ...over,
  });

  it("marca cada processo como FONTE com o id do acervo", () => {
    const c = montarContextoRecorte([proc(7), proc(9)]);
    expect(c.fontes.map((f) => f.id)).toEqual([7, 9]);
    expect(c.texto).toContain("[FONTE 7]");
    expect(c.texto).toContain("[FONTE 9]");
  });

  it("leva o movimento decisivo, que é o que sustenta a afirmação", () => {
    const c = montarContextoRecorte([proc(1)]);
    expect(c.texto).toContain("movimento decisivo: Julgado procedente o pedido");
  });

  it("diz explicitamente quando o processo não terminou", () => {
    const c = montarContextoRecorte([
      proc(1, { resultado: null, resultadoEm: null, resultadoMovimento: null }),
    ]);
    expect(c.texto).toContain("resultado: ainda sem desfecho");
    expect(c.fontes[0].rotulo).toContain("Em andamento");
    expect(c.fontes[0].data).toBe("10/01/2023");
  });

  it("respeita o teto de fontes", () => {
    const muitos = Array.from({ length: 80 }, (_, i) => proc(i + 1));
    expect(montarContextoRecorte(muitos, { maxFontes: 5 }).fontes).toHaveLength(5);
    expect(montarContextoRecorte(muitos).fontes).toHaveLength(40);
  });

  it("aguenta processo com campos faltando", () => {
    const c = montarContextoRecorte([
      proc(3, {
        grau: null,
        classeNome: null,
        assuntoNome: null,
        orgaoNome: null,
        resultadoEm: null,
        ajuizamentoEm: null,
      }),
    ]);
    expect(c.fontes[0].data).toBe("");
    expect(c.texto).toContain("[FONTE 3]");
    expect(c.texto).not.toContain("instância:");
    expect(c.fontes[0].natureza).toBeNull();
  });

  it("diz ao modelo qual fonte é acórdão e qual é sentença", () => {
    const c = montarContextoRecorte([proc(1, { grau: "G1" }), proc(2, { grau: "G2" })]);
    expect(c.texto).toContain("NÃO é jurisprudência");
    expect(c.texto).toContain("pode ser citada como jurisprudência");
    expect(c.fontes.map((f) => f.natureza)).toEqual(["estatistica", "jurisprudencia"]);
  });
});

describe("contemNumeroInventado", () => {
  it("pega percentual", () => {
    expect(contemNumeroInventado("62% dos casos são procedentes")).toBe("62%");
    expect(contemNumeroInventado("cerca de 30 por cento")).toBe("30 por cento");
  });

  it("pega contagem de processo", () => {
    expect(contemNumeroInventado("em 12 processos o pedido foi acolhido")).toBe("12 processos");
    expect(contemNumeroInventado("na maioria dos 40 casos")).toBe("40 casos");
    expect(contemNumeroInventado("18 sentenças julgaram procedente")).toBe("18 sentenças");
  });

  it("pega proporção escrita", () => {
    expect(contemNumeroInventado("procedente em 3 de 4 vezes")).toBeTruthy();
    expect(contemNumeroInventado("1 em cada 5 termina em acordo")).toBeTruthy();
  });

  // A trava tem que ser estreita: número que identifica processo, vara, ano ou
  // artigo de lei é exatamente o que a resposta PRECISA citar.
  it("deixa passar número que identifica em vez de medir", () => {
    expect(contemNumeroInventado("o processo 0800123-45.2023.8.06.0001 foi julgado")).toBeNull();
    expect(contemNumeroInventado("a 3ª Vara Cível decidiu assim")).toBeNull();
    expect(contemNumeroInventado("com base no art. 42 do CDC")).toBeNull();
    expect(contemNumeroInventado("ajuizado em 2023 e sentenciado em 2024")).toBeNull();
    expect(contemNumeroInventado("aplicou a Lei 8.078 de 1990")).toBeNull();
  });

  it("deixa passar descrição qualitativa, que é o que se pede ao modelo", () => {
    expect(contemNumeroInventado("a maioria termina improcedente")).toBeNull();
    expect(contemNumeroInventado("é raro haver acordo homologado")).toBeNull();
  });
});

describe("numeroInventadoNaResposta", () => {
  it("acha na afirmação", () => {
    const r = {
      afirmacoes: [{ texto: "limpo aqui" }, { texto: "e 71% ali" }],
      conclusao: null,
    };
    expect(numeroInventadoNaResposta(r)).toBe("71%");
  });

  it("acha na conclusão — o lugar preferido do modelo pra resumir", () => {
    const r = {
      afirmacoes: [{ texto: "a maioria é improcedente" }],
      conclusao: "vale a pena: 8 de 10 dão certo",
    };
    expect(numeroInventadoNaResposta(r)).toBeTruthy();
  });

  it("libera resposta qualitativa inteira", () => {
    const r = {
      afirmacoes: [{ texto: "o pedido costuma ser acolhido em parte" }],
      conclusao: "recomendo pedir também os honorários",
    };
    expect(numeroInventadoNaResposta(r)).toBeNull();
  });
});

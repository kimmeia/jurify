/**
 * Ingestão do DataJud.
 *
 * O teste que mais importa aqui é o do sigilo: processo em segredo de justiça
 * não pode entrar no acervo, e essa garantia não pode depender de alguém
 * lembrar de filtrar na hora certa.
 */

import { describe, it, expect } from "vitest";
import { cnjNormalizado, normalizarHit } from "../../shared/datajud-normalizar";
import { deduzirDesfecho } from "../../shared/datajud-desfecho";
import { ehErroDeOrdenacao, proximaPagina } from "../jurisia/datajud-client";
import { resumirAmostra } from "../../shared/datajud-amostra";

const hit = (over: Record<string, unknown> = {}) => ({
  _source: {
    numeroProcesso: "30578036820258060001",
    tribunal: "TJCE",
    grau: "G1",
    nivelSigilo: 0,
    dataAjuizamento: "2025-03-14T00:00:00.000Z",
    dataHoraUltimaAtualizacao: "2026-08-01T10:00:00.000Z",
    classe: { codigo: 1116, nome: "Procedimento Comum Cível" },
    assuntos: [{ codigo: 7771, nome: "Contratos Bancários" }],
    orgaoJulgador: { codigo: 4321, nome: "3ª Vara Cível de Fortaleza" },
    movimentos: [
      { codigo: 26, nome: "Distribuição", dataHora: "2025-03-14T09:00:00.000Z" },
    ],
    ...over,
  },
});

const okDe = (r: ReturnType<typeof normalizarHit>) => {
  if (!r.ok) throw new Error(`esperava ok, veio ${r.motivo}`);
  return r;
};

describe("normalizarHit — sigilo", () => {
  it("processo sigiloso não entra no acervo", () => {
    const r = normalizarHit(hit({ nivelSigilo: 1 }));
    expect(r).toEqual({ ok: false, motivo: "sigiloso" });
  });

  it("sem o campo de sigilo, fica de fora — na dúvida não entra", () => {
    // Tribunal que não preenche o campo não pode virar porta de entrada
    // pra autos restritos.
    const r = normalizarHit(hit({ nivelSigilo: undefined }));
    expect(r).toEqual({ ok: false, motivo: "sigiloso" });
  });

  it("sigilo 0 é o único que passa", () => {
    expect(okDe(normalizarHit(hit())).processo.cnj).toBe("30578036820258060001");
  });
});

describe("normalizarHit — campos", () => {
  it("guarda o CNJ só com dígitos, venha mascarado ou não", () => {
    const r = okDe(normalizarHit(hit({ numeroProcesso: "3057803-68.2025.8.06.0001" })));
    expect(r.processo.cnj).toBe("30578036820258060001");
  });

  it("CNJ com tamanho errado é recusado", () => {
    expect(normalizarHit(hit({ numeroProcesso: "123" })).ok).toBe(false);
  });

  it("tribunal vai em maiúscula pra não duplicar 'tjce' e 'TJCE'", () => {
    expect(okDe(normalizarHit(hit({ tribunal: "tjce" }))).processo.tribunal).toBe("TJCE");
  });

  it("campo ausente vira null em vez de quebrar — 90+ tribunais preenchem diferente", () => {
    const r = okDe(normalizarHit(hit({
      classe: undefined,
      assuntos: undefined,
      orgaoJulgador: undefined,
      dataAjuizamento: undefined,
      grau: undefined,
    })));
    expect(r.processo).toMatchObject({
      classeCodigo: null,
      assuntoNome: null,
      orgaoNome: null,
      ajuizamentoEm: null,
      grau: null,
    });
  });

  it("data inválida não vira Invalid Date no banco", () => {
    const r = okDe(normalizarHit(hit({ dataAjuizamento: "31/02/2025" })));
    expect(r.processo.ajuizamentoEm).toBeNull();
  });

  it("movimento sem nome ou sem data é descartado, não gera linha vazia", () => {
    const r = okDe(normalizarHit(hit({
      movimentos: [
        { codigo: 1, nome: "Válido", dataHora: "2025-04-01T00:00:00.000Z" },
        { codigo: 2, nome: "", dataHora: "2025-04-02T00:00:00.000Z" },
        { codigo: 3, nome: "Sem data" },
      ],
    })));
    expect(r.movimentos).toHaveLength(1);
  });

  it("movimentos saem em ordem cronológica", () => {
    const r = okDe(normalizarHit(hit({
      movimentos: [
        { codigo: 2, nome: "Depois", dataHora: "2025-06-01T00:00:00.000Z" },
        { codigo: 1, nome: "Antes", dataHora: "2025-01-01T00:00:00.000Z" },
      ],
    })));
    expect(r.movimentos.map((m) => m.nome)).toEqual(["Antes", "Depois"]);
  });

  it("aceita o _source direto, sem o envelope do hit", () => {
    expect(normalizarHit(hit()._source).ok).toBe(true);
  });
});

describe("cnjNormalizado", () => {
  it("aceita mascarado e cru, recusa o resto", () => {
    expect(cnjNormalizado("3057803-68.2025.8.06.0001")).toBe("30578036820258060001");
    expect(cnjNormalizado("30578036820258060001")).toBe("30578036820258060001");
    expect(cnjNormalizado("305780368202580600011")).toBeNull();
    expect(cnjNormalizado(null)).toBeNull();
  });
});

describe("deduzirDesfecho", () => {
  const mov = (nome: string, dataHora: string) => ({ nome, dataHora });

  it("'em parte' não é confundido com procedência total", () => {
    // A regra específica precisa ser testada antes da genérica — "procedência
    // em parte" contém "procedência".
    const d = deduzirDesfecho([mov("Procedência em Parte", "2026-03-01T00:00:00Z")]);
    expect(d?.resultado).toBe("parcial");
  });

  it("improcedência não vira procedência", () => {
    expect(deduzirDesfecho([mov("Improcedência", "2026-03-01T00:00:00Z")])?.resultado)
      .toBe("improcedente");
  });

  it("reconhece acordo homologado", () => {
    expect(deduzirDesfecho([mov("Homologação de Transação", "2026-03-01T00:00:00Z")])?.resultado)
      .toBe("acordo");
  });

  it("extinção sem mérito não conta como derrota no mérito", () => {
    const d = deduzirDesfecho([
      mov("Extinção do processo sem resolução do mérito", "2026-03-01T00:00:00Z"),
    ]);
    expect(d?.resultado).toBe("extinto_sem_merito");
  });

  it("vale o ÚLTIMO decisivo: sentença reformada em grau de recurso", () => {
    // É o desfecho final que responde "quanto costuma dar" — usar o primeiro
    // contaria como vitória um caso que terminou perdido.
    const d = deduzirDesfecho([
      mov("Procedência", "2026-01-10T00:00:00Z"),
      mov("Improcedência", "2026-07-20T00:00:00Z"),
    ]);
    expect(d?.resultado).toBe("improcedente");
    expect(d?.em).toBe("2026-07-20T00:00:00Z");
  });

  it("a ordem do array não manda — a data manda", () => {
    const d = deduzirDesfecho([
      mov("Improcedência", "2026-07-20T00:00:00Z"),
      mov("Procedência", "2026-01-10T00:00:00Z"),
    ]);
    expect(d?.resultado).toBe("improcedente");
  });

  it("processo sem movimento decisivo não inventa desfecho", () => {
    expect(deduzirDesfecho([mov("Conclusos para despacho", "2026-01-01T00:00:00Z")])).toBeNull();
    expect(deduzirDesfecho([])).toBeNull();
  });

  it("guarda o nome que gerou a classificação, pra conferir quando errar", () => {
    const d = deduzirDesfecho([mov("Procedência em Parte", "2026-03-01T00:00:00Z")]);
    expect(d?.movimento).toBe("Procedência em Parte");
  });

  it("classifica sem depender de acento", () => {
    expect(deduzirDesfecho([mov("PROCEDENCIA", "2026-03-01T00:00:00Z")])?.resultado)
      .toBe("procedente");
  });
});

describe("proximaPagina", () => {
  const hits = (n: number, comSort = true) =>
    Array.from({ length: n }, (_, i) => ({
      _source: {},
      ...(comSort ? { sort: [1700000000000 + i, `id-${i}`] } : {}),
    }));

  it("página cheia devolve o cursor do último hit", () => {
    const p = proximaPagina({ hits: { hits: hits(100) } }, 100);
    expect(p.hits).toHaveLength(100);
    expect(JSON.parse(p.proximoCursor!)).toEqual([1700000000099, "id-99"]);
  });

  it("página incompleta encerra o tribunal", () => {
    // Pedir a próxima só gastaria requisição pra receber vazio.
    expect(proximaPagina({ hits: { hits: hits(37) } }, 100).proximoCursor).toBeNull();
  });

  it("página vazia encerra", () => {
    expect(proximaPagina({ hits: { hits: [] } }, 100).proximoCursor).toBeNull();
  });

  it("hit sem 'sort' encerra em vez de reler a primeira página pra sempre", () => {
    // Sem cursor, o próximo pedido volta ao início — loop infinito silencioso.
    const p = proximaPagina({ hits: { hits: hits(100, false) } }, 100);
    expect(p.proximoCursor).toBeNull();
  });

  it("lê o total nos dois formatos que o ES usa", () => {
    expect(proximaPagina({ hits: { hits: [], total: 4200 } }, 100).total).toBe(4200);
    expect(proximaPagina({ hits: { hits: [], total: { value: 4200 } } }, 100).total).toBe(4200);
    expect(proximaPagina({ hits: { hits: [] } }, 100).total).toBeNull();
  });

  // O ES para de contar em 10.000 e sinaliza com relation "gte". Sem ler esse
  // campo, um tribunal de milhões aparece como "10.000" e a varredura parece
  // quase pronta quando mal começou.
  it("distingue contagem exata de contagem capada pelo Elasticsearch", () => {
    const capado = proximaPagina(
      { hits: { hits: [], total: { value: 10000, relation: "gte" } } },
      100,
    );
    expect(capado.total).toBe(10000);
    expect(capado.totalEhMinimo).toBe(true);

    const exato = proximaPagina(
      { hits: { hits: [], total: { value: 842, relation: "eq" } } },
      100,
    );
    expect(exato.totalEhMinimo).toBe(false);

    // Formato antigo (total numérico puro) nunca é capado.
    expect(proximaPagina({ hits: { hits: [], total: 4200 } }, 100).totalEhMinimo).toBe(false);
    expect(proximaPagina({ hits: { hits: [] } }, 100).totalEhMinimo).toBe(false);
  });

  it("resposta fora do formato não quebra a varredura", () => {
    expect(proximaPagina(null, 100)).toEqual({
      hits: [],
      proximoCursor: null,
      total: null,
      totalEhMinimo: false,
    });
    expect(proximaPagina({ erro: "x" }, 100).hits).toEqual([]);
  });
});

describe("ehErroDeOrdenacao", () => {
  // O erro real que derrubou a primeira varredura em produção.
  const FIELDDATA =
    '{"error":{"root_cause":[{"type":"illegal_argument_exception","reason":"Fielddata access on the _id field is disallowed, you can re-enable it by updating the dynamic cluster setting: indices.id_field_data.enabled"}]},"status":400}';

  it("reconhece a recusa de fielddata no _id", () => {
    expect(ehErroDeOrdenacao(400, FIELDDATA)).toBe(true);
  });

  it("reconhece campo sem mapeamento pra ordenar", () => {
    expect(
      ehErroDeOrdenacao(400, '{"error":"No mapping found for [numeroProcesso] in order to sort on"}'),
    ).toBe(true);
  });

  // Trocar o sort não conserta chave inválida nem rate limit — repetir só
  // gastaria requisição no tribunal, que foi o que derrubou o motor antes.
  it("não tenta de novo em erro que a ordenação não resolve", () => {
    expect(ehErroDeOrdenacao(401, "unauthorized")).toBe(false);
    expect(ehErroDeOrdenacao(403, "forbidden")).toBe(false);
    expect(ehErroDeOrdenacao(429, "too many requests")).toBe(false);
    expect(ehErroDeOrdenacao(500, "internal")).toBe(false);
    expect(ehErroDeOrdenacao(404, "index_not_found_exception")).toBe(false);
  });

  it("400 que não é de ordenação também não repete", () => {
    expect(ehErroDeOrdenacao(400, '{"error":"parsing_exception: unknown query [foo]"}')).toBe(false);
  });
});

describe("resumirAmostra", () => {
  const proc = (over: Record<string, unknown> = {}) => ({
    _source: {
      numeroProcesso: `3057803682025806${String(Math.random()).slice(2, 6)}`,
      tribunal: "TJCE",
      nivelSigilo: 0,
      classe: { codigo: 1116, nome: "Procedimento Comum Cível" },
      assuntos: [{ codigo: 7771, nome: "Contratos Bancários" }],
      orgaoJulgador: { codigo: 1, nome: "3ª Vara Cível" },
      movimentos: [{ codigo: 26, nome: "Distribuição", dataHora: "2025-01-01T00:00:00Z" }],
      ...over,
    },
  });

  const comMovs = (nomes: string[]) =>
    proc({
      movimentos: nomes.map((nome, i) => ({
        codigo: i,
        nome,
        dataHora: `2025-0${i + 1}-01T00:00:00Z`,
      })),
    });

  it("separa aceitos, sigilosos e inválidos", () => {
    const r = resumirAmostra([
      proc(),
      proc({ nivelSigilo: 2 }),
      proc({ numeroProcesso: "123" }),
    ]);
    expect(r).toMatchObject({ lidos: 3, aceitos: 1, sigilosos: 1, invalidos: 1 });
  });

  it("conta por resultado", () => {
    const r = resumirAmostra([
      comMovs(["Distribuição", "Procedência"]),
      comMovs(["Distribuição", "Improcedência"]),
      comMovs(["Distribuição", "Procedência em Parte"]),
    ]);
    expect(r.porResultado).toMatchObject({ procedente: 1, improcedente: 1, parcial: 1 });
    expect(r.semResultado).toBe(0);
  });

  it("junta os nomes que NÃO classificaram — é o insumo pra calibrar", () => {
    // Se a sentença do tribunal se chama algo que as regras não cobrem, o
    // nome precisa aparecer aqui pra a gente corrigir olhando dado real.
    const r = resumirAmostra([
      comMovs(["Distribuição", "Julgamento com resolução do mérito"]),
      comMovs(["Distribuição", "Julgamento com resolução do mérito"]),
      comMovs(["Distribuição", "Conclusos para sentença"]),
    ]);
    expect(r.semResultado).toBe(3);
    expect(r.naoClassificados[0]).toEqual({ nome: "Julgamento com resolução do mérito", vezes: 2 });
  });

  it("olha só o ÚLTIMO movimento — 'juntada de petição' afogaria o sinal", () => {
    const r = resumirAmostra([
      comMovs(["Juntada de petição", "Juntada de petição", "Ato ordinatório praticado"]),
    ]);
    expect(r.naoClassificados).toEqual([{ nome: "Ato ordinatório praticado", vezes: 1 }]);
  });

  it("processo classificado não entra nos não-classificados", () => {
    const r = resumirAmostra([comMovs(["Distribuição", "Procedência"])]);
    expect(r.naoClassificados).toEqual([]);
  });

  it("traz exemplos com o movimento que decidiu, pra conferir a olho", () => {
    const r = resumirAmostra([comMovs(["Distribuição", "Procedência em Parte"])]);
    expect(r.exemplos[0]).toMatchObject({
      classe: "Procedimento Comum Cível",
      resultado: "parcial",
      movimentoDecisivo: "Procedência em Parte",
      movimentos: 2,
    });
  });

  it("limita os exemplos pra a resposta não virar dump", () => {
    const r = resumirAmostra(Array.from({ length: 50 }, () => proc()), 3);
    expect(r.exemplos).toHaveLength(3);
    expect(r.aceitos).toBe(50);
  });

  it("página vazia devolve zeros em vez de quebrar", () => {
    const r = resumirAmostra([]);
    expect(r).toMatchObject({ lidos: 0, aceitos: 0, semResultado: 0 });
    expect(r.naoClassificados).toEqual([]);
  });
});

/**
 * O fallback de ordenação do DataJud.
 *
 * Existe porque a primeira varredura em produção morreu com 400: o desempate
 * por `_id` — que é o certo em teoria pra `search_after` — é proibido pelo
 * Elasticsearch. Como o mapeamento varia entre os 90+ índices e não dá pra
 * provar contra a API real de dentro do teste, o que se prova aqui é o
 * comportamento: degrada quando é erro de ordenação, desiste quando não é.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buscarPagina,
  esquecerOrdenacaoDataJud,
  lerCursor,
  ordenacaoDoCursorLegado,
} from "../jurisia/datajud-client";

const FIELDDATA =
  '{"error":{"root_cause":[{"type":"illegal_argument_exception","reason":"Fielddata access on the _id field is disallowed"}]},"status":400}';

const ok = (hits: unknown[]) =>
  new Response(JSON.stringify({ hits: { hits, total: { value: hits.length } } }), { status: 200 });

const falha = (status: number, corpo: string) => new Response(corpo, { status });

const hit = (i: number) => ({ _source: { numeroProcesso: String(i) }, sort: [i, String(i)] });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  esquecerOrdenacaoDataJud();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  esquecerOrdenacaoDataJud();
});

const corpoDe = (chamada: number) => JSON.parse(fetchMock.mock.calls[chamada][1].body as string);

describe("buscarPagina — fallback de ordenação", () => {
  it("cai pra próxima ordenação quando o índice recusa a primeira", async () => {
    fetchMock.mockResolvedValueOnce(falha(400, FIELDDATA)).mockResolvedValueOnce(ok([hit(1)]));

    const p = await buscarPagina({ alias: "tjce", cursor: null, tamanho: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(p.hits).toHaveLength(1);
    expect(corpoDe(0).sort).toHaveLength(2);
    expect(corpoDe(1).sort).toHaveLength(1);
  });

  // Pagar duas requisições por página no tribunal inteiro é justamente o
  // excesso de tráfego que já derrubou o motor antes.
  it("lembra a ordenação que funcionou e não tenta a recusada de novo", async () => {
    fetchMock.mockResolvedValueOnce(falha(400, FIELDDATA)).mockResolvedValueOnce(ok([hit(1)]));
    await buscarPagina({ alias: "tjce", cursor: null, tamanho: 1 });

    fetchMock.mockResolvedValueOnce(ok([hit(2)]));
    await buscarPagina({ alias: "tjce", cursor: null, tamanho: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(corpoDe(2).sort).toEqual(corpoDe(1).sort);
  });

  it("desiste na hora em erro que trocar de ordenação não resolve", async () => {
    fetchMock.mockResolvedValueOnce(falha(401, "unauthorized"));

    await expect(buscarPagina({ alias: "tjce", cursor: null, tamanho: 1 })).rejects.toThrow(
      /DataJud 401/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("erra explícito quando esgota todas as ordenações", async () => {
    // Fábrica, não instância: o body de um Response só pode ser lido uma vez.
    fetchMock.mockImplementation(() => Promise.resolve(falha(400, FIELDDATA)));

    await expect(buscarPagina({ alias: "tjce", cursor: null, tamanho: 1 })).rejects.toThrow(
      /Nenhuma ordenação aceita/,
    );
  });

  it("manda o search_after quando tem cursor", async () => {
    fetchMock.mockResolvedValueOnce(ok([hit(1)]));

    await buscarPagina({ alias: "tjce", cursor: '[123,"abc"]', tamanho: 1 });

    expect(corpoDe(0).search_after).toEqual([123, "abc"]);
  });

  it("cursor corrompido pede reinício em vez de virar busca sem filtro", async () => {
    await expect(buscarPagina({ alias: "tjce", cursor: "{nao é json", tamanho: 1 })).rejects.toThrow(
      /Cursor da varredura corrompido/,
    );
    await expect(buscarPagina({ alias: "tjce", cursor: '{"a":1}', tamanho: 1 })).rejects.toThrow(
      /Cursor da varredura corrompido/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("o cursor devolvido carrega a ordenação que o produziu", async () => {
    fetchMock.mockResolvedValueOnce(falha(400, FIELDDATA)).mockResolvedValueOnce(ok([hit(1)]));

    const p = await buscarPagina({ alias: "tjce", cursor: null, tamanho: 1 });

    expect(JSON.parse(p.proximoCursor!)).toEqual({ o: "@timestamp", v: [1, "1"] });
  });

  /**
   * O travamento da fila do STJ em produção.
   *
   * O índice recusou a ordenação com `numeroProcesso`, a varredura caiu pra
   * `@timestamp` e gravou um cursor de UM elemento. Veio um redeploy, a
   * variável de processo que lembrava a ordenação zerou, e o ciclo seguinte
   * comparou o cursor de 1 elemento com a spec de 2 da primeira ordenação da
   * lista: erro a cada ciclo, "0 de 5.000" pra sempre.
   */
  it("retoma um cursor legado sem depender de memória de processo", async () => {
    // Processo recém-subido: nada em cache, como depois de um deploy.
    fetchMock.mockResolvedValueOnce(ok([hit(9)]));

    const p = await buscarPagina({ alias: "stj", cursor: "[1730000000000]", tamanho: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Foi direto pra ordenação de 1 elemento — a que produziu o cursor.
    expect(corpoDe(0).sort).toHaveLength(1);
    expect(corpoDe(0).search_after).toEqual([1730000000000]);
    expect(p.hits).toHaveLength(1);
  });

  it("cursor legado por numeroProcesso vai pra ordenação de texto", async () => {
    fetchMock.mockResolvedValueOnce(ok([hit(9)]));

    await buscarPagina({ alias: "stj", cursor: '["30578036820258060001"]', tamanho: 1 });

    expect(corpoDe(0).sort).toEqual([{ numeroProcesso: { order: "asc" } }]);
  });

  // Trocar de eixo no meio da varredura percorreria o resto do tribunal por
  // outro critério, e os processos entre os dois pontos sumiriam sem erro.
  it("não degrada de ordenação quando já está seguindo um cursor", async () => {
    fetchMock.mockResolvedValue(falha(400, FIELDDATA));

    await expect(
      buscarPagina({ alias: "stj", cursor: '{"o":"@timestamp","v":[1730000000000]}', tamanho: 1 }),
    ).rejects.toThrow(/recusou a ordenação/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("cursor de ordenação desconhecida recomeça o tribunal em vez de travar a fila", async () => {
    fetchMock.mockResolvedValueOnce(ok([hit(1)]));

    const p = await buscarPagina({
      alias: "stj",
      cursor: '{"o":"campo_que_nao_existe","v":[1]}',
      tamanho: 1,
    });

    expect(corpoDe(0).search_after).toBeUndefined();
    expect(p.hits).toHaveLength(1);
  });

  // Um cache só pra todos fazia o índice do TJCE decidir por qual ordenação o
  // STJ começava.
  it("a ordenação aprendida num tribunal não contamina outro", async () => {
    fetchMock.mockResolvedValueOnce(falha(400, FIELDDATA)).mockResolvedValueOnce(ok([hit(1)]));
    await buscarPagina({ alias: "tjce", cursor: null, tamanho: 1 });

    fetchMock.mockResolvedValueOnce(ok([hit(2)]));
    await buscarPagina({ alias: "stj", cursor: null, tamanho: 1 });

    expect(corpoDe(2).sort).toHaveLength(2);
  });
});

describe("ordenacaoDoCursorLegado", () => {
  it("epoch é @timestamp, string é numeroProcesso", () => {
    expect(ordenacaoDoCursorLegado([1730000000000])).toBe("@timestamp");
    expect(ordenacaoDoCursorLegado(["3057803"])).toBe("numeroProcesso");
    expect(ordenacaoDoCursorLegado([1730000000000, "3057803"])).toBe("@timestamp+numeroProcesso");
  });

  it("formato que não casa nenhuma ordenação devolve null", () => {
    expect(ordenacaoDoCursorLegado(["a", 1])).toBeNull();
    expect(ordenacaoDoCursorLegado([null])).toBeNull();
    expect(ordenacaoDoCursorLegado([1, 2, 3])).toBeNull();
  });
});

describe("lerCursor", () => {
  it("aceita o formato novo e devolve a ordenação gravada", () => {
    expect(lerCursor('{"o":"@timestamp","v":[10]}')).toEqual({
      ordenacao: "@timestamp",
      valores: [10],
    });
  });

  it("ordenação desconhecida vira null — recomeçar é melhor que travar", () => {
    expect(lerCursor('{"o":"inventada","v":[10]}')).toBeNull();
  });

  it("array vazio é corrupção, não cursor legado", () => {
    expect(() => lerCursor("[]")).toThrow(/corrompido/);
  });
});

describe("buscarPagina — chave", () => {
  it("usa a chave pública do CNJ quando não há nada cadastrado", async () => {
    fetchMock.mockResolvedValueOnce(ok([hit(1)]));
    await buscarPagina({ alias: "tjce", cursor: null, tamanho: 1 });

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^APIKey .+/);
  });
});

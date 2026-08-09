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
import { buscarPagina, esquecerOrdenacaoDataJud } from "../jurisia/datajud-client";

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

  // Seguir com um cursor de outro formato pularia metade do tribunal sem dar
  // erro nenhum — o pior tipo de falha nesta base.
  it("recusa cursor gravado sob outra ordenação em vez de pular processos", async () => {
    fetchMock.mockResolvedValueOnce(falha(400, FIELDDATA)).mockResolvedValueOnce(ok([hit(1)]));
    await buscarPagina({ alias: "tjce", cursor: null, tamanho: 1 });

    await expect(
      buscarPagina({ alias: "tjce", cursor: '[123,"abc"]', tamanho: 1 }),
    ).rejects.toThrow(/reinicie o tribunal/);
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

  it("usa a chave pública do CNJ quando não há nada cadastrado", async () => {
    fetchMock.mockResolvedValueOnce(ok([hit(1)]));
    await buscarPagina({ alias: "tjce", cursor: null, tamanho: 1 });

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^APIKey .+/);
  });
});

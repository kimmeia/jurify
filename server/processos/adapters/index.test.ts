/**
 * Despachante do motor próprio: quem é chamado, e com que config.
 *
 * O runner da aba Consultar chamava `consultarTjce` SEM config pra qualquer
 * tribunal (caía sempre no TJCE) e recusava tudo que não fosse "tjce"; o
 * cron sabia só do TRF5. Estas amarras travam que:
 *  - tribunal do registro + sessão → `consultarTjce` com a config DELE;
 *  - tribunal de consulta pública → o adapter aberto dele, sem sessão;
 *  - a lista compartilhada e o mapa de adapters públicos são o MESMO conjunto;
 *  - fora dos dois, a mensagem é a do router (`mensagemTribunalSemMotor`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const consultarTjce = vi.fn(async () => ({ ok: true, tribunal: "registro" }));
const consultarTjcePorCpf = vi.fn(async () => ({ ok: true, cnjs: ["x"] }));
vi.mock("./pje-tjce", () => ({ consultarTjce, consultarTjcePorCpf }));

const consultarTrf5 = vi.fn(async (cnj: string) => ({ ok: true, tribunal: "trf5", cnj }));
vi.mock("./pje-trf5", () => ({ consultarTrf5 }));

const consultarTrt2 = vi.fn(async (cnj: string) => ({ ok: true, tribunal: "trt2", cnj }));
const consultarTrt15 = vi.fn(async (cnj: string) => ({ ok: true, tribunal: "trt15", cnj }));
vi.mock("./pje-trt", () => ({ consultarTrt2, consultarTrt15 }));

const { ADAPTERS_PUBLICOS, consultarPorDocumento, consultarProcesso, temAdapterPublico } = await import("./index");
const { TRIBUNAIS_CONSULTA_PUBLICA, getConfigTribunal } = await import("../tribunais-pdpj");
const { TRIBUNAIS_CONSULTA_PUBLICA_PJE, mensagemTribunalSemMotor } = await import("../../../shared/tribunais-pje");

const CNJ = "0001234-12.2024.8.13.0001";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("tribunal do registro (PDPJ, com credencial)", () => {
  it("chama consultarTjce com a config DO tribunal, não a do TJCE", async () => {
    await consultarProcesso("tjmg", CNJ, "sessao-json", { teorMaximo: 3 });
    const cfgMg = getConfigTribunal("tjmg");
    expect(cfgMg?.tribunal).toBe("tjmg");
    expect(cfgMg?.urlBusca).toContain("tjmg");
    expect(cfgMg).not.toEqual(getConfigTribunal("tjce"));
    expect(consultarTjce).toHaveBeenCalledTimes(1);
    expect(consultarTjce).toHaveBeenCalledWith(CNJ, "sessao-json", cfgMg, { teorMaximo: 3 });
    expect(consultarTrf5).not.toHaveBeenCalled();
  });

  it("sede continua sendo a config do TJCE", async () => {
    await consultarProcesso("tjce", CNJ, "s");
    expect(consultarTjce).toHaveBeenCalledWith(CNJ, "s", getConfigTribunal("tjce"), {});
  });

  it("grau 2 escolhe a config do 2º grau e não vaza `grau` pras opções do scraper", async () => {
    await consultarProcesso("tjrj", CNJ, "s", { grau: 2, teorMaximo: 0 });
    expect(consultarTjce).toHaveBeenCalledWith(CNJ, "s", getConfigTribunal("tjrj", 2), { teorMaximo: 0 });
  });

  it("sem sessão é erro próprio (a credencial faltou, o motor existe) e nada é chamado", async () => {
    await expect(consultarProcesso("tjmg", CNJ, null)).rejects.toThrow(/TJMG exige credencial no Cofre/);
    expect(consultarTjce).not.toHaveBeenCalled();
    expect(consultarTrf5).not.toHaveBeenCalled();
  });
});

describe("tribunal de consulta pública (sem credencial)", () => {
  it.each([
    ["trf5", consultarTrf5],
    ["trt2", consultarTrt2],
    ["trt15", consultarTrt15],
  ])("%s → adapter aberto dele, sem passar pelo PDPJ", async (codigo, adapter) => {
    const r = await consultarProcesso(codigo, CNJ, null);
    expect(r.tribunal).toBe(codigo);
    expect(adapter).toHaveBeenCalledWith(CNJ);
    expect(consultarTjce).not.toHaveBeenCalled();
    for (const outro of [consultarTrf5, consultarTrt2, consultarTrt15]) {
      if (outro !== adapter) expect(outro).not.toHaveBeenCalled();
    }
  });

  it("sessão informada não muda nada: o caminho aberto vence o do registro (candidato não comprovado)", async () => {
    await consultarProcesso("trt2", CNJ, "sessao-de-outro-lugar");
    expect(consultarTrt2).toHaveBeenCalledWith(CNJ);
    expect(consultarTjce).not.toHaveBeenCalled();
  });

  it("o mapa de adapters e a lista compartilhada são o MESMO conjunto, nos dois sentidos", () => {
    const doMapa = Object.keys(ADAPTERS_PUBLICOS).sort();
    const daLista = TRIBUNAIS_CONSULTA_PUBLICA_PJE.map((t) => t.codigo).sort();
    expect(doMapa).toEqual(daLista);
    expect(new Set(doMapa)).toEqual(TRIBUNAIS_CONSULTA_PUBLICA);
    expect(doMapa).toEqual(expect.arrayContaining(["trf5", "trt2", "trt15"]));
    for (const codigo of daLista) expect(temAdapterPublico(codigo)).toBe(true);
  });

  it("temAdapterPublico não confunde herança de objeto com adapter", () => {
    expect(temAdapterPublico("toString")).toBe(false);
    expect(temAdapterPublico("tjce")).toBe(false);
  });
});

describe("fora da cobertura", () => {
  it("lança a MESMA mensagem que o router dá, sem chamar adapter nenhum", async () => {
    await expect(consultarProcesso("tjsp", CNJ, "s")).rejects.toThrow(mensagemTribunalSemMotor("TJSP"));
    await expect(consultarProcesso("tjsp", CNJ, null)).rejects.toThrow(mensagemTribunalSemMotor("TJSP"));
    // TRT7 está no registro (candidato, com credencial): sem sessão é falta de credencial, não falta de motor.
    await expect(consultarProcesso("trt7", CNJ, null)).rejects.toThrow(/TRT7 exige credencial no Cofre/);
    expect(consultarTjce).not.toHaveBeenCalled();
    expect(consultarTrf5).not.toHaveBeenCalled();
    expect(consultarTrt2).not.toHaveBeenCalled();
  });
});

describe("busca por CPF/CNPJ", () => {
  it("qualquer tribunal do registro, com a config dele", async () => {
    const r = await consultarPorDocumento("tjmg", "cpf", "12345678901", "sessao");
    expect(r.ok).toBe(true);
    expect(consultarTjcePorCpf).toHaveBeenCalledWith("12345678901", "sessao", getConfigTribunal("tjmg"));
    expect(getConfigTribunal("tjmg")).not.toEqual(getConfigTribunal("tjce"));
  });

  it("sede: config do TJCE", async () => {
    await consultarPorDocumento("tjce", "cnpj", "12345678000190", "sessao");
    expect(consultarTjcePorCpf).toHaveBeenCalledWith("12345678000190", "sessao", getConfigTribunal("tjce"));
  });

  it("tribunal de consulta pública não tem busca por parte: erro claro, nada chamado", async () => {
    await expect(consultarPorDocumento("trt2", "cpf", "12345678901", "s")).rejects.toThrow(
      /Busca por CPF não disponível no TRT2/,
    );
    expect(consultarTjcePorCpf).not.toHaveBeenCalled();
  });
});

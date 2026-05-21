import { describe, expect, it } from "vitest";
import {
  parseAgenteVariaveis,
  serializarAgenteVariaveis,
  temAtributosDuplicados,
} from "../../shared/agente-variaveis-types";

describe("parseAgenteVariaveis — retrocompatibilidade", () => {
  it("retorna [] pra entrada vazia/inválida", () => {
    expect(parseAgenteVariaveis(null)).toEqual([]);
    expect(parseAgenteVariaveis(undefined)).toEqual([]);
    expect(parseAgenteVariaveis("")).toEqual([]);
    expect(parseAgenteVariaveis("não é json")).toEqual([]);
    expect(parseAgenteVariaveis("{}")).toEqual([]);
  });

  it("converte formato legado (array de strings) pra estrutura nova", () => {
    const raw = JSON.stringify(["valor_financiamento", "cpf_principal"]);
    expect(parseAgenteVariaveis(raw)).toEqual([
      { atributo: "valor_financiamento", descricao: "", campoChave: "valor_financiamento" },
      { atributo: "cpf_principal", descricao: "", campoChave: "cpf_principal" },
    ]);
  });

  it("aceita formato novo (objetos com atributo/descricao/campoChave)", () => {
    const raw = JSON.stringify([
      {
        atributo: "data_consulta",
        descricao: "Data que o cliente prefere. Aceitar 'amanhã'.",
        campoChave: "data_agendamento",
      },
    ]);
    expect(parseAgenteVariaveis(raw)).toEqual([
      {
        atributo: "data_consulta",
        descricao: "Data que o cliente prefere. Aceitar 'amanhã'.",
        campoChave: "data_agendamento",
      },
    ]);
  });

  it("descarta objetos sem campoChave", () => {
    const raw = JSON.stringify([{ atributo: "x", descricao: "y" }]);
    expect(parseAgenteVariaveis(raw)).toEqual([]);
  });

  it("usa campoChave como atributo quando atributo está vazio", () => {
    const raw = JSON.stringify([{ atributo: "", campoChave: "valor_x" }]);
    expect(parseAgenteVariaveis(raw)).toEqual([
      { atributo: "valor_x", descricao: "", campoChave: "valor_x" },
    ]);
  });

  it("ignora itens sem string em campos esperados", () => {
    const raw = JSON.stringify([
      { atributo: 42, campoChave: "ok" },
      { atributo: "valid", campoChave: "valid", descricao: 99 },
    ]);
    const parsed = parseAgenteVariaveis(raw);
    expect(parsed).toEqual([
      { atributo: "ok", descricao: "", campoChave: "ok" },
      { atributo: "valid", descricao: "", campoChave: "valid" },
    ]);
  });

  it("aceita mistura de formatos (legado + novo)", () => {
    const raw = JSON.stringify([
      "campo_a",
      { atributo: "b", campoChave: "campo_b", descricao: "desc" },
    ]);
    expect(parseAgenteVariaveis(raw)).toEqual([
      { atributo: "campo_a", descricao: "", campoChave: "campo_a" },
      { atributo: "b", descricao: "desc", campoChave: "campo_b" },
    ]);
  });
});

describe("serializarAgenteVariaveis", () => {
  it("retorna null pra lista vazia", () => {
    expect(serializarAgenteVariaveis([])).toBeNull();
    expect(serializarAgenteVariaveis(null)).toBeNull();
    expect(serializarAgenteVariaveis(undefined)).toBeNull();
  });

  it("serializa lista válida normalizando whitespace", () => {
    const out = serializarAgenteVariaveis([
      { atributo: "  data_consulta  ", descricao: " hint ", campoChave: " data_x " },
    ]);
    expect(out).toBe(
      JSON.stringify([{ atributo: "data_consulta", descricao: "hint", campoChave: "data_x" }]),
    );
  });

  it("descarta itens sem campoChave ou atributo", () => {
    const out = serializarAgenteVariaveis([
      { atributo: "ok", descricao: "", campoChave: "ok" },
      { atributo: "", descricao: "x", campoChave: "y" },
      { atributo: "z", descricao: "", campoChave: "" },
    ]);
    expect(out).toBe(JSON.stringify([{ atributo: "ok", descricao: "", campoChave: "ok" }]));
  });

  it("round-trip preserva dados", () => {
    const vars = [
      { atributo: "data_consulta", descricao: "Aceitar 'amanhã'", campoChave: "data_agendamento" },
      { atributo: "valor", descricao: "", campoChave: "valor_causa" },
    ];
    const serialized = serializarAgenteVariaveis(vars);
    expect(parseAgenteVariaveis(serialized)).toEqual(vars);
  });
});

describe("temAtributosDuplicados", () => {
  it("retorna false quando todos os atributos são únicos", () => {
    expect(
      temAtributosDuplicados([
        { atributo: "a", descricao: "", campoChave: "x" },
        { atributo: "b", descricao: "", campoChave: "y" },
      ]),
    ).toBe(false);
  });

  it("detecta duplicados case-insensitive", () => {
    expect(
      temAtributosDuplicados([
        { atributo: "data", descricao: "", campoChave: "a" },
        { atributo: "DATA", descricao: "", campoChave: "b" },
      ]),
    ).toBe(true);
  });
});

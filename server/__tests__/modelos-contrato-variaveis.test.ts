/**
 * Testes do catálogo + resolvedor de variáveis usado em modelos de
 * contrato. Pure functions, sem mock de DB.
 */

import { describe, it, expect } from "vitest";
import {
  CATALOGO_BASE,
  detectarPlaceholdersNumerados,
  resolverVariavel,
  type ContextoContrato,
} from "../../shared/modelos-contrato-variaveis";

describe("detectarPlaceholdersNumerados", () => {
  it("detecta números únicos em ordem", () => {
    expect(
      detectarPlaceholdersNumerados("Olá {{1}}, {{3}} reais para {{1}} amanhã"),
    ).toEqual([1, 3]);
  });

  it("retorna vazio quando não há placeholders", () => {
    expect(detectarPlaceholdersNumerados("Texto sem placeholder")).toEqual([]);
  });

  it("ignora placeholders não-numéricos", () => {
    expect(detectarPlaceholdersNumerados("{{nome}} e {{1}}")).toEqual([1]);
  });

  it("aceita espaços dentro das chaves", () => {
    expect(detectarPlaceholdersNumerados("{{ 5 }} e {{ 2 }}")).toEqual([2, 5]);
  });

  it("ignora zero (placeholders começam em 1)", () => {
    expect(detectarPlaceholdersNumerados("{{0}} e {{1}}")).toEqual([1]);
  });
});

describe("resolverVariavel — cliente", () => {
  const ctx: ContextoContrato = {
    cliente: {
      nome: "Maria da Silva",
      cpfCnpj: "123.456.789-00",
      profissao: "Engenheira civil",
      estadoCivil: "casado",
      nacionalidade: "Brasileira",
      cep: "60000-000",
      logradouro: "Av. Beira Mar",
      numeroEndereco: "1234",
      complemento: "Apto 502",
      bairro: "Meireles",
      cidade: "Fortaleza",
      uf: "CE",
      campos: { numeroOab: "12345-CE", contratoIdExterno: 999 },
    },
  };

  it("resolve campos top-level", () => {
    expect(resolverVariavel("cliente.nome", ctx)).toBe("Maria da Silva");
    expect(resolverVariavel("cliente.cpfCnpj", ctx)).toBe("123.456.789-00");
    expect(resolverVariavel("cliente.profissao", ctx)).toBe("Engenheira civil");
  });

  it("formata estado civil pra label completo", () => {
    expect(resolverVariavel("cliente.estadoCivil", ctx)).toBe("Casado(a)");
  });

  it("resolve campos de endereço", () => {
    expect(resolverVariavel("cliente.endereco.cidade", ctx)).toBe("Fortaleza");
    expect(resolverVariavel("cliente.endereco.uf", ctx)).toBe("CE");
    expect(resolverVariavel("cliente.endereco.numero", ctx)).toBe("1234");
  });

  it("monta endereço completo formatado", () => {
    const completo = resolverVariavel("cliente.endereco.completo", ctx);
    expect(completo).toContain("Av. Beira Mar, 1234");
    expect(completo).toContain("Apto 502");
    expect(completo).toContain("Meireles");
    expect(completo).toContain("Fortaleza/CE");
    expect(completo).toContain("CEP 60000-000");
  });

  it("resolve campos personalizados", () => {
    expect(resolverVariavel("cliente.campos.numeroOab", ctx)).toBe("12345-CE");
    expect(resolverVariavel("cliente.campos.contratoIdExterno", ctx)).toBe("999");
  });

  it("retorna vazio quando campo personalizado não existe", () => {
    expect(resolverVariavel("cliente.campos.naoExiste", ctx)).toBe("");
  });

  it("retorna vazio em paths desconhecidos", () => {
    expect(resolverVariavel("cliente.foobar", ctx)).toBe("");
  });

  it("retorna vazio quando cliente é null", () => {
    expect(resolverVariavel("cliente.nome", { cliente: null })).toBe("");
  });
});

describe("resolverVariavel — endereço incompleto", () => {
  it("monta endereço pulando partes vazias", () => {
    const ctx: ContextoContrato = {
      cliente: {
        cidade: "São Paulo",
        uf: "SP",
        // sem logradouro, número, etc.
      },
    };
    const completo = resolverVariavel("cliente.endereco.completo", ctx);
    expect(completo).toBe("São Paulo/SP");
  });

  it("retorna vazio quando endereço inteiro está vazio", () => {
    expect(resolverVariavel("cliente.endereco.completo", { cliente: {} })).toBe("");
  });
});

describe("resolverVariavel — escritório e data", () => {
  const ctx: ContextoContrato = {
    escritorio: {
      nome: "Silva & Associados",
      cnpj: "00.000.000/0001-00",
      email: "contato@silva.adv.br",
    },
    hoje: new Date(2026, 3, 30), // 30 abril 2026 (mês 3 = abril)
  };

  it("resolve dados do escritório", () => {
    expect(resolverVariavel("escritorio.nome", ctx)).toBe("Silva & Associados");
    expect(resolverVariavel("escritorio.cnpj", ctx)).toBe("00.000.000/0001-00");
  });

  it("formata data por extenso", () => {
    expect(resolverVariavel("data.hoje", ctx)).toBe("30 de abril de 2026");
  });

  it("formata data ISO", () => {
    expect(resolverVariavel("data.hojeISO", ctx)).toBe("2026-04-30");
  });

  it("formata data BR", () => {
    expect(resolverVariavel("data.hojeBR", ctx)).toBe("30/04/2026");
  });
});

describe("CATALOGO_BASE", () => {
  it("inclui todas as variáveis principais", () => {
    const paths = CATALOGO_BASE.map((v) => v.path);
    expect(paths).toContain("cliente.nome");
    expect(paths).toContain("cliente.profissao");
    expect(paths).toContain("cliente.endereco.cidade");
    expect(paths).toContain("cliente.endereco.completo");
    expect(paths).toContain("escritorio.cnpj");
    expect(paths).toContain("data.hoje");
  });

  it("não tem paths duplicados", () => {
    const paths = CATALOGO_BASE.map((v) => v.path);
    const unicos = new Set(paths);
    expect(unicos.size).toBe(paths.length);
  });
});

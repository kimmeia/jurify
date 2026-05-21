import { describe, it, expect } from "vitest";
import {
  montarContextoCliente,
  ehChaveSensivel,
  formatarValorParaPrompt,
  type DefinicaoCampo,
} from "./contexto-cliente-ia";

describe("ehChaveSensivel — blacklist hardcoded", () => {
  it.each([
    "cpf", "CPF", "cpfPrincipal", "cliente_cpf",
    "cnpj", "rg", "rgFrente", "cnh",
    "senha", "password", "token", "api_key", "apiKey", "secret",
    "cartao", "cartão", "credit_card", "ccnumber",
    "ssn", "tax_id",
  ])("considera %p sensível", (chave) => {
    expect(ehChaveSensivel(chave)).toBe(true);
  });

  it.each(["nome", "email", "valor_causa", "data_agendamento", "telefone"])(
    "permite %p (não sensível)",
    (chave) => {
      expect(ehChaveSensivel(chave)).toBe(false);
    },
  );
});

describe("formatarValorParaPrompt", () => {
  describe("boolean", () => {
    it.each([["true", "Sim"], ["sim", "Sim"], ["Sim", "Sim"]])(
      "%p → %p",
      (entrada, esperado) => {
        expect(formatarValorParaPrompt(entrada, "boolean")).toBe(esperado);
      },
    );
    it.each([["false", "Não"], ["nao", "Não"], ["não", "Não"]])(
      "%p → %p",
      (entrada, esperado) => {
        expect(formatarValorParaPrompt(entrada, "boolean")).toBe(esperado);
      },
    );
  });

  describe("data", () => {
    it("converte ISO YYYY-MM-DD pra DD/MM/YYYY", () => {
      expect(formatarValorParaPrompt("2026-05-22", "data")).toBe("22/05/2026");
    });
    it("preserva ISO com hora", () => {
      expect(formatarValorParaPrompt("2026-05-22T14:00:00", "data")).toBe("22/05/2026");
    });
    it("retorna string crua se formato desconhecido", () => {
      expect(formatarValorParaPrompt("amanhã", "data")).toBe("amanhã");
    });
  });

  describe("numero", () => {
    it("formata número grande com separador BR", () => {
      expect(formatarValorParaPrompt(50000, "numero")).toBe("50.000");
    });
    it("aceita string ISO", () => {
      expect(formatarValorParaPrompt("1234.5", "numero")).toBe("1.234,5");
    });
    it("aceita formato BR", () => {
      expect(formatarValorParaPrompt("1.234,56", "numero")).toBe("1.234,56");
    });
  });

  describe("texto/textarea/select", () => {
    it("retorna trim do valor", () => {
      expect(formatarValorParaPrompt("  online  ", "select")).toBe("online");
    });
    it("trata texto vazio", () => {
      expect(formatarValorParaPrompt("", "texto")).toBe("");
      expect(formatarValorParaPrompt("   ", "texto")).toBe("");
    });
  });

  it.each([null, undefined])("retorna vazio para %p", (v) => {
    expect(formatarValorParaPrompt(v, "texto")).toBe("");
  });
});

describe("montarContextoCliente — guards (empty-input → empty-output)", () => {
  const defs: DefinicaoCampo[] = [{ chave: "x", label: "X", tipo: "texto" }];

  it.each([null, undefined, ""])("retorna '' para camposPersonalizados=%p", (v) => {
    expect(montarContextoCliente(v, defs)).toBe("");
  });

  it("retorna '' para JSON malformado (não joga exceção)", () => {
    expect(montarContextoCliente("{ não é json", defs)).toBe("");
    expect(montarContextoCliente("not json at all", defs)).toBe("");
  });

  it("retorna '' para JSON que não é objeto", () => {
    expect(montarContextoCliente("[]", defs)).toBe("");
    expect(montarContextoCliente('"string"', defs)).toBe("");
    expect(montarContextoCliente("null", defs)).toBe("");
    expect(montarContextoCliente("42", defs)).toBe("");
  });

  it("retorna '' quando lista de definições é vazia", () => {
    expect(montarContextoCliente('{"x": "y"}', [])).toBe("");
  });

  it("retorna '' quando nenhum campo tem valor preenchido", () => {
    const r = montarContextoCliente('{"x": null, "y": "", "z": "   "}', [
      { chave: "x", label: "X", tipo: "texto" },
      { chave: "y", label: "Y", tipo: "texto" },
      { chave: "z", label: "Z", tipo: "texto" },
    ]);
    expect(r).toBe("");
  });

  it("retorna '' quando definições não casam com chaves do JSON", () => {
    const r = montarContextoCliente('{"chave_a": "valor"}', [
      { chave: "chave_b", label: "B", tipo: "texto" },
    ]);
    expect(r).toBe("");
  });
});

describe("montarContextoCliente — formato do bloco", () => {
  it("monta bloco completo com cabeçalho e instrução final", () => {
    const r = montarContextoCliente(
      JSON.stringify({
        data_agendamento: "2026-05-22",
        modalidade: "presencial",
        valor_causa: 50000,
      }),
      [
        { chave: "data_agendamento", label: "Data agendamento", tipo: "data" },
        { chave: "modalidade", label: "Modalidade", tipo: "select" },
        { chave: "valor_causa", label: "Valor estimado", tipo: "numero" },
      ],
    );
    expect(r).toContain("## Dados já coletados deste cliente nesta conversa");
    expect(r).toContain("- Data agendamento: 22/05/2026");
    expect(r).toContain("- Modalidade: presencial");
    expect(r).toContain("- Valor estimado: 50.000");
    expect(r).toContain("IMPORTANTE:");
  });

  it("inclui só campos com valor preenchido", () => {
    const r = montarContextoCliente(
      JSON.stringify({ a: "valor_a", b: null, c: "" }),
      [
        { chave: "a", label: "A", tipo: "texto" },
        { chave: "b", label: "B", tipo: "texto" },
        { chave: "c", label: "C", tipo: "texto" },
      ],
    );
    expect(r).toContain("- A: valor_a");
    expect(r).not.toContain("- B:");
    expect(r).not.toContain("- C:");
  });
});

describe("montarContextoCliente — filtragem de sensíveis", () => {
  it("NÃO injeta campos com nome sensível mesmo se preenchidos", () => {
    const r = montarContextoCliente(
      JSON.stringify({
        cpf: "123.456.789-00",
        senha: "supersecreta",
        cartao_credito: "4532...",
        nome: "Rafael Rocha",
      }),
      [
        { chave: "cpf", label: "CPF", tipo: "texto" },
        { chave: "senha", label: "Senha", tipo: "texto" },
        { chave: "cartao_credito", label: "Cartão", tipo: "texto" },
        { chave: "nome", label: "Nome", tipo: "texto" },
      ],
    );
    expect(r).toContain("- Nome: Rafael Rocha");
    expect(r).not.toContain("123.456.789");
    expect(r).not.toContain("supersecreta");
    expect(r).not.toContain("4532");
    expect(r).not.toContain("CPF");
    expect(r).not.toContain("Senha");
  });

  it("retorna '' quando todos os campos preenchidos são sensíveis", () => {
    const r = montarContextoCliente(
      JSON.stringify({ cpf: "111", senha: "abc" }),
      [
        { chave: "cpf", label: "CPF", tipo: "texto" },
        { chave: "senha", label: "Senha", tipo: "texto" },
      ],
    );
    expect(r).toBe("");
  });
});

describe("montarContextoCliente — truncamento (limite 2000)", () => {
  it("não trunca quando bloco < limite", () => {
    const r = montarContextoCliente(
      JSON.stringify({ a: "valor curto" }),
      [{ chave: "a", label: "A", tipo: "texto" }],
    );
    expect(r.length).toBeLessThan(2000);
    expect(r).toContain("IMPORTANTE: use estes dados pra evitar perguntar de novo. Avance pra próxima etapa do atendimento.");
  });

  it("trunca bloco grande preservando instrução final reduzida", () => {
    // Cria 30 campos de ~80 chars cada = ~2400 chars total
    const definicoes: DefinicaoCampo[] = [];
    const valores: Record<string, string> = {};
    for (let i = 0; i < 30; i++) {
      const chave = `campo_${i}`;
      definicoes.push({ chave, label: `Label ${i}`, tipo: "texto" });
      valores[chave] = `Valor longo número ${i} pra ocupar espaço significativo no bloco`;
    }
    const r = montarContextoCliente(JSON.stringify(valores), definicoes);
    expect(r.length).toBeLessThanOrEqual(2000);
    // Instrução final ainda presente (versão truncada)
    expect(r).toContain("IMPORTANTE:");
    // Pelo menos os primeiros campos aparecem
    expect(r).toContain("- Label 0:");
  });
});

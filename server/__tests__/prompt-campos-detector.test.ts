import { describe, it, expect } from "vitest";
import {
  detectarChavesNoPrompt,
  inferirTipoCampo,
  chaveParaLabel,
  chavesFaltantes,
} from "../../shared/prompt-campos-detector";

describe("detectarChavesNoPrompt", () => {
  it("extrai chaves [snake_case] do texto", () => {
    expect(detectarChavesNoPrompt("Salve em [valor_financiado] e [parcelas_pagas].")).toEqual([
      "valor_financiado",
      "parcelas_pagas",
    ]);
  });

  it("dedupica — chave repetida aparece só uma vez", () => {
    expect(detectarChavesNoPrompt("[x] [x] [y]")).toEqual(["x", "y"]);
  });

  it("ignora markdown links [texto](url) — falso positivo comum", () => {
    expect(detectarChavesNoPrompt("Veja [aqui](http://x) ou em [valor].")).toEqual(["valor"]);
  });

  it("normaliza pra minúscula (case-insensitive)", () => {
    expect(detectarChavesNoPrompt("[VALOR_X] e [ValorY]")).toEqual(["valor_x", "valory"]);
  });

  it("vazio → []", () => {
    expect(detectarChavesNoPrompt("")).toEqual([]);
    expect(detectarChavesNoPrompt("sem nada aqui")).toEqual([]);
  });
});

describe("inferirTipoCampo", () => {
  it("Sim/Não conhecidos → select SIM/NAO", () => {
    expect(inferirTipoCampo("conteudo_sexual")).toEqual({ tipo: "select", opcoes: ["SIM", "NAO"] });
    expect(inferirTipoCampo("confirmacao_agendamento")).toEqual({ tipo: "select", opcoes: ["SIM", "NAO"] });
    expect(inferirTipoCampo("aceita_proposta")).toEqual({ tipo: "select", opcoes: ["SIM", "NAO"] });
  });

  it("data_* / *_data → data", () => {
    expect(inferirTipoCampo("data_bloqueio").tipo).toBe("data");
    expect(inferirTipoCampo("nascimento_data").tipo).toBe("data");
  });

  it("valor/renda/parcelas/numero/fatura/remuneracao → numero", () => {
    expect(inferirTipoCampo("valor_financiado").tipo).toBe("numero");
    expect(inferirTipoCampo("renda").tipo).toBe("numero");
    expect(inferirTipoCampo("parcelas_pagas").tipo).toBe("numero");
    expect(inferirTipoCampo("numero_de_emprestimos").tipo).toBe("numero");
    expect(inferirTipoCampo("fatura_cartao").tipo).toBe("numero");
    expect(inferirTipoCampo("remuneracao_diaria").tipo).toBe("numero");
    expect(inferirTipoCampo("valor_total_emprestimos").tipo).toBe("numero");
  });

  it("default conservador = texto", () => {
    expect(inferirTipoCampo("motivo_bloqueio").tipo).toBe("texto");
    expect(inferirTipoCampo("tipo_emprestimo").tipo).toBe("texto");
  });
});

describe("chaveParaLabel", () => {
  it("snake_case → Frase capitalizada", () => {
    expect(chaveParaLabel("valor_financiado")).toBe("Valor financiado");
    expect(chaveParaLabel("data_bloqueio")).toBe("Data bloqueio");
    expect(chaveParaLabel("renda")).toBe("Renda");
  });
});

describe("chavesFaltantes", () => {
  it("retorna só as que não existem no catálogo", () => {
    const r = chavesFaltantes("[valor_financiado] e [novo_campo]", [{ chave: "valor_financiado" }]);
    expect(r).toHaveLength(1);
    expect(r[0].chave).toBe("novo_campo");
    expect(r[0].label).toBe("Novo campo");
  });

  it("comparação case-insensitive com existentes", () => {
    expect(chavesFaltantes("[VALOR_X]", [{ chave: "valor_x" }])).toEqual([]);
  });

  it("monta sugestão completa pra criação direta (chave + label + tipo + opcoes)", () => {
    expect(chavesFaltantes("[fatura_cartao]", [])).toEqual([
      { chave: "fatura_cartao", label: "Fatura cartao", tipo: "numero" },
    ]);
    expect(chavesFaltantes("[conteudo_sexual]", [])).toEqual([
      { chave: "conteudo_sexual", label: "Conteudo sexual", tipo: "select", opcoes: ["SIM", "NAO"] },
    ]);
  });

  it("prompt completo do SDR Boyadjian: detecta os 16 campos do prompt corretamente", () => {
    const prompt = `
Seu nome é {{atendente}}. Pergunte:
1. Valor financiado? → [valor_financiado]
2. Valor da parcela? → [valor_parcela]
3. Nº de parcelas? → [numero_parcelas]
4. Parcelas pagas? → [parcelas_pagas]
5. Parcelas atrasadas? → [parcelas_atrasadas]
6. Tipo? → [tipo_emprestimo]
7. Qtd empréstimos? → [numero_de_emprestimos]
8. Valor total? → [valor_total_emprestimos]
9. Fatura? → [fatura_cartao]
10. Valor atrasado? → [valor_atrasado_total]
11. Renda? → [renda]
12. Total parcelas? → [valor_total_parcelas_emprestimo]
13. Data bloqueio? → [data_bloqueio]
14. Motivo? → [motivo_bloqueio]
15. Remuneração? → [remuneracao_diaria]
16. Valor imóvel? → [valor_imovel]
17. Conteúdo sexual? → [conteudo_sexual]
Veja [aqui](http://x) — markdown link não conta.
    `;
    const r = chavesFaltantes(prompt, []);
    expect(r).toHaveLength(17);
    // Sanity: o conteudo_sexual saiu como select SIM/NAO
    const conteudo = r.find((s) => s.chave === "conteudo_sexual")!;
    expect(conteudo.tipo).toBe("select");
    expect(conteudo.opcoes).toEqual(["SIM", "NAO"]);
    // valor_* saíram como numero
    const valor = r.find((s) => s.chave === "valor_financiado")!;
    expect(valor.tipo).toBe("numero");
    // motivo_* ficou texto (default)
    const motivo = r.find((s) => s.chave === "motivo_bloqueio")!;
    expect(motivo.tipo).toBe("texto");
  });
});

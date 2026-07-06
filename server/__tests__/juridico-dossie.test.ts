import { describe, it, expect } from "vitest";
import { montarQualificacao, montarResumoProcesso } from "../juridico/dossie";

describe("montarQualificacao", () => {
  it("monta bloco rotulado com os dados reais + endereço", () => {
    const q = montarQualificacao({
      nome: "Maria Silva Santos",
      cpfCnpj: "123.456.789-00",
      nacionalidade: "brasileira",
      estadoCivil: "casado",
      profissao: "analista de sistemas",
      cep: "60150-160",
      logradouro: "Rua das Acácias",
      numeroEndereco: "123",
      bairro: "Aldeota",
      cidade: "Fortaleza",
      uf: "CE",
    });
    expect(q).toContain("Nome: Maria Silva Santos");
    expect(q).toContain("CPF/CNPJ: 123.456.789-00");
    expect(q).toContain("Estado civil: casado(a)"); // enum traduzido
    expect(q).toContain("Rua das Acácias, 123");
    expect(q).toContain("Fortaleza/CE");
    expect(q).toContain("CEP 60150-160");
  });

  it("omite campos ausentes (só o nome)", () => {
    const q = montarQualificacao({ nome: "João" });
    expect(q).toBe("Nome: João");
  });

  it("traduz união estável", () => {
    const q = montarQualificacao({ nome: "X", estadoCivil: "uniao_estavel" });
    expect(q).toContain("em união estável");
  });
});

describe("montarResumoProcesso", () => {
  it("monta bloco com CNJ, classe, valor (reais) e polo", () => {
    const p = montarResumoProcesso({
      numeroCnj: "0801234-56.2024.8.06.0001",
      classe: "Procedimento Comum",
      tribunal: "TJCE",
      valorCausa: 45000,
      polo: "ativo",
    });
    expect(p).toContain("Número CNJ: 0801234-56.2024.8.06.0001");
    expect(p).toContain("Classe/assunto: Procedimento Comum");
    expect(p).toContain("R$ 45.000,00");
    expect(p).toContain("Polo do cliente: ativo");
  });

  it("vazio quando não há dado", () => {
    expect(montarResumoProcesso({})).toBe("");
  });
});

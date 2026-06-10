/**
 * Testes — mesclarCadastroDoAsaas (política de merge CRM ← Asaas).
 *
 * Regressão do bug "sync/vínculo Asaas troca o telefone do contato e o
 * WhatsApp passa a enviar pro número errado": telefone e email do CRM
 * NUNCA são sobrescritos pelo Asaas — só preenchidos quando vazios, e
 * valor ausente no Asaas nunca apaga valor existente. Nome/CPF continuam
 * vindo do Asaas quando presentes (cadastro de faturamento).
 */

import { describe, it, expect } from "vitest";
import { mesclarCadastroDoAsaas } from "../integracoes/asaas-cadastro-merge";

const atualCompleto = {
  nome: "Rafael Rocha",
  cpfCnpj: "11122233344",
  email: "rafael@exemplo.com",
  telefone: "5585988887777",
};

describe("mesclarCadastroDoAsaas", () => {
  it("preserva o telefone do CRM mesmo quando o Asaas tem mobilePhone diferente", () => {
    const r = mesclarCadastroDoAsaas(atualCompleto, {
      name: "Rafael R. da Rocha",
      cpfCnpj: "111.222.333-44",
      email: "financeiro@exemplo.com",
      mobilePhone: "85911110000",
      phone: "8533334444",
    });
    expect(r.telefone).toBe("5585988887777");
    expect(r.email).toBe("rafael@exemplo.com");
  });

  it("preenche telefone/email do Asaas quando o CRM está vazio (mobilePhone > phone)", () => {
    const r = mesclarCadastroDoAsaas(
      { nome: "Novo", cpfCnpj: null, email: null, telefone: null },
      { name: "Novo", mobilePhone: "85911110000", phone: "8533334444", email: "a@b.c" },
    );
    expect(r.telefone).toBe("85911110000");
    expect(r.email).toBe("a@b.c");
  });

  it("usa phone fixo como último recurso quando CRM vazio e Asaas sem mobilePhone", () => {
    const r = mesclarCadastroDoAsaas(
      { nome: "Novo", cpfCnpj: null, email: null, telefone: null },
      { name: "Novo", phone: "8533334444" },
    );
    expect(r.telefone).toBe("8533334444");
  });

  it("Asaas sem telefone/email NÃO apaga os valores do CRM", () => {
    const r = mesclarCadastroDoAsaas(atualCompleto, {
      name: "Rafael Rocha",
      cpfCnpj: "11122233344",
      // sem email, sem phone, sem mobilePhone
    });
    expect(r.telefone).toBe("5585988887777");
    expect(r.email).toBe("rafael@exemplo.com");
  });

  it("nome e CPF do Asaas têm precedência quando presentes", () => {
    const r = mesclarCadastroDoAsaas(atualCompleto, {
      name: "Rafael Rocha ME",
      cpfCnpj: "999.888.777-66",
    });
    expect(r.nome).toBe("Rafael Rocha ME");
    expect(r.cpfCnpj).toBe("99988877766");
  });

  it("nome/CPF ausentes no Asaas mantêm os do CRM (nunca apaga)", () => {
    const r = mesclarCadastroDoAsaas(atualCompleto, {});
    expect(r.nome).toBe("Rafael Rocha");
    expect(r.cpfCnpj).toBe("11122233344");
  });

  it("tudo vazio dos dois lados resulta em nulls sem lançar", () => {
    const r = mesclarCadastroDoAsaas(
      { nome: "X", cpfCnpj: null, email: null, telefone: null },
      {},
    );
    expect(r).toEqual({ nome: "X", cpfCnpj: null, email: null, telefone: null });
  });
});

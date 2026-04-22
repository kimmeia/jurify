/**
 * Testes — agregação N:1 de vínculos Asaas por contato do CRM.
 *
 * O Asaas permite cadastrar 2+ customers com o mesmo CPF/CNPJ; cada um tem
 * id próprio (cus_A, cus_B). No CRM, eles ficam todos vinculados ao MESMO
 * contato. A tela "Clientes" agrega sob o contato, somando cobranças de
 * todos os customers. Sem agregação correta, a tela mostra 2 linhas
 * duplicadas OU zera o contador (bug anterior).
 */

import { describe, it, expect } from "vitest";
import {
  agregarVinculosPorContato,
  type VinculoLinha,
  type CobrancaAgg,
  type ContatoMeta,
} from "../integracoes/asaas-sync";

function v(overrides: Partial<VinculoLinha>): VinculoLinha {
  return {
    id: 1,
    contatoId: 42,
    asaasCustomerId: "cus_A",
    cpfCnpj: "12345678901",
    nome: "João da Silva",
    primario: true,
    ...overrides,
  };
}

function c(overrides: Partial<CobrancaAgg>): CobrancaAgg {
  return {
    asaasCustomerId: "cus_A",
    valor: "100",
    status: "PENDING",
    ...overrides,
  };
}

const metaJoao: Record<number, ContatoMeta> = {
  42: { nome: "João da Silva", telefone: "11999998888", email: "joao@ex.com" },
};

describe("agregarVinculosPorContato", () => {
  it("retorna 1 item por contato mesmo quando há 2 vínculos (2 customers Asaas, mesmo CPF)", () => {
    const vinculos = [
      v({ id: 1, asaasCustomerId: "cus_A", primario: true }),
      v({ id: 2, asaasCustomerId: "cus_B", primario: false }),
    ];
    const cobrancas: CobrancaAgg[] = [];

    const out = agregarVinculosPorContato(vinculos, cobrancas, metaJoao);

    expect(out).toHaveLength(1);
    expect(out[0].contatoId).toBe(42);
    expect(out[0].asaasCustomerIds.sort()).toEqual(["cus_A", "cus_B"]);
  });

  it("soma cobranças de TODOS os customers vinculados ao mesmo contato", () => {
    const vinculos = [
      v({ id: 1, asaasCustomerId: "cus_A", primario: true }),
      v({ id: 2, asaasCustomerId: "cus_B", primario: false }),
    ];
    const cobrancas = [
      c({ asaasCustomerId: "cus_A", valor: "100", status: "PENDING" }),
      c({ asaasCustomerId: "cus_A", valor: "200", status: "RECEIVED" }),
      c({ asaasCustomerId: "cus_B", valor: "500", status: "OVERDUE" }),
    ];

    const [item] = agregarVinculosPorContato(vinculos, cobrancas, metaJoao);

    expect(item.totalCobrancas).toBe(3);
    expect(item.pendente).toBe(100);
    expect(item.pago).toBe(200);
    expect(item.vencido).toBe(500);
  });

  it("ignora cobranças de customers que NÃO pertencem ao contato (isolamento)", () => {
    const vinculos = [v({ id: 1, asaasCustomerId: "cus_A", contatoId: 42 })];
    const cobrancas = [
      c({ asaasCustomerId: "cus_A", valor: "100", status: "PENDING" }),
      c({ asaasCustomerId: "cus_ZZ_outroContato", valor: "9999", status: "OVERDUE" }),
    ];

    const [item] = agregarVinculosPorContato(vinculos, cobrancas, metaJoao);

    expect(item.totalCobrancas).toBe(1);
    expect(item.vencido).toBe(0);
    expect(item.pendente).toBe(100);
  });

  it("elege o vínculo com primario=true como representante (id exposto na UI)", () => {
    const vinculos = [
      v({ id: 10, asaasCustomerId: "cus_X", primario: false }),
      v({ id: 20, asaasCustomerId: "cus_Y", primario: true }),
      v({ id: 5, asaasCustomerId: "cus_Z", primario: false }),
    ];

    const [item] = agregarVinculosPorContato(vinculos, [], metaJoao);

    expect(item.id).toBe(20);
    expect(item.asaasCustomerId).toBe("cus_Y");
  });

  it("sem primario marcado, usa o vínculo mais antigo (menor id) como representante", () => {
    const vinculos = [
      v({ id: 20, asaasCustomerId: "cus_Y", primario: false }),
      v({ id: 5, asaasCustomerId: "cus_Z", primario: false }),
      v({ id: 10, asaasCustomerId: "cus_X", primario: null }),
    ];

    const [item] = agregarVinculosPorContato(vinculos, [], metaJoao);

    expect(item.id).toBe(5);
    expect(item.asaasCustomerId).toBe("cus_Z");
  });

  it("separa contatos diferentes em itens diferentes", () => {
    const metaMulti: Record<number, ContatoMeta> = {
      42: { nome: "João", telefone: null, email: null },
      77: { nome: "Maria", telefone: null, email: null },
    };
    const vinculos = [
      v({ id: 1, contatoId: 42, asaasCustomerId: "cus_A" }),
      v({ id: 2, contatoId: 77, asaasCustomerId: "cus_B" }),
    ];
    const cobrancas = [
      c({ asaasCustomerId: "cus_A", valor: "100", status: "PENDING" }),
      c({ asaasCustomerId: "cus_B", valor: "200", status: "OVERDUE" }),
    ];

    const out = agregarVinculosPorContato(vinculos, cobrancas, metaMulti);

    expect(out).toHaveLength(2);
    const joao = out.find((o) => o.contatoId === 42)!;
    const maria = out.find((o) => o.contatoId === 77)!;
    expect(joao.pendente).toBe(100);
    expect(joao.vencido).toBe(0);
    expect(maria.vencido).toBe(200);
    expect(maria.pendente).toBe(0);
  });

  it("usa meta do contato quando disponível; fallback para o nome do vínculo", () => {
    const vinculos = [v({ contatoId: 999, nome: "Fallback do Asaas" })];
    const [item] = agregarVinculosPorContato(vinculos, [], {});

    expect(item.contatoNome).toBe("Fallback do Asaas");
    expect(item.contatoTelefone).toBeNull();
    expect(item.contatoEmail).toBeNull();
  });

  it("não quebra com lista vazia", () => {
    expect(agregarVinculosPorContato([], [], {})).toEqual([]);
  });
});

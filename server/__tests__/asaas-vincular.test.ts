/**
 * Testes — fluxo de vinculação CRM ↔ Asaas (asaas-client).
 *
 * Cobre o método `buscarClientesPorTelefone` que sustenta o passo 2 do
 * fluxo de vinculação (buscar por telefone quando CPF não bate). O router
 * tRPC é mais testável manualmente no dev, pois envolve DB + contexto;
 * aqui focamos na mecânica da busca HTTP.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { AsaasClient, type AsaasCustomer } from "../integracoes/asaas-client";

type MockGet = ReturnType<typeof vi.fn>;

function criarClienteMock(overrides: Partial<AsaasCustomer> = {}): AsaasCustomer {
  return {
    id: "cus_000000001",
    name: "Cliente Teste",
    cpfCnpj: "12345678901",
    email: "teste@exemplo.com",
    phone: "",
    mobilePhone: "11999998888",
    deleted: false,
    ...overrides,
  };
}

describe("AsaasClient.buscarClientesPorTelefone", () => {
  let client: AsaasClient;
  let getMock: MockGet;

  beforeEach(() => {
    getMock = vi.fn();
    vi.spyOn(axios, "create").mockReturnValue({
      get: getMock,
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    } as any);
    client = new AsaasClient("$aact_sandbox_fakekey", "sandbox");
  });

  it("retorna array vazio quando telefone é vazio ou só dígitos não numéricos", async () => {
    const resA = await client.buscarClientesPorTelefone("");
    const resB = await client.buscarClientesPorTelefone("  -- ");
    expect(resA).toEqual([]);
    expect(resB).toEqual([]);
    expect(getMock).not.toHaveBeenCalled();
  });

  it("consulta ambos os campos (phone e mobilePhone) e deduplica por id", async () => {
    const mesmo = criarClienteMock({ id: "cus_A", mobilePhone: "11999998888" });
    getMock.mockResolvedValueOnce({ data: { data: [mesmo], hasMore: false, limit: 100, offset: 0 } });
    getMock.mockResolvedValueOnce({ data: { data: [mesmo], hasMore: false, limit: 100, offset: 0 } });

    const resultado = await client.buscarClientesPorTelefone("11999998888");
    expect(resultado).toHaveLength(1);
    expect(resultado[0].id).toBe("cus_A");
    expect(getMock).toHaveBeenCalledTimes(2);
  });

  it("filtra localmente por dígitos exatos (não aceita match parcial)", async () => {
    const exato = criarClienteMock({ id: "cus_A", mobilePhone: "11999998888" });
    const outro = criarClienteMock({ id: "cus_B", mobilePhone: "1199999888" });
    getMock.mockResolvedValue({ data: { data: [exato, outro], hasMore: false, limit: 100, offset: 0 } });

    const resultado = await client.buscarClientesPorTelefone("(11) 99999-8888");
    expect(resultado.map((c) => c.id)).toEqual(["cus_A"]);
  });

  it("ignora clientes marcados como deleted", async () => {
    const ativo = criarClienteMock({ id: "cus_A", mobilePhone: "11999998888" });
    const deletado = criarClienteMock({ id: "cus_B", mobilePhone: "11999998888", deleted: true });
    getMock.mockResolvedValue({ data: { data: [ativo, deletado], hasMore: false, limit: 100, offset: 0 } });

    const resultado = await client.buscarClientesPorTelefone("11999998888");
    expect(resultado).toHaveLength(1);
    expect(resultado[0].id).toBe("cus_A");
  });

  it("retorna múltiplos clientes quando telefone é compartilhado (ex.: responsável legal)", async () => {
    const pessoaA = criarClienteMock({ id: "cus_A", name: "João", cpfCnpj: "11111111111", mobilePhone: "11999998888" });
    const pessoaB = criarClienteMock({ id: "cus_B", name: "Maria (resp. legal)", cpfCnpj: "22222222222", mobilePhone: "11999998888" });
    getMock.mockResolvedValue({ data: { data: [pessoaA, pessoaB], hasMore: false, limit: 100, offset: 0 } });

    const resultado = await client.buscarClientesPorTelefone("11999998888");
    const ids = resultado.map((c) => c.id).sort();
    expect(ids).toEqual(["cus_A", "cus_B"]);
  });

  it("trata erro em um dos campos sem abortar — tenta o outro", async () => {
    getMock.mockRejectedValueOnce(new Error("500 Asaas"));
    const cliente = criarClienteMock({ id: "cus_A", phone: "11999998888", mobilePhone: "" });
    getMock.mockResolvedValueOnce({ data: { data: [cliente], hasMore: false, limit: 100, offset: 0 } });

    const resultado = await client.buscarClientesPorTelefone("11999998888");
    expect(resultado).toHaveLength(1);
    expect(resultado[0].id).toBe("cus_A");
  });

  it("retorna array vazio quando nenhum cliente bate com os dígitos", async () => {
    const outroTelefone = criarClienteMock({ id: "cus_X", mobilePhone: "21988887777" });
    getMock.mockResolvedValue({ data: { data: [outroTelefone], hasMore: false, limit: 100, offset: 0 } });

    const resultado = await client.buscarClientesPorTelefone("11999998888");
    expect(resultado).toEqual([]);
  });
});

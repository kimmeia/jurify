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

// ═══════════════════════════════════════════════════════════════════════════════
// listarCobrancas: garante o filtro por customer (regressão do bug onde
// o sync pós-vinculação não puxava cobranças existentes).
// ═══════════════════════════════════════════════════════════════════════════════

describe("AsaasClient.listarCobrancas", () => {
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

  it("passa o parâmetro customer como query string quando fornecido", async () => {
    getMock.mockResolvedValue({ data: { data: [], hasMore: false, limit: 100, offset: 0 } });

    await client.listarCobrancas({ customer: "cus_abc123", limit: 100, offset: 0 });

    expect(getMock).toHaveBeenCalledTimes(1);
    const [url, config] = getMock.mock.calls[0];
    expect(url).toBe("/payments");
    expect(config.params).toMatchObject({ customer: "cus_abc123", limit: 100, offset: 0 });
  });

  it("propaga o erro em vez de silenciar — permite ao caller decidir", async () => {
    const erro = new Error("Asaas 503");
    getMock.mockRejectedValue(erro);

    await expect(
      client.listarCobrancas({ customer: "cus_abc123" }),
    ).rejects.toThrow("Asaas 503");
  });

  it("não aplica filtro de data — retorna cobranças de qualquer status (pago, vencido, pendente)", async () => {
    // Garante que a chamada HTTP não injeta dateCreated[ge]/[le] ou similar,
    // preservando o histórico completo do customer (regressão do bug onde
    // cobranças antigas não apareciam após Sincronizar).
    getMock.mockResolvedValue({
      data: {
        data: [
          { id: "pay_1", status: "RECEIVED", customer: "cus_A", value: 100, dueDate: "2024-01-15", billingType: "PIX", invoiceUrl: "", deleted: false },
          { id: "pay_2", status: "OVERDUE", customer: "cus_A", value: 200, dueDate: "2025-06-10", billingType: "BOLETO", invoiceUrl: "", deleted: false },
          { id: "pay_3", status: "PENDING", customer: "cus_A", value: 300, dueDate: "2026-12-20", billingType: "PIX", invoiceUrl: "", deleted: false },
        ],
        hasMore: false,
        limit: 100,
        offset: 0,
      },
    });

    await client.listarCobrancas({ customer: "cus_A", limit: 100, offset: 0 });

    const [, config] = getMock.mock.calls[0];
    // Nenhum parâmetro de data deve ser injetado automaticamente.
    expect(config.params).not.toHaveProperty("dateCreated[ge]");
    expect(config.params).not.toHaveProperty("dateCreated[le]");
    expect(config.params).not.toHaveProperty("dueDate[ge]");
    expect(config.params).not.toHaveProperty("dueDate[le]");
    // Só os filtros explícitos do caller.
    expect(Object.keys(config.params || {}).sort()).toEqual(["customer", "limit", "offset"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// buscarCliente: usado no confirmarVinculacao quando o usuário escolhe
// "vincular existente" no diálogo de decisão.
// ═══════════════════════════════════════════════════════════════════════════════

describe("AsaasClient.buscarCliente", () => {
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

  it("busca o cliente por ID e retorna os dados completos", async () => {
    const cliente = criarClienteMock({
      id: "cus_abc123",
      name: "JOAO DA SILVA FILHO",
      email: "joao@exemplo.com",
    });
    getMock.mockResolvedValue({ data: cliente });

    const resultado = await client.buscarCliente("cus_abc123");
    expect(getMock).toHaveBeenCalledWith("/customers/cus_abc123");
    expect(resultado.id).toBe("cus_abc123");
    expect(resultado.name).toBe("JOAO DA SILVA FILHO");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// buscarTodosClientesPorCpfCnpj: essencial pro fluxo de múltiplos customers
// com mesmo CPF (duplicatas permitidas pelo Asaas).
// ═══════════════════════════════════════════════════════════════════════════════

describe("AsaasClient.buscarTodosClientesPorCpfCnpj", () => {
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

  it("retorna array vazio quando CPF é vazio", async () => {
    const res = await client.buscarTodosClientesPorCpfCnpj("");
    expect(res).toEqual([]);
    expect(getMock).not.toHaveBeenCalled();
  });

  it("retorna múltiplos customers com o mesmo CPF (duplicatas do Asaas)", async () => {
    const a = criarClienteMock({ id: "cus_A", name: "Oficina Damasceno" });
    const b = criarClienteMock({ id: "cus_B", name: "OFICINA DAMASCENO ME" });
    getMock.mockResolvedValue({
      data: { data: [a, b], hasMore: false, limit: 100, offset: 0 },
    });

    const res = await client.buscarTodosClientesPorCpfCnpj("12345678901");
    expect(res.map((c) => c.id).sort()).toEqual(["cus_A", "cus_B"]);
  });

  it("ignora customers deletados", async () => {
    const ativo = criarClienteMock({ id: "cus_A" });
    const deletado = criarClienteMock({ id: "cus_B", deleted: true });
    getMock.mockResolvedValue({
      data: { data: [ativo, deletado], hasMore: false, limit: 100, offset: 0 },
    });

    const res = await client.buscarTodosClientesPorCpfCnpj("12345678901");
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe("cus_A");
  });

  it("descarta matches parciais de CPF (Asaas eventualmente faz prefix)", async () => {
    const cli = criarClienteMock({ id: "cus_X", cpfCnpj: "12345678900" });
    getMock.mockResolvedValue({
      data: { data: [cli], hasMore: false, limit: 100, offset: 0 },
    });

    const res = await client.buscarTodosClientesPorCpfCnpj("12345678901");
    expect(res).toEqual([]);
  });

  it("pagina corretamente quando há mais de 100 resultados", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) =>
      criarClienteMock({ id: `cus_${i}`, cpfCnpj: "12345678901" }),
    );
    const page2 = [criarClienteMock({ id: "cus_X", cpfCnpj: "12345678901" })];
    getMock
      .mockResolvedValueOnce({ data: { data: page1, hasMore: true, limit: 100, offset: 0 } })
      .mockResolvedValueOnce({ data: { data: page2, hasMore: false, limit: 100, offset: 100 } });

    const res = await client.buscarTodosClientesPorCpfCnpj("12345678901");
    expect(res).toHaveLength(101);
    expect(getMock).toHaveBeenCalledTimes(2);
    expect(getMock.mock.calls[1][1].params).toMatchObject({ offset: 100 });
  });
});

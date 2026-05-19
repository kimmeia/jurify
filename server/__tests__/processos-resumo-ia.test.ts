/**
 * Tests — `processos.resumoIA` (resumo executivo via OpenAI/Anthropic).
 *
 * Procedure adicionada no fix do bug em que o botão "Resumo IA" no
 * MonitoramentoCard chamava `trpc.processos.resumoIA` que não existia,
 * causando erro tRPC ao clicar.
 */

import { describe, expect, it, vi, beforeEach, beforeAll, afterAll } from "vitest";
import type { TrpcContext } from "../_core/context";

// ─── Mock crypto-utils ──────────────────────────────────────────────────────
const adminDecrypt = vi.fn();
vi.mock("../escritorio/crypto-utils", () => ({
  decrypt: adminDecrypt,
  decryptConfig: vi.fn(),
  encrypt: vi.fn(),
  encryptConfig: vi.fn(),
}));

// ─── Mock fetch para chamadas IA ────────────────────────────────────────────
// CRÍTICO: vitest compartilha workers entre arquivos. Se mutarmos
// `globalThis.fetch` sem restaurar, testes subsequentes em outros arquivos
// que dependem de fetch real (ou de outros mocks) quebram. Salva e
// restaura em beforeAll/afterAll.
const originalFetch = globalThis.fetch;
const fetchMock = vi.fn();
beforeAll(() => {
  globalThis.fetch = fetchMock as any;
});
afterAll(() => {
  globalThis.fetch = originalFetch;
});

// ─── Mock consumirCreditos ──────────────────────────────────────────────────
const consumirCreditosEscritorio = vi.fn();
vi.mock("../billing/escritorio-creditos", () => ({
  consumirCreditosEscritorio,
  getSaldoEscritorio: vi.fn(async () => ({
    saldo: 100, totalConsumido: 0, totalComprado: 100, cotaMensal: 0, ultimoReset: null,
  })),
}));

// ─── Mock DB ────────────────────────────────────────────────────────────────
const dbState: {
  monitoramento: any;
  adminIntegracoesOpenai: any;
  adminIntegracoesAnthropic: any;
  eventos: any[];
} = {
  monitoramento: null,
  adminIntegracoesOpenai: null,
  adminIntegracoesAnthropic: null,
  eventos: [],
};

function tableName(t: unknown): string {
  const anyT = t as any;
  return anyT?._?.name || anyT?.[Symbol.for("drizzle:Name")] || "unknown";
}

function makeDb() {
  // Estado por instância do builder — cada `db.select()` cria um builder
  // novo, então rastreamos a tabela atual aqui.
  let adminIntegracoesCallCount = 0;

  function newBuilder() {
    let currentTable = "";
    const builder: any = {
      from: (t: unknown) => {
        currentTable = tableName(t);
        return builder;
      },
      where: () => builder,
      orderBy: () => builder,
      limit: async (_n: number) => {
        if (currentTable === "motor_monitoramentos") {
          return dbState.monitoramento ? [dbState.monitoramento] : [];
        }
        if (currentTable === "admin_integracoes") {
          // Procedure consulta openai primeiro, depois anthropic. Em
          // alguns testes só anthropic está setado — alinhar com a ordem
          // que o código produção faz a query.
          adminIntegracoesCallCount++;
          if (adminIntegracoesCallCount === 1) {
            return dbState.adminIntegracoesOpenai ? [dbState.adminIntegracoesOpenai] : [];
          }
          if (adminIntegracoesCallCount === 2) {
            return dbState.adminIntegracoesAnthropic ? [dbState.adminIntegracoesAnthropic] : [];
          }
          return [];
        }
        return [];
      },
      then: (resolve: any) => {
        if (currentTable === "eventos_processo") return resolve(dbState.eventos);
        return resolve([]);
      },
    };
    return builder;
  }

  return {
    select: () => newBuilder(),
    insert: () => ({ values: () => Promise.resolve([{ insertId: 1 }]) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  };
}

vi.mock("../db", () => ({
  getDb: vi.fn(async () => makeDb()),
}));

vi.mock("../escritorio/db-escritorio", () => ({
  getEscritorioPorUsuario: vi.fn(async () => ({
    escritorio: { id: 1, nome: "Esc Teste" },
    colaborador: { id: 10, cargo: "atendente" },
  })),
}));

const { appRouter } = await import("../routers");

function fakeCtx(): TrpcContext {
  return {
    user: {
      id: 100, openId: "x", email: "x@y.z", name: "X",
      loginMethod: "google", role: "user", asaasCustomerId: null,
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    } as any,
    req: { protocol: "https", headers: {} } as any,
    res: { clearCookie: () => {} } as any,
  };
}

const MON_BASE = {
  id: 42,
  escritorioId: 1,
  criadoPor: 100,
  searchKey: "0001234-56.2024.8.06.0001",
  searchType: "lawsuit_cnj",
  tribunal: "tjce",
  tipoMonitoramento: "movimentacoes",
  apelido: "Processo X",
  capaJson: JSON.stringify({
    cnj: "0001234-56.2024.8.06.0001",
    classe: "Procedimento Comum Cível",
    valorCausaCentavos: 5449470,
    dataDistribuicao: "2024-03-15",
    juiz: "Dr. Fulano de Tal",
    comarca: "Fortaleza/CE",
    partes: [
      { nome: "João Silva", polo: "ativo" },
      { nome: "Banco X S.A.", polo: "passivo" },
    ],
    assuntos: ["Revisão de contrato"],
  }),
  partesJson: null,
  status: "ativo",
};

beforeEach(() => {
  dbState.monitoramento = null;
  dbState.adminIntegracoesOpenai = null;
  dbState.adminIntegracoesAnthropic = null;
  dbState.eventos = [];
  adminDecrypt.mockReset();
  fetchMock.mockReset();
  consumirCreditosEscritorio.mockReset();
});

describe("processos.resumoIA — pré-condições", () => {
  it("erro NOT_FOUND quando monitoramento não existe", async () => {
    dbState.monitoramento = null;
    const caller = appRouter.createCaller(fakeCtx());
    await expect(
      caller.processos.resumoIA({ cnj: "0001234-56.2024.8.06.0001", monitoramentoId: 999 }),
    ).rejects.toThrow(/Monitoramento não encontrado/i);
  });

  it("erro PRECONDITION_FAILED quando capa do processo está vazia", async () => {
    dbState.monitoramento = { ...MON_BASE, capaJson: null };
    const caller = appRouter.createCaller(fakeCtx());
    await expect(
      caller.processos.resumoIA({ cnj: "0001234-56.2024.8.06.0001", monitoramentoId: 42 }),
    ).rejects.toThrow(/Sem dados do processo|Histórico/i);
  });

  it("erro PRECONDITION_FAILED quando nem OpenAI nem Anthropic configurados", async () => {
    dbState.monitoramento = MON_BASE;
    dbState.adminIntegracoesOpenai = null;
    dbState.adminIntegracoesAnthropic = null;
    const caller = appRouter.createCaller(fakeCtx());
    await expect(
      caller.processos.resumoIA({ cnj: "0001234-56.2024.8.06.0001", monitoramentoId: 42 }),
    ).rejects.toThrow(/Integração com IA não configurada/i);
  });
});

describe("processos.resumoIA — fluxo OpenAI", () => {
  it("gera resumo via OpenAI, cobra 1 crédito e retorna processo+resumo+fonte", async () => {
    dbState.monitoramento = MON_BASE;
    dbState.adminIntegracoesOpenai = {
      apiKeyEncrypted: "enc",
      apiKeyIv: "iv",
      apiKeyTag: "tag",
    };
    adminDecrypt.mockReturnValue("sk-fake-openai-key");
    consumirCreditosEscritorio.mockResolvedValue(undefined);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "**Resumo:** Processo de revisão de contrato bancário..." } }],
      }),
      text: async () => "",
    });

    const caller = appRouter.createCaller(fakeCtx());
    const result = await caller.processos.resumoIA({
      cnj: "0001234-56.2024.8.06.0001",
      monitoramentoId: 42,
    });

    expect(result.resumo).toContain("Resumo");
    expect(result.fonte).toBe("ia");
    expect(result.processo).toBeDefined();
    // adaptarParaJuditShape retorna `code` ou similar — confirma que veio capa
    expect(result.processo).toMatchObject({ classifications: expect.any(Array) });

    // Cobrou exatamente 1 crédito antes da chamada externa
    expect(consumirCreditosEscritorio).toHaveBeenCalledWith(
      1, 100, 1, "resumo_ia", expect.any(String),
    );

    // Chamou OpenAI com Bearer token
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer sk-fake-openai-key",
        }),
      }),
    );
  });

  it("propaga erro se OpenAI retornar status não-ok", async () => {
    dbState.monitoramento = MON_BASE;
    dbState.adminIntegracoesOpenai = {
      apiKeyEncrypted: "enc",
      apiKeyIv: "iv",
      apiKeyTag: "tag",
    };
    adminDecrypt.mockReturnValue("sk-fake");
    consumirCreditosEscritorio.mockResolvedValue(undefined);
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "Rate limit",
      json: async () => ({}),
    });

    const caller = appRouter.createCaller(fakeCtx());
    await expect(
      caller.processos.resumoIA({ cnj: "0001234-56.2024.8.06.0001", monitoramentoId: 42 }),
    ).rejects.toThrow(/Falha ao gerar resumo|OpenAI 429/i);
  });
});

describe("processos.resumoIA — fluxo Anthropic (fallback)", () => {
  it("usa Anthropic quando OpenAI não está configurado", async () => {
    dbState.monitoramento = MON_BASE;
    dbState.adminIntegracoesOpenai = null;
    dbState.adminIntegracoesAnthropic = {
      apiKeyEncrypted: "enc",
      apiKeyIv: "iv",
      apiKeyTag: "tag",
    };
    adminDecrypt.mockReturnValue("sk-ant-fake");
    consumirCreditosEscritorio.mockResolvedValue(undefined);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ text: "Resumo gerado via Claude." }],
      }),
      text: async () => "",
    });

    const caller = appRouter.createCaller(fakeCtx());
    const result = await caller.processos.resumoIA({
      cnj: "0001234-56.2024.8.06.0001",
      monitoramentoId: 42,
    });

    expect(result.resumo).toBe("Resumo gerado via Claude.");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-api-key": "sk-ant-fake",
        }),
      }),
    );
  });
});


/**
 * Testes do gate `exigirPermAgente` — fecha vazamento descoberto onde
 * `obter`, `toggleAtivo`, `testar`, `uploadArquivo`, `adicionarLink`,
 * `adicionarTexto`, `deletarDocumento` não checavam permissão.
 *
 * Cenários cobertos:
 * - Sem escritório → FORBIDDEN (mensagem default do checkPermission)
 * - Dono: bypass total (vê/edita/exclui qualquer agente)
 * - Atendente (verProprios=true): bloqueia agente de outro user
 * - Atendente: passa pro próprio agente
 * - Estagiário: matriz legada bloqueia agentesIa direto
 *
 * Usa mocks de getDb + getEscritorioPorUsuario pra não depender de banco
 * real. Mesmo padrão dos outros tests do check-permission.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const getEscritorioPorUsuarioMock = vi.fn();
const dbSelectMock = vi.fn();

vi.mock("../escritorio/db-escritorio", () => ({
  getEscritorioPorUsuario: (...a: unknown[]) => getEscritorioPorUsuarioMock(...a),
}));

// Mock de getDb retorna um objeto fake com .select().from().where().limit()
// — apenas o suficiente pra podeMexerNoAgente buscar criadoPor.
vi.mock("../db", () => ({
  getDb: vi.fn(async () => ({
    select: (..._args: unknown[]) => ({
      from: (_t: unknown) => ({
        where: (_w: unknown) => ({
          limit: async (_n: number) => dbSelectMock(),
        }),
      }),
    }),
  })),
}));

const { exigirPermAgente } = await import("../integracoes/router-agentes-ia");
const { limparCachePermissoes } = await import("../escritorio/check-permission");

beforeEach(() => {
  vi.clearAllMocks();
  limparCachePermissoes();
});

describe("exigirPermAgente — dono tem bypass", () => {
  it("dono passa sem verificar ownership do agente", async () => {
    getEscritorioPorUsuarioMock.mockResolvedValue({
      escritorio: { id: 1 },
      colaborador: { id: 10, cargo: "dono" },
    });
    // Mesmo que o agente fosse de outro user, o dono passa.
    dbSelectMock.mockResolvedValue([{ criadoPor: 999 }]);

    const perm = await exigirPermAgente(1, "ver", 42);
    expect(perm.allowed).toBe(true);
    expect(perm.verTodos).toBe(true);
    expect(perm.escritorioId).toBe(1);
  });

  it("dono pode editar/excluir qualquer agente", async () => {
    getEscritorioPorUsuarioMock.mockResolvedValue({
      escritorio: { id: 1 },
      colaborador: { id: 10, cargo: "dono" },
    });
    dbSelectMock.mockResolvedValue([{ criadoPor: 999 }]);

    await expect(exigirPermAgente(1, "editar", 42)).resolves.toBeDefined();
    await expect(exigirPermAgente(1, "excluir", 42)).resolves.toBeDefined();
  });
});

describe("exigirPermAgente — sem escritório/sem permissão", () => {
  it("sem escritório vinculado → FORBIDDEN", async () => {
    getEscritorioPorUsuarioMock.mockResolvedValue(null);
    await expect(exigirPermAgente(99, "ver", null)).rejects.toThrow(/permissão/i);
  });

  it("estagiário sem entry em agentesIa: matriz legada bloqueia", async () => {
    getEscritorioPorUsuarioMock.mockResolvedValue({
      escritorio: { id: 1 },
      colaborador: { id: 40, cargo: "estagiario" },
    });
    await expect(exigirPermAgente(1, "ver", null)).rejects.toThrow(/permissão/i);
  });
});

describe("exigirPermAgente — verProprios filtra por ownership", () => {
  it("atendente (verProprios=true): BLOQUEIA agente criado por outro user", async () => {
    getEscritorioPorUsuarioMock.mockResolvedValue({
      escritorio: { id: 1 },
      colaborador: { id: 30, cargo: "atendente" },
    });
    // Agente foi criado por user 999, mas o caller é user 1
    dbSelectMock.mockResolvedValue([{ criadoPor: 999 }]);

    await expect(exigirPermAgente(1, "ver", 42)).rejects.toThrow(
      /só pode acessar seus próprios/i,
    );
  });

  it("atendente (verProprios=true): PASSA pro próprio agente", async () => {
    getEscritorioPorUsuarioMock.mockResolvedValue({
      escritorio: { id: 1 },
      colaborador: { id: 30, cargo: "atendente" },
    });
    // Agente criado pelo próprio user (1)
    dbSelectMock.mockResolvedValue([{ criadoPor: 1 }]);

    const perm = await exigirPermAgente(1, "ver", 42);
    expect(perm.allowed).toBe(true);
    expect(perm.verProprios).toBe(true);
    expect(perm.verTodos).toBe(false);
  });

  it("atendente sem agenteId: passa (gate de cargo já validou)", async () => {
    getEscritorioPorUsuarioMock.mockResolvedValue({
      escritorio: { id: 1 },
      colaborador: { id: 30, cargo: "atendente" },
    });

    const perm = await exigirPermAgente(1, "ver", null);
    expect(perm.allowed).toBe(true);
  });

  it("atendente em ação 'editar': matriz legada bloqueia (criar=false)", async () => {
    // PERMISSOES_LEGADO.atendente.agentesIa: ver=true, criar=false, editar=false
    getEscritorioPorUsuarioMock.mockResolvedValue({
      escritorio: { id: 1 },
      colaborador: { id: 30, cargo: "atendente" },
    });

    await expect(exigirPermAgente(1, "editar", null)).rejects.toThrow(
      /Sem permissão para editar/i,
    );
  });

  it("atendente em ação 'criar': bloqueado (criar=false na matriz)", async () => {
    getEscritorioPorUsuarioMock.mockResolvedValue({
      escritorio: { id: 1 },
      colaborador: { id: 30, cargo: "atendente" },
    });

    await expect(exigirPermAgente(1, "criar", null)).rejects.toThrow(
      /Sem permissão para criar/i,
    );
  });
});

describe("exigirPermAgente — agente não existente", () => {
  it("agente inexistente + verProprios → bloqueia (ownership check falha)", async () => {
    getEscritorioPorUsuarioMock.mockResolvedValue({
      escritorio: { id: 1 },
      colaborador: { id: 30, cargo: "atendente" },
    });
    dbSelectMock.mockResolvedValue([]); // nenhum agente

    await expect(exigirPermAgente(1, "ver", 9999)).rejects.toThrow(
      /só pode acessar seus próprios/i,
    );
  });
});

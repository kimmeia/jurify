/**
 * Permissões da AGENDA por cargo legado.
 *
 * Pega o snapshot do que cada cargo padrão pode fazer no módulo `agenda`
 * — usado tanto pelos gates do `router-agenda.ts` (criar/editar/excluir)
 * quanto pelo botão "Novo evento" na UI (que agora consulta
 * `minhasPermissoes` antes de renderizar).
 *
 * Se algum dia alguém mexer nos defaults de PERMISSOES_LEGADO ou na
 * lógica de fallback de `checkPermission`, esses testes quebram —
 * forçando atualização consciente.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const getEscritorioPorUsuarioMock = vi.fn();

vi.mock("../escritorio/db-escritorio", () => ({
  getEscritorioPorUsuario: (...a: unknown[]) => getEscritorioPorUsuarioMock(...a),
}));

// getDb → null força fallback pra PERMISSOES_LEGADO (sem cargo personalizado
// vindo do banco). Isso isola o teste do estado real do DB e exercita a
// matriz default que é a fonte da verdade pros testes de UI.
vi.mock("../db", () => ({
  getDb: vi.fn(async () => null),
}));

const { checkPermission, limparCachePermissoes } = await import(
  "../escritorio/check-permission"
);

beforeEach(() => {
  vi.clearAllMocks();
  limparCachePermissoes();
});

describe("agenda:ver — quem pode ver o módulo no menu", () => {
  it.each([
    ["dono", true],
    ["gestor", true],
    ["atendente", true],
    ["estagiario", true],
    ["sdr", true],
  ] as const)("%s pode ver agenda (allowed=%s)", async (cargo, esperado) => {
    getEscritorioPorUsuarioMock.mockResolvedValue({
      escritorio: { id: 1 },
      colaborador: { id: 10, cargo },
    });

    const r = await checkPermission(1, "agenda", "ver");

    expect(r.allowed).toBe(esperado);
  });
});

describe("agenda:criar — quem vê o botão 'Novo evento'", () => {
  it("dono pode criar (verTodos=true, criar=true)", async () => {
    getEscritorioPorUsuarioMock.mockResolvedValue({
      escritorio: { id: 1 },
      colaborador: { id: 10, cargo: "dono" },
    });

    const r = await checkPermission(1, "agenda", "criar");

    expect(r.allowed).toBe(true);
    expect(r.criar).toBe(true);
    expect(r.verTodos).toBe(true);
  });

  it("gestor pode criar", async () => {
    getEscritorioPorUsuarioMock.mockResolvedValue({
      escritorio: { id: 1 },
      colaborador: { id: 20, cargo: "gestor" },
    });

    const r = await checkPermission(1, "agenda", "criar");

    expect(r.allowed).toBe(true);
    expect(r.criar).toBe(true);
  });

  it("atendente pode criar (vê próprios)", async () => {
    getEscritorioPorUsuarioMock.mockResolvedValue({
      escritorio: { id: 1 },
      colaborador: { id: 30, cargo: "atendente" },
    });

    const r = await checkPermission(1, "agenda", "criar");

    expect(r.allowed).toBe(true);
    expect(r.criar).toBe(true);
    expect(r.verTodos).toBe(false);
    expect(r.verProprios).toBe(true);
  });

  it("sdr pode criar (vê próprios)", async () => {
    getEscritorioPorUsuarioMock.mockResolvedValue({
      escritorio: { id: 1 },
      colaborador: { id: 40, cargo: "sdr" },
    });

    const r = await checkPermission(1, "agenda", "criar");

    expect(r.allowed).toBe(true);
    expect(r.criar).toBe(true);
  });

  it("ESTAGIÁRIO NÃO pode criar — botão deve ficar escondido na UI", async () => {
    // O bug original "tela só pra dono" não existia: era cache do browser.
    // Mas o frontend agora respeita esse default (esconde o botão).
    getEscritorioPorUsuarioMock.mockResolvedValue({
      escritorio: { id: 1 },
      colaborador: { id: 50, cargo: "estagiario" },
    });

    const r = await checkPermission(1, "agenda", "criar");

    expect(r.allowed).toBe(false);
    expect(r.criar).toBe(false);
    expect(r.verProprios).toBe(true); // ainda VÊ, só não cria
  });
});

describe("agenda:editar — quem vê 'Editar' e 'Concluir'", () => {
  it.each([
    ["dono", true],
    ["gestor", true],
    ["atendente", true],
    ["sdr", true],
  ] as const)("%s pode editar", async (cargo, esperado) => {
    getEscritorioPorUsuarioMock.mockResolvedValue({
      escritorio: { id: 1 },
      colaborador: { id: 10, cargo },
    });

    const r = await checkPermission(1, "agenda", "editar");

    expect(r.allowed).toBe(esperado);
    expect(r.editar).toBe(esperado);
  });

  it("estagiário NÃO pode editar — botões Editar/Concluir escondidos", async () => {
    getEscritorioPorUsuarioMock.mockResolvedValue({
      escritorio: { id: 1 },
      colaborador: { id: 50, cargo: "estagiario" },
    });

    const r = await checkPermission(1, "agenda", "editar");

    expect(r.editar).toBe(false);
    expect(r.allowed).toBe(false);
  });
});

describe("agenda:excluir — só Dono", () => {
  it("apenas dono tem excluir=true por padrão", async () => {
    const cargos: Array<{ cargo: "dono" | "gestor" | "atendente" | "estagiario" | "sdr"; pode: boolean }> = [
      { cargo: "dono", pode: true },
      { cargo: "gestor", pode: false },
      { cargo: "atendente", pode: false },
      { cargo: "estagiario", pode: false },
      { cargo: "sdr", pode: false },
    ];

    for (const { cargo, pode } of cargos) {
      limparCachePermissoes();
      getEscritorioPorUsuarioMock.mockResolvedValue({
        escritorio: { id: 1 },
        colaborador: { id: 100, cargo },
      });
      const r = await checkPermission(1, "agenda", "excluir");
      expect(r.excluir, `${cargo} excluir`).toBe(pode);
    }
  });
});

/**
 * Testes do bug #9 — `checkPermissionAdminOuMatriz`.
 *
 * Antes do fix: procedures críticos (configurar Cal.com/WhatsApp/agentes-IA,
 * gerenciar modelos de contrato, atribuir cargos, excluir/unificar clientes)
 * tinham hardcode `cargo === "dono" || cargo === "gestor"`. Cargos
 * personalizados criados via UI (`Cargos personalizados`) ficavam
 * BLOQUEADOS mesmo com a matriz toda marcada — o admin criava "Sócio
 * Júnior" com permissões completas e o usuário ainda recebia "Sem
 * permissão".
 *
 * Fix: helper que mantém o bypass legacy (dono/gestor sempre passam) E
 * delega cargos personalizados pra matriz de permissões via `checkPermission`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const getEscritorioPorUsuarioMock = vi.fn();
const checkPermissionMock = vi.fn();

vi.mock("../escritorio/db-escritorio", () => ({
  getEscritorioPorUsuario: (...a: unknown[]) => getEscritorioPorUsuarioMock(...a),
}));

// Mock interno: precisamos espionar `checkPermission` que vive no MESMO
// módulo da função sob teste. Vitest não permite mockar imports do mesmo
// módulo de forma natural, então preferimos integrar via getDb retornar
// null (sem cargo personalizado, cai no fallback legado).
vi.mock("../db", () => ({
  getDb: vi.fn(async () => null),
}));

const { checkPermissionAdminOuMatriz } = await import(
  "../escritorio/check-permission"
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("checkPermissionAdminOuMatriz — bypass legacy", () => {
  it("dono: SEMPRE allowed, retorna verTodos/criar/editar/excluir=true", async () => {
    getEscritorioPorUsuarioMock.mockResolvedValue({
      escritorio: { id: 1 },
      colaborador: { id: 10, cargo: "dono" },
    });

    const r = await checkPermissionAdminOuMatriz(1, "configuracoes", "editar");

    expect(r.allowed).toBe(true);
    expect(r.verTodos).toBe(true);
    expect(r.criar).toBe(true);
    expect(r.editar).toBe(true);
    expect(r.excluir).toBe(true);
    expect(r.escritorioId).toBe(1);
    expect(r.colaboradorId).toBe(10);
    expect(r.cargo).toBe("dono");
  });

  it("gestor: SEMPRE allowed (legado preservado, mesmo se matriz negasse)", async () => {
    // Matriz legado pra gestor bloqueia "configuracoes" (perm 0,0,0,0,0).
    // Mas o helper preserva o hardcode antigo → allowed=true.
    getEscritorioPorUsuarioMock.mockResolvedValue({
      escritorio: { id: 1 },
      colaborador: { id: 20, cargo: "gestor" },
    });

    const r = await checkPermissionAdminOuMatriz(1, "configuracoes", "editar");

    expect(r.allowed).toBe(true);
    expect(r.cargo).toBe("gestor");
  });

  it("dono: bypass funciona pra QUALQUER módulo solicitado", async () => {
    getEscritorioPorUsuarioMock.mockResolvedValue({
      escritorio: { id: 1 },
      colaborador: { id: 10, cargo: "dono" },
    });

    for (const modulo of ["configuracoes", "clientes", "equipe", "agentesIa", "inexistente"]) {
      const r = await checkPermissionAdminOuMatriz(1, modulo);
      expect(r.allowed).toBe(true);
    }
  });
});

describe("checkPermissionAdminOuMatriz — delegação à matriz", () => {
  it("atendente em 'configuracoes' editar: matriz LEGADO bloqueia", async () => {
    // Atendente no PERMISSOES_LEGADO: configuracoes = (false,false,false,false,false)
    getEscritorioPorUsuarioMock.mockResolvedValue({
      escritorio: { id: 1 },
      colaborador: { id: 30, cargo: "atendente" },
    });

    const r = await checkPermissionAdminOuMatriz(1, "configuracoes", "editar");

    expect(r.allowed).toBe(false);
  });

  it("estagiario em 'agentesIa' editar: matriz LEGADO bloqueia (estagiario = false)", async () => {
    getEscritorioPorUsuarioMock.mockResolvedValue({
      escritorio: { id: 1 },
      colaborador: { id: 40, cargo: "estagiario" },
    });

    const r = await checkPermissionAdminOuMatriz(1, "agentesIa", "editar");

    expect(r.allowed).toBe(false);
  });

  it("sem escritório: bloqueia com defaults zerados (sem crash)", async () => {
    getEscritorioPorUsuarioMock.mockResolvedValue(null);

    const r = await checkPermissionAdminOuMatriz(999, "configuracoes", "editar");

    expect(r.allowed).toBe(false);
    expect(r.escritorioId).toBe(0);
    expect(r.colaboradorId).toBe(0);
    expect(r.cargo).toBe("");
  });
});

describe("checkPermissionAdminOuMatriz — proteção do fix #9", () => {
  it("dono nunca quebra: configurar integração permitido independente da matriz", async () => {
    // Cenário do bug: antes do fix, hardcode `cargo === "dono" || === "gestor"`
    // permitia dono. O helper preserva esse direito de forma DURÁVEL —
    // mesmo se admin mexer na matriz e quebrar a entry "configuracoes" do
    // dono (que normalmente é true), bypass garante que dono nunca perde
    // acesso a configurar integrações.
    getEscritorioPorUsuarioMock.mockResolvedValue({
      escritorio: { id: 5 },
      colaborador: { id: 50, cargo: "dono" },
    });

    const r = await checkPermissionAdminOuMatriz(1, "configuracoes", "editar");

    expect(r.allowed).toBe(true);
  });

  it("gestor: pode configurar integrações mesmo que matriz legado bloqueie 'configuracoes'", async () => {
    // Cenário cobertura: gestor no PERMISSOES_LEGADO tem configuracoes=false.
    // Sem o bypass, gestor perderia acesso depois da migração — quebra
    // comportamento histórico. Bypass preserva.
    getEscritorioPorUsuarioMock.mockResolvedValue({
      escritorio: { id: 5 },
      colaborador: { id: 60, cargo: "gestor" },
    });

    const r = await checkPermissionAdminOuMatriz(1, "configuracoes", "editar");

    expect(r.allowed).toBe(true);
  });
});

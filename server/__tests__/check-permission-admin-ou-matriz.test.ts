/**
 * Testes do `checkPermissionAdminOuMatriz`.
 *
 * Histórico do helper:
 * - Fix do bug #9: ANTES, procedures críticos (Cal.com/WhatsApp/agentes-IA,
 *   modelos de contrato, atribuir cargos, excluir/unificar clientes) tinham
 *   hardcode `cargo === "dono" || cargo === "gestor"`. Cargos personalizados
 *   criados via UI ficavam BLOQUEADOS mesmo com toda a matriz marcada.
 *   Helper passou a delegar pra matriz oficial.
 * - Mudança Gestor-segue-matriz: bypass do Gestor removido. Agora SÓ DONO
 *   tem bypass; Gestor e demais cargos obedecem rigorosamente à matriz.
 *   O default do Gestor em PERMISSOES_LEGADO ganha configurações/equipe:editar
 *   pra preservar comportamento histórico quando ninguém customizou.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const getEscritorioPorUsuarioMock = vi.fn();

vi.mock("../escritorio/db-escritorio", () => ({
  getEscritorioPorUsuario: (...a: unknown[]) => getEscritorioPorUsuarioMock(...a),
}));

// getDb → null força fallback pra PERMISSOES_LEGADO (sem cargo personalizado).
vi.mock("../db", () => ({
  getDb: vi.fn(async () => null),
}));

const { checkPermissionAdminOuMatriz, limparCachePermissoes } = await import(
  "../escritorio/check-permission"
);

beforeEach(() => {
  vi.clearAllMocks();
  // O cache de checkPermission é module-global e vaza entre testes
  // (mesmo userId, mesma key → mesma entry). Limpa pra isolar.
  limparCachePermissoes();
});

describe("checkPermissionAdminOuMatriz — bypass do dono", () => {
  it("dono: SEMPRE allowed, retorna tudo true (superuser do escritório)", async () => {
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

describe("checkPermissionAdminOuMatriz — Gestor obedece a matriz", () => {
  it("gestor: matriz LEGADO default agora concede configurações:editar", async () => {
    // Sem bypass: gestor passa pela matriz. Default novo:
    //   configuracoes: verTodos=true, verProprios=true, criar=true, editar=true, excluir=false
    getEscritorioPorUsuarioMock.mockResolvedValue({
      escritorio: { id: 1 },
      colaborador: { id: 20, cargo: "gestor" },
    });

    const r = await checkPermissionAdminOuMatriz(1, "configuracoes", "editar");

    expect(r.allowed).toBe(true);
    expect(r.editar).toBe(true);
    expect(r.cargo).toBe("gestor");
  });

  it("gestor: matriz LEGADO concede equipe:editar (atribuir cargos)", async () => {
    getEscritorioPorUsuarioMock.mockResolvedValue({
      escritorio: { id: 1 },
      colaborador: { id: 20, cargo: "gestor" },
    });

    const r = await checkPermissionAdminOuMatriz(1, "equipe", "editar");

    expect(r.allowed).toBe(true);
    expect(r.editar).toBe(true);
  });

  it("gestor: matriz LEGADO concede clientes:excluir (excluir/unificar)", async () => {
    getEscritorioPorUsuarioMock.mockResolvedValue({
      escritorio: { id: 1 },
      colaborador: { id: 20, cargo: "gestor" },
    });

    const r = await checkPermissionAdminOuMatriz(1, "clientes", "excluir");

    expect(r.allowed).toBe(true);
    expect(r.excluir).toBe(true);
  });

  it("gestor: matriz pode BLOQUEAR (novo comportamento — dono customizou)", async () => {
    // Simula cargo personalizado "Gestor" onde dono desmarcou configurações.
    // Mockamos getDb retornando um db falso com select pra esse caso.
    // Como aqui usamos getDb=null, o teste fica no fallback legado;
    // pra cobrir o caminho personalizado, ver permissoes-cargo.test.ts
    // ou outro teste de integração. Aqui só validamos que se a matriz
    // estivesse zerada, o gestor seria bloqueado — usamos um módulo
    // que o gestor legado NÃO tem entry: 'inexistente'.
    getEscritorioPorUsuarioMock.mockResolvedValue({
      escritorio: { id: 1 },
      colaborador: { id: 20, cargo: "gestor" },
    });

    const r = await checkPermissionAdminOuMatriz(1, "inexistente", "editar");

    expect(r.allowed).toBe(false);
  });
});

describe("checkPermissionAdminOuMatriz — delegação à matriz pros demais cargos", () => {
  it("atendente em 'configuracoes' editar: matriz LEGADO bloqueia", async () => {
    getEscritorioPorUsuarioMock.mockResolvedValue({
      escritorio: { id: 1 },
      colaborador: { id: 30, cargo: "atendente" },
    });

    const r = await checkPermissionAdminOuMatriz(1, "configuracoes", "editar");

    expect(r.allowed).toBe(false);
  });

  it("estagiario em 'agentesIa' editar: matriz LEGADO bloqueia", async () => {
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
  it("dono nunca quebra: bypass dura mesmo se matriz ficar inconsistente", async () => {
    getEscritorioPorUsuarioMock.mockResolvedValue({
      escritorio: { id: 5 },
      colaborador: { id: 50, cargo: "dono" },
    });

    const r = await checkPermissionAdminOuMatriz(1, "configuracoes", "editar");

    expect(r.allowed).toBe(true);
  });
});

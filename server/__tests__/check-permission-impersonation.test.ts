/**
 * Bypass de superuser quando um admin está impersonando um escritório.
 *
 * Decisão de produto: o admin que impersona tem acesso TOTAL ao escritório-alvo
 * (mesmo padrão do router-backup). O checkPermission só recebe o `userId` do
 * alvo — a flag de impersonação chega via AsyncLocalStorage
 * (`runComContextoImpersonacao`), setado no middleware `requireUser`.
 *
 * Propriedade crítica de segurança testada aqui: o bypass NÃO pode vazar pro
 * cache compartilhado — senão um resultado impersonado contaminaria a sessão
 * normal do mesmo usuário (e vice-versa).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const getEscritorioPorUsuarioMock = vi.fn();

vi.mock("../escritorio/db-escritorio", () => ({
  getEscritorioPorUsuario: (...a: unknown[]) => getEscritorioPorUsuarioMock(...a),
}));

// getDb → null isola do banco (força a matriz legada; irrelevante no bypass).
vi.mock("../db", () => ({ getDb: vi.fn(async () => null) }));

const { checkPermission, limparCachePermissoes } = await import(
  "../escritorio/check-permission"
);
const { runComContextoImpersonacao } = await import(
  "../_core/impersonation-context"
);

// Alvo com o cargo MAIS restrito (estagiário não cria cliente) — se o bypass
// funciona pra ele, funciona pra qualquer cargo.
const ALVO = { escritorio: { id: 7 }, colaborador: { id: 99, cargo: "estagiario" } };

beforeEach(() => {
  vi.clearAllMocks();
  limparCachePermissoes();
  getEscritorioPorUsuarioMock.mockResolvedValue(ALVO);
});

describe("checkPermission — bypass de admin impersonando", () => {
  it("SEM impersonação: estagiário não pode criar cliente", async () => {
    const r = await checkPermission(1, "clientes", "criar");
    expect(r.allowed).toBe(false);
    expect(r.criar).toBe(false);
  });

  it("SOB impersonação: acesso total, com a base (escritório/colaborador) do alvo", async () => {
    const r = await runComContextoImpersonacao("admin-openid", () =>
      checkPermission(1, "clientes", "criar"),
    );
    expect(r.allowed).toBe(true);
    expect(r.criar).toBe(true);
    expect(r.editar).toBe(true);
    expect(r.excluir).toBe(true);
    expect(r.verTodos).toBe(true);
    // base preservada = ids do ALVO (procedures usam pra filtrar/inserir)
    expect(r.escritorioId).toBe(7);
    expect(r.colaboradorId).toBe(99);
  });

  it("impersonatedBy undefined NÃO bypassa", async () => {
    const r = await runComContextoImpersonacao(undefined, () =>
      checkPermission(1, "clientes", "criar"),
    );
    expect(r.allowed).toBe(false);
  });

  it("bypass NÃO vaza pro cache: request normal seguinte continua negada", async () => {
    const imp = await runComContextoImpersonacao("admin", () =>
      checkPermission(1, "clientes", "criar"),
    );
    expect(imp.allowed).toBe(true);
    const normal = await checkPermission(1, "clientes", "criar");
    expect(normal.allowed).toBe(false);
  });

  it("cache de request normal NÃO bloqueia o bypass de impersonação", async () => {
    const normal = await checkPermission(1, "clientes", "criar"); // cacheia negado
    expect(normal.allowed).toBe(false);
    const imp = await runComContextoImpersonacao("admin", () =>
      checkPermission(1, "clientes", "criar"),
    );
    expect(imp.allowed).toBe(true); // bypass ignora o cache
  });
});

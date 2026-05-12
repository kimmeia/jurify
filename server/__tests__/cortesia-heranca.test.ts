/**
 * Testes — `resolveSubscriptionComHeranca`.
 *
 * Garante o cenário do bug reportado: cliente é dono do escritório,
 * colaboradores precisam herdar o acesso (cortesia/plano) liberado pelo
 * dono. Lógica pura — sem mocks de Drizzle.
 */

import { describe, it, expect, vi } from "vitest";
import { resolveSubscriptionComHeranca } from "../db";

describe("resolveSubscriptionComHeranca", () => {
  it("sub própria active: retorna a própria, não consulta dono", async () => {
    const getSub = vi.fn(async (uid: number) =>
      uid === 10 ? { userId: 10, status: "active", cortesia: false } : null,
    );
    const getOwner = vi.fn(async () => null);

    const sub = await resolveSubscriptionComHeranca(10, getSub, getOwner);
    expect((sub as any)?.userId).toBe(10);
    expect(getOwner).not.toHaveBeenCalled();
  });

  it("sub própria cortesia: retorna a própria", async () => {
    const getSub = vi.fn(async (uid: number) =>
      uid === 10 ? { userId: 10, cortesia: true, cortesiaExpiraEm: null } : null,
    );
    const getOwner = vi.fn(async () => null);

    const sub = await resolveSubscriptionComHeranca(10, getSub, getOwner);
    expect((sub as any)?.cortesia).toBe(true);
    expect(getOwner).not.toHaveBeenCalled();
  });

  it("colaborador sem sub + dono com cortesia: herda do dono", async () => {
    const getSub = vi.fn(async (uid: number) => {
      if (uid === 20) return { userId: 20, cortesia: true, cortesiaExpiraEm: null };
      return null;
    });
    const getOwner = vi.fn(async (uid: number) => (uid === 10 ? 20 : null));

    const sub = await resolveSubscriptionComHeranca(10, getSub, getOwner);
    expect((sub as any)?.userId).toBe(20);
    expect((sub as any)?.cortesia).toBe(true);
  });

  it("colaborador sem sub + dono com plano active: herda do dono", async () => {
    const getSub = vi.fn(async (uid: number) => {
      if (uid === 20) return { userId: 20, status: "active", cortesia: false };
      return null;
    });
    const getOwner = vi.fn(async (uid: number) => (uid === 10 ? 20 : null));

    const sub = await resolveSubscriptionComHeranca(10, getSub, getOwner);
    expect((sub as any)?.userId).toBe(20);
  });

  it("user não-colaborador sem sub: null", async () => {
    const getSub = vi.fn(async () => null);
    const getOwner = vi.fn(async () => null);

    const sub = await resolveSubscriptionComHeranca(99, getSub, getOwner);
    expect(sub).toBeNull();
  });

  it("colaborador sem sub + dono também sem sub: null", async () => {
    const getSub = vi.fn(async () => null);
    const getOwner = vi.fn(async (uid: number) => (uid === 10 ? 20 : null));

    const sub = await resolveSubscriptionComHeranca(10, getSub, getOwner);
    expect(sub).toBeNull();
    expect(getSub).toHaveBeenCalledTimes(2); // própria + dono
  });

  it("guarda contra loop: ownerId == userId → não tenta herdar de si próprio", async () => {
    const getSub = vi.fn(async () => null);
    const getOwner = vi.fn(async (uid: number) => uid); // bug hipotético

    const sub = await resolveSubscriptionComHeranca(10, getSub, getOwner);
    expect(sub).toBeNull();
    // Crucial: getSub chamado UMA vez só (própria) — NÃO recursou
    expect(getSub).toHaveBeenCalledTimes(1);
  });
});

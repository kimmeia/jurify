/**
 * Testes — validação de variáveis de ambiente
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

describe("ENV validation", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("carrega variáveis normalmente em desenvolvimento", async () => {
    process.env.NODE_ENV = "development";
    process.env.JWT_SECRET = "dev-secret";
    process.env.DATABASE_URL = "mysql://dev";
    const { ENV } = await import("../_core/env");
    expect(ENV.cookieSecret).toBe("dev-secret");
    expect(ENV.databaseUrl).toBe("mysql://dev");
    expect(ENV.isProduction).toBe(false);
  });

  it("lança erro em produção quando JWT_SECRET está ausente", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.JWT_SECRET;
    process.env.DATABASE_URL = "mysql://prod";
    await expect(import("../_core/env")).rejects.toThrow(/JWT_SECRET/);
  });

  it("lança erro em produção quando DATABASE_URL está ausente", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "prod-secret";
    delete process.env.DATABASE_URL;
    await expect(import("../_core/env")).rejects.toThrow(/DATABASE_URL/);
  });

  it("não lança erro em desenvolvimento mesmo sem variáveis", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.JWT_SECRET;
    delete process.env.DATABASE_URL;
    const { ENV } = await import("../_core/env");
    expect(ENV.cookieSecret).toBe("");
    expect(ENV.isProduction).toBe(false);
  });
});

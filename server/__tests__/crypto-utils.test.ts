/**
 * Testes — crypto-utils
 * Valida criptografia AES-256-GCM e comportamento de fallback/produção.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";

describe("crypto-utils", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Chave válida (32 bytes hex)
    process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
    process.env.DATABASE_URL = "mysql://test@localhost/test";
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("criptografa e descriptografa texto simples", async () => {
    const { encrypt, decrypt } = await import("../escritorio/crypto-utils");
    const plaintext = "segredo-super-secreto-123";
    const { encrypted, iv, tag } = encrypt(plaintext);

    expect(encrypted).toBeTruthy();
    expect(iv).toHaveLength(24); // 12 bytes hex
    expect(tag).toHaveLength(32); // 16 bytes hex
    expect(encrypted).not.toBe(plaintext);

    const decrypted = decrypt(encrypted, iv, tag);
    expect(decrypted).toBe(plaintext);
  });

  it("criptografa e descriptografa objeto de configuração", async () => {
    const { encryptConfig, decryptConfig } = await import("../escritorio/crypto-utils");
    const config = { apiKey: "sk_live_abc123", webhookUrl: "https://x.com/hook" };
    const { encrypted, iv, tag } = encryptConfig(config);
    expect(decryptConfig(encrypted, iv, tag)).toEqual(config);
  });

  it("gera IVs diferentes a cada chamada (determinismo quebrado = OK)", async () => {
    const { encrypt } = await import("../escritorio/crypto-utils");
    const a = encrypt("mesma coisa");
    const b = encrypt("mesma coisa");
    expect(a.iv).not.toBe(b.iv);
    expect(a.encrypted).not.toBe(b.encrypted);
  });

  it("falha ao descriptografar com tag inválida (detecção de adulteração)", async () => {
    const { encrypt, decrypt } = await import("../escritorio/crypto-utils");
    const { encrypted, iv, tag } = encrypt("dados");
    const tagAdulterada = "0".repeat(tag.length);
    expect(() => decrypt(encrypted, iv, tagAdulterada)).toThrow();
  });

  it("maskToken oculta partes sensíveis", async () => {
    const { maskToken } = await import("../escritorio/crypto-utils");
    expect(maskToken("sk_live_abc123xyz789")).toContain("***");
    expect(maskToken("curto")).toBe("****");
  });
});

describe("crypto-utils - segurança", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("lança erro em produção sem ENCRYPTION_KEY", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.ENCRYPTION_KEY;
    process.env.DATABASE_URL = "mysql://x@h/d";
    // Força recarga para pegar env atualizada
    const mod = await import("../escritorio/crypto-utils");
    expect(() => mod.encrypt("oi")).toThrow(/ENCRYPTION_KEY/);
  });
});

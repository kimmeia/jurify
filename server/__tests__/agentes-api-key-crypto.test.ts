/**
 * Cadeado da chave da OpenAI colada dentro de um agente. Sem
 * CANAIS_ENCRYPTION_KEY o sistema gravava com uma chave de zeros; agora
 * grava com ENCRYPTION_KEY e continua lendo o que foi gravado com zeros.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";

const ZEROS = "0".repeat(64);
const GERAL = "a".repeat(64);
const DEDICADA = "b".repeat(64);

function cifrarCom(chaveHex: string, texto: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(chaveHex, "hex"), iv);
  let encrypted = cipher.update(texto, "utf8", "base64");
  encrypted += cipher.final("base64");
  return { encrypted, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

function decifrarCom(chaveHex: string, e: { encrypted: string; iv: string; tag: string }) {
  const d = crypto.createDecipheriv("aes-256-gcm", Buffer.from(chaveHex, "hex"), Buffer.from(e.iv, "base64"));
  d.setAuthTag(Buffer.from(e.tag, "base64"));
  let t = d.update(e.encrypted, "base64", "utf8");
  t += d.final("utf8");
  return t;
}

const mod = await import("../integracoes/agentes-api-key-crypto");

afterEach(() => {
  vi.unstubAllEnvs();
});

function ambiente(vars: Record<string, string | undefined>) {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("CANAIS_ENCRYPTION_KEY", "");
  vi.stubEnv("ENCRYPTION_KEY", "");
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v ?? "");
}

describe("sem CANAIS_ENCRYPTION_KEY, com ENCRYPTION_KEY (produção hoje)", () => {
  it("grava com ENCRYPTION_KEY, nunca com a chave de zeros", () => {
    ambiente({ ENCRYPTION_KEY: GERAL });
    const e = mod.encryptApiKey("sk-cliente-123");
    expect(decifrarCom(GERAL, e)).toBe("sk-cliente-123");
    expect(() => decifrarCom(ZEROS, e)).toThrow();
    expect(mod.chaveDeGravacao()).toBe(GERAL);
  });

  it("lê o que foi gravado com a chave de zeros (legado) sem recadastro", () => {
    ambiente({ ENCRYPTION_KEY: GERAL });
    const legado = cifrarCom(ZEROS, "sk-antiga");
    expect(mod.decryptApiKey(legado.encrypted, legado.iv, legado.tag)).toBe("sk-antiga");
  });

  it("lê o que gravou", () => {
    ambiente({ ENCRYPTION_KEY: GERAL });
    const e = mod.encryptApiKey("sk-nova");
    expect(mod.decryptApiKey(e.encrypted, e.iv, e.tag)).toBe("sk-nova");
  });
});

describe("com CANAIS_ENCRYPTION_KEY (se o dono colar depois)", () => {
  it("grava com a dedicada", () => {
    ambiente({ ENCRYPTION_KEY: GERAL, CANAIS_ENCRYPTION_KEY: DEDICADA });
    const e = mod.encryptApiKey("sk-x");
    expect(decifrarCom(DEDICADA, e)).toBe("sk-x");
    expect(mod.chaveDeGravacao()).toBe(DEDICADA);
  });

  it("ainda lê o gravado com ENCRYPTION_KEY e o legado de zeros", () => {
    ambiente({ ENCRYPTION_KEY: GERAL, CANAIS_ENCRYPTION_KEY: DEDICADA });
    const comGeral = cifrarCom(GERAL, "sk-geral");
    const comZeros = cifrarCom(ZEROS, "sk-zeros");
    expect(mod.decryptApiKey(comGeral.encrypted, comGeral.iv, comGeral.tag)).toBe("sk-geral");
    expect(mod.decryptApiKey(comZeros.encrypted, comZeros.iv, comZeros.tag)).toBe("sk-zeros");
    expect(mod.chavesDeLeitura()).toEqual([DEDICADA, GERAL, ZEROS]);
  });
});

describe("limites", () => {
  it("dado corrompido ou de outra chave: erro, não texto errado", () => {
    ambiente({ ENCRYPTION_KEY: GERAL });
    const outra = cifrarCom("c".repeat(64), "sk-alheia");
    expect(() => mod.decryptApiKey(outra.encrypted, outra.iv, outra.tag)).toThrow();
  });

  it("produção sem nenhuma chave: recusa gravar em vez de usar zeros", () => {
    ambiente({});
    expect(() => mod.encryptApiKey("sk")).toThrow(/CANAIS_ENCRYPTION_KEY ou ENCRYPTION_KEY/);
  });

  it("valor que não é hex de 64 é ignorado", () => {
    ambiente({ ENCRYPTION_KEY: GERAL, CANAIS_ENCRYPTION_KEY: "curta" });
    expect(mod.chaveDeGravacao()).toBe(GERAL);
  });
});

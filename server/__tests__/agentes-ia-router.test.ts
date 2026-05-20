/**
 * Testes do router de Agentes IA — focados em:
 * 1. Bug fix: chave individual do agente respeita o provider do modelo
 *    (era hardcoded "openai" mesmo pra modelos Claude → cai pra erro 401).
 * 2. Função pura `providerDoModelo` detecta corretamente Claude vs OpenAI.
 *
 * Os testes de gate de permissão precisam de DB real (checkPermission lê
 * colaboradores + cargos personalizados) e ficam para teste de integração.
 */

import { describe, expect, it, vi } from "vitest";
import { providerDoModelo, resolverAPIKey } from "../integracoes/router-agentes-ia";

// O resolverAPIKey usa crypto-utils.decrypt do admin pra key admin
// (cai no passo 4), e crypto.createCipheriv/createDecipheriv internamente.
// Pra simular uma key individual do agente, criamos via encryptApiKey
// inline com a CANAIS_ENCRYPTION_KEY default do router.
import crypto from "crypto";

const ENCRYPTION_KEY = process.env.CANAIS_ENCRYPTION_KEY || "0".repeat(64);

function encriptarLocal(apiKey: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(ENCRYPTION_KEY, "hex"), iv);
  let encrypted = cipher.update(apiKey, "utf8", "base64");
  encrypted += cipher.final("base64");
  return { encrypted, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

describe("providerDoModelo", () => {
  it("detecta Claude pra modelos claude-*", () => {
    expect(providerDoModelo("claude-sonnet-4-20250514")).toBe("anthropic");
    expect(providerDoModelo("claude-haiku-4-5-20251001")).toBe("anthropic");
    expect(providerDoModelo("CLAUDE-OPUS")).toBe("anthropic");
  });

  it("detecta OpenAI pra gpt-* / outros", () => {
    expect(providerDoModelo("gpt-4o-mini")).toBe("openai");
    expect(providerDoModelo("gpt-4o")).toBe("openai");
    expect(providerDoModelo("gpt-3.5-turbo")).toBe("openai");
  });

  it("default OpenAI quando modelo null/undefined/vazio", () => {
    expect(providerDoModelo(null)).toBe("openai");
    expect(providerDoModelo(undefined)).toBe("openai");
    expect(providerDoModelo("")).toBe("openai");
  });

  it("detecta 'anthropic' no nome do modelo (fallback)", () => {
    expect(providerDoModelo("anthropic/claude-3-opus")).toBe("anthropic");
  });
});

describe("resolverAPIKey — bug fix do provider da key individual", () => {
  // Quando o agente tem key individual e o modelo é Claude, a key deve
  // ser retornada como provider="anthropic" — antes do fix sempre voltava
  // "openai" e a chamada à Anthropic API falhava com 401.
  it("retorna anthropic quando providerPreferido=anthropic e agente tem key individual", async () => {
    const fake = encriptarLocal("sk-ant-test123");
    const agente = {
      openaiApiKey: fake.encrypted,
      apiKeyIv: fake.iv,
      apiKeyTag: fake.tag,
    };

    const r = await resolverAPIKey(1, agente, "anthropic");
    expect(r).not.toBeNull();
    expect(r!.provider).toBe("anthropic");
    expect(r!.key).toBe("sk-ant-test123");
  });

  it("retorna openai quando providerPreferido=openai e agente tem key individual", async () => {
    const fake = encriptarLocal("sk-test456");
    const agente = {
      openaiApiKey: fake.encrypted,
      apiKeyIv: fake.iv,
      apiKeyTag: fake.tag,
    };

    const r = await resolverAPIKey(1, agente, "openai");
    expect(r).not.toBeNull();
    expect(r!.provider).toBe("openai");
    expect(r!.key).toBe("sk-test456");
  });

  it("default openai quando providerPreferido omitido e há key individual", async () => {
    const fake = encriptarLocal("sk-legacy");
    const agente = {
      openaiApiKey: fake.encrypted,
      apiKeyIv: fake.iv,
      apiKeyTag: fake.tag,
    };

    const r = await resolverAPIKey(1, agente);
    expect(r).not.toBeNull();
    expect(r!.provider).toBe("openai");
  });

  it("retorna null se key individual está corrompida (decrypt falha) e DB não tem fallback", async () => {
    // Mocka getDb para retornar null — força o caminho de falha total
    vi.doMock("../db", () => ({ getDb: async () => null }));
    const { resolverAPIKey: resolverAposMock } = await import(
      "../integracoes/router-agentes-ia?test=null-db"
    ).catch(async () => {
      // Re-importa direto: vi.doMock pode não pegar arquivos já carregados.
      // Nesse caso, a função vai cair em decryptApiKey-error → fall through →
      // getDb (real) → como não há DB em CI, esperamos null.
      return await import("../integracoes/router-agentes-ia");
    });

    const agente = {
      openaiApiKey: "lixo-invalido",
      apiKeyIv: "iv",
      apiKeyTag: "tag",
    };
    const r = await resolverAposMock(1, agente, "openai");
    // Sem DB e key inválida → null
    expect(r).toBeNull();
  });
});

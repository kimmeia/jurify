/**
 * Testes da verificação HMAC SHA-256 do webhook WhatsApp Cloud (Meta).
 *
 * Bug coberto: antes do fix, `/api/webhooks/whatsapp` (POST) aceitava
 * qualquer body sem verificar `X-Hub-Signature-256`. Só o GET (verificação
 * inicial da Meta) usava o verify_token. Atacante podia forjar mensagens
 * recebidas, criar conversas falsas no CRM, disparar SmartFlow do
 * escritório (respostas automáticas, transfers, leads fake).
 *
 * Diferenças vs Cal.com:
 *  - Header com prefixo `sha256=` (Meta) vs hex puro (Cal.com).
 *  - Secret global em `admin_integracoes.config.appSecret` (não por canal).
 */

import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  calcularAssinaturaMeta,
  compararStringConstante,
  verificarAssinaturaMeta,
} from "../integracoes/meta-signature";

const APP_SECRET = "fb_app_secret_jurify_test_123456789";
const PAYLOAD_JSON = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WABA_ID_123",
      changes: [
        {
          field: "messages",
          value: {
            metadata: { phone_number_id: "PHONE_ID_456" },
            messages: [{ from: "5511999998888", text: { body: "olá" }, type: "text" }],
          },
        },
      ],
    },
  ],
});
const PAYLOAD_RAW = Buffer.from(PAYLOAD_JSON, "utf-8");

function assinarMeta(raw: Buffer, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
}

describe("calcularAssinaturaMeta", () => {
  it("retorna 'sha256=<64-chars-hex>' determinístico", () => {
    const s1 = calcularAssinaturaMeta(PAYLOAD_RAW, APP_SECRET);
    const s2 = calcularAssinaturaMeta(PAYLOAD_RAW, APP_SECRET);
    expect(s1).toBe(s2);
    expect(s1).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("muda completamente quando byte do payload muda (avalanche)", () => {
    const s1 = calcularAssinaturaMeta(PAYLOAD_RAW, APP_SECRET);
    const alterado = Buffer.from(PAYLOAD_JSON.slice(0, -2) + "X}", "utf-8");
    const s2 = calcularAssinaturaMeta(alterado, APP_SECRET);
    expect(s1).not.toBe(s2);
  });

  it("muda completamente quando appSecret muda", () => {
    const s1 = calcularAssinaturaMeta(PAYLOAD_RAW, APP_SECRET);
    const s2 = calcularAssinaturaMeta(PAYLOAD_RAW, APP_SECRET + "_outro");
    expect(s1).not.toBe(s2);
  });

  it("formato bate exatamente com `assinarMeta` (oráculo do teste)", () => {
    expect(calcularAssinaturaMeta(PAYLOAD_RAW, APP_SECRET)).toBe(
      assinarMeta(PAYLOAD_RAW, APP_SECRET),
    );
  });
});

describe("compararStringConstante", () => {
  it("retorna true para strings iguais", () => {
    const s = "sha256=" + "a".repeat(64);
    expect(compararStringConstante(s, s)).toBe(true);
  });

  it("retorna false para strings diferentes do mesmo comprimento", () => {
    const a = "sha256=" + "a".repeat(64);
    const b = "sha256=" + "b".repeat(64);
    expect(compararStringConstante(a, b)).toBe(false);
  });

  it("retorna false para comprimentos diferentes (sem lançar)", () => {
    expect(compararStringConstante("sha256=abc", "sha256=abcdef")).toBe(false);
    expect(compararStringConstante("", "sha256=abc")).toBe(false);
  });
});

describe("verificarAssinaturaMeta", () => {
  it("aceita gracioso quando appSecret não configurado (mode 'no-secret')", () => {
    const r = verificarAssinaturaMeta(PAYLOAD_RAW, undefined, undefined);
    expect(r.ok).toBe(true);
    expect(r.mode).toBe("no-secret");
  });

  it("aceita 'no-secret' também quando secret é string vazia", () => {
    const r = verificarAssinaturaMeta(PAYLOAD_RAW, "sha256=abc", "");
    expect(r.ok).toBe(true);
    expect(r.mode).toBe("no-secret");
  });

  it("rejeita quando secret cadastrado mas header ausente", () => {
    const r = verificarAssinaturaMeta(PAYLOAD_RAW, undefined, APP_SECRET);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.mode).toBe("missing-header");
      expect(r.motivo).toMatch(/X-Hub-Signature-256/);
    }
  });

  it("rejeita header sem prefixo 'sha256=' (formato Meta esperado)", () => {
    const hexPuro = createHmac("sha256", APP_SECRET).update(PAYLOAD_RAW).digest("hex");
    const r = verificarAssinaturaMeta(PAYLOAD_RAW, hexPuro, APP_SECRET);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.mode).toBe("bad-format");
      expect(r.motivo).toMatch(/sha256=/);
    }
  });

  it("rejeita header com prefixo SHA-1 antigo (deprecated)", () => {
    const sha1 = "sha1=" + createHmac("sha1", APP_SECRET).update(PAYLOAD_RAW).digest("hex");
    const r = verificarAssinaturaMeta(PAYLOAD_RAW, sha1, APP_SECRET);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.mode).toBe("bad-format");
  });

  it("rejeita quando rawBody indisponível (middleware verify não rodou)", () => {
    const assinatura = assinarMeta(PAYLOAD_RAW, APP_SECRET);
    const r = verificarAssinaturaMeta(undefined, assinatura, APP_SECRET);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.mode).toBe("mismatch");
      expect(r.motivo).toMatch(/rawBody/);
    }
  });

  it("aceita quando HMAC bate (mode 'verified')", () => {
    const assinatura = assinarMeta(PAYLOAD_RAW, APP_SECRET);
    const r = verificarAssinaturaMeta(PAYLOAD_RAW, assinatura, APP_SECRET);
    expect(r.ok).toBe(true);
    expect(r.mode).toBe("verified");
  });

  it("rejeita quando HMAC NÃO bate (payload forjado por atacante)", () => {
    const assinaturaErrada = assinarMeta(PAYLOAD_RAW, "secret_do_atacante");
    const r = verificarAssinaturaMeta(PAYLOAD_RAW, assinaturaErrada, APP_SECRET);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.mode).toBe("mismatch");
  });

  it("rejeita quando atacante muda 1 byte do payload depois de assinar (replay tampering)", () => {
    const assinaturaValida = assinarMeta(PAYLOAD_RAW, APP_SECRET);
    // Atacante captura webhook legítimo "olá", muda pra "exec(...)"
    // mas mantém a assinatura original.
    const payloadModificado = Buffer.from(
      PAYLOAD_JSON.replace("olá", "exec malicioso"),
      "utf-8",
    );
    const r = verificarAssinaturaMeta(
      payloadModificado,
      assinaturaValida,
      APP_SECRET,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.mode).toBe("mismatch");
  });

  it("é case-sensitive (hex lowercase canônico do Meta)", () => {
    const assinatura = assinarMeta(PAYLOAD_RAW, APP_SECRET);
    const upper = "sha256=" + assinatura.slice(7).toUpperCase();
    const r = verificarAssinaturaMeta(PAYLOAD_RAW, upper, APP_SECRET);
    expect(r.ok).toBe(false);
  });
});

/**
 * Testes da verificação HMAC SHA-256 do webhook Cal.com.
 *
 * Bug coberto: antes do fix, `/api/webhooks/calcom` aceitava QUALQUER POST
 * sem verificação. Atacante podia forjar BOOKING_CREATED e disparar
 * SmartFlow do escritório (cobranças, leads, automações WhatsApp/email
 * automáticas). Validação HMAC bloqueia isso, comparando o header
 * `X-Cal-Signature-256` com o hash do body raw assinado com o segredo
 * cadastrado no canal.
 *
 * Política de transição:
 *  - Canal sem secret cadastrado → aceita sem validar (mode "no-secret"),
 *    handler loga warn. Não quebra setups antigos enquanto operadores
 *    cadastram o secret no painel.
 *  - Canal COM secret cadastrado → header obrigatório, HMAC tem que bater.
 */

import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  calcularHmacSha256Hex,
  compararHexConstante,
  verificarAssinaturaCalcom,
} from "../integracoes/calcom-signature";

const SECRET = "whsec_jurify_cal_test_123456789";
const PAYLOAD_JSON = JSON.stringify({
  triggerEvent: "BOOKING_CREATED",
  createdAt: "2026-05-17T10:00:00Z",
  payload: { id: 1, uid: "abc", title: "Consulta", organizer: { email: "a@b.com" } },
});
const PAYLOAD_RAW = Buffer.from(PAYLOAD_JSON, "utf-8");

function assinar(raw: Buffer, secret: string): string {
  return createHmac("sha256", secret).update(raw).digest("hex");
}

describe("calcularHmacSha256Hex", () => {
  it("retorna 64 chars hex (SHA-256) determinístico", () => {
    const h1 = calcularHmacSha256Hex(PAYLOAD_RAW, SECRET);
    const h2 = calcularHmacSha256Hex(PAYLOAD_RAW, SECRET);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("muda completamente quando byte do payload muda (avalanche)", () => {
    const h1 = calcularHmacSha256Hex(PAYLOAD_RAW, SECRET);
    const alterado = Buffer.from(PAYLOAD_JSON.slice(0, -2) + "X}", "utf-8");
    const h2 = calcularHmacSha256Hex(alterado, SECRET);
    expect(h1).not.toBe(h2);
  });

  it("muda completamente quando secret muda", () => {
    const h1 = calcularHmacSha256Hex(PAYLOAD_RAW, SECRET);
    const h2 = calcularHmacSha256Hex(PAYLOAD_RAW, SECRET + "_outro");
    expect(h1).not.toBe(h2);
  });
});

describe("compararHexConstante", () => {
  it("retorna true para strings iguais", () => {
    const s = "a".repeat(64);
    expect(compararHexConstante(s, s)).toBe(true);
  });

  it("retorna false para strings diferentes do mesmo comprimento", () => {
    const a = "a".repeat(64);
    const b = "b".repeat(64);
    expect(compararHexConstante(a, b)).toBe(false);
  });

  it("retorna false para comprimentos diferentes (sem lançar)", () => {
    expect(compararHexConstante("abc", "abcdef")).toBe(false);
    expect(compararHexConstante("", "abc")).toBe(false);
    expect(compararHexConstante("abc", "")).toBe(false);
  });
});

describe("verificarAssinaturaCalcom", () => {
  it("aceita gracioso quando secret não configurado (mode 'no-secret')", () => {
    const r = verificarAssinaturaCalcom(PAYLOAD_RAW, undefined, undefined);
    expect(r.ok).toBe(true);
    expect(r.mode).toBe("no-secret");
  });

  it("aceita 'no-secret' também quando secret é string vazia", () => {
    const r = verificarAssinaturaCalcom(PAYLOAD_RAW, "abc", "");
    expect(r.ok).toBe(true);
    expect(r.mode).toBe("no-secret");
  });

  it("rejeita quando secret cadastrado mas header ausente", () => {
    const r = verificarAssinaturaCalcom(PAYLOAD_RAW, undefined, SECRET);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.mode).toBe("missing-header");
      expect(r.motivo).toMatch(/X-Cal-Signature-256/);
    }
  });

  it("rejeita quando rawBody indisponível (middleware verify não rodou)", () => {
    const assinatura = assinar(PAYLOAD_RAW, SECRET);
    const r = verificarAssinaturaCalcom(undefined, assinatura, SECRET);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.mode).toBe("mismatch");
      expect(r.motivo).toMatch(/rawBody/);
    }
  });

  it("aceita quando HMAC bate (mode 'verified')", () => {
    const assinatura = assinar(PAYLOAD_RAW, SECRET);
    const r = verificarAssinaturaCalcom(PAYLOAD_RAW, assinatura, SECRET);
    expect(r.ok).toBe(true);
    expect(r.mode).toBe("verified");
  });

  it("rejeita quando HMAC NÃO bate (payload forjado por atacante)", () => {
    const assinaturaErrada = assinar(PAYLOAD_RAW, "secret_do_atacante");
    const r = verificarAssinaturaCalcom(PAYLOAD_RAW, assinaturaErrada, SECRET);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.mode).toBe("mismatch");
    }
  });

  it("rejeita quando atacante muda 1 byte do payload depois de assinar", () => {
    const assinaturaValida = assinar(PAYLOAD_RAW, SECRET);
    // Atacante captura request legítima, modifica payload, mas mantém
    // assinatura original — comum em replay tampering.
    const payloadModificado = Buffer.from(
      PAYLOAD_JSON.replace("BOOKING_CREATED", "BOOKING_CANCEL"),
      "utf-8",
    );
    const r = verificarAssinaturaCalcom(
      payloadModificado,
      assinaturaValida,
      SECRET,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.mode).toBe("mismatch");
    }
  });

  it("rejeita header com comprimento diferente (não SHA-256 hex)", () => {
    const r = verificarAssinaturaCalcom(PAYLOAD_RAW, "abc123", SECRET);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.mode).toBe("mismatch");
  });

  it("é case-sensitive (hex lowercase canônico)", () => {
    const assinatura = assinar(PAYLOAD_RAW, SECRET);
    const upper = assinatura.toUpperCase();
    const r = verificarAssinaturaCalcom(PAYLOAD_RAW, upper, SECRET);
    // SHA-256 hex padrão é lowercase. Header em UPPER não bate — comportamento
    // explícito pra evitar normalização que ocultaria forja.
    expect(r.ok).toBe(false);
  });
});

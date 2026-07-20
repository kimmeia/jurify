/**
 * Testes — detecção de coexistência (CoEx) e decisão de registro na conexão.
 *
 * Regra crítica: o antigo `coexMode` era gravado "true" pra TODA conexão via
 * Embedded Signup (inclusive número dedicado) — por isso ele NUNCA pode ser
 * usado como sinal. Só `isOnBizApp` (ground truth da Meta) conta.
 */

import { describe, it, expect } from "vitest";
import { canalEhCoex, decidirRegistroConexao } from "../integracoes/coex";

describe("canalEhCoex — ground truth da config do canal", () => {
  it("isOnBizApp 'true' (persistido) ou true (cru) → CoEx", () => {
    expect(canalEhCoex({ isOnBizApp: "true" })).toBe(true);
    expect(canalEhCoex({ isOnBizApp: true })).toBe(true);
  });

  it("isOnBizApp 'false'/ausente → não é CoEx", () => {
    expect(canalEhCoex({ isOnBizApp: "false" })).toBe(false);
    expect(canalEhCoex({})).toBe(false);
    expect(canalEhCoex(null)).toBe(false);
    expect(canalEhCoex(undefined)).toBe(false);
  });

  it("coexMode legado (hardcoded em toda conexão) NÃO conta como CoEx", () => {
    expect(canalEhCoex({ coexMode: "true" })).toBe(false);
    expect(canalEhCoex({ coexMode: "true", isOnBizApp: "false" })).toBe(false);
  });
});

describe("decidirRegistroConexao — registro na Cloud API pós-connect", () => {
  it("CoEx (is_on_biz_app) → já registrado pelo pareamento QR, sem PIN", () => {
    const r = decidirRegistroConexao({ isOnBizApp: true, platformType: "NOT_APPLICABLE" });
    expect(r.coex).toBe(true);
    expect(r.jaRegistrado).toBe(true);
  });

  it("dedicado com platform_type CLOUD_API → já registrado", () => {
    const r = decidirRegistroConexao({ isOnBizApp: false, platformType: "CLOUD_API" });
    expect(r.coex).toBe(false);
    expect(r.jaRegistrado).toBe(true);
  });

  it("dedicado ainda não registrado → mantém o passo de PIN", () => {
    const r = decidirRegistroConexao({ isOnBizApp: false, platformType: "NOT_APPLICABLE" });
    expect(r.coex).toBe(false);
    expect(r.jaRegistrado).toBe(false);
  });

  it("resposta sem os campos (Graph antigo/falha parcial) → comportamento dedicado (status quo)", () => {
    const r = decidirRegistroConexao({});
    expect(r.coex).toBe(false);
    expect(r.jaRegistrado).toBe(false);
    expect(r.platformType).toBe("");
  });
});

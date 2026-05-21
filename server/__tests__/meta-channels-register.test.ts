/**
 * Testes — explicarErroRegister.
 *
 * O endpoint POST /{phone-number-id}/register devolve códigos numéricos
 * no envelope `error.code` / `error.error_subcode`. Sem tradução, o
 * usuário vê só "Erro 100" — sem saber se é PIN errado, nome de
 * exibição não aprovado, ou número bloqueado.
 */

import { describe, it, expect } from "vitest";
import { explicarErroRegister } from "../routers/meta-channels";

function fbErr(code: number, error_subcode?: number, message = "") {
  return {
    response: {
      data: {
        error: { code, error_subcode, message },
      },
    },
  };
}

describe("explicarErroRegister", () => {
  it("PIN errado (code 133006) — mensagem acionável", () => {
    const out = explicarErroRegister(fbErr(133006));
    expect(out).toContain("PIN");
    expect(out).toContain("incorreto");
  });

  it("nome de exibição mudado demais (code 133015)", () => {
    const out = explicarErroRegister(fbErr(133015));
    expect(out).toContain("nome");
    expect(out).toContain("24h");
  });

  it("número ainda no app comum (code 133005)", () => {
    const out = explicarErroRegister(fbErr(133005));
    expect(out).toContain("exclua a conta no app");
  });

  it("número não verificado por OTP (code 133010)", () => {
    const out = explicarErroRegister(fbErr(133010));
    expect(out).toContain("Verifique o número");
  });

  it("conta bloqueada (code 133016)", () => {
    const out = explicarErroRegister(fbErr(133016));
    expect(out).toContain("bloqueada");
  });

  it("display name pending review (code 100 + subcode 2388023)", () => {
    const out = explicarErroRegister(fbErr(100, 2388023));
    expect(out).toContain("Nome de exibição");
    expect(out).toContain("aprovado");
  });

  it("escopo OAuth insuficiente (code 200)", () => {
    const out = explicarErroRegister(fbErr(200));
    expect(out).toContain("Permissão");
    expect(out).toContain("whatsapp_business_management");
  });

  it("código desconhecido devolve null (caller usa fallback genérico)", () => {
    expect(explicarErroRegister(fbErr(99999))).toBeNull();
  });

  it("erro sem envelope FB devolve null", () => {
    expect(explicarErroRegister({ message: "ECONNABORTED" })).toBeNull();
  });

  it("erro undefined não quebra", () => {
    expect(explicarErroRegister(undefined)).toBeNull();
  });

  it("code 100 sem subcode 2388023 não casa display name (fallback genérico)", () => {
    // code 100 é genérico — só é display-name quando combinado com o subcode.
    expect(explicarErroRegister(fbErr(100, 999))).toBeNull();
  });
});

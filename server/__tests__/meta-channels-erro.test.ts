/**
 * Testes — explicarErroFacebook.
 *
 * O Graph API devolve erros num envelope consistente:
 *   { error: { message, type, code, fbtrace_id, ... } }
 *
 * Antes deste helper, o tRPC propagava `Error("Request failed with status
 * code 400")` do axios — mensagem inútil pro usuário final, que aparecia
 * como toast sem dica da causa (permissão faltando, token expirado, etc).
 */

import { describe, it, expect } from "vitest";
import { explicarErroFacebook } from "../routers/meta-channels";

function axiosErr(status: number, fbError?: { message?: string; fbtrace_id?: string; code?: number }) {
  return {
    message: `Request failed with status code ${status}`,
    response: {
      status,
      data: fbError ? { error: fbError } : undefined,
    },
  };
}

describe("explicarErroFacebook", () => {
  it("extrai a mensagem do Graph API quando presente", () => {
    const err = axiosErr(400, { message: "Invalid OAuth access token.", code: 190 });
    expect(explicarErroFacebook(err, "Falha X")).toBe("Falha X: Invalid OAuth access token.");
  });

  it("inclui fbtrace_id quando Facebook fornece (útil pra suporte Meta)", () => {
    const err = axiosErr(400, {
      message: "Missing permissions",
      fbtrace_id: "AbC_123-xyz=",
    });
    const out = explicarErroFacebook(err, "Falha Y");
    expect(out).toContain("Missing permissions");
    expect(out).toContain("fbtrace_id=AbC_123-xyz=");
  });

  it("sanitiza fbtrace_id removendo caracteres estranhos", () => {
    const err = axiosErr(400, {
      message: "Bla",
      fbtrace_id: "AbC<script>alert(1)</script>",
    });
    const out = explicarErroFacebook(err, "X");
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
  });

  it("cai para HTTP status quando o body não tem envelope error", () => {
    const err = axiosErr(502); // sem data.error
    expect(explicarErroFacebook(err, "Falha Z")).toBe("Falha Z: Facebook retornou HTTP 502.");
  });

  it("cai para mensagem do axios quando não há response (timeout, DNS)", () => {
    const err = { message: "ECONNABORTED" };
    expect(explicarErroFacebook(err, "Falha Q")).toBe("Falha Q: ECONNABORTED");
  });

  it("não quebra com erro undefined", () => {
    expect(explicarErroFacebook(undefined, "X")).toBe("X: erro desconhecido");
  });
});

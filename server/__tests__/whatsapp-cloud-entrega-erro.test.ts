import { describe, it, expect } from "vitest";
import { extrairMotivoFalhaEntrega } from "../integracoes/whatsapp-cloud-webhook";

describe("extrairMotivoFalhaEntrega", () => {
  it("monta 'código: detalhe' a partir de error_data.details", () => {
    const motivo = extrairMotivoFalhaEntrega({
      errors: [
        {
          code: 131026,
          title: "Message undeliverable",
          error_data: { details: "Message undeliverable." },
        },
      ],
    });
    expect(motivo).toBe("131026: Message undeliverable.");
  });

  it("cai no title quando não há details nem message", () => {
    const motivo = extrairMotivoFalhaEntrega({
      errors: [{ code: 131047, title: "Re-engagement message" }],
    });
    expect(motivo).toBe("131047: Re-engagement message");
  });

  it("usa message quando presente antes do title", () => {
    const motivo = extrairMotivoFalhaEntrega({
      errors: [{ code: 130472, title: "t", message: "User's number is part of an experiment" }],
    });
    expect(motivo).toBe("130472: User's number is part of an experiment");
  });

  it("fallback claro quando a Meta não manda errors[]", () => {
    expect(extrairMotivoFalhaEntrega({})).toBe("Falha na entrega (sem detalhe da Meta)");
    expect(extrairMotivoFalhaEntrega({ errors: [] })).toBe("Falha na entrega (sem detalhe da Meta)");
    expect(extrairMotivoFalhaEntrega(null)).toBe("Falha na entrega (sem detalhe da Meta)");
  });

  it("degrada pro código quando só há code", () => {
    expect(extrairMotivoFalhaEntrega({ errors: [{ code: 131000 }] })).toBe("131000");
  });
});

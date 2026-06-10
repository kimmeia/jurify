/**
 * Testes — resolverDestinatarioCloudApi (canal-envio).
 *
 * Regressão do bug "telefone do contato sobrescrito pelo Asaas bloqueia o
 * envio": o destino do envio Cloud API deve ser o wa_id da CONVERSA
 * (chatIdExterno, janela de 24h aberta), não o telefone cadastral — que
 * pode ter sido trocado por vínculo Asaas/edição manual e apontar pra
 * outro número ou formato sem DDI 55.
 */

import { describe, it, expect } from "vitest";
import { resolverDestinatarioCloudApi } from "../integracoes/canal-envio";

describe("resolverDestinatarioCloudApi", () => {
  it("prioriza o wa_id do chatIdExterno sobre o telefone cadastral", () => {
    const r = resolverDestinatarioCloudApi({
      telefone: "85988887777", // formato Asaas, sem DDI 55
      chatIdExterno: "5585991112222@s.whatsapp.net",
    });
    expect(r).toBe("5585991112222");
  });

  it("usa o chatIdExterno mesmo quando o telefone cadastral é de OUTRO número", () => {
    // Caso esposa: conversa é do número dela; cadastro aponta pro marido.
    const r = resolverDestinatarioCloudApi({
      telefone: "5585999990000",
      chatIdExterno: "5511987654321@s.whatsapp.net",
    });
    expect(r).toBe("5511987654321");
  });

  it("cai no telefone cadastral quando não há chatIdExterno", () => {
    const r = resolverDestinatarioCloudApi({
      telefone: "(55) 85 98888-7777",
      chatIdExterno: null,
    });
    expect(r).toBe("5585988887777");
  });

  it("JID @lid não é telefone — cai no fallback cadastral", () => {
    const r = resolverDestinatarioCloudApi({
      telefone: "5585988887777",
      chatIdExterno: "123456789012345@lid",
    });
    expect(r).toBe("5585988887777");
  });

  it("descarta device part de JID Baileys (':2') em vez de virar dígito extra", () => {
    const r = resolverDestinatarioCloudApi({
      telefone: null,
      chatIdExterno: "5511999999999:2@s.whatsapp.net",
    });
    expect(r).toBe("5511999999999");
  });

  it("retorna null quando nem chatIdExterno nem telefone são utilizáveis", () => {
    expect(resolverDestinatarioCloudApi({ telefone: "", chatIdExterno: "" })).toBeNull();
    expect(resolverDestinatarioCloudApi({ telefone: "1234", chatIdExterno: null })).toBeNull();
    expect(
      resolverDestinatarioCloudApi({ telefone: null, chatIdExterno: "987@lid" }),
    ).toBeNull();
  });

  it("chatIdExterno com número curto demais cai no telefone cadastral", () => {
    const r = resolverDestinatarioCloudApi({
      telefone: "5585988887777",
      chatIdExterno: "12345@s.whatsapp.net",
    });
    expect(r).toBe("5585988887777");
  });
});
